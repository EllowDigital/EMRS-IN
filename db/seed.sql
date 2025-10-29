-- Seed data for EMRS attendees (sample records for local testing)
-- Assumes db/schema.sql has been applied

INSERT INTO attendees (registration_id, full_name, phone, email, city, state, profile_url, status)
VALUES
  ('UP25-TEST0001', 'Test User One', '9876500001', 'test1@example.com', 'Lucknow', 'UP', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=400&auto=format&fit=crop&ixlib=rb-4.0.3&s=placeholder', 'registered')
ON CONFLICT (registration_id) DO NOTHING;

INSERT INTO attendees (registration_id, full_name, phone, email, city, state, profile_url, status)
VALUES
  ('UP25-TEST0002', 'Test User Two', '9876500002', 'test2@example.com', 'Lucknow', 'UP', 'https://images.unsplash.com/photo-1545996124-6b7f6b5d6c4f?q=80&w=400&auto=format&fit=crop&ixlib=rb-4.0.3&s=placeholder', 'epass_issued')
ON CONFLICT (registration_id) DO NOTHING;
