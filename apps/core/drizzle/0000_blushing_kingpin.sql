CREATE TABLE "Agent" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"identity" text NOT NULL,
	"ownerRef" text,
	"level" integer DEFAULT 0 NOT NULL,
	"residency" text DEFAULT 'unknown' NOT NULL,
	"panOnFile" boolean DEFAULT false NOT NULL,
	"credentialIssuer" text,
	"credentialHash" text,
	"reserveAccountID" text,
	"verifiedAt" timestamp with time zone,
	CONSTRAINT "Agent_identity_unique" UNIQUE("identity"),
	CONSTRAINT "Agent_reserveAccountID_unique" UNIQUE("reserveAccountID"),
	CONSTRAINT "agentLevelRange" CHECK ("Agent"."level" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "AgentWallet" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"agentID" text NOT NULL,
	"accountID" text NOT NULL,
	CONSTRAINT "AgentWallet_accountID_unique" UNIQUE("accountID")
);
--> statement-breakpoint
CREATE TABLE "Aggregate" (
	"agentID" text NOT NULL,
	"receiverID" text NOT NULL,
	"fy" text NOT NULL,
	"valuePaise" bigint DEFAULT 0 NOT NULL,
	"outsideValuePaise" bigint DEFAULT 0 NOT NULL,
	"paymentsCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Aggregate_agentID_receiverID_fy_pk" PRIMARY KEY("agentID","receiverID","fy")
);
--> statement-breakpoint
CREATE TABLE "HcsOutbox" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"topicID" text NOT NULL,
	"payload" jsonb NOT NULL,
	"paymentID" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"hcsSequence" integer,
	"publishedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "Payment" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"quoteID" text NOT NULL,
	"transactionID" text NOT NULL,
	"forwardTransactionID" text,
	"consensusAt" timestamp with time zone,
	"receiverID" text NOT NULL,
	"agentID" text,
	"priceMicro" bigint NOT NULL,
	"tdsMicro" bigint NOT NULL,
	"reserveAccountID" text,
	"inrValuePaise" bigint NOT NULL,
	"fy" text NOT NULL,
	"hcsSequence" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "Payment_quoteID_unique" UNIQUE("quoteID"),
	CONSTRAINT "Payment_transactionID_unique" UNIQUE("transactionID"),
	CONSTRAINT "Payment_forwardTransactionID_unique" UNIQUE("forwardTransactionID")
);
--> statement-breakpoint
CREATE TABLE "Policy" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"agentID" text NOT NULL,
	"perPaymentMicro" bigint NOT NULL,
	"dailyMicro" bigint NOT NULL,
	"fyBudgetMicro" bigint NOT NULL,
	"allowlist" text[] NOT NULL,
	"thresholdAction" text NOT NULL,
	"acceptRulepacks" text[] NOT NULL,
	CONSTRAINT "Policy_agentID_unique" UNIQUE("agentID")
);
--> statement-breakpoint
CREATE TABLE "Quote" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"scheme" text NOT NULL,
	"receiverID" text NOT NULL,
	"agentID" text,
	"resource" text NOT NULL,
	"payToAccountID" text NOT NULL,
	"reserveAccountID" text,
	"priceMicro" bigint NOT NULL,
	"tdsMicro" bigint NOT NULL,
	"totalMicro" bigint NOT NULL,
	"inrValuePaise" bigint NOT NULL,
	"rateBps" integer NOT NULL,
	"reason" text NOT NULL,
	"rulepack" text NOT NULL,
	"inrPerUsdMicro" bigint NOT NULL,
	"nodeAccountIDs" text[] NOT NULL,
	"fy" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"usedTransactionID" text,
	CONSTRAINT "Quote_usedTransactionID_unique" UNIQUE("usedTransactionID"),
	CONSTRAINT "quoteTotal" CHECK ("Quote"."totalMicro" = "Quote"."priceMicro" + "Quote"."tdsMicro")
);
--> statement-breakpoint
CREATE TABLE "Receiver" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"legalName" text NOT NULL,
	"panCommitment" text,
	"tan" text,
	"gstin" text,
	"residency" text NOT NULL,
	"specifiedPerson" boolean NOT NULL,
	"mode" text NOT NULL,
	"unverifiedPolicy" text NOT NULL,
	"apiKeyHash" text NOT NULL,
	CONSTRAINT "Receiver_apiKeyHash_unique" UNIQUE("apiKeyHash")
);
--> statement-breakpoint
CREATE TABLE "ReceiverWallet" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"receiverID" text NOT NULL,
	"accountID" text NOT NULL,
	"proofSignature" text NOT NULL,
	"verifiedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "ReceiverWallet_accountID_unique" UNIQUE("accountID")
);
--> statement-breakpoint
ALTER TABLE "AgentWallet" ADD CONSTRAINT "AgentWallet_agentID_Agent_id_fk" FOREIGN KEY ("agentID") REFERENCES "public"."Agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Aggregate" ADD CONSTRAINT "Aggregate_agentID_Agent_id_fk" FOREIGN KEY ("agentID") REFERENCES "public"."Agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Aggregate" ADD CONSTRAINT "Aggregate_receiverID_Receiver_id_fk" FOREIGN KEY ("receiverID") REFERENCES "public"."Receiver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "HcsOutbox" ADD CONSTRAINT "HcsOutbox_paymentID_Payment_id_fk" FOREIGN KEY ("paymentID") REFERENCES "public"."Payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_quoteID_Quote_id_fk" FOREIGN KEY ("quoteID") REFERENCES "public"."Quote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receiverID_Receiver_id_fk" FOREIGN KEY ("receiverID") REFERENCES "public"."Receiver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_agentID_Agent_id_fk" FOREIGN KEY ("agentID") REFERENCES "public"."Agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_agentID_Agent_id_fk" FOREIGN KEY ("agentID") REFERENCES "public"."Agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_receiverID_Receiver_id_fk" FOREIGN KEY ("receiverID") REFERENCES "public"."Receiver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_agentID_Agent_id_fk" FOREIGN KEY ("agentID") REFERENCES "public"."Agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ReceiverWallet" ADD CONSTRAINT "ReceiverWallet_receiverID_Receiver_id_fk" FOREIGN KEY ("receiverID") REFERENCES "public"."Receiver"("id") ON DELETE no action ON UPDATE no action;