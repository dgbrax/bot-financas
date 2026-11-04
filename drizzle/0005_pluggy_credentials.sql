CREATE TABLE "pluggy_credentials" (
	"userId" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"clientSecretEncrypted" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pluggy_credentials" ADD CONSTRAINT "pluggy_credentials_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;