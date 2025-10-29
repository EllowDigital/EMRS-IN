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

  await sql`
    create unique index if not exists attendees_registration_id_key on attendees(registration_id)
  `;
  await sql`
    create unique index if not exists attendees_phone_key on attendees(phone)
  `;
  await sql`
    create index if not exists idx_attendees_email on attendees(lower(email))
  `;
  await sql`
    create index if not exists idx_attendees_created_at on attendees(created_at desc)
  `;

  await sql`
    create table if not exists checkins (
      id uuid primary key default gen_random_uuid(),
      attendee_id uuid not null references attendees(id) on delete cascade,
      staff_id uuid,
      method checkin_method not null,
      location text,
      notes text,
      created_at timestamptz not null default now()
    )
  `;

  await sql`
    create unique index if not exists checkins_attendee_once_idx on checkins(attendee_id) where method = 'qr_scan'
  `;
  await sql`
    create index if not exists idx_checkins_created_at on checkins(created_at desc)
  `;

  await sql`
    create table if not exists staff_accounts (
      id uuid primary key default gen_random_uuid(),
      full_name text not null,
      email text not null unique,
      password_hash text not null,
      role text not null default 'staff',
      created_at timestamptz not null default now(),
      last_login_at timestamptz
    )
  `;

  await sql`
    do $$
    begin
      if not exists (
        select 1 from information_schema.table_constraints
        where constraint_name = 'checkins_staff_id_fkey'
      ) then
        alter table checkins
        add constraint checkins_staff_id_fkey foreign key (staff_id) references staff_accounts(id);
      end if;
    end;
    $$;
  `;

  await sql`
    create table if not exists staff_tokens (
      id uuid primary key default gen_random_uuid(),
      staff_id uuid not null references staff_accounts(id) on delete cascade,
      description text,
      token_hash text not null,
      expires_at timestamptz,
      created_at timestamptz not null default now(),
      revoked_at timestamptz
    )
  `;

  await sql`
    create index if not exists idx_staff_tokens_staff on staff_tokens(staff_id)
  `;
  await sql`
    create index if not exists idx_staff_tokens_active on staff_tokens(staff_id, expires_at) where revoked_at is null
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
