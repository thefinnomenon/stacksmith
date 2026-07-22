import type { ExternalCommand } from "../core/commands.js";
import type { ProjectManifest } from "../core/types.js";

const cloudflareApiBase = "https://api.cloudflare.com/client/v4";

export function r2CorsRules(manifest: ProjectManifest) {
  const origins = [
    manifest.environments.development.appUrl,
    manifest.environments.staging.appUrl,
    manifest.environments.production.appUrl
  ];

  return {
    rules: [
      {
        allowed: {
          origins,
          methods: ["GET", "HEAD", "PUT", "POST", "DELETE"],
          headers: ["Content-Type", "Authorization", "x-amz-*"]
        },
        exposeHeaders: ["ETag"],
        maxAgeSeconds: 3600
      }
    ]
  };
}

export function r2CorsJson(manifest: ProjectManifest): string {
  return `${JSON.stringify(r2CorsRules(manifest), null, 2)}\n`;
}

export function cloudflareDnsRecords(manifest: ProjectManifest) {
  const domain = manifest.domain;
  if (!domain) {
    return [];
  }

  return [
    {
      id: "root",
      type: "CNAME",
      name: domain,
      content: "cname.vercel-dns.com",
      proxied: false
    },
    {
      id: "www",
      type: "CNAME",
      name: `www.${domain}`,
      content: "cname.vercel-dns.com",
      proxied: false
    },
    {
      id: "staging",
      type: "CNAME",
      name: new URL(manifest.environments.staging.appUrl).hostname,
      content: "cname.vercel-dns.com",
      proxied: false
    },
    {
      id: "api",
      type: "CNAME",
      name: new URL(manifest.environments.production.apiUrl ?? `https://api.${domain}`).hostname,
      content: "ghs.googlehosted.com",
      proxied: true
    },
    {
      id: "files-placeholder",
      type: "TXT",
      name: `_stacksmith-files.${domain}`,
      content: "R2 custom domain should be connected through the R2 custom domain API/dashboard, not CNAMEd to r2.dev.",
      proxied: false
    }
  ];
}

