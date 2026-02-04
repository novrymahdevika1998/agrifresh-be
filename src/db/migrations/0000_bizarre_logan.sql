CREATE TABLE "sensor_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"silo_id" integer NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"temperature" real,
	"humidity" real,
	"is_error" boolean DEFAULT false,
	"raw_value" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silos" (
	"id" serial PRIMARY KEY NOT NULL,
	"silo_number" varchar(10) NOT NULL,
	"name" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "silos_silo_number_unique" UNIQUE("silo_number")
);
--> statement-breakpoint
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_silo_id_silos_id_fk" FOREIGN KEY ("silo_id") REFERENCES "public"."silos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "silo_time_idx" ON "sensor_readings" USING btree ("silo_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "timestamp_idx" ON "sensor_readings" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "silo_number_idx" ON "silos" USING btree ("silo_number");