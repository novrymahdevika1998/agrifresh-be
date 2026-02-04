import "dotenv/config"
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set')
}
const conn = postgres(databaseUrl)
export const db = drizzle(conn, { schema })
export const { silos, sensorReadings } = schema
