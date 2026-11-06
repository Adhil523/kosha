CREATE TABLE "Challan" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"receiverID" text NOT NULL,
	"month" text NOT NULL,
	"tdsPaise" bigint NOT NULL,
	"challanRefHash" text NOT NULL,
	"recordedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "challanReceiverMonth" UNIQUE("receiverID","month")
);
--> statement-breakpoint
CREATE TABLE "Release" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"challanID" text NOT NULL,
	"agentID" text NOT NULL,
	"reserveAccountID" text NOT NULL,
	"toAccountID" text NOT NULL,
	"micro" bigint NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"scheduleID" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"cosignedBy" text,
	"executedAt" timestamp with time zone,
	CONSTRAINT "Release_scheduleID_unique" UNIQUE("scheduleID"),
	CONSTRAINT "releaseChallanAgent" UNIQUE("challanID","agentID")
);
--> statement-breakpoint
ALTER TABLE "Challan" ADD CONSTRAINT "Challan_receiverID_Receiver_id_fk" FOREIGN KEY ("receiverID") REFERENCES "public"."Receiver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Release" ADD CONSTRAINT "Release_challanID_Challan_id_fk" FOREIGN KEY ("challanID") REFERENCES "public"."Challan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Release" ADD CONSTRAINT "Release_agentID_Agent_id_fk" FOREIGN KEY ("agentID") REFERENCES "public"."Agent"("id") ON DELETE no action ON UPDATE no action;