-- ---
-- EMRS Registrations Table Schema
-- Created By EllowDigital
-- ---

-- Drop the table if it exists to start fresh (optional, be careful)
-- DROP TABLE IF EXISTS public.registrations;

-- Create the main 'registrations' table
CREATE TABLE IF NOT EXISTS public.registrations (
    id SERIAL PRIMARY KEY,
    "timestamp" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reg_id TEXT UNIQUE NOT NULL,
    name TEXT,
    phone TEXT UNIQUE,
    email TEXT,
    city TEXT,
    state TEXT,
    pay_id TEXT,
    image_url TEXT,
    needs_sync BOOLEAN DEFAULT true,
    checked_in_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ---
-- Indexes
-- Note: UNIQUE and PRIMARY KEY indexes are created automatically by the constraints.
-- ---

-- Index for quickly finding checked-in users
CREATE INDEX IF NOT EXISTS idx_registrations_checked_in_at
ON public.registrations USING BTREE (checked_in_at);

-- Index for finding by reg_id (as seen in screenshot)
CREATE INDEX IF NOT EXISTS idx_registrations_not_checked_in
ON public.registrations USING BTREE (reg_id);

-- Index for grouping registrations by date
CREATE INDEX IF NOT EXISTS idx_registrations_timestamp_date
ON public.registrations USING BTREE (("timestamp"::date));