export function cloudflareCommandPlan(manifest: ProjectManifest): ExternalCommand[] {
  const buckets = [
    { id: "dev", name: `${manifest.slug}-dev`, risk: "reversible" as const },
    { id: "staging", name: `${manifest.slug}-staging`, risk: "reversible" as const },
    { id: "production", name: `${manifest.slug}-production`, risk: "production-write" as const }
  ];
  const r2EventForwarder = manifest.providers.cloudflare.r2EventForwarder;
  const r2EventsEnabled = manifest.providers.cloudflare.r2Events !== false;
  const r2EventTypes = manifest.providers.cloudflare.r2EventTypes ?? ["object-create", "object-delete"];
  const r2EventQueueName = r2EventForwarder?.queueName ?? `${manifest.slug}-r2-events`;
  const r2EventWorkerName = r2EventForwarder?.workerName ?? `${manifest.slug}-r2-event-forwarder`;
  const r2EventWorkerConfig = "workers/r2-event-forwarder/wrangler.jsonc";
  const corsFile = ".stacksmith/r2-cors.json";
  const domain = manifest.domain;
  const tunnelCommands: ExternalCommand[] = domain ? [
    {
      provider: "cloudflare" as const,
      id: "cloudflare.tunnel.dev",
      description: "Create a named development tunnel.",
      command: "cloudflared",
      args: ["tunnel", "create", `${manifest.slug}-development`],
      risk: "reversible" as const,
      requiresConfirmation: true,
      env: ["CLOUDFLARE_API_TOKEN"],
      check: {
        description: "Named development tunnel exists.",
        command: "cloudflared",
        args: ["tunnel", "info", `${manifest.slug}-development`],
        env: ["CLOUDFLARE_API_TOKEN"]
      },
      undo: {
        description: "Delete the named development tunnel.",
        command: "cloudflared",
        args: ["tunnel", "delete", "--force", `${manifest.slug}-development`],
        risk: "destructive" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN"]
      }
    },
    {
      provider: "cloudflare" as const,
      id: "cloudflare.tunnel.route.dev",
      description: "Route the named development tunnel to dev subdomains.",
      command: "cloudflared",
      args: ["tunnel", "route", "dns", `${manifest.slug}-development`, new URL(manifest.environments.development.appUrl).hostname],
      risk: "reversible" as const,
      requiresConfirmation: true,
      env: ["CLOUDFLARE_API_TOKEN"],
      undo: {
        description: "Delete the DNS record created for the dev tunnel.",
        command: "curl",
        args: [
          "--request", "DELETE",
          "--url", `${cloudflareApiBase}/zones/$CLOUDFLARE_ZONE_ID/dns_records/$CLOUDFLARE_DEV_TUNNEL_DNS_RECORD_ID`,
          "--header", "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
        ],
        risk: "destructive" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "CLOUDFLARE_DEV_TUNNEL_DNS_RECORD_ID"]
      }
    }
  ] : [
    {
      provider: "cloudflare" as const,
      id: "cloudflare.tunnel.quick.web",
      description: "Start an ephemeral HTTPS quick tunnel to local Next for phone testing.",
      command: "cloudflared",
      args: ["tunnel", "--url", manifest.environments.development.appUrl],
      risk: "reversible" as const,
      requiresConfirmation: false,
      undo: {
        description: "Stop the quick tunnel process with Ctrl-C.",
        command: "stacksmith",
        args: ["noop", "cloudflare.tunnel.quick.web"],
        risk: "read-only" as const,
        requiresConfirmation: false
      }
    },
    {
      provider: "cloudflare" as const,
      id: "cloudflare.tunnel.quick.api",
      description: "Start an ephemeral HTTPS quick tunnel to the local API for phone testing.",
      command: "cloudflared",
      args: ["tunnel", "--url", manifest.environments.development.apiUrl ?? "http://localhost:4000"],
      risk: "reversible" as const,
      requiresConfirmation: false,
      undo: {
        description: "Stop the quick tunnel process with Ctrl-C.",
        command: "stacksmith",
        args: ["noop", "cloudflare.tunnel.quick.api"],
        risk: "read-only" as const,
        requiresConfirmation: false
      }
    }
  ];
  const r2EventCommands: ExternalCommand[] = r2EventsEnabled ? [
    {
      provider: "cloudflare" as const,
      id: "cloudflare.r2.events.queue",
      description: "Create the Cloudflare Queue that receives R2 bucket event notifications.",
      command: "wrangler",
      args: ["queues", "create", r2EventQueueName],
      risk: "reversible" as const,
      requiresConfirmation: true,
      env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
      check: {
        description: `${r2EventQueueName} queue exists.`,
        command: "wrangler",
        args: ["queues", "info", r2EventQueueName],
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
      },
      undo: {
        description: "Delete the R2 event queue.",
        command: "wrangler",
        args: ["queues", "delete", r2EventQueueName],
        risk: "destructive" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        check: {
          description: `${r2EventQueueName} queue exists.`,
          command: "wrangler",
          args: ["queues", "info", r2EventQueueName],
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        }
      }
    },
    {
      provider: "cloudflare" as const,
      id: "cloudflare.r2.events.worker.deploy",
      description: "Deploy the Cloudflare Worker that forwards R2 event batches to Vercel.",
      command: "wrangler",
      args: ["deploy", "--config", r2EventWorkerConfig],
      risk: "reversible" as const,
      requiresConfirmation: true,
      env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
      check: {
        description: `${r2EventWorkerName} Worker has deployments.`,
        command: "wrangler",
        args: ["deployments", "list", "--config", r2EventWorkerConfig],
        stdoutIncludes: r2EventWorkerName,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
      },
      undo: {
        description: "Delete the R2 event forwarder Worker.",
        command: "wrangler",
        args: ["delete", r2EventWorkerName],
        risk: "destructive" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
      }
    },
    {
      provider: "cloudflare" as const,
      id: "cloudflare.r2.events.worker.secret",
      description: "Set the shared R2 event webhook secret on the forwarder Worker.",
      command: "wrangler",
      args: ["secret", "put", "R2_EVENT_WEBHOOK_SECRET", "--config", r2EventWorkerConfig],
      risk: "reversible" as const,
      requiresConfirmation: true,
      env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "R2_EVENT_WEBHOOK_SECRET"],
      stdinFromEnv: "R2_EVENT_WEBHOOK_SECRET",
      check: {
        description: "R2_EVENT_WEBHOOK_SECRET exists on the forwarder Worker.",
        command: "wrangler",
        args: ["secret", "list", "--config", r2EventWorkerConfig],
        stdoutIncludes: "R2_EVENT_WEBHOOK_SECRET",
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
      },
      undo: {
        description: "Delete the R2 event webhook secret from the forwarder Worker.",
        command: "wrangler",
        args: ["secret", "delete", "R2_EVENT_WEBHOOK_SECRET", "--config", r2EventWorkerConfig],
        risk: "destructive" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        check: {
          description: "R2_EVENT_WEBHOOK_SECRET exists on the forwarder Worker.",
          command: "wrangler",
          args: ["secret", "list", "--config", r2EventWorkerConfig],
          stdoutIncludes: "R2_EVENT_WEBHOOK_SECRET",
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        }
      }
    },
    ...buckets.flatMap((bucket) => r2EventTypes.map((eventType) => ({
      provider: "cloudflare" as const,
      id: `cloudflare.r2.events.notification.${bucket.id}.${eventType}`,
      description: `Forward ${eventType} notifications from ${bucket.name} to the R2 event queue.`,
      command: "wrangler",
      args: ["r2", "bucket", "notification", "create", bucket.name, "--event-type", eventType, "--queue", r2EventQueueName],
      risk: bucket.risk,
      requiresConfirmation: true,
      env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
      check: {
        description: `${bucket.name} has an R2 notification rule for ${eventType}.`,
        command: "wrangler",
        args: ["r2", "bucket", "notification", "list", bucket.name],
        stdoutIncludes: r2EventQueueName,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
      },
      undo: {
        description: `Delete R2 notification rules for ${bucket.name} that target ${r2EventQueueName}.`,
        command: "wrangler",
        args: ["r2", "bucket", "notification", "delete", bucket.name, "--queue", r2EventQueueName],
        risk: "destructive" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        check: {
          description: `${bucket.name} has R2 notification rules for ${r2EventQueueName}.`,
          command: "wrangler",
          args: ["r2", "bucket", "notification", "list", bucket.name],
          stdoutIncludes: r2EventQueueName,
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        }
      }
    })))
  ] : [];

  return [
    ...(domain ? [
      {
        provider: "cloudflare" as const,
        id: "cloudflare.domain.search",
        description: "Search Cloudflare Registrar for the configured domain.",
        command: "curl",
        args: [
          "--request", "GET",
          "--url", `${cloudflareApiBase}/accounts/$CLOUDFLARE_ACCOUNT_ID/registrar/domain-search?q=${encodeURIComponent(domain)}&limit=5`,
          "--header", "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
        ],
        risk: "read-only" as const,
        requiresConfirmation: false,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        undo: {
          description: "Domain search is read-only and has no undo.",
          command: "stacksmith",
          args: ["noop", "cloudflare.domain.search"],
          risk: "read-only" as const,
          requiresConfirmation: false
        }
      },
      {
        provider: "cloudflare" as const,
        id: "cloudflare.domain.check",
        description: "Check authoritative availability and price immediately before registration.",
        command: "curl",
        args: [
          "--request", "POST",
          "--url", `${cloudflareApiBase}/accounts/$CLOUDFLARE_ACCOUNT_ID/registrar/domain-check`,
          "--header", "Authorization: Bearer $CLOUDFLARE_API_TOKEN",
          "--header", "Content-Type: application/json",
          "--data", JSON.stringify({ domains: [domain] })
        ],
        risk: "read-only" as const,
        requiresConfirmation: false,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        undo: {
          description: "Domain availability checks are read-only and have no undo.",
          command: "stacksmith",
          args: ["noop", "cloudflare.domain.check"],
          risk: "read-only" as const,
          requiresConfirmation: false
        }
      },
      {
        provider: "cloudflare" as const,
        id: "cloudflare.domain.register",
        description: "Register the configured domain through Cloudflare Registrar beta API.",
        command: "curl",
        args: [
          "--request", "POST",
          "--url", `${cloudflareApiBase}/accounts/$CLOUDFLARE_ACCOUNT_ID/registrar/registrations`,
          "--header", "Authorization: Bearer $CLOUDFLARE_API_TOKEN",
          "--header", "Content-Type: application/json",
          "--data", JSON.stringify({ domain, years: 1 })
        ],
        risk: "production-write" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        check: {
          description: "Domain is visible in Cloudflare Registrar search.",
          command: "curl",
          args: [
            "--request", "GET",
            "--url", `${cloudflareApiBase}/accounts/$CLOUDFLARE_ACCOUNT_ID/registrar/domain-search?q=${encodeURIComponent(domain)}&limit=5`,
            "--header", "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
          ],
          stdoutIncludes: domain,
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        },
        undo: {
          description: "Domain registration cannot be safely undone automatically.",
          command: "stacksmith",
          args: ["noop", "cloudflare.domain.register"],
          risk: "read-only" as const,
          requiresConfirmation: false
        }
      }
    ] : []),
    ...buckets.flatMap((bucket) => [
      {
        provider: "cloudflare" as const,
        id: `cloudflare.r2.${bucket.id}`,
        description: `Create the ${bucket.id} R2 bucket.`,
        command: "wrangler",
        args: ["r2", "bucket", "create", bucket.name],
        risk: bucket.risk,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        check: {
          description: `${bucket.name} R2 bucket exists.`,
          command: "wrangler",
          args: ["r2", "bucket", "list"],
          stdoutIncludes: bucket.name,
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        },
        undo: {
          description: `Delete the ${bucket.id} R2 bucket.`,
          command: "wrangler",
          args: ["r2", "bucket", "delete", bucket.name],
          risk: "destructive" as const,
          requiresConfirmation: true,
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        }
      },
      {
        provider: "cloudflare" as const,
        id: `cloudflare.r2.cors.${bucket.id}`,
        description: `Apply CORS policy to the ${bucket.id} R2 bucket.`,
        command: "wrangler",
        args: ["r2", "bucket", "cors", "set", bucket.name, "--file", corsFile],
        risk: bucket.risk,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        check: {
          description: `${bucket.name} R2 CORS policy is configured.`,
          command: "wrangler",
          args: ["r2", "bucket", "cors", "list", bucket.name],
          stdoutIncludes: "allowed",
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        },
        undo: {
          description: `Delete the ${bucket.id} R2 CORS policy.`,
          command: "wrangler",
          args: ["r2", "bucket", "cors", "delete", bucket.name],
          risk: bucket.risk,
          requiresConfirmation: true,
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        }
      },
      {
        provider: "cloudflare" as const,
        id: `cloudflare.r2.cors.list.${bucket.id}`,
        description: `Verify CORS policy for the ${bucket.id} R2 bucket.`,
        command: "wrangler",
        args: ["r2", "bucket", "cors", "list", bucket.name],
        risk: "read-only" as const,
        requiresConfirmation: false,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        undo: {
          description: "CORS verification is read-only and has no undo.",
          command: "stacksmith",
          args: ["noop", `cloudflare.r2.cors.list.${bucket.id}`],
          risk: "read-only" as const,
          requiresConfirmation: false
        }
      }
    ]),
    ...r2EventCommands,
    ...(domain ? [
      {
        provider: "cloudflare" as const,
        id: "cloudflare.r2.custom-domain.dev",
        description: "Plan R2 custom domain connection for files.dev host.",
        command: "stacksmith",
        args: ["cloudflare", "r2", "custom-domain", "connect", `${manifest.slug}-dev`, new URL(manifest.environments.development.filesUrl ?? `https://files.dev.${domain}`).hostname],
        risk: "reversible" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        undo: {
          description: "Disconnect the files.dev R2 custom domain.",
          command: "stacksmith",
          args: ["cloudflare", "r2", "custom-domain", "disconnect", `${manifest.slug}-dev`, new URL(manifest.environments.development.filesUrl ?? `https://files.dev.${domain}`).hostname],
          risk: "destructive" as const,
          requiresConfirmation: true,
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        }
      },
      {
        provider: "cloudflare" as const,
        id: "cloudflare.r2.custom-domain.staging",
        description: "Plan R2 custom domain connection for files.staging host.",
        command: "stacksmith",
        args: ["cloudflare", "r2", "custom-domain", "connect", `${manifest.slug}-staging`, new URL(manifest.environments.staging.filesUrl ?? `https://files.staging.${domain}`).hostname],
        risk: "reversible" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        undo: {
          description: "Disconnect the files.staging R2 custom domain.",
          command: "stacksmith",
          args: ["cloudflare", "r2", "custom-domain", "disconnect", `${manifest.slug}-staging`, new URL(manifest.environments.staging.filesUrl ?? `https://files.staging.${domain}`).hostname],
          risk: "destructive" as const,
          requiresConfirmation: true,
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        }
      },
      {
        provider: "cloudflare" as const,
        id: "cloudflare.r2.custom-domain.production",
        description: "Plan R2 custom domain connection for production files host.",
        command: "stacksmith",
        args: ["cloudflare", "r2", "custom-domain", "connect", `${manifest.slug}-production`, new URL(manifest.environments.production.filesUrl ?? `https://files.${domain}`).hostname],
        risk: "production-write" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        undo: {
          description: "Disconnect the production files R2 custom domain.",
          command: "stacksmith",
          args: ["cloudflare", "r2", "custom-domain", "disconnect", `${manifest.slug}-production`, new URL(manifest.environments.production.filesUrl ?? `https://files.${domain}`).hostname],
          risk: "destructive" as const,
          requiresConfirmation: true,
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
        }
      }
    ] : []),
    ...tunnelCommands,
    ...cloudflareDnsRecords(manifest).map((record) => {
      const { id, ...payload } = record;

      return {
        provider: "cloudflare" as const,
        id: `cloudflare.dns.${id}`,
        description: `Create or update DNS record ${record.name}.`,
        command: "curl",
        args: [
          "--request", "POST",
          "--url", `${cloudflareApiBase}/zones/$CLOUDFLARE_ZONE_ID/dns_records`,
          "--header", "Authorization: Bearer $CLOUDFLARE_API_TOKEN",
          "--header", "Content-Type: application/json",
          "--data", JSON.stringify(payload)
        ],
        risk: id === "root" ? "production-write" as const : "reversible" as const,
        requiresConfirmation: true,
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"],
        check: {
          description: `DNS record ${record.name} exists.`,
          command: "curl",
          args: [
            "--request", "GET",
            "--url", `${cloudflareApiBase}/zones/$CLOUDFLARE_ZONE_ID/dns_records?type=${record.type}&name=${encodeURIComponent(record.name)}`,
            "--header", "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
          ],
          stdoutIncludes: record.name,
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"]
        },
        undo: {
          description: `Delete DNS record ${record.name} by id.`,
          command: "curl",
          args: [
            "--request", "DELETE",
            "--url", `${cloudflareApiBase}/zones/$CLOUDFLARE_ZONE_ID/dns_records/$CLOUDFLARE_DNS_RECORD_ID`,
            "--header", "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
          ],
          risk: id === "root" ? "production-write" as const : "destructive" as const,
          requiresConfirmation: true,
          env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "CLOUDFLARE_DNS_RECORD_ID"]
        }
      };
    })
  ];
}
