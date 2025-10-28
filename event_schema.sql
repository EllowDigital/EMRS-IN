-- -----------------------------------------------------------------------------
-- Idempotent Event Management Schema Verification & Setup for Neon (PostgreSQL)
-- VERSION 2: REMOVED UNIQUE EMAIL CONSTRAINT
-- -----------------------------------------------------------------------------
-- This script can be run multiple times safely.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- EXTENSIONS
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- TABLE 1: attendees
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    phone_number TEXT NOT NULL, -- Keep phone unique
    email TEXT NOT NULL,        -- Email is NOT unique anymore
    city TEXT NOT NULL,
    state_province TEXT NOT NULL,
    profile_pic_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attempt to REMOVE the unique_email constraint if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_email' AND conrelid = 'attendees'::regclass
    ) THEN
        ALTER TABLE attendees DROP CONSTRAINT unique_email;
        RAISE NOTICE 'Dropped unique_email constraint.'; -- Optional confirmation message
    END IF;
END;
$$;


-- Attempt to add UNIQUE constraint for PHONE (will error harmlessly if it already exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_phone' AND conrelid = 'attendees'::regclass
    ) THEN
        ALTER TABLE attendees ADD CONSTRAINT unique_phone UNIQUE(phone_number);
    END IF;
END;
$$;


-- Create indexes if they don't exist:
-- NOTE: We still index email for faster lookups, even if not unique
CREATE INDEX IF NOT EXISTS idx_attendees_email ON attendees(email);
CREATE INDEX IF NOT EXISTS idx_attendees_phone ON attendees(phone_number);
CREATE INDEX IF NOT EXISTS idx_attendees_reg_id ON attendees(registration_id);


-- -----------------------------------------------------------------------------
-- TABLE 2: check_ins
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS check_ins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendee_id UUID NOT NULL,
    check_in_time TIMESTAMPTZ DEFAULT NOW(),
    verified_by TEXT
);

-- Attempt to add Foreign Key and UNIQUE constraints (will error harmlessly if they already exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_attendee' AND conrelid = 'check_ins'::regclass
    ) THEN
        ALTER TABLE check_ins ADD CONSTRAINT fk_attendee
            FOREIGN KEY(attendee_id)
            REFERENCES attendees(id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_attendee_check_in' AND conrelid = 'check_ins'::regclass
    ) THEN
        ALTER TABLE check_ins ADD CONSTRAINT unique_attendee_check_in UNIQUE(attendee_id);
    END IF;
END;
$$;


-- Create index if it doesn't exist:
CREATE INDEX IF NOT EXISTS idx_check_ins_attendee_id ON check_ins(attendee_id);


-- -----------------------------------------------------------------------------
-- TABLE 3: system_status
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_status (
    id INT PRIMARY KEY DEFAULT 1,
    registration_open BOOLEAN NOT NULL DEFAULT TRUE,
    maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
    status_message TEXT,
    countdown_target TIMESTAMPTZ
);

-- Attempt to add CHECK constraint (will error harmlessly if it already exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'single_row_lock' AND conrelid = 'system_status'::regclass
    ) THEN
        ALTER TABLE system_status ADD CONSTRAINT single_row_lock CHECK (id = 1);
    END IF;
END;
$$;


-- Insert the default row only if the table is empty or the row doesn't exist.
INSERT INTO system_status (id, registration_open, maintenance_mode, status_message, countdown_target)
VALUES (1, TRUE, FALSE, 'Registrations are open!', NULL)
ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- VIEW: admin_dashboard_stats
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_dashboard_stats AS
SELECT
    (SELECT COUNT(*) FROM attendees) AS total_registrations,
    (SELECT COUNT(*) FROM check_ins) AS total_check_ins,
    (SELECT registration_open FROM system_status WHERE id = 1) AS is_registration_open,
    (SELECT maintenance_mode FROM system_status WHERE id = 1) AS is_in_maintenance;

-- -----------------------------------------------------------------------------
-- Verification Complete
-- -----------------------------------------------------------------------------
SELECT 'Schema verification and setup script completed (Email NOT unique).' AS status;