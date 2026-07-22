import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ProjectManifest } from "../core/types.js";
import { envContract, envExample } from "../core/env-contract.js";
import { r2CorsJson } from "../providers/cloudflare-plan.js";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerateAppResult {
  root: string;
  written: string[];
  skipped: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeGeneratedFile(root: string, file: GeneratedFile, force: boolean): Promise<"written" | "skipped"> {
  const target = join(root, file.path);

  if (!force && await exists(target)) {
    return "skipped";
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content, "utf8");
  return "written";
}

export function createAppFiles(manifest: ProjectManifest): GeneratedFile[] {
  const packageName = manifest.slug;
  const domain = manifest.domain ?? `${manifest.slug}.vercel.app`;
  const envNames = envContract.map((variable) => variable.name);
  const r2EventForwarder = manifest.providers.cloudflare.r2EventForwarder;
  const r2EventQueueName = r2EventForwarder?.queueName ?? `${manifest.slug}-r2-events`;
  const r2EventWorkerName = r2EventForwarder?.workerName ?? `${manifest.slug}-r2-event-forwarder`;
  const r2EventEndpointPath = r2EventForwarder?.endpointPath ?? "/api/webhook/cloudflare/r2";
  const r2EventForwardUrl = new URL(r2EventEndpointPath, manifest.environments.production.appUrl).toString();

  return [
    {
      path: "package.json",
      content: `${JSON.stringify({
        name: packageName,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          dev: "next dev",
          build: "prisma generate && next build",
          start: "next start",
          test: "node --import tsx --test \"tests/**/*.test.ts\" \"workers/**/*.test.ts\"",
          check: "tsc --noEmit",
          "db:generate": "prisma generate",
          "db:migrate": "prisma migrate deploy",
          "db:studio": "prisma studio"
        },
        dependencies: {
          "@aws-sdk/client-s3": "^3.850.0",
          "@aws-sdk/s3-request-presigner": "^3.850.0",
          "@prisma/client": "^6.12.0",
          next: "^15.4.0",
          react: "^19.1.0",
          "react-dom": "^19.1.0",
          resend: "^4.6.0",
          "zod": "^3.25.0"
        },
        devDependencies: {
          "@types/node": "^24.0.15",
          "@types/react": "^19.1.8",
          prisma: "^6.12.0",
          tsx: "^4.20.3",
          typescript: "^5.8.3"
        }
      }, null, 2)}\n`
    },
    {
      path: "tsconfig.json",
      content: `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`
    },
    {
      path: ".gitignore",
      content: `.next/
node_modules/
.env
.env.local
.env*.local
dist/
.DS_Store
`
    },
    {
      path: ".env.example",
      content: envExample(manifest, "development")
    },
    {
      path: ".stacksmith/r2-cors.json",
      content: r2CorsJson(manifest)
    },
    {
      path: "workers/r2-event-forwarder/wrangler.jsonc",
      content: `${JSON.stringify({
        "$schema": "../../node_modules/wrangler/config-schema.json",
        name: r2EventWorkerName,
        main: "src/index.ts",
        compatibility_date: "2026-07-22",
        compatibility_flags: ["nodejs_compat"],
        observability: {
          enabled: true,
          head_sampling_rate: 1
        },
        vars: {
          STACKSMITH_PROJECT: manifest.slug,
          R2_EVENT_FORWARD_URL: r2EventForwardUrl
        },
        queues: {
          consumers: [
            {
              queue: r2EventQueueName,
              max_batch_size: 10,
              max_batch_timeout: 5,
              max_retries: 5,
              dead_letter_queue: `${r2EventQueueName}-dead`
            }
          ]
        }
      }, null, 2)}\n`
    },
    {
      path: "workers/r2-event-forwarder/src/index.ts",
      content: `export interface CloudflareR2Event {
  account: string;
  action: string;
  bucket: string;
  object: {
    key: string;
    size?: number;
    eTag?: string;
  };
  eventTime: string;
  copySource?: {
    bucket: string;
    object: string;
  };
}

export interface Env {
  STACKSMITH_PROJECT: string;
  R2_EVENT_FORWARD_URL: string;
  R2_EVENT_WEBHOOK_SECRET: string;
}

type QueueMessage<T> = {
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

type QueueBatch<T> = {
  messages: Array<QueueMessage<T>>;
};

async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function forwardEvents(events: CloudflareR2Event[], env: Env) {
  const body = JSON.stringify({
    project: env.STACKSMITH_PROJECT,
    source: "cloudflare-r2",
    receivedAt: new Date().toISOString(),
    events
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = "v1=" + await hmacSha256Hex(env.R2_EVENT_WEBHOOK_SECRET, \`\${timestamp}.\${body}\`);

  const response = await fetch(env.R2_EVENT_FORWARD_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stacksmith-event": "cloudflare-r2",
      "x-stacksmith-project": env.STACKSMITH_PROJECT,
      "x-stacksmith-timestamp": timestamp,
      "x-stacksmith-signature": signature
    },
    body
  });

  if (!response.ok) {
    throw new Error(\`R2 event forward failed: \${response.status} \${await response.text()}\`);
  }

  console.log(JSON.stringify({
    event: "cloudflare.r2.forwarded",
    project: env.STACKSMITH_PROJECT,
    count: events.length
  }));
}

async function forwardMessage(message: QueueMessage<CloudflareR2Event>, env: Env) {
  try {
    await forwardEvents([message.body], env);
    message.ack();
  } catch (error) {
    console.error(JSON.stringify({
      event: "cloudflare.r2.forward_failed",
      project: env.STACKSMITH_PROJECT,
      bucket: message.body.bucket,
      objectKey: message.body.object.key,
      error: error instanceof Error ? error.message : String(error)
    }));
    message.retry({ delaySeconds: 30 });
  }
}

export default {
  async fetch() {
    return Response.json({ ok: true, service: "r2-event-forwarder" });
  },

  async queue(batch: QueueBatch<CloudflareR2Event>, env: Env) {
    await Promise.all(batch.messages.map((message) => forwardMessage(message, env)));
  }
};
`
    },
    {
      path: "next.config.ts",
      content: `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true
};

export default nextConfig;
`
    },
    {
      path: "app/layout.tsx",
      content: `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "${manifest.name}",
  description: "Generated by Stacksmith."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`
    },
    {
      path: "app/page.tsx",
      content: `import { deployment } from "@/lib/deployment";

export default function HomePage() {
  return (
    <main className="shell">
      <section>
        <p className="eyebrow">Stacksmith app</p>
        <h1>${manifest.name}</h1>
        <p>Environment: {deployment.environment}</p>
        <p>App URL: {deployment.appUrl.toString()}</p>
      </section>
    </main>
  );
}
`
    },
    {
      path: "app/globals.css",
      content: `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f7f9;
  color: #181b20;
}

body {
  margin: 0;
}

.shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
}

section {
  width: min(720px, 100%);
}

h1 {
  font-size: 48px;
  line-height: 1;
  margin: 0 0 16px;
}

p {
  color: #4d5562;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0;
  font-size: 12px;
  font-weight: 700;
  color: #7b3f00;
}
`
    },
    {
      path: "app/api/health/route.ts",
      content: `import { NextResponse } from "next/server";
import { deployment } from "@/lib/deployment";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    project: "${manifest.slug}",
    environment: deployment.environment,
    previewId: deployment.previewId,
    gitSha: deployment.gitSha,
    appUrl: deployment.appUrl.toString(),
    apiUrl: deployment.apiUrl?.toString() ?? null
  });
}
`
    },
    {
      path: "app/api/webhook/cloudflare/r2/route.ts",
      content: `import { NextRequest, NextResponse } from "next/server";
import { handleCloudflareR2EventBatch, type CloudflareR2EventEnvelope } from "@/lib/cloudflare-r2-events";
import { env } from "@/lib/env";
import { stacksmithSignatureHeader, stacksmithTimestampHeader, verifyStacksmithWebhookSignature } from "@/lib/stacksmith-webhook";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!env.R2_EVENT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "R2 event webhook secret is not configured." }, { status: 500 });
  }

  if (!verifyStacksmithWebhookSignature({
    rawBody,
    timestamp: request.headers.get(stacksmithTimestampHeader),
    signature: request.headers.get(stacksmithSignatureHeader),
    secret: env.R2_EVENT_WEBHOOK_SECRET
  })) {
    return NextResponse.json({ error: "Invalid Cloudflare R2 event signature." }, { status: 401 });
  }

  const envelope = JSON.parse(rawBody) as CloudflareR2EventEnvelope;
  const result = await handleCloudflareR2EventBatch(envelope);

  return NextResponse.json({ ok: true, ...result });
}
`
    },
    {
      path: "app/.well-known/stacksmith/route.ts",
      content: `import { NextResponse } from "next/server";
import { deployment } from "@/lib/deployment";

export async function GET() {
  return NextResponse.json({
    project: "${manifest.slug}",
    environment: deployment.environment,
    previewId: deployment.previewId,
    gitSha: deployment.gitSha,
    services: {
      database: "unchecked",
      r2: "unchecked",
      resend: "unchecked",
      stripe: "unchecked",
      posthog: "configured-by-env"
    }
  });
}
`
    },
    {
      path: "lib/stacksmith-webhook.ts",
      content: `import { createHmac, timingSafeEqual } from "node:crypto";

export const stacksmithSignatureHeader = "x-stacksmith-signature";
export const stacksmithTimestampHeader = "x-stacksmith-timestamp";

export function signStacksmithWebhookPayload(input: {
  rawBody: string;
  secret: string;
  timestamp?: string;
}) {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const signature = "v1=" + createHmac("sha256", input.secret)
    .update(\`\${timestamp}.\${input.rawBody}\`)
    .digest("hex");

  return { timestamp, signature };
}

export function verifyStacksmithWebhookSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string | undefined;
  toleranceMs?: number;
}) {
  if (!input.secret || !input.timestamp || !input.signature) {
    return false;
  }

  const timestampMs = Number(input.timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > (input.toleranceMs ?? 5 * 60 * 1000)) {
    return false;
  }

  const expected = signStacksmithWebhookPayload({
    rawBody: input.rawBody,
    secret: input.secret,
    timestamp: input.timestamp
  }).signature;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.signature);

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
`
    },
    {
      path: "lib/cloudflare-r2-events.ts",
      content: `import { deployment } from "./deployment";
import { logInfo, trackEvent } from "./observability";
import { markWebhookEventFailed, markWebhookEventProcessed, startWebhookEvent } from "./webhook-idempotency";

export type CloudflareR2Action =
  | "PutObject"
  | "CopyObject"
  | "CompleteMultipartUpload"
  | "DeleteObject"
  | "LifecycleDeletion"
  | string;

export interface CloudflareR2Event {
  account: string;
  action: CloudflareR2Action;
  bucket: string;
  object: {
    key: string;
    size?: number;
    eTag?: string;
  };
  eventTime: string;
  copySource?: {
    bucket: string;
    object: string;
  };
}

export interface CloudflareR2EventEnvelope {
  project: string;
  source: "cloudflare-r2";
  receivedAt: string;
  events: CloudflareR2Event[];
}

export function cloudflareR2EventIdempotencyKey(event: CloudflareR2Event) {
  return [
    event.account,
    event.bucket,
    event.action,
    event.object.key,
    event.object.eTag ?? "",
    event.object.size ?? "",
    event.eventTime
  ].join(":");
}

export async function handleCloudflareR2Event(event: CloudflareR2Event) {
  logInfo("cloudflare.r2.event", {
    bucket: event.bucket,
    object_key: event.object.key,
    action: event.action,
    event_time: event.eventTime
  });

  return trackEvent("cloudflare.r2.event", {
    bucket: event.bucket,
    object_key: event.object.key,
    object_size: event.object.size,
    action: event.action,
    event_time: event.eventTime
  });
}

export async function handleCloudflareR2EventBatch(envelope: CloudflareR2EventEnvelope) {
  const handled = [];
  const skipped = [];

  for (const event of envelope.events) {
    const idempotencyKey = cloudflareR2EventIdempotencyKey(event);
    const webhookEvent = await startWebhookEvent({
      projectId: envelope.project,
      environment: deployment.environment,
      provider: "cloudflare-r2",
      eventType: event.action,
      idempotencyKey,
      payload: event
    });

    if (!webhookEvent.started) {
      skipped.push(idempotencyKey);
      continue;
    }

    try {
      handled.push(await handleCloudflareR2Event(event));
      await markWebhookEventProcessed(webhookEvent.id);
    } catch (error) {
      await markWebhookEventFailed(webhookEvent.id, error);
      throw error;
    }
  }

  return {
    received: envelope.events.length,
    handled: handled.length,
    skipped: skipped.length
  };
}
`
    },
    {
      path: "lib/webhook-idempotency.ts",
      content: `import { db } from "./db";
import type { Prisma } from "@prisma/client";

export type WebhookEnvironment = "development" | "preview" | "staging" | "production";

export type WebhookEventStatus = "processing" | "processed" | "failed";

export interface StartWebhookEventInput {
  projectId: string;
  environment: WebhookEnvironment;
  provider: string;
  eventType: string;
  idempotencyKey: string;
  payload: unknown;
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "P2002";
}

export async function startWebhookEvent(input: StartWebhookEventInput) {
  try {
    const event = await db.webhookEvent.create({
      data: {
        projectId: input.projectId,
        environment: input.environment,
        provider: input.provider,
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload as Prisma.InputJsonValue
      }
    });

    return {
      started: true,
      id: event.id,
      status: event.status
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await db.webhookEvent.findUnique({
      where: {
        provider_idempotencyKey: {
          provider: input.provider,
          idempotencyKey: input.idempotencyKey
        }
      },
      select: {
        id: true,
        status: true
      }
    });

    if (existing?.status === "failed") {
      const event = await db.webhookEvent.update({
        where: { id: existing.id },
        data: {
          status: "processing",
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonValue,
          lastError: null,
          updatedAt: new Date()
        }
      });

      return {
        started: true,
        id: event.id,
        status: event.status
      };
    }

    return {
      started: false,
      id: existing?.id ?? "",
      status: existing?.status ?? "processed"
    };
  }
}

export async function markWebhookEventProcessed(id: string) {
  await db.webhookEvent.update({
    where: { id },
    data: {
      status: "processed",
      processedAt: new Date(),
      lastError: null
    }
  });
}

export async function markWebhookEventFailed(id: string, error: unknown) {
  await db.webhookEvent.update({
    where: { id },
    data: {
      status: "failed",
      failedAt: new Date(),
      lastError: error instanceof Error ? error.message : String(error)
    }
  });
}
`
    },
    {
      path: "lib/env.ts",
      content: `import { z } from "zod";

const envSchema = z.object({
  STACKSMITH_PROJECT: z.string().min(1),
  APP_ENV: z.enum(["development", "preview", "staging", "production"]).default("development"),
  APP_URL: z.string().url(),
  API_URL: z.string().url().optional(),
  FILES_URL: z.string().url().optional(),
  AUTH_CALLBACK_URL: z.string().url(),
  EMAIL_LINK_BASE_URL: z.string().url(),
  STRIPE_WEBHOOK_URL: z.string().url(),
  PREVIEW_ID: z.string().optional(),
  GITHUB_PR_NUMBER: z.string().optional(),
  GIT_BRANCH: z.string().optional(),
  GIT_SHA: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.string().min(1).optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PREFIX: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_EVENT_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  POSTHOG_PROJECT_API_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
  POSTHOG_PROJECT_SLUG: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_PROJECT_SLUG: z.string().optional(),
  POSTHOG_ALLOCATION: z.enum(["shared-incubator", "dedicated"]).optional(),
  POSTHOG_SHARED_PROJECT_NAME: z.string().optional()
});

export const env = envSchema.parse(process.env);

export const stacksmithEnvContract = ${JSON.stringify(envNames, null, 2)} as const;
`
    },
    {
      path: "lib/storage.ts",
      content: `import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type ListObjectsV2CommandOutput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageClientConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  publicUrl?: string;
  prefix?: string;
}

export interface PutObjectInput {
  key: string;
  body: string | Uint8Array | Buffer;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  key: string;
  publicUrl?: string;
  eTag?: string;
  size?: number;
  contentType?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

export interface GetObjectResult extends StoredObject {
  body: Uint8Array;
}

function trimSlashes(value: string) {
  return value.replace(/^\\/+|\\/+$/g, "");
}

function normalizePrefix(prefix: string | undefined) {
  const normalized = trimSlashes(prefix ?? "");
  return normalized ? \`\${normalized}/\` : "";
}

function normalizeKey(key: string) {
  const normalized = trimSlashes(key);
  if (!normalized) {
    throw new Error("Storage object key cannot be empty.");
  }
  return normalized;
}

function normalizeBaseUrl(value: string | undefined) {
  return value ? value.replace(/\\/+$/g, "") : undefined;
}

export class R2StorageClient {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | undefined;
  private readonly prefix: string;

  constructor(config: StorageClientConfig) {
    const endpoint = config.endpoint ?? \`https://\${config.accountId}.r2.cloudflarestorage.com\`;
    this.bucket = config.bucket;
    this.publicBaseUrl = normalizeBaseUrl(config.publicUrl);
    this.prefix = normalizePrefix(config.prefix);
    this.client = new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  objectKey(key: string) {
    return \`\${this.prefix}\${normalizeKey(key)}\`;
  }

  publicUrl(key: string) {
    return this.publicBaseUrl ? \`\${this.publicBaseUrl}/\${this.objectKey(key)}\` : undefined;
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const key = this.objectKey(input.key);
    const result = await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
      Metadata: input.metadata
    }));

    return {
      key,
      publicUrl: this.publicUrl(input.key),
      eTag: result.ETag
    };
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const objectKey = this.objectKey(key);
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey
    }));

    return {
      key: objectKey,
      publicUrl: this.publicUrl(key),
      body: await result.Body?.transformToByteArray() ?? new Uint8Array(),
      eTag: result.ETag,
      size: result.ContentLength,
      contentType: result.ContentType,
      lastModified: result.LastModified,
      metadata: result.Metadata
    };
  }

  async getText(key: string) {
    const object = await this.getObject(key);
    return new TextDecoder().decode(object.body);
  }

  async headObject(key: string): Promise<StoredObject> {
    const objectKey = this.objectKey(key);
    const result = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: objectKey
    }));

    return {
      key: objectKey,
      publicUrl: this.publicUrl(key),
      eTag: result.ETag,
      size: result.ContentLength,
      contentType: result.ContentType,
      lastModified: result.LastModified,
      metadata: result.Metadata
    };
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(key)
    }));
  }

  async listObjects(input: { prefix?: string; limit?: number } = {}) {
    const prefix = input.prefix ? this.objectKey(input.prefix) : this.prefix;
    const objects: StoredObject[] = [];
    let continuationToken: string | undefined;

    do {
      const result: ListObjectsV2CommandOutput = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: input.limit,
        ContinuationToken: continuationToken
      }));

      for (const item of result.Contents ?? []) {
        if (item.Key) {
          objects.push({
            key: item.Key,
            publicUrl: this.publicBaseUrl ? \`\${this.publicBaseUrl}/\${item.Key}\` : undefined,
            eTag: item.ETag,
            size: item.Size,
            lastModified: item.LastModified
          });
        }
      }

      continuationToken = result.NextContinuationToken;
    } while (continuationToken && (!input.limit || objects.length < input.limit));

    return input.limit ? objects.slice(0, input.limit) : objects;
  }

  async createPresignedPutUrl(input: Omit<PutObjectInput, "body"> & { expiresInSeconds?: number }) {
    return getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(input.key),
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
      Metadata: input.metadata
    }), {
      expiresIn: input.expiresInSeconds ?? 900
    });
  }

  async createPresignedGetUrl(key: string, expiresInSeconds = 900) {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(key)
    }), {
      expiresIn: expiresInSeconds
    });
  }
}

export function createStorageClient(config: Partial<StorageClientConfig> = {}) {
  const accountId = config.accountId ?? process.env.R2_ACCOUNT_ID;
  const accessKeyId = config.accessKeyId ?? process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = config.secretAccessKey ?? process.env.R2_SECRET_ACCESS_KEY;
  const bucket = config.bucket ?? process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.");
  }

  return new R2StorageClient({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: config.endpoint ?? process.env.R2_ENDPOINT,
    publicUrl: config.publicUrl ?? process.env.FILES_URL,
    prefix: config.prefix ?? process.env.R2_PREFIX
  });
}

let defaultStorageClient: R2StorageClient | undefined;

export function getStorageClient() {
  defaultStorageClient ??= createStorageClient();
  return defaultStorageClient;
}

export const storage = {
  objectKey: (key: string) => getStorageClient().objectKey(key),
  publicUrl: (key: string) => getStorageClient().publicUrl(key),
  putObject: (input: PutObjectInput) => getStorageClient().putObject(input),
  getObject: (key: string) => getStorageClient().getObject(key),
  getText: (key: string) => getStorageClient().getText(key),
  headObject: (key: string) => getStorageClient().headObject(key),
  deleteObject: (key: string) => getStorageClient().deleteObject(key),
  listObjects: (input?: { prefix?: string; limit?: number }) => getStorageClient().listObjects(input),
  createPresignedPutUrl: (input: Omit<PutObjectInput, "body"> & { expiresInSeconds?: number }) => getStorageClient().createPresignedPutUrl(input),
  createPresignedGetUrl: (key: string, expiresInSeconds?: number) => getStorageClient().createPresignedGetUrl(key, expiresInSeconds)
};
`
    },
    {
      path: "lib/deployment.ts",
      content: `import { env } from "./env";

function optionalUrl(value: string | undefined): URL | undefined {
  return value ? new URL(value) : undefined;
}

export const deployment = {
  project: env.STACKSMITH_PROJECT,
  environment: env.APP_ENV,
  previewId: env.PREVIEW_ID || undefined,
  githubPrNumber: env.GITHUB_PR_NUMBER || undefined,
  gitBranch: env.GIT_BRANCH || undefined,
  gitSha: env.GIT_SHA || undefined,
  appUrl: new URL(env.APP_URL),
  apiUrl: optionalUrl(env.API_URL),
  filesUrl: optionalUrl(env.FILES_URL),
  authCallbackUrl: new URL(env.AUTH_CALLBACK_URL),
  emailLinkBaseUrl: new URL(env.EMAIL_LINK_BASE_URL),
  stripeWebhookUrl: new URL(env.STRIPE_WEBHOOK_URL)
};
`
    },
    {
      path: "lib/observability.ts",
      content: `import { deployment } from "./deployment";
import { env } from "./env";

export type ObservabilityContext = {
  requestId?: string;
  userId?: string;
  route?: string;
  jobId?: string;
  stripeEventId?: string;
  incidentId?: string;
};

export function observabilityProperties(context: ObservabilityContext = {}) {
  return {
    project_slug: env.POSTHOG_PROJECT_SLUG ?? deployment.project,
    app_environment: deployment.environment,
    preview_id: deployment.previewId,
    github_pr: deployment.githubPrNumber,
    git_branch: deployment.gitBranch,
    git_sha: deployment.gitSha,
    posthog_allocation: env.POSTHOG_ALLOCATION ?? "shared-incubator",
    request_id: context.requestId,
    user_id: context.userId,
    route: context.route,
    job_id: context.jobId,
    stripe_event_id: context.stripeEventId,
    incident_id: context.incidentId
  };
}

export function captureError(error: unknown, context: ObservabilityContext = {}) {
  const properties = observabilityProperties(context);

  if (!env.POSTHOG_PROJECT_API_KEY && process.env.NODE_ENV !== "production") {
    console.error("[observability:error]", { error, properties });
  }

  return { error, properties };
}

export function trackEvent(name: string, properties: Record<string, unknown> = {}) {
  return {
    name,
    properties: {
      ...observabilityProperties(),
      ...properties,
    }
  };
}

export function logInfo(message: string, properties: Record<string, unknown> = {}) {
  return trackEvent("log.info", { message, ...properties });
}

export function identifyForReplay(distinctId: string, properties: Record<string, unknown> = {}) {
  return trackEvent("user.identified", { distinct_id: distinctId, ...properties });
}

export function featureFlagContext(properties: Record<string, unknown> = {}) {
  return {
    ...observabilityProperties(),
    ...properties
  };
}
`
    },
    {
      path: "tests/stacksmith-webhook.test.ts",
      content: `import assert from "node:assert/strict";
import test from "node:test";
import {
  signStacksmithWebhookPayload,
  verifyStacksmithWebhookSignature
} from "../lib/stacksmith-webhook";

test("Stacksmith webhook signatures accept valid payloads", () => {
  const rawBody = JSON.stringify({ source: "cloudflare-r2", events: [] });
  const secret = "test-secret";
  const signed = signStacksmithWebhookPayload({ rawBody, secret });

  assert.equal(verifyStacksmithWebhookSignature({
    rawBody,
    secret,
    timestamp: signed.timestamp,
    signature: signed.signature
  }), true);
});

test("Stacksmith webhook signatures reject tampered payloads", () => {
  const rawBody = JSON.stringify({ source: "cloudflare-r2", events: [] });
  const secret = "test-secret";
  const signed = signStacksmithWebhookPayload({ rawBody, secret });

  assert.equal(verifyStacksmithWebhookSignature({
    rawBody: JSON.stringify({ source: "cloudflare-r2", events: [{ object: { key: "changed" } }] }),
    secret,
    timestamp: signed.timestamp,
    signature: signed.signature
  }), false);
});
`
    },
    {
      path: "tests/storage.test.ts",
      content: `import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { R2StorageClient, type StorageClientConfig } from "../lib/storage";

const liveStorageEnabled = process.env.STACKSMITH_LIVE_R2_STORAGE_TEST === "1";
const liveStorageSkipReason = "Set STACKSMITH_LIVE_R2_STORAGE_TEST=1 and R2_* env vars to run live R2 storage tests.";

function requireR2Config(): StorageClientConfig {
  const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"] as const;
  for (const name of required) {
    assert.ok(process.env[name], \`Set \${name} to run live R2 storage tests.\`);
  }

  return {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucket: process.env.R2_BUCKET_NAME!,
    endpoint: process.env.R2_ENDPOINT,
    publicUrl: process.env.FILES_URL,
    prefix: \`stacksmith-tests/\${Date.now()}-\${randomBytes(3).toString("hex")}\`
  };
}

test("R2StorageClient normalizes prefixed keys and public URLs", () => {
  const client = new R2StorageClient({
    accountId: "account",
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "bucket",
    publicUrl: "https://files.example.com/",
    prefix: "/previews/pr-12/"
  });

  assert.equal(client.objectKey("/avatars/user.png"), "previews/pr-12/avatars/user.png");
  assert.equal(client.publicUrl("avatars/user.png"), "https://files.example.com/previews/pr-12/avatars/user.png");
  assert.throws(() => client.objectKey(""), /cannot be empty/);
});

test("R2StorageClient can put read list sign and delete objects against R2", {
  skip: liveStorageEnabled ? false : liveStorageSkipReason,
  timeout: 120_000
}, async () => {
  const config = requireR2Config();
  const client = new R2StorageClient(config);
  const key = "storage-client.txt";

  try {
    const put = await client.putObject({
      key,
      body: "hello from Stacksmith storage",
      contentType: "text/plain",
      cacheControl: "public, max-age=60",
      metadata: { purpose: "live-test" }
    });
    assert.equal(put.key, \`\${config.prefix}/\${key}\`);

    const head = await client.headObject(key);
    assert.equal(head.contentType, "text/plain");

    const text = await client.getText(key);
    assert.equal(text, "hello from Stacksmith storage");

    const listed = await client.listObjects({ prefix: "", limit: 10 });
    assert.ok(listed.some((object) => object.key === put.key));

    const signedPutUrl = await client.createPresignedPutUrl({ key: "signed.txt", contentType: "text/plain" });
    assert.match(signedPutUrl, /X-Amz-Signature/);
  } finally {
    await client.deleteObject(key);
    await client.deleteObject("signed.txt");
  }
});
`
    },
    {
      path: "workers/r2-event-forwarder/src/index.test.ts",
      content: `import assert from "node:assert/strict";
import test from "node:test";
import worker, { type CloudflareR2Event, type Env } from "./index";
import {
  stacksmithSignatureHeader,
  stacksmithTimestampHeader,
  verifyStacksmithWebhookSignature
} from "../../../lib/stacksmith-webhook";

test("R2 event forwarder posts signed event envelopes to the configured endpoint", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  const event: CloudflareR2Event = {
    account: "account",
    action: "PutObject",
    bucket: "stacksmith-test",
    object: {
      key: "uploads/example.txt",
      size: 12,
      eTag: "etag"
    },
    eventTime: new Date().toISOString()
  };
  const env: Env = {
    STACKSMITH_PROJECT: "facereel",
    R2_EVENT_FORWARD_URL: "https://example.com/api/webhook/cloudflare/r2",
    R2_EVENT_WEBHOOK_SECRET: "test-secret"
  };
  let acknowledged = false;
  let retried = false;

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    await worker.queue({
      messages: [{
        body: event,
        ack() {
          acknowledged = true;
        },
        retry() {
          retried = true;
        }
      }]
    }, env);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, env.R2_EVENT_FORWARD_URL);
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(acknowledged, true);
    assert.equal(retried, false);

    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers["x-stacksmith-event"], "cloudflare-r2");
    assert.equal(headers["x-stacksmith-project"], "facereel");
    assert.match(headers["x-stacksmith-signature"], /^v1=/);

    const rawBody = String(calls[0]?.init?.body);
    assert.equal(verifyStacksmithWebhookSignature({
      rawBody,
      secret: env.R2_EVENT_WEBHOOK_SECRET,
      timestamp: headers[stacksmithTimestampHeader],
      signature: headers[stacksmithSignatureHeader]
    }), true);

    const body = JSON.parse(rawBody);
    assert.equal(body.project, "facereel");
    assert.equal(body.source, "cloudflare-r2");
    assert.deepEqual(body.events, [event]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
`
    },
    {
      path: "lib/db.ts",
      content: `import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
`
    },
    {
      path: "lib/email.ts",
      content: `import { env } from "./env";

export function emailConfigured() {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export function defaultFromAddress() {
  return env.EMAIL_FROM ?? "hello@example.com";
}
`
    },
    {
      path: "lib/auth.ts",
      content: `export const authConfig = {
  emailOtp: true,
  magicLink: true,
  social: {
    google: false,
    github: false,
    facebook: false,
    twitter: false
  }
};
`
    },
    {
      path: "prisma/schema.prisma",
      content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  auditEvents AuditEvent[]
}

model AuditEvent {
  id         String   @id @default(cuid())
  actorId    String?
  action     String
  entityType String
  entityId   String?
  metadata   Json     @default("{}")
  requestId  String?
  createdAt  DateTime @default(now())

  actor User? @relation(fields: [actorId], references: [id])
}

model WebhookEvent {
  id             String    @id @default(cuid())
  projectId      String
  environment    String
  provider       String
  eventType      String
  idempotencyKey String
  status         String    @default("processing")
  payload        Json
  processedAt    DateTime?
  failedAt       DateTime?
  lastError      String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@unique([provider, idempotencyKey])
  @@index([projectId, environment, provider, status, createdAt])
}
`
    },
    {
      path: "README.md",
      content: `# ${manifest.name}

Generated by Stacksmith.

## Development

Copy \`.env.example\` to \`.env.local\`, fill in values, then run:

\`\`\`bash
npm install
npm run dev
\`\`\`

Health:

\`\`\`text
GET /api/health
GET /.well-known/stacksmith
\`\`\`
`
    }
  ];
}

export async function generateAppSkeleton(input: {
  manifest: ProjectManifest;
  targetDir: string;
  force?: boolean;
}): Promise<GenerateAppResult> {
  const root = resolve(input.targetDir);
  const files = createAppFiles(input.manifest);
  const written: string[] = [];
  const skipped: string[] = [];

  await mkdir(root, { recursive: true });

  for (const file of files) {
    const result = await writeGeneratedFile(root, file, input.force ?? false);
    if (result === "written") {
      written.push(file.path);
    } else {
      skipped.push(file.path);
    }
  }

  return { root, written, skipped };
}
