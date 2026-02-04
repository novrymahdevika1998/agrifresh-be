import fs from "fs";
import csv from "csv-parser";
import { db, silos, sensorReadings } from "../db/index.js";
import { eq } from "drizzle-orm";

interface ParsedRow {
  timestamp: string;
  readings: Array<{
    siloNumber: string;
    temperature: number | null;
    humidity: number | null;
    isError: boolean;
    rawTemp: string | null;
    rawHumidity: string | null;
  }>;
}

// Parse a single value from CSV
function parseSensorValue(value: string | null | undefined): {
  numeric: number | null;
  isError: boolean;
  raw: string | null;
} {
  if (value === null || value === undefined || value.trim() === "") {
    return { numeric: null, isError: false, raw: null };
  }

  const trimmed = value.trim();

  // Check for error indicators
  if (trimmed.toUpperCase() === "ERR" || trimmed.toUpperCase() === "ERROR") {
    return { numeric: null, isError: true, raw: trimmed };
  }

  // Check for invalid numeric values (like 9999 which seems like a sensor error)
  const numValue = parseFloat(trimmed);
  if (isNaN(numValue)) {
    return { numeric: null, isError: true, raw: trimmed };
  }

  // Flag unrealistic values as errors (e.g., temperature > 100 or humidity > 100)
  const isUnrealistic = numValue > 1000 || numValue < -100;
  
  return { 
    numeric: isUnrealistic ? null : numValue, 
    isError: isUnrealistic, 
    raw: trimmed 
  };
}

// Parse CSV row into structured format
function parseRow(row: Record<string, string>): ParsedRow {
  const timestamp = row["Timestamp"];
  const readings: ParsedRow["readings"] = [];

  // Get all column names except Timestamp
  const columns = Object.keys(row).filter((col) => col !== "Timestamp");

  // Group columns by silo number
  const siloColumns = new Map<string, { temp?: string; humidity?: string }>();

  for (const col of columns) {
    // Parse column name like "Silo_001_Temp_C" or "Silo_001_Humidity_%"
    const match = col.match(/Silo_(\d+)_(Temp|Humidity)/i);
    if (match) {
      const siloNumber = match[1];
      const metric = match[2].toLowerCase();

      if (!siloColumns.has(siloNumber)) {
        siloColumns.set(siloNumber, {});
      }

      const silo = siloColumns.get(siloNumber)!;
      if (metric === "temp") {
        silo.temp = row[col];
      } else if (metric === "humidity") {
        silo.humidity = row[col];
      }
    }
  }

  // Process each silo's data
  for (const [siloNumber, metrics] of siloColumns) {
    const tempResult = parseSensorValue(metrics.temp);
    const humidityResult = parseSensorValue(metrics.humidity);

    readings.push({
      siloNumber,
      temperature: tempResult.numeric,
      humidity: humidityResult.numeric,
      isError: tempResult.isError || humidityResult.isError,
      rawTemp: tempResult.raw,
      rawHumidity: humidityResult.raw,
    });
  }

  return { timestamp, readings };
}

// Get or create silo
async function getOrCreateSilo(siloNumber: string): Promise<number> {
  // Try to find existing silo
  const existing = await db.query.silos.findFirst({
    where: eq(silos.siloNumber, siloNumber),
  });

  if (existing) {
    return existing.id;
  }

  // Create new silo
  const [newSilo] = await db
    .insert(silos)
    .values({
      siloNumber,
      name: `Silo ${siloNumber}`,
    })
    .returning({ id: silos.id });

  return newSilo.id;
}

// Ingest CSV file
export async function ingestCSV(filePath: string): Promise<{
  success: boolean;
  message: string;
  stats: {
    rowsProcessed: number;
    silosFound: Set<string>;
    readingsInserted: number;
    errors: string[];
  };
}> {
  const stats = {
    rowsProcessed: 0,
    silosFound: new Set<string>(),
    readingsInserted: 0,
    errors: [] as string[],
  };

  return new Promise((resolve, reject) => {
    const rows: ParsedRow[] = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row: Record<string, string>) => {
        try {
          const parsed = parseRow(row);
          rows.push(parsed);
          stats.rowsProcessed++;
          
          parsed.readings.forEach((r) => stats.silosFound.add(r.siloNumber));
        } catch (error) {
          const errorMsg = `Error parsing row: ${error instanceof Error ? error.message : String(error)}`;
          stats.errors.push(errorMsg);
        }
      })
      .on("end", async () => {
        try {
          // Cache silo IDs to avoid repeated lookups
          const siloIdCache = new Map<string, number>();

          for (const row of rows) {
            const timestamp = new Date(row.timestamp);

            for (const reading of row.readings) {
              // Get or create silo
              let siloId = siloIdCache.get(reading.siloNumber);
              if (!siloId) {
                siloId = await getOrCreateSilo(reading.siloNumber);
                siloIdCache.set(reading.siloNumber, siloId);
              }

              // Insert reading
              try {
                await db
                  .insert(sensorReadings)
                  .values({
                    siloId,
                    timestamp,
                    temperature: reading.temperature,
                    humidity: reading.humidity,
                    isError: reading.isError,
                    rawValue: reading.rawTemp && reading.rawHumidity 
                      ? `${reading.rawTemp},${reading.rawHumidity}` 
                      : (reading.rawTemp || reading.rawHumidity || null),
                  })
                  .onConflictDoNothing(); // Skip duplicates

                stats.readingsInserted++;
              } catch (error) {
                const errorMsg = `Error inserting reading for silo ${reading.siloNumber}: ${error instanceof Error ? error.message : String(error)}`;
                stats.errors.push(errorMsg);
              }
            }
          }

          resolve({
            success: stats.errors.length === 0,
            message: `Processed ${stats.rowsProcessed} rows, inserted ${stats.readingsInserted} readings`,
            stats: {
              ...stats,
              silosFound: stats.silosFound,
            },
          });
        } catch (error) {
          reject(error);
        }
      })
      .on("error", (error) => {
        reject(error);
      });
  });
}

// Ingest from raw CSV content (for inline data)
export async function ingestCSVContent(content: string): Promise<{
  success: boolean;
  message: string;
  stats: {
    rowsProcessed: number;
    silosFound: Set<string>;
    readingsInserted: number;
    errors: string[];
  };
}> {
  // Write content to temp file
  const tempFile = `/tmp/sensor_data_${Date.now()}.csv`;
  fs.writeFileSync(tempFile, content);
  
  try {
    const result = await ingestCSV(tempFile);
    return result;
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
