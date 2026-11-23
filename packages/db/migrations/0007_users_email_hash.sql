ALTER TABLE "users" ADD COLUMN "email_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_hash_uq" ON "users" USING btree ("email_hash") WHERE "users"."email_hash" IS NOT NULL;