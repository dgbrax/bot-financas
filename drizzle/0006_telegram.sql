CREATE TABLE "telegram_link_codes" (
	"hash" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" integer NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_codes_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"id" text PRIMARY KEY NOT NULL,
	"telegramUserId" text NOT NULL,
	"chatId" text NOT NULL,
	"userId" text NOT NULL,
	"accountId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_links_telegramUserId_unique" UNIQUE("telegramUserId"),
	CONSTRAINT "telegram_links_chatId_unique" UNIQUE("chatId"),
	CONSTRAINT "telegram_links_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"updateId" text PRIMARY KEY NOT NULL,
	"chatId" text NOT NULL,
	"messageId" text NOT NULL,
	"telegramUserId" text NOT NULL,
	"userId" text,
	"bindingId" text,
	"reply" text,
	"receivedAt" timestamp DEFAULT now() NOT NULL,
	"deliveredAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_accountId_bank_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_accountId_bank_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_updates" ADD CONSTRAINT "telegram_updates_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_updates_chat_message_uq" ON "telegram_updates" USING btree ("chatId","messageId");