ALTER TABLE "HcsOutbox" ADD COLUMN "transactionID" text;--> statement-breakpoint
ALTER TABLE "HcsOutbox" ADD COLUMN "abandonedAt" timestamp with time zone;