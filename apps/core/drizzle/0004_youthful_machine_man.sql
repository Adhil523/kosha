CREATE TABLE "Decision" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"receiverID" text NOT NULL,
	"agentID" text,
	"payerReference" text,
	"chain" text NOT NULL,
	"resource" text,
	"priceMicro" bigint NOT NULL,
	"inrPerUsdMicro" bigint NOT NULL,
	"valuePaise" bigint NOT NULL,
	"tdsPaise" bigint NOT NULL,
	"tdsMicro" bigint NOT NULL,
	"rateBps" integer NOT NULL,
	"reason" text NOT NULL,
	"flags" text[] NOT NULL,
	"rulepack" text NOT NULL,
	"fy" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"confirmedAt" timestamp with time zone,
	"transactionRef" text,
	CONSTRAINT "decisionPayer" CHECK (("Decision"."agentID" is null) <> ("Decision"."payerReference" is null))
);
--> statement-breakpoint
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_receiverID_Receiver_id_fk" FOREIGN KEY ("receiverID") REFERENCES "public"."Receiver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_agentID_Agent_id_fk" FOREIGN KEY ("agentID") REFERENCES "public"."Agent"("id") ON DELETE no action ON UPDATE no action;