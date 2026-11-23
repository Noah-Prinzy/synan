-- 0005 — database roles for the identity vault (hand-written).
--
-- Group roles (NOLOGIN). Operations create LOGIN users and grant each exactly one of them:
--
--   app_api    the general application role. Reads and writes the operational schema. May INSERT
--              attendees (write-only, so registration stays one transaction) but has NO privilege to
--              read pii_vault.attendees and none on pii_vault.ephemeral_ids. Setting
--              app.vault_scope does not help it: privileges are checked before row-level security.
--   app_scan   the scan-ingest hot path: everything app_api has, plus SELECT/INSERT on the
--              ephemeral ID mapping (credential → per-event ephemeral id). Nothing else in the vault.
--   app_vault  identity reads and writes: SELECT/INSERT/UPDATE on pii_vault.attendees and
--              SELECT/INSERT on the ephemeral mapping, nothing in the operational schema. Its
--              transactions still declare a scope (system / operator / attendee / scan) through
--              app.vault_scope, which row-level security enforces as an inner layer.
--
-- The migrating role owns every object and is the only one that may run DDL. It needs:
--   CREATEROLE (to create the three group roles; on PostgreSQL 16+ it then holds ADMIN on them),
--   CREATE on the database (schemas), and the right to CREATE EXTENSION btree_gist — on managed
--   services btree_gist is a trusted/allow-listed extension (e.g. rds_superuser on RDS, cloudsqlsuperuser
--   on Cloud SQL, azure_pg_admin on Azure). No superuser-only feature is used.
--   If the migrating role lacks CREATEROLE, create the three roles beforehand (same names, NOLOGIN);
--   this migration then only grants.
--
-- Single-role deployments (development, PGlite, the backend's current tests) keep working: a
-- superuser bypasses all of this, and the table owner keeps its privileges and the app.vault_scope
-- policies from 0002.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN CREATE ROLE app_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_scan') THEN CREATE ROLE app_scan NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_vault') THEN CREATE ROLE app_vault NOLOGIN; END IF;
END
$$;
--> statement-breakpoint
GRANT app_api TO app_scan;
--> statement-breakpoint

-- Nobody but the owner may create objects in public (default since PostgreSQL 15; explicit here for
-- older servers). Skipped with a notice if the migrating role does not own schema public.
DO $$
BEGIN
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'could not revoke CREATE on schema public from PUBLIC; do it as the schema owner';
END
$$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA pii_vault FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA pii_vault FROM PUBLIC;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- app_api: the operational schema
------------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_api, app_vault;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api;
--> statement-breakpoint
-- Append-only tables: no UPDATE or DELETE even if the triggers were ever disabled.
REVOKE UPDATE, DELETE ON public.scans, public.audit_log FROM app_api;
--> statement-breakpoint
-- The chain head is written only by the SECURITY DEFINER audit trigger; readable for audit_verify().
REVOKE INSERT, UPDATE, DELETE ON public.audit_chain_head FROM app_api;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api;
--> statement-breakpoint
-- Tables and sequences created by later migrations (run by the same owner) get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_api;
--> statement-breakpoint
-- Write-only identity: create attendees (encrypted by the caller), never read them.
GRANT USAGE ON SCHEMA pii_vault TO app_api;
--> statement-breakpoint
GRANT INSERT ON pii_vault.attendees TO app_api;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- app_scan: the ephemeral mapping, nothing else in the vault
------------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA pii_vault TO app_scan;
--> statement-breakpoint
GRANT SELECT, INSERT ON pii_vault.ephemeral_ids TO app_scan;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- app_vault: identity only
------------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA pii_vault TO app_vault;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON pii_vault.attendees TO app_vault;
--> statement-breakpoint
GRANT SELECT, INSERT ON pii_vault.ephemeral_ids TO app_vault;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- Functions. EXECUTE is granted to PUBLIC by default; the privileged ones are narrowed.
-- None of these returns identity: purge and rollups return counts, erasure a boolean.
------------------------------------------------------------------------------------------------

-- The events delete trigger drops the event's (empty) scan partition: only the owner may drop it.
ALTER FUNCTION public.events_scan_partition() SECURITY DEFINER;
--> statement-breakpoint

-- Pin search_path on every SECURITY DEFINER function: pg_catalog first, then the owner's schemas,
-- pg_temp last (so a caller's temporary objects can never shadow anything).
ALTER FUNCTION public.events_scan_partition() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.create_scan_partition(uuid) SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.audit_log_chain() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.audit_prune() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rebuild_event_rollups(uuid) SET search_path = pg_catalog, public, pii_vault, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.purge_event_movement_data(uuid, boolean, uuid) SET search_path = pg_catalog, public, pii_vault, pg_temp;
--> statement-breakpoint
ALTER FUNCTION pii_vault.erase_attendee(uuid, uuid) SET search_path = pg_catalog, public, pii_vault, pg_temp;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.purge_event_movement_data(uuid, boolean, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.purge_event_movement_data(uuid, boolean, uuid) TO app_api;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.rebuild_event_rollups(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.rebuild_event_rollups(uuid) TO app_api;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.audit_prune() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.audit_prune() TO app_api;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.create_scan_partition(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_scan_partition(uuid) TO app_api;
--> statement-breakpoint
-- Erasure rewrites identity: the vault role only.
REVOKE EXECUTE ON FUNCTION pii_vault.erase_attendee(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pii_vault.erase_attendee(uuid, uuid) TO app_vault;
--> statement-breakpoint
-- The scope helpers are used inside row-level security policies.
GRANT EXECUTE ON FUNCTION pii_vault.current_scope(), pii_vault.current_attendee() TO app_api, app_vault;
