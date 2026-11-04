CREATE TABLE "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"bank" text NOT NULL,
	"balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"balanceAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "accountId" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "externalId" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_user_name_uq" ON "bank_accounts" USING btree ("userId","name");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_accountId_bank_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_account_idx" ON "transactions" USING btree ("accountId");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_source_external_uq" ON "transactions" USING btree ("userId","source","externalId") WHERE "transactions"."externalId" is not null;