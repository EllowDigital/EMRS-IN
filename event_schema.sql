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
