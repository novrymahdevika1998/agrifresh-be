# AgriFresh Technical Handover Guide

## 1. Technical Handover

### 1.1 Setup Instructions

#### Prerequisites
- **Node.js** 18+ (LTS recommended)
- **PostgreSQL** 14+ (running and accessible)
- **npm** or **yarn** package manager

#### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL credentials:
# DATABASE_URL=postgres://username:password@localhost:5432/agrifresh
# PORT=3000

# 3. Run migrations
npm run db:migrate

# 4. Seed sample data (optional)
npm run seed

# 5. Build and start
npm run build
npm start

# Or use the one-liner setup
npm run setup
```

The API will be available at `http://localhost:3000`.

#### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production app |
| `npm run dev` | Build and run (development) |
| `npm run db:migrate` | Run database migrations |
| `npm run db:reset` | **DANGER**: Drop all tables |
| `npm run seed` | Seed database with sample CSV data |
| `npm run setup` | Full setup: build + migrate + seed |

---

### 1.2 Tech Stack Justification

| Component | Choice | Justification |
|-----------|--------|---------------|
| **Runtime** | Node.js + TypeScript | Type safety for data processing; modern async/await for I/O-heavy CSV ingestion; excellent ecosystem for data pipelines. |
| **Framework** | Express.js | Battle-tested, minimal overhead, extensive middleware ecosystem (multer for file uploads, CORS). |
| **Database** | PostgreSQL | ACID compliance for sensor data integrity; excellent time-series query support; handles concurrent writes during ingestion. |
| **ORM** | Drizzle ORM | Type-safe SQL-like syntax; lightweight; generates migrations automatically; good PostgreSQL support. |
| **CSV Parsing** | `csv-parser` | Streaming parser - handles large files without memory issues; battle-tested with 10M+ weekly downloads. |
| **Validation** | Zod | Runtime type safety for API inputs; excellent error messages; TypeScript inference. |
| **File Uploads** | Multer | Industry standard for multipart/form-data; handles temp file cleanup. |

#### Why This Stack?

1. **Scalability for 50+ Silos**: PostgreSQL's relational model with proper indexing handles time-series data efficiently. The EAV-like schema (silos as rows, not columns) means zero schema changes when adding silos.

2. **Data Integrity**: Foreign key constraints + unique indexes prevent orphaned readings and duplicates. ACID transactions ensure no partial ingestion states.

3. **Developer Experience**: TypeScript + Drizzle provides compile-time SQL safety. Zod validates runtime inputs.

4. **Operational Simplicity**: Single PostgreSQL instance (no Redis/Kafka needed for current scale). Stateless Node.js app deploys anywhere.

---

## 2. Business Logic & Assumptions

### 2.1 Data Quality Issues Handled

The CSV data contains three types of errors that the ingestion pipeline handles:

#### Error Type 1: Sensor Error Strings ("ERR", "ERROR")

**Example from data:**
```csv
2023-10-27 09:30:00,28.5,55,23.1,53,ERR,57
```

**Handling:**
```typescript
// In src/services/csvIngestion.ts
if (trimmed.toUpperCase() === "ERR" || trimmed.toUpperCase() === "ERROR") {
  return { numeric: null, isError: true, raw: trimmed };
}
```

- Value stored as `NULL` in database
- `is_error` flag set to `true`
- Original "ERR" preserved in `raw_value` column for audit

**Rationale:** Physical sensor failures happen (network issues, hardware faults). We must distinguish between "no data" (NULL) and "bad data" (error flag). Preserving the raw value aids debugging.

---

#### Error Type 2: Unrealistic Values ("9999")

**Example from data:**
```csv
2023-10-27 10:30:00,34.8,70,23.8,56,9999,61
```

**Handling:**
```typescript
// Values outside -100 to +1000 range flagged as errors
const isUnrealistic = numValue > 1000 || numValue < -100;
return { 
  numeric: isUnrealistic ? null : numValue, 
  isError: isUnrealistic, 
  raw: trimmed 
};
```

- "9999" is a common sensor "no reading" placeholder
- Value stored as `NULL`, `is_error = true`

