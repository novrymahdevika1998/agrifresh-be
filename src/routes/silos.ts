import { Router, type Request, type Response } from "express";
import { db, silos, sensorReadings } from "../db/index.js";
import { eq, and, gte, lte, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// Validation schemas
const querySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(1000).default(100),
  offset: z.coerce.number().min(0).default(0),
  includeErrors: z.coerce.boolean().default(true),
});

const timeRangeSchema = z.object({
  hours: z.coerce.number().min(1).max(168).optional(), // Max 1 week
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// GET /api/silos - List all silos
router.get("/", async (_req: Request, res: Response) => {
  try {
    const allSilos = await db.query.silos.findMany({
      orderBy: [asc(silos.siloNumber)],
    });

    // Get latest reading for each silo
    const silosWithStats = await Promise.all(
      allSilos.map(async (silo) => {
        const latestReading = await db.query.sensorReadings.findFirst({
          where: eq(sensorReadings.siloId, silo.id),
          orderBy: [desc(sensorReadings.timestamp)],
        });

        const readingCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(sensorReadings)
          .where(eq(sensorReadings.siloId, silo.id));

        return {
          ...silo,
          latestReading: latestReading
            ? {
                timestamp: latestReading.timestamp,
                temperature: latestReading.temperature,
                humidity: latestReading.humidity,
                isError: latestReading.isError,
              }
            : null,
          totalReadings: readingCount[0]?.count ?? 0,
        };
      })
    );

    res.json({
      success: true,
      data: silosWithStats,
    });
  } catch (error) {
    console.error("Error fetching silos:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch silos",
    });
  }
});

// GET /api/silos/:siloNumber - Get silo details
router.get("/:siloNumber", async (req: Request, res: Response) => {
  try {
    const siloNumber = String(req.params.siloNumber);

    const silo = await db.query.silos.findFirst({
      where: eq(silos.siloNumber, siloNumber),
    });

    if (!silo) {
      res.status(404).json({
        success: false,
        error: "Silo not found",
      });
      return;
    }

    // Get statistics
    const stats = await db
      .select({
        avgTemp: sql<number>`avg(${sensorReadings.temperature})`,
        minTemp: sql<number>`min(${sensorReadings.temperature})`,
        maxTemp: sql<number>`max(${sensorReadings.temperature})`,
        avgHumidity: sql<number>`avg(${sensorReadings.humidity})`,
        minHumidity: sql<number>`min(${sensorReadings.humidity})`,
        maxHumidity: sql<number>`max(${sensorReadings.humidity})`,
        errorCount: sql<number>`sum(case when ${sensorReadings.isError} then 1 else 0 end)`,
        totalCount: sql<number>`count(*)`,
      })
      .from(sensorReadings)
      .where(eq(sensorReadings.siloId, silo.id));

    res.json({
      success: true,
      data: {
        ...silo,
        statistics: stats[0],
      },
    });
  } catch (error) {
    console.error("Error fetching silo:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch silo",
    });
  }
});

