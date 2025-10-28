-- -----------------------------------------------------------------------------
-- WARNING: This script deletes ALL attendee registrations and check-ins.
-- Use with caution! Ensure you want to completely reset the data.
-- -----------------------------------------------------------------------------

-- Empty the check_ins and attendees tables.
-- TRUNCATE is faster than DELETE for large amounts of data.
-- CASCADE automatically handles the foreign key relationship 
-- (emptying attendees requires emptying check_ins first, CASCADE does this).
TRUNCATE TABLE attendees CASCADE; 
-- Note: 'CASCADE' will also empty 'check_ins' because of the foreign key.
-- Alternatively, you could run: TRUNCATE TABLE check_ins, attendees;

-- Reset the system_status table to its default state.
-- It's safer to UPDATE the existing row rather than deleting and re-inserting.
UPDATE system_status 
SET 
    registration_open = TRUE, 
    maintenance_mode = FALSE, 
    status_message = 'Registrations are open!', 
    countdown_target = NULL 
WHERE id = 1;

-- -----------------------------------------------------------------------------
-- Data Reset Complete
-- -----------------------------------------------------------------------------
SELECT 'Attendee and check-in data has been cleared. System status reset.' AS status;