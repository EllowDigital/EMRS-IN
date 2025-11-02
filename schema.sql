-- Creates the 'registrations' table in the 'public' schema
CREATE TABLE IF NOT EXISTS public.registrations (
    -- 'id' is an auto-incrementing primary key
    id SERIAL PRIMARY KEY,

    -- 'timestamp' defaults to the time of insertion.
    -- Quoted because "timestamp" is a reserved SQL keyword.
    "timestamp" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- 'registration_id_text' is the unique, human-readable ID (e.g., EMRS-1234)
    registration_id_text TEXT UNIQUE NOT NULL,

    -- Attendee details
    name TEXT,
    phone TEXT UNIQUE,
    email TEXT,
    city TEXT,
    state TEXT,
    payment_id_text TEXT,
    image_url TEXT,

    -- 'needs_sync' flags rows for the Google Sheets sync
    needs_sync BOOLEAN DEFAULT true,

    -- 'checked_in_at' is null until the user is verified at the event
    checked_in_at TIMESTAMP WITH TIME ZONE,

    -- 'updated_at' automatically updates when the row is modified
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

---
--- Create Indexes for faster queries
---
-- Note: Indexes for 'id' (PRIMARY KEY), 'registration_id_text' (UNIQUE),
-- and 'phone' (UNIQUE) are created automatically by the constraints above.

-- Index for quickly finding checked-in users (for stats or lookups)
CREATE INDEX IF NOT EXISTS idx_registrations_checked_in_at
ON public.registrations(checked_in_at);

-- A partial index to help the 'sync-with-google-sheets' function
-- quickly find only the rows that need to be synced.
CREATE INDEX IF NOT EXISTS idx_registrations_needs_sync
ON public.registrations(needs_sync)
WHERE needs_sync = true;

-- An expression index to speed up queries that group by date
-- (e.g., the 'get-stats' function)
CREATE INDEX IF NOT EXISTS idx_registrations_timestamp_date
ON public.registrations(((timestamp)::date));