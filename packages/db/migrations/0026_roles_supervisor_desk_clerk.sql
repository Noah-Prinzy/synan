ALTER TYPE "public"."user_role" ADD VALUE 'supervisor';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'desk_clerk';--> statement-breakpoint
ALTER TABLE "access_rules" DROP CONSTRAINT "access_rules_subject_valid";--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_subject_valid" CHECK (("access_rules"."subject_kind" = 'tier' AND "access_rules"."subject" IN ('VIP','ORDINARY','PRIVATE_INVITE','PUBLIC'))
       OR ("access_rules"."subject_kind" = 'role' AND "access_rules"."subject" IN ('admin','organiser','security_staff','speaker','crew','supervisor','desk_clerk')));