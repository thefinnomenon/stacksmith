import { createStubProvider } from "./stub.js";

export const prismaProvider = createStubProvider({
  id: "prisma-postgres",
  label: "Prisma Postgres",
  getConfig: (manifest) => manifest.providers["prisma-postgres"],
  resources: [
    {
      kind: "database",
      name: (manifest) => `${manifest.slug}-development`
    },
    {
      kind: "database",
      name: (manifest) => `${manifest.slug}-staging`
    },
    {
      kind: "database",
      name: (manifest) => `${manifest.slug}-production`
    },
    {
      kind: "preview-database-policy",
      name: (manifest) => `${manifest.slug}-preview-databases`,
      metadata: (manifest) => ({ strategy: manifest.previews.database })
    }
  ],
  notes: ["Prisma scaffold records database intent and preview strategy. No databases are created."]
});
