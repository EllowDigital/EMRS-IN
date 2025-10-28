-- -----------------------------------------------------------------------------
-- WARNING: This script deletes ALL attendee registrations.
-- Use with extreme caution! This action cannot be undone.
-- -----------------------------------------------------------------------------

-- Empty the attendees table. This will remove all registration and check-in data.
TRUNCATE TABLE attendees RESTART IDENTITY CASCADE;

-- Reset the system_config table to its default state.
UPDATE system_config SET value = 'true' WHERE key = 'registration_enabled';
UPDATE system_config SET value = 'false' WHERE key = 'maintenance_mode';

-- -----------------------------------------------------------------------------
-- Data Reset Complete
-- -----------------------------------------------------------------------------
SELECT 'All attendee data has been cleared and system configuration has been reset.' AS status;
