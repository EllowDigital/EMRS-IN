-- EMRS Neon/PostgreSQL schema
-- Run this script against your Neon database to provision all required objects.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE checkin_method AS ENUM ('qr_scan', 'manual_lookup');
CREATE TYPE attendee_status AS ENUM ('registered', 'epass_issued', 'checked_in', 'revoked');
CREATE TYPE health_status AS ENUM ('operational', 'degraded', 'down');

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

CREATE INDEX idx_attendees_email ON attendees (lower(email));
CREATE INDEX idx_attendees_created_at ON attendees (created_at DESC);
CREATE INDEX idx_attendees_status ON attendees (status);
CREATE INDEX idx_attendees_last_qr ON attendees (last_qr_requested_at DESC);

CREATE TABLE staff_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff_accounts(id),
  method checkin_method NOT NULL,
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX checkins_attendee_once_idx ON checkins(attendee_id) WHERE method = 'qr_scan';
CREATE INDEX idx_checkins_created_at ON checkins (created_at DESC);
CREATE INDEX idx_checkins_staff_id ON checkins (staff_id);

CREATE TABLE staff_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  description TEXT,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_staff_tokens_staff ON staff_tokens (staff_id);
CREATE INDEX idx_staff_tokens_active ON staff_tokens (staff_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES staff_accounts(id),
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

CREATE TABLE service_health_logs (
  id BIGSERIAL PRIMARY KEY,
  service_name TEXT NOT NULL,
  status health_status NOT NULL,
  response_ms INTEGER,
  metadata JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_health_service_time ON service_health_logs (service_name, checked_at DESC);

CREATE TABLE email_log (
  id BIGSERIAL PRIMARY KEY,
  attendee_id UUID REFERENCES attendees(id) ON DELETE SET NULL,
  template_key TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT
);

CREATE INDEX idx_email_log_attendee ON email_log (attendee_id);
CREATE INDEX idx_email_log_sent_at ON email_log (sent_at DESC);

CREATE TABLE attendee_events (
  id BIGSERIAL PRIMARY KEY,
  attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_by UUID REFERENCES staff_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attendee_events_attendee ON attendee_events (attendee_id, created_at DESC);

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
