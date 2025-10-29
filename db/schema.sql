BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ENUM Types
CREATE TYPE checkin_method AS ENUM ('qr_scan', 'manual_lookup');
CREATE TYPE attendee_status AS ENUM ('registered', 'epass_issued', 'checked_in', 'revoked');

-- attendees Table
CREATE TABLE attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone CHAR(10) NOT NULL,
  email TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  profile_public_id TEXT,
  profile_url TEXT,
  status attendee_status NOT NULL DEFAULT 'registered',
  last_qr_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE attendees
  ADD CONSTRAINT attendees_registration_id_key UNIQUE (registration_id);

ALTER TABLE attendees
  ADD CONSTRAINT attendees_phone_key UNIQUE (phone);

ALTER TABLE attendees
  ADD CONSTRAINT attendees_phone_digits_ck CHECK (phone ~ '^[0-9]{10}$');

-- Indexes for fast reads on attendees
CREATE INDEX idx_attendees_email ON attendees (lower(email));
CREATE INDEX idx_attendees_created_at ON attendees (created_at DESC);
CREATE INDEX idx_attendees_status ON attendees (status);
CREATE INDEX idx_attendees_last_qr ON attendees (last_qr_requested_at DESC);

-- checkins Table
CREATE TABLE checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  method checkin_method NOT NULL,
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for checkins
CREATE INDEX idx_checkins_attendee_id ON checkins (attendee_id);
CREATE INDEX idx_checkins_created_at ON checkins (created_at DESC);

-- system_settings Table
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value)
VALUES
  ('registration_open', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_settings (key, value)
VALUES
  ('maintenance_mode', '{"enabled": false, "message": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Function and Trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attendees_updated_at
BEFORE UPDATE ON attendees
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
