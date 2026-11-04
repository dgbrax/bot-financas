CREATE TABLE "pluggy_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"pluggyItemId" text NOT NULL,
	"connectorId" integer NOT NULL,
	"connectorName" text NOT NULL,
	"connectorImageUrl" text,
	"isSandbox" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"executionStatus" text,
	"errorCode" text,
	"errorMessage" text,
	"pluggyUpdatedAt" timestamp,
	"lastSyncedAt" timestamp,
	"consentExpiresAt" timestamp,
	"disconnectedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"itemId" integer NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"finishedAt" timestamp,
	"accountsSynced" integer DEFAULT 0 NOT NULL,
	"txCreated" integer DEFAULT 0 NOT NULL,
	"txUpdated" integer DEFAULT 0 NOT NULL,
	"txRemoved" integer DEFAULT 0 NOT NULL,
	"matchesSuggested" integer DEFAULT 0 NOT NULL,
	"errorMessage" text
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"eventId" text NOT NULL,
	"event" text NOT NULL,
	"pluggyItemId" text,
	"userId" text,
	"status" text NOT NULL,
	"errorMessage" text,
	"receivedAt" timestamp DEFAULT now() NOT NULL,
	"processedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "itemId" integer;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "externalId" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "accountType" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "subtype" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "numberMask" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "status" text DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "merchant" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bankCategory" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "categoryStatus" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "isTransfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "externalUpdatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "matchCandidateId" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "matchStatus" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "duplicateOf" integer;--> statement-breakpoint
ALTER TABLE "pluggy_items" ADD CONSTRAINT "pluggy_items_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_itemId_pluggy_items_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."pluggy_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pluggy_items_pluggy_item_uq" ON "pluggy_items" USING btree ("pluggyItemId");--> statement-breakpoint
CREATE INDEX "pluggy_items_user_idx" ON "pluggy_items" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "sync_runs_item_idx" ON "sync_runs" USING btree ("itemId","startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_event_uq" ON "webhook_events" USING btree ("eventId");--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_itemId_pluggy_items_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."pluggy_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_matchCandidateId_transactions_id_fk" FOREIGN KEY ("matchCandidateId") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_duplicateOf_transactions_id_fk" FOREIGN KEY ("duplicateOf") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_user_external_uq" ON "bank_accounts" USING btree ("userId","externalId") WHERE "bank_accounts"."externalId" is not null;--> statement-breakpoint
CREATE INDEX "transactions_match_candidate_idx" ON "transactions" USING btree ("matchCandidateId");