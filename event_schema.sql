-- -----------------------------------------------------------------------------
-- Event Management Schema for Neon (PostgreSQL)
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- EXTENSIONS
-- -----------------------------------------------------------------------------
-- Enable the 'uuid-ossp' extension to generate UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- TABLE 1: attendees
-- Stores all information for registered attendees.
-- -----------------------------------------------------------------------------
CREATE TABLE attendees (
    -- Primary Key: A unique, unguessable ID for each attendee.
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Registration ID: The human-readable, unique ID (e.g., "UP25-XXXXXXXX").
    registration_id TEXT NOT NULL UNIQUE,
    
    -- Attendee Details:
    full_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    email TEXT NOT NULL,
    city TEXT NOT NULL,
    state_province TEXT NOT NULL,
    
    -- Cloudinary URL:
    profile_pic_url TEXT,
    
    -- Timestamps:
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints:
    -- Ensure no two attendees can register with the same email or phone.
    CONSTRAINT unique_email UNIQUE(email),
    CONSTRAINT unique_phone UNIQUE(phone_number)
);

-- Indexes for fast lookups:
-- Create indexes on the columns we will use to search for users.
CREATE INDEX idx_attendees_email ON attendees(email);
CREATE INDEX idx_attendees_phone ON attendees(phone_number);
CREATE INDEX idx_attendees_reg_id ON attendees(registration_id);


-- -----------------------------------------------------------------------------
-- TABLE 2: check_ins
-- Stores a record of each attendee check-in for the "Verify & Check-In" page.
-- -----------------------------------------------------------------------------
CREATE TABLE check_ins (
    -- Primary Key:
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Foreign Key: Links this check-in to a specific attendee.
    attendee_id UUID NOT NULL,
    
    -- Timestamps:
    check_in_time TIMESTAMPTZ DEFAULT NOW(),
    
    -- Audit Trail:
    -- Stores who verified this pass (e.g., "Staff Scanner 1", "Admin: John Doe").
    verified_by TEXT,
    
    -- Constraints:
    -- 1. Links to the 'attendees' table. If an attendee is deleted, their check-in is also deleted.
    CONSTRAINT fk_attendee
        FOREIGN KEY(attendee_id) 
        REFERENCES attendees(id) 
        ON DELETE CASCADE,
        
    -- 2. Ensures an attendee can only be checked-in *once*.
    CONSTRAINT unique_attendee_check_in UNIQUE(attendee_id)
);

-- Index for fast check-in lookups:
CREATE INDEX idx_check_ins_attendee_id ON check_ins(attendee_id);


-- -----------------------------------------------------------------------------
-- TABLE 3: system_status
-- Controls the Admin Dashboard features (e.g., pausing registration).
-- This table will ONLY EVER have ONE ROW.
-- -----------------------------------------------------------------------------
CREATE TABLE system_status (
    -- We use a single 'id' and a CHECK constraint to ensure only one row exists.
    id INT PRIMARY KEY DEFAULT 1,
    
    -- Registration Control:
    registration_open BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Maintenance Mode:
    maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Status Message:
    -- Displayed on the site (e.g., "Registrations are closed", "Opening in 2 hours!").
    status_message TEXT,
    
    -- Countdown Target:
    -- A future timestamp for the "Upcoming (Countdown Display)" feature.
    countdown_target TIMESTAMPTZ,
    
    CONSTRAINT single_row_lock CHECK (id = 1)
);

-- Insert the one and only row for the admin panel to control.
INSERT INTO system_status (registration_open, maintenance_mode, status_message, countdown_target)
VALUES (TRUE, FALSE, 'Registrations are open!', NULL);


-- -----------------------------------------------------------------------------
-- VIEW: admin_dashboard_stats
-- A pre-built query to make loading the admin dashboard easier and faster.
-- -----------------------------------------------------------------------------
CREATE VIEW admin_dashboard_stats AS
SELECT
    -- Get total registration count
    (SELECT COUNT(*) FROM attendees) AS total_registrations,
    
    -- Get total check-in count
    (SELECT COUNT(*) FROM check_ins) AS total_check_ins,
    
    -- Get the current system status
    (SELECT registration_open FROM system_status WHERE id = 1) AS is_registration_open,
    (SELECT maintenance_mode FROM system_status WHERE id = 1) AS is_in_maintenance;

-- -----------------------------------------------------------------------------
-- End of schema
-- -----------------------------------------------------------------------------

