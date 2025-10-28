CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(255) PRIMARY KEY,
    value VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Default settings
INSERT INTO system_config (key, value) VALUES ('registration_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO system_config (key, value) VALUES ('maintenance_mode', 'false') ON CONFLICT (key) DO NOTHING;
