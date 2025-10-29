import postgres from 'postgres';

let sqlClient;
let schemaPromise;

async function ensureSchema(sql) {
  await sql`create extension if not exists "pgcrypto"`;

  await sql`create type if not exists checkin_method as enum ('qr_scan','manual_lookup')`;
  await sql`alter type checkin_method add value if not exists 'qr_scan'`;
  await sql`alter type checkin_method add value if not exists 'manual_lookup'`;

  await sql`create type if not exists attendee_status as enum ('registered','epass_issued','checked_in','revoked')`;
  await sql`alter type attendee_status add value if not exists 'registered'`;
  await sql`alter type attendee_status add value if not exists 'epass_issued'`;
  await sql`alter type attendee_status add value if not exists 'checked_in'`;
  await sql`alter type attendee_status add value if not exists 'revoked'`;

  await sql`
    create table if not exists attendees (
      id uuid primary key default gen_random_uuid(),
      registration_id text not null,
      full_name text not null,
      phone char(10) not null,
      email text not null,
      city text not null,
      state text not null,
      profile_public_id text,
      profile_url text,
      status attendee_status not null default 'registered',
      last_qr_requested_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;

  await sql`alter table attendees add column if not exists profile_public_id text`;
  await sql`alter table attendees add column if not exists profile_url text`;
  await sql`alter table attendees add column if not exists status attendee_status default 'registered'`;
  await sql`alter table attendees add column if not exists last_qr_requested_at timestamptz`;
  await sql`alter table attendees add column if not exists created_at timestamptz default now()`;
  await sql`alter table attendees add column if not exists updated_at timestamptz default now()`;

  await sql`update attendees set created_at = now() where created_at is null`;
  await sql`update attendees set updated_at = now() where updated_at is null`;
  await sql`alter table attendees alter column created_at set default now()`;
  await sql`alter table attendees alter column updated_at set default now()`;
  await sql`alter table attendees alter column created_at set not null`;
  await sql`alter table attendees alter column updated_at set not null`;
  await sql`alter table attendees alter column status type attendee_status using status::attendee_status`;
  await sql`alter table attendees alter column status set default 'registered'`;

  await sql`
    do $$
    begin
      if not exists (
        select 1 from information_schema.table_constraints
        where table_name = 'attendees' and constraint_name = 'attendees_registration_id_key'
      ) then
        alter table attendees add constraint attendees_registration_id_key unique (registration_id);
      end if;
    end;
    $$;
  `;

  await sql`
    do $$
    begin
      if not exists (
        select 1 from information_schema.table_constraints
        where table_name = 'attendees' and constraint_name = 'attendees_phone_key'
      ) then
        alter table attendees add constraint attendees_phone_key unique (phone);
      end if;
    end;
    $$;
  `;

  await sql`
    do $$
    begin
      if not exists (
        select 1 from information_schema.table_constraints
        where table_name = 'attendees' and constraint_name = 'attendees_phone_digits_ck'
      ) then
        alter table attendees add constraint attendees_phone_digits_ck check (phone ~ '^[0-9]{10}$');
      end if;
    end;
    $$;
  `;

  await sql`create index if not exists idx_attendees_email on attendees(lower(email))`;
  await sql`create index if not exists idx_attendees_created_at on attendees(created_at desc)`;
  await sql`create index if not exists idx_attendees_status on attendees(status)`;
  await sql`create index if not exists idx_attendees_last_qr on attendees(last_qr_requested_at desc)`;

  await sql`
    create table if not exists checkins (
      id uuid primary key default gen_random_uuid(),
      attendee_id uuid not null references attendees(id) on delete cascade,
      method checkin_method not null,
      location text,
      notes text,
      created_at timestamptz not null default now()
    )
  `;

  await sql`alter table checkins add column if not exists location text`;
  await sql`alter table checkins add column if not exists notes text`;
  await sql`alter table checkins add column if not exists created_at timestamptz default now()`;
  await sql`update checkins set created_at = now() where created_at is null`;
  await sql`alter table checkins alter column created_at set default now()`;
  await sql`alter table checkins alter column created_at set not null`;
  await sql`alter table checkins alter column method type checkin_method using method::checkin_method`;

  await sql`alter table if exists checkins drop column if exists staff_id`;
  await sql`drop index if exists checkins_attendee_once_idx`;
  await sql`drop index if exists idx_checkins_staff_id`;
  await sql`create index if not exists idx_checkins_attendee_id on checkins(attendee_id)`;
  await sql`create index if not exists idx_checkins_created_at on checkins(created_at desc)`;

  await sql`alter table if exists system_settings drop column if exists updated_by`;
  await sql`drop table if exists staff_tokens cascade`;
  await sql`drop table if exists staff_accounts cascade`;
  await sql`drop table if exists service_health_logs cascade`;
  await sql`drop table if exists email_log cascade`;
  await sql`drop table if exists attendee_events cascade`;
  await sql`drop type if exists health_status`;

  await sql`
    create table if not exists system_settings (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )
  `;

  await sql`alter table system_settings add column if not exists updated_at timestamptz default now()`;
  await sql`update system_settings set updated_at = now() where updated_at is null`;
  await sql`alter table system_settings alter column updated_at set default now()`;
  await sql`alter table system_settings alter column updated_at set not null`;

  await sql`
    insert into system_settings (key, value)
    values ('registration_open', '{"enabled": true}'::jsonb)
    on conflict (key) do nothing
  `;

  await sql`
    insert into system_settings (key, value)
    values ('maintenance_mode', '{"enabled": false, "message": ""}'::jsonb)
    on conflict (key) do nothing
  `;

  await sql`
    create or replace function set_updated_at()
    returns trigger as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$ language plpgsql;
  `;

  await sql`
    do $$
    begin
      if not exists (
        select 1 from pg_trigger
        where tgname = 'trg_attendees_updated_at'
      ) then
        create trigger trg_attendees_updated_at
        before update on attendees
        for each row execute function set_updated_at();
      end if;
    end;
    $$;
  `;
}

function getConnectionOptions() {
  const ssl = process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false };
  return {
    ssl,
    prepare: true,
    max: Number.parseInt(process.env.DB_POOL_MAX || '5', 10),
    idle_timeout: Number.parseInt(process.env.DB_IDLE_TIMEOUT || '20', 10),
    max_lifetime: Number.parseInt(process.env.DB_MAX_LIFETIME || String(60 * 5), 10),
    connection: {
      application_name: process.env.DB_APP_NAME || 'emrs-verify-functions',
    },
    onnotice: () => { /* silence */ },
  };
}

export function getSqlClient() {
  if (!sqlClient) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured. Populate it in Netlify/Environment variables');
    }
    sqlClient = postgres(process.env.DATABASE_URL, getConnectionOptions());
    schemaPromise = ensureSchema(sqlClient).catch((error) => {
      console.error('Failed to ensure schema', error);
      throw error;
    });
  }
  return sqlClient;
}

export async function ensureSchemaReady() {
  if (!schemaPromise) {
    getSqlClient();
  }
  await schemaPromise;
}

export async function closeSqlClient() {
  if (sqlClient) {
    try {
      await sqlClient.end({ timeout: 5 });
    } catch (err) {
      console.warn('Error closing PostgreSQL client', err);
    } finally {
      sqlClient = undefined;
      schemaPromise = undefined;
    }
  }
}
