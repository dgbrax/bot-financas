import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// APP_DATABASE_URL wins over DATABASE_URL. On Vercel, the Neon integration
// manages DATABASE_URL (and may point Previews at a branch without our
// migrations); APP_DATABASE_URL pins the app to the intended database.
export const databaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL

export const pool = new Pool({ connectionString: databaseUrl })
export const db = drizzle(pool, { schema })
