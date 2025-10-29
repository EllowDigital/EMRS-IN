-- -----------------------------------------------------------------------------
-- Idempotent Event Management Schema for EMRS-IN (PostgreSQL)
-- Version 3: Aligned with application code.
-- This script reflects the actual schema used by the Netlify functions.
-- It can be run multiple times safely.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- EXTENSIONS
-- -----------------------------------------------------------------------------
-- Ensures the UUID generation function is available.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- TABLE 1: attendees
-- This table stores information about each registered attendee.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pass_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    city TEXT,
    state_province TEXT,
    profile_pic_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    checked_in BOOLEAN DEFAULT FALSE,
    checked_in_at TIMESTAMPTZ
);

-- Create indexes for faster lookups on commonly queried columns.
CREATE INDEX IF NOT EXISTS idx_attendees_email ON attendees(email);
CREATE INDEX IF NOT EXISTS idx_attendees_phone ON attendees(phone);
CREATE INDEX IF NOT EXISTS idx_attendees_pass_id ON attendees(pass_id);

-- -----------------------------------------------------------------------------
-- TABLE 2: system_config
-- A key-value store for system-wide settings like registration status.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(255) PRIMARY KEY,
    value VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration settings.
-- ON CONFLICT DO NOTHING ensures this only runs the first time.
INSERT INTO system_config (key, value) VALUES ('registration_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO system_config (key, value) VALUES ('maintenance_mode', 'false') ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- VIEW: admin_dashboard_stats
-- Provides a quick overview of key metrics for the admin dashboard.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_dashboard_stats AS
SELECT
    (SELECT COUNT(*) FROM attendees) AS total_registrations,
    (SELECT COUNT(*) FROM attendees WHERE checked_in = TRUE) AS total_check_ins,
    (SELECT value FROM system_config WHERE key = 'registration_enabled') AS is_registration_open,
    (SELECT value FROM system_config WHERE key = 'maintenance_mode') AS is_in_maintenance;

-- -----------------------------------------------------------------------------
-- Verification Complete
-- -----------------------------------------------------------------------------
SELECT 'EMRS-IN schema setup script completed successfully.' AS status;

-- -----------------------------------------------------------------------------
-- BACKWARD-COMPATIBILITY & PERFORMANCE ADDITIONS
-- Add optional alias columns and search index to match application expectations
-- These are idempotent and safe to run repeatedly.
-- -----------------------------------------------------------------------------

-- 1) Add convenience alias columns that some functions expect (registration_id, full_name, phone_number)
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS registration_id TEXT;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Populate alias columns from existing columns when empty
UPDATE attendees SET registration_id = pass_id WHERE registration_id IS NULL AND pass_id IS NOT NULL;
UPDATE attendees SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL;
UPDATE attendees SET phone_number = phone WHERE phone_number IS NULL AND phone IS NOT NULL;

-- Create trigger function to keep alias columns in sync on insert/update
CREATE OR REPLACE FUNCTION attendees_sync_aliases() RETURNS trigger AS $$
BEGIN
    NEW.registration_id := COALESCE(NEW.registration_id, NEW.pass_id);
    NEW.full_name := COALESCE(NEW.full_name, NEW.name);
    NEW.phone_number := COALESCE(NEW.phone_number, NEW.phone);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendees_sync_aliases ON attendees;
CREATE TRIGGER trg_attendees_sync_aliases
BEFORE INSERT OR UPDATE ON attendees
FOR EACH ROW EXECUTE FUNCTION attendees_sync_aliases();

-- 2) Optional check_ins table: if your code records check-ins to a separate table, create it.
CREATE TABLE IF NOT EXISTS check_ins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendee_id UUID REFERENCES attendees(id) ON DELETE CASCADE,
    checked_in_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_checkins_attendee_id ON check_ins(attendee_id);

-- 3) Add tsvector column and GIN index to speed up attendee text search
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS search_tsv tsvector;

-- Populate search_tsv for existing rows
UPDATE attendees SET search_tsv = to_tsvector('english', coalesce(full_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(registration_id,'')) WHERE search_tsv IS NULL;

-- Create trigger to keep search_tsv up-to-date
CREATE OR REPLACE FUNCTION attendees_update_search_tsv() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv := to_tsvector('english', coalesce(NEW.full_name,'') || ' ' || coalesce(NEW.email,'') || ' ' || coalesce(NEW.registration_id,''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendees_update_search_tsv ON attendees;
CREATE TRIGGER trg_attendees_update_search_tsv
BEFORE INSERT OR UPDATE ON attendees
FOR EACH ROW EXECUTE FUNCTION attendees_update_search_tsv();

CREATE INDEX IF NOT EXISTS idx_attendees_search_tsv ON attendees USING GIN (search_tsv);

-- 4) Recommend a trigram index on registration_id and full_name for fast ILIKE queries (optional)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_attendees_regid_trgm ON attendees USING GIN (registration_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_attendees_fullname_trgm ON attendees USING GIN (full_name gin_trgm_ops);

-- End of backward-compat/perf additions
