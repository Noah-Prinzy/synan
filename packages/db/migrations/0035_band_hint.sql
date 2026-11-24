-- 0035 — a band's hint people can read (generated).
-- carriers.identifier_hint: the NFC UID's last four characters in upper-case hex, stored when the UID is
-- presented (import, bind, a desk or gate read). The identifier stays the UID's hash; the UID is never stored.
ALTER TABLE "carriers" ADD COLUMN "identifier_hint" text;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_identifier_hint_shape" CHECK ("carriers"."identifier_hint" IS NULL OR ("carriers"."kind" = 'nfc' AND "carriers"."identifier_hint" ~ '^[0-9A-F]{4}$'));
