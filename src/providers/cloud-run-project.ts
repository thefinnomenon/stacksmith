export const cloudRunDefaultRegion = "us-central1";

export function defaultGoogleCloudProjectId(slug: string): string {
  const normalized = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = `ss-${normalized || "app"}`;
  const trimmed = base.slice(0, 30).replace(/-+$/g, "");

  if (trimmed.length >= 6) {
    return trimmed;
  }

  return `${trimmed}-app`.slice(0, 30).replace(/-+$/g, "");
}

export function cloudRunProjectId(manifest: {
  slug: string;
  providers: { "cloud-run": { projectId?: string } };
}): string {
  return manifest.providers["cloud-run"].projectId?.trim() || defaultGoogleCloudProjectId(manifest.slug);
}

export function cloudRunRegion(manifest: {
  providers: { "cloud-run": { region?: string } };
}): string {
  return manifest.providers["cloud-run"].region ?? cloudRunDefaultRegion;
}
