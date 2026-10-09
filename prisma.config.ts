import "./scripts/load-env";
import { defineConfig } from "prisma/config";

// Migrations need a direct Neon connection. The app uses the pooled DATABASE_URL.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