// GET /api/silos/:siloNumber/readings - Get sensor readings for a silo
router.get("/:siloNumber/readings", async (req: Request, res: Response) => {
  try {
    const siloNumber = String(req.params.siloNumber);
    const queryResult = querySchema.safeParse(req.query);

    if (!queryResult.success) {
      res.status(400).json({
        success: false,
        error: "Invalid query parameters",
        details: queryResult.error.format(),
      });
      return;
    }

    const { startDate, endDate, limit, offset, includeErrors } = queryResult.data;

    // Find silo
    const silo = await db.query.silos.findFirst({
      where: eq(silos.siloNumber, siloNumber),
    });

    if (!silo) {
      res.status(404).json({
        success: false,
        error: "Silo not found",
      });
      return;
    }

    // Build query conditions
    const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof gte> | ReturnType<typeof lte>> = [
      eq(sensorReadings.siloId, silo.id),
    ];

    if (startDate) {
      conditions.push(gte(sensorReadings.timestamp, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(sensorReadings.timestamp, new Date(endDate)));
    }
    if (!includeErrors) {
      conditions.push(eq(sensorReadings.isError, false));
    }

    // Get readings
    const readings = await db
      .select({
        id: sensorReadings.id,
        timestamp: sensorReadings.timestamp,
        temperature: sensorReadings.temperature,
        humidity: sensorReadings.humidity,
        isError: sensorReadings.isError,
        rawValue: sensorReadings.rawValue,
      })
      .from(sensorReadings)
      .where(and(...conditions))
      .orderBy(desc(sensorReadings.timestamp))
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(sensorReadings)
      .where(and(...conditions));

    res.json({
      success: true,
      data: {
        silo: {
          id: silo.id,
          siloNumber: silo.siloNumber,
          name: silo.name,
        },
        readings,
        pagination: {
          total: countResult[0]?.count ?? 0,
          limit,
          offset,
          hasMore: (offset + readings.length) < (countResult[0]?.count ?? 0),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching readings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch readings",
    });
  }
});

// GET /api/silos/:siloNumber/latest - Get latest reading for a silo
router.get("/:siloNumber/latest", async (req: Request, res: Response) => {
  try {
    const siloNumber = String(req.params.siloNumber);

    const silo = await db.query.silos.findFirst({
      where: eq(silos.siloNumber, siloNumber),
    });

    if (!silo) {
      res.status(404).json({
        success: false,
        error: "Silo not found",
      });
      return;
    }

    const reading = await db.query.sensorReadings.findFirst({
      where: eq(sensorReadings.siloId, silo.id),
      orderBy: [desc(sensorReadings.timestamp)],
    });

    if (!reading) {
      res.status(404).json({
        success: false,
        error: "No readings found for this silo",
      });
      return;
    }

    res.json({
      success: true,
      data: {
        silo: {
          id: silo.id,
          siloNumber: silo.siloNumber,
          name: silo.name,
        },
        reading: {
          id: reading.id,
          timestamp: reading.timestamp,
          temperature: reading.temperature,
          humidity: reading.humidity,
          isError: reading.isError,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching latest reading:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch latest reading",
    });
  }
});

// GET /api/silos/:siloNumber/analytics - Get analytics for a silo
router.get("/:siloNumber/analytics", async (req: Request, res: Response) => {
  try {
    const { siloNumber } = req.params;
    const queryResult = timeRangeSchema.safeParse(req.query);

    if (!queryResult.success) {
      res.status(400).json({
        success: false,
        error: "Invalid query parameters",
        details: queryResult.error.format(),
      });
      return;
    }

    const { hours, startDate, endDate } = queryResult.data;

    const silo = await db.query.silos.findFirst({
      where: eq(silos.siloNumber, String(siloNumber)),
    });

    if (!silo) {
      res.status(404).json({
        success: false,
        error: "Silo not found",
      });
      return;
    }

    // Build time range
    let startTime: Date;
    let endTime: Date;

    if (startDate && endDate) {
      startTime = new Date(startDate);
      endTime = new Date(endDate);
    } else if (hours) {
      endTime = new Date();
      startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);
    } else {
      // Default to last 24 hours
      endTime = new Date();
      startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
    }

    // Get hourly aggregated data
    const hourlyData = await db
      .select({
        hour: sql<string>`date_trunc('hour', ${sensorReadings.timestamp})`,
        avgTemp: sql<number>`avg(${sensorReadings.temperature})`,
        minTemp: sql<number>`min(${sensorReadings.temperature})`,
        maxTemp: sql<number>`max(${sensorReadings.temperature})`,
        avgHumidity: sql<number>`avg(${sensorReadings.humidity})`,
        minHumidity: sql<number>`min(${sensorReadings.humidity})`,
        maxHumidity: sql<number>`max(${sensorReadings.humidity})`,
        readingCount: sql<number>`count(*)`,
        errorCount: sql<number>`sum(case when ${sensorReadings.isError} then 1 else 0 end)`,
      })
      .from(sensorReadings)
      .where(
        and(
          eq(sensorReadings.siloId, silo.id),
          gte(sensorReadings.timestamp, startTime),
          lte(sensorReadings.timestamp, endTime)
        )
      )
      .groupBy(sql`date_trunc('hour', ${sensorReadings.timestamp})`)
      .orderBy(sql`date_trunc('hour', ${sensorReadings.timestamp})`);

    res.json({
      success: true,
      data: {
        silo: {
          id: silo.id,
          siloNumber: silo.siloNumber,
          name: silo.name,
        },
        timeRange: {
          start: startTime,
          end: endTime,
        },
        hourlyData,
      },
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch analytics",
    });
  }
});

export default router;
