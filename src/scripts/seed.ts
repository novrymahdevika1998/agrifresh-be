/**
 * Seed script to ingest sample CSV data
 * Usage: npm run seed
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ingestCSVContent } from "../services/csvIngestion.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function seed() {
  try {
    const csvPath = path.join(__dirname, "../../sensor_data.csv");
    const content = fs.readFileSync(csvPath, "utf-8");
    
    console.log("🌱 Seeding database with sample data...");
    const result = await ingestCSVContent(content);
    
    console.log("✅ Seeding complete!");
    console.log(`   Rows processed: ${result.stats.rowsProcessed}`);
    console.log(`   Readings inserted: ${result.stats.readingsInserted}`);
    console.log(`   Silos found: ${Array.from(result.stats.silosFound).join(", ")}`);
    
    if (result.stats.errors.length > 0) {
      console.log("⚠️  Errors encountered:");
      result.stats.errors.forEach((err) => console.log(`   - ${err}`));
    }
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seed();
