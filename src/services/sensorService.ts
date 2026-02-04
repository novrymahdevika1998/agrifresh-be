import { db, silos, sensorReadings } from "../db/index.js";
import { eq, and, gte, lte, desc, asc, sql, isNotNull } from "drizzle-orm";

export interface SensorDataQuery {
  siloNumber?: string;
  startTime?: Date;
  endTime?: Date;
  includeErrors?: boolean;
  limit?: number;
  offset?: number;
}

export interface AggregatedData {
  siloNumber: string;
  avgTemperature: number | null;
  avgHumidity: number | null;
  minTemperature: number | null;
  maxTemperature: number | null;
  minHumidity: number | null;
  maxHumidity: number | null;
  readingCount: number;
}

// Get all silos
export async function getAllSilos() {
  return db.query.silos.findMany({
    orderBy: asc(silos.siloNumber),
  });
}

// Get sensor readings with filters
export async function getSensorReadings(query: SensorDataQuery) {
  const conditions = [];

  if (query.siloNumber) {
    const silo = await db.query.silos.findFirst({
      where: eq(silos.siloNumber, query.siloNumber),
    });
    if (silo) {
      conditions.push(eq(sensorReadings.siloId, silo.id));
    }
  }

  if (query.startTime) {
    conditions.push(gte(sensorReadings.timestamp, query.startTime));
  }

  if (query.endTime) {
    conditions.push(lte(sensorReadings.timestamp, query.endTime));
  }

  if (!query.includeErrors) {
    conditions.push(eq(sensorReadings.isError, false));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const readings = await db.query.sensorReadings.findMany({
    where: whereClause,
    with: {
      silo: true,
    },
    orderBy: desc(sensorReadings.timestamp),
    limit: query.limit ?? 100,
    offset: query.offset ?? 0,
  });

  return readings.map((r) => ({
    id: r.id,
    siloNumber: r.silo.siloNumber,
    siloName: r.silo.name,
    timestamp: r.timestamp,
    temperature: r.temperature,
    humidity: r.humidity,
    isError: r.isError,
    rawValue: r.rawValue,
  }));
}

// Get aggregated statistics by silo
export async function getAggregatedStats(
  siloNumber?: string,
  startTime?: Date,
  endTime?: Date
): Promise<AggregatedData[]> {
  const conditions = [isNotNull(sensorReadings.temperature)];

  if (siloNumber) {
    const silo = await db.query.silos.findFirst({
      where: eq(silos.siloNumber, siloNumber),
    });
    if (silo) {
      conditions.push(eq(sensorReadings.siloId, silo.id));
    }
  }

  if (startTime) {
    conditions.push(gte(sensorReadings.timestamp, startTime));
  }

  if (endTime) {
    conditions.push(lte(sensorReadings.timestamp, endTime));
  }

  const result = await db
    .select({
      siloNumber: silos.siloNumber,
      avgTemperature: sql<number | null>`avg(${sensorReadings.temperature})`,
      avgHumidity: sql<number | null>`avg(${sensorReadings.humidity})`,
      minTemperature: sql<number | null>`min(${sensorReadings.temperature})`,
      maxTemperature: sql<number | null>`max(${sensorReadings.temperature})`,
      minHumidity: sql<number | null>`min(${sensorReadings.humidity})`,
      maxHumidity: sql<number | null>`max(${sensorReadings.humidity})`,
      readingCount: sql<number>`count(*)`,
    })
    .from(sensorReadings)
    .innerJoin(silos, eq(sensorReadings.siloId, silos.id))
    .where(and(...conditions))
    .groupBy(silos.siloNumber)
    .orderBy(asc(silos.siloNumber));

  return result.map((r) => ({
    siloNumber: r.siloNumber,
    avgTemperature: r.avgTemperature ? Number(r.avgTemperature.toFixed(2)) : null,
    avgHumidity: r.avgHumidity ? Number(r.avgHumidity.toFixed(2)) : null,
    minTemperature: r.minTemperature,
    maxTemperature: r.maxTemperature,
    minHumidity: r.minHumidity,
    maxHumidity: r.maxHumidity,
    readingCount: Number(r.readingCount),
  }));
}

// Get latest readings for all silos
export async function getLatestReadings() {
  const subquery = db
    .select({
      siloId: sensorReadings.siloId,
      maxTimestamp: sql<Date>`max(${sensorReadings.timestamp})`.as("maxTimestamp"),
    })
    .from(sensorReadings)
    .groupBy(sensorReadings.siloId)
    .as("latest");

  const readings = await db
    .select({
      siloNumber: silos.siloNumber,
      siloName: silos.name,
      timestamp: sensorReadings.timestamp,
      temperature: sensorReadings.temperature,
      humidity: sensorReadings.humidity,
      isError: sensorReadings.isError,
    })
    .from(sensorReadings)
    .innerJoin(silos, eq(sensorReadings.siloId, silos.id))
    .innerJoin(
      subquery,
      and(
        eq(sensorReadings.siloId, subquery.siloId),
        eq(sensorReadings.timestamp, subquery.maxTimestamp)
      )
    )
    .orderBy(asc(silos.siloNumber));

  return readings;
}

// Get silo details with recent readings
export async function getSiloDetails(siloNumber: string, limit: number = 50) {
  const silo = await db.query.silos.findFirst({
    where: eq(silos.siloNumber, siloNumber),
  });

  if (!silo) {
    return null;
  }

  const readings = await db.query.sensorReadings.findMany({
    where: eq(sensorReadings.siloId, silo.id),
    orderBy: desc(sensorReadings.timestamp),
    limit,
  });

  return {
    silo: {
      id: silo.id,
      siloNumber: silo.siloNumber,
      name: silo.name,
      createdAt: silo.createdAt,
    },
    readings: readings.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      temperature: r.temperature,
      humidity: r.humidity,
      isError: r.isError,
      rawValue: r.rawValue,
    })),
  };
}
