import postgres from 'postgres';

let sqlClient;
let schemaPromise;

async function ensureSchema(sql) {
  await sql`create extension if not exists "pgcrypto"`;

  await sql`
    create table if not exists attendees (
      id uuid primary key default gen_random_uuid(),
      registration_id text unique not null,
      full_name text not null,
      phone char(10) unique not null,
      email text not null,
      city text not null,
      state text not null,
      profile_public_id text,
      profile_url text,
      status text not null default 'registered',
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
}

export function getSqlClient() {
  if (!sqlClient) {
    sqlClient = postgres(process.env.DATABASE_URL, {
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    });
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
