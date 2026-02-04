import { pgTable, serial, varchar, timestamp, real, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Silo table - stores information about each silo
// This design allows adding new silos without schema changes
export const silos = pgTable("silos", {
  id: serial("id").primaryKey(),
  siloNumber: varchar("silo_number", { length: 10 }).notNull().unique(), // e.g., "001", "002"
  name: varchar("name", { length: 100 }), // Optional display name
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  siloNumberIdx: uniqueIndex("silo_number_idx").on(table.siloNumber),
}));

// Sensor reading table - stores individual sensor readings
// Each reading is linked to a silo and has a timestamp
export const sensorReadings = pgTable("sensor_readings", {
  id: serial("id").primaryKey(),
  siloId: integer("silo_id").notNull().references(() => silos.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  temperature: real("temperature"), // Nullable to handle gaps
  humidity: real("humidity"), // Nullable to handle gaps
  isError: boolean("is_error").default(false), // Flag for sensor errors
  rawValue: varchar("raw_value", { length: 50 }), // Store original value for debugging
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Index for efficient querying by silo and time
  siloTimeIdx: uniqueIndex("silo_time_idx").on(table.siloId, table.timestamp),
}));

// Define relations
export const silosRelations = relations(silos, ({ many }) => ({
  readings: many(sensorReadings),
}));

export const sensorReadingsRelations = relations(sensorReadings, ({ one }) => ({
  silo: one(silos, {
    fields: [sensorReadings.siloId],
    references: [silos.id],
  }),
}));

// Type exports
export type Silo = typeof silos.$inferSelect;
export type NewSilo = typeof silos.$inferInsert;
export type SensorReading = typeof sensorReadings.$inferSelect;
export type NewSensorReading = typeof sensorReadings.$inferInsert;
