import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import {
  getAllSilos,
  getSensorReadings,
  getAggregatedStats,
  getLatestReadings,
  getSiloDetails,
  type SensorDataQuery,
} from "../services/sensorService.js";
import { ingestCSV, ingestCSVContent } from "../services/csvIngestion.js";

const router = Router();

// Configure multer for file uploads
const upload = multer({ dest: "uploads/" });

// Validation schemas
const querySchema = z.object({
  siloNumber: z.string().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  includeErrors: z.enum(["true", "false"]).optional().default("false"),
  limit: z.string().transform(Number).optional().default("100"),
  offset: z.string().transform(Number).optional().default("0"),
});

// GET /api/silos - List all silos
router.get("/silos", async (_req: Request, res: Response) => {
  try {
    const silos = await getAllSilos();
    res.json({
      success: true,
      data: silos,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /api/silos/:siloNumber - Get silo details with recent readings
router.get("/silos/:siloNumber", async (req: Request, res: Response) => {
  try {
    const siloNumber = String(req.params.siloNumber);
    const limit = Number(req.query.limit) || 50;

    const details = await getSiloDetails(siloNumber, limit);

    if (!details) {
      res.status(404).json({
        success: false,
        error: "Silo not found",
      });
      return;
    }

    res.json({
      success: true,
      data: details,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /api/readings - Get sensor readings with filters
router.get("/readings", async (req: Request, res: Response) => {
  try {
    const validation = querySchema.safeParse(req.query);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: validation.error.errors,
      });
      return;
    }

    const query: SensorDataQuery = {
      siloNumber: validation.data.siloNumber,
      startTime: validation.data.startTime ? new Date(validation.data.startTime) : undefined,
      endTime: validation.data.endTime ? new Date(validation.data.endTime) : undefined,
      includeErrors: validation.data.includeErrors === "true",
      limit: validation.data.limit,
      offset: validation.data.offset,
    };

    const readings = await getSensorReadings(query);

    res.json({
      success: true,
      count: readings.length,
      data: readings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /api/readings/latest - Get latest readings for all silos
router.get("/readings/latest", async (_req: Request, res: Response) => {
  try {
    const readings = await getLatestReadings();

    res.json({
      success: true,
      count: readings.length,
      data: readings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /api/stats - Get aggregated statistics
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const { siloNumber, startTime, endTime } = req.query;

    const stats = await getAggregatedStats(
      siloNumber as string | undefined,
      startTime ? new Date(startTime as string) : undefined,
      endTime ? new Date(endTime as string) : undefined
    );

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// POST /api/ingest - Ingest CSV file
router.post("/ingest", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
      return;
    }

    const result = await ingestCSV(req.file.path);

    // Clean up uploaded file
    try {
      import("fs").then((fs) => fs.unlinkSync(req.file!.path));
    } catch {
      // Ignore cleanup errors
    }

    res.json({
      success: result.success,
      message: result.message,
      stats: {
        rowsProcessed: result.stats.rowsProcessed,
        silosFound: Array.from(result.stats.silosFound),
        readingsInserted: result.stats.readingsInserted,
        errors: result.stats.errors,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