**Rationale:** 9999 is an industry convention for "sensor not responding." The ±1000°C threshold covers all realistic agricultural scenarios (grain silos typically -10°C to +60°C) while catching obvious error codes.

---

#### Error Type 3: Missing Values (Empty Strings)

**Example from data:**
```csv
2023-10-27 08:15:00,24.8,46,22.3,49,,51
2023-10-27 10:15:00,34.1,68,,55,27.0,60
```

**Handling:**
```typescript
if (value === null || value === undefined || value.trim() === "") {
  return { numeric: null, isError: false, raw: null };
}
```

- Value stored as `NULL`
- `is_error` remains `false` (it's a gap, not an error)

**Rationale:** Missing data ≠ bad data. Gaps occur from scheduled maintenance, transmission delays, or power cycling. We distinguish gaps from errors for accurate analytics (don't skew averages with error flags).

---

### 2.2 Data Handling Summary Table

| Issue | Example | Stored As | `is_error` | Rationale |
|-------|---------|-----------|------------|-----------|
| Empty/missing | `,,` | `NULL` | `false` | Data gap, not corruption |
| Sensor error | `ERR` | `NULL` | `true` | Hardware failure, needs investigation |
| Unrealistic | `9999` | `NULL` | `true` | Calibration/sensor error |
| NaN strings | `N/A` | `NULL` | `true` | Non-numeric garbage data |

---

### 2.3 Alerts / Thresholds

**Current Status: No automated alerting system is implemented.**

The system tracks error states (`is_error` flag) but does not send notifications or trigger webhooks.

#### Recommended Alert Thresholds (Future Implementation)

Based on agricultural best practices for grain storage:

| Metric | Warning Threshold | Critical Threshold | Rationale |
|--------|-------------------|-------------------|-----------|
| **Temperature** | > 30°C | > 35°C | Above 30°C increases spoilage risk; 35°C indicates potential hot spots or fermentation |
| **Humidity** | > 70% | > 80% | High humidity promotes mold; 80%+ is danger zone for mycotoxins |
| **Error Rate** | > 5% of readings in 1 hour | > 20% of readings in 1 hour | Sensor degradation vs. complete failure |
| **Data Gap** | No reading for 30 min | No reading for 2 hours | Communication issue vs. power/system failure |

**Implementation Suggestion:**
```typescript
// Pseudo-code for future alert service
function evaluateAlert(reading: SensorReading): AlertLevel {
  if (reading.temperature && reading.temperature > 35) {
    return AlertLevel.CRITICAL; // Immediate action required
  }
  if (reading.temperature && reading.temperature > 30) {
    return AlertLevel.WARNING; // Monitor closely
  }
  if (reading.isError) {
    return AlertLevel.INFO; // Log for maintenance
  }
  return AlertLevel.NONE;
}
```

---

### 2.4 Key Architectural Decisions

1. **Nullable Temperature/Humidity**: Schema allows NULL for both values independently. A sensor might report temperature but fail on humidity.

2. **Unique Constraint**: `(silo_id, timestamp)` is unique. Re-ingesting the same CSV is idempotent - duplicates are silently skipped via `ON CONFLICT DO NOTHING`.

3. **Soft Error Handling**: Ingestion never fails due to bad data. All 36 readings from sample CSV are inserted even with 3 error values.

4. **Auto-silo Creation**: New silo columns in CSV (e.g., `Silo_050_Temp_C`) automatically create silo records. No manual setup needed.

---

## 3. API Quick Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health check |
| `/api/ingest` | POST | Upload CSV (multipart/form-data) |
| `/api/silos` | GET | List all silos with latest readings |
| `/api/silos/:id` | GET | Silo details + statistics |
| `/api/silos/:id/readings` | GET | Paginated readings with filters |
| `/api/silos/:id/latest` | GET | Most recent reading |
| `/api/silos/:id/analytics` | GET | Hourly aggregated data |

---

## 4. Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Database connection failed" | Invalid DATABASE_URL | Check credentials, ensure PostgreSQL is running |
| "Only 12 rows inserted" | Timestamp-only unique index | Run `npm run db:migrate` (fixed in migration 0001) |
| CSV columns not recognized | Wrong column naming | Use format `Silo_XXX_Temp_C` and `Silo_XXX_Humidity_%` |
