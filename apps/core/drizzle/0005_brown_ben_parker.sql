CREATE TABLE "OutsidePayment" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"receiverID" text NOT NULL,
	"agentID" text NOT NULL,
	"fromWallet" text NOT NULL,
	"toWallet" text NOT NULL,
	"transactionID" text NOT NULL,
	"consensusAt" timestamp with time zone NOT NULL,
	"amountMicro" bigint NOT NULL,
	"valuePaise" bigint NOT NULL,
	"shortfallPaise" bigint NOT NULL,
	"fy" text NOT NULL,
	"classification" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"classifiedAt" timestamp with time zone,
	CONSTRAINT "OutsidePayment_transactionID_unique" UNIQUE("transactionID")
);
--> statement-breakpoint
CREATE TABLE "WatcherCursor" (
	"accountID" text PRIMARY KEY NOT NULL,
	"cursor" text NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "OutsidePayment" ADD CONSTRAINT "OutsidePayment_receiverID_Receiver_id_fk" FOREIGN KEY ("receiverID") REFERENCES "public"."Receiver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OutsidePayment" ADD CONSTRAINT "OutsidePayment_agentID_Agent_id_fk" FOREIGN KEY ("agentID") REFERENCES "public"."Agent"("id") ON DELETE no action ON UPDATE no action;