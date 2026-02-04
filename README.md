# AgriFresh Sensor Data API

An ExpressJS API for ingesting and querying silo sensor data using Drizzle ORM and PostgreSQL.

## Features

- **Scalable Database Design**: Silos are stored as rows, not columns - easily add 50+ more silos without schema changes
- **CSV Ingestion**: Handles wide-format CSV with gaps and sensor errors (ERR, 9999 values)
- **Clean REST API**: Query sensor data with filters, aggregations, and latest readings
- **TypeScript + ES Modules**: Modern JavaScript with type safety

## Project Structure

```
.
├── src/
│   ├── db/
│   │   ├── schema.ts       # Database schema (silos, sensor_readings)
│   │   ├── index.ts        # Database connection
│   │   └── migrations/     # Drizzle migrations
│   ├── routes/
│   │   ├── sensorRoutes.ts # Sensor data & ingestion routes
│   │   └── silos.ts        # Silo management routes
│   ├── services/
│   │   ├── csvIngestion.ts # CSV parsing and ingestion
│   │   └── sensorService.ts # Data queries and aggregations
│   ├── scripts/
│   │   └── seed.ts         # Database seeding script
│   └── index.ts            # Express app entry point
├── sensor_data.csv         # Sample data file
├── drizzle.config.ts       # Drizzle configuration
└── package.json
```

## Database Schema

### Silos Table
```sql
- id (serial, PK)
- silo_number (varchar, unique) - e.g., "001", "002"
- name (varchar)
- created_at (timestamp)
```

### Sensor Readings Table
```sql
- id (serial, PK)
- silo_id (integer, FK)
- timestamp (timestamp)
- temperature (real, nullable)
- humidity (real, nullable)
- is_error (boolean) - flag for sensor errors
- raw_value (varchar) - stores original error values
- created_at (timestamp)
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your PostgreSQL credentials
```

Example `.env`:
```
DATABASE_URL=postgres://username:password@localhost:5432/agrifresh
PORT=3000
```

The `.env` file is automatically loaded by the application.

### 3. Run Migrations

The project includes a custom migration script that works without requiring special permissions:

```bash
npm run db:migrate
```

If you encounter connection issues, make sure:
1. PostgreSQL is running
2. The database exists: `createdb agrifresh`
3. Your `DATABASE_URL` is correct in `.env`

To reset the database (drops all tables):
```bash
npm run db:reset
```

### 4. Seed Sample Data (optional)

```bash
npm run seed
```

### 5. Build and Start

```bash
# Production
npm run build
npm start

# Development
npm run dev
```

The server will start at `http://localhost:3000`

## API Endpoints

### Health Check
```
GET /health
```

### Silo Management

#### List All Silos
```
GET /api/silos
```
Response includes latest reading and total reading count for each silo.

#### Get Silo Details
```
GET /api/silos/:siloNumber
```
Returns silo info with statistics (avg/min/max temperature and humidity, error count).

#### Get Silo Readings
```
GET /api/silos/:siloNumber/readings
?startDate=2023-10-27T08:00:00Z  # optional
&endDate=2023-10-27T10:00:00Z    # optional
&includeErrors=true               # include error readings (default: true)
&limit=100                        # max 1000
&offset=0
```

#### Get Latest Reading for a Silo
```
GET /api/silos/:siloNumber/latest
```

#### Get Analytics for a Silo
```
GET /api/silos/:siloNumber/analytics
?hours=24          # optional, last N hours
&startDate=...     # optional, ISO datetime
&endDate=...       # optional, ISO datetime
```
Returns hourly aggregated data (avg/min/max temperature and humidity).

### Sensor Data (Alternative Routes)

#### Get All Sensor Readings
```
GET /api/readings
?siloNumber=001          # filter by silo
&startTime=2023-10-27T08:00:00Z
&endTime=2023-10-27T10:00:00Z
&includeErrors=true      # include error readings
&limit=100
&offset=0
```

#### Get Latest Readings (all silos)
```
GET /api/readings/latest
```

#### Get Aggregated Statistics
```
GET /api/stats
?siloNumber=001          # optional, omit for all silos
&startTime=...           # optional
&endTime=...             # optional
```

### CSV Ingestion

#### Upload CSV File
```
POST /api/ingest
Content-Type: multipart/form-data

file: <csv_file>
```

## Example Usage

### Ingest Sample Data

```bash
# Using file upload
curl -X POST -F "file=@sensor_data.csv" http://localhost:3000/api/ingest
```

### Query Data

```bash
# Get all silos
curl http://localhost:3000/api/silos

# Get silo details with statistics
curl http://localhost:3000/api/silos/001

# Get readings for a specific silo with pagination
curl "http://localhost:3000/api/silos/001/readings?limit=10&offset=0"

# Get latest reading for a silo
curl http://localhost:3000/api/silos/001/latest

# Get hourly analytics for last 24 hours
curl http://localhost:3000/api/silos/001/analytics

# Get analytics for specific time range
curl "http://localhost:3000/api/silos/001/analytics?startDate=2023-10-27T08:00:00Z&endDate=2023-10-27T12:00:00Z"
```

## CSV Data Handling

The ingestion service handles real-world data issues:

| Issue | Handling |
|-------|----------|
| Empty values | Stored as NULL |
| "ERR" or "ERROR" | Marked as error (`isError=true`), NULL value, raw value preserved |
| Unrealistic values (e.g., 9999) | Marked as error, treated as NULL |
| Wide format | Dynamically parses all `Silo_XXX_Temp_C` and `Silo_XXX_Humidity_%` columns |
| Data gaps | Nullable columns allow missing data |
| Duplicate readings | Skipped (unique index on silo_id + timestamp) |

## Adding New Silos

Simply include new silo columns in the CSV file:
```csv
Timestamp,Silo_001_Temp_C,Silo_001_Humidity_%,Silo_050_Temp_C,Silo_050_Humidity_%
```

The system will automatically create new silo records as needed. No schema changes required!

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled app |
| `npm run dev` | Build and run |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Run migrations (custom script) |
| `npm run db:reset` | Drop all tables (use with caution!) |
| `npm run seed` | Seed database with sample CSV data |
| `npm run setup` | Full setup: build + migrate + seed |

## Architecture Benefits

### Scalable Design
- **No column limits**: Adding 50 more silos requires zero schema changes
- **Dynamic parsing**: CSV columns are parsed dynamically based on naming pattern
- **Auto-discovery**: New silos are created automatically during ingestion

### Data Integrity
- **Foreign key constraints**: Ensures referential integrity
- **Unique constraints**: Prevents duplicate readings
- **Error tracking**: Sensor errors are flagged but don't block ingestion

### Query Performance
- **Indexed timestamps**: Fast time-range queries
- **Indexed silo lookups**: Efficient silo-specific queries
- **Composite index**: Optimized for silo + timestamp lookups
