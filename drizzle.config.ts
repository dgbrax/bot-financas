import { defineConfig } from 'drizzle-kit'

// Only `drizzle-kit generate` is used in this project; it does not connect to
// the database. Migrations are applied manually (see README).
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
})
