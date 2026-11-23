DROP INDEX "users_email_lower_uq";--> statement-breakpoint
DROP INDEX "users_email_hash_uq";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email_hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_hash_uq" ON "users" USING btree ("email_hash");