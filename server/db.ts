import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION || '';
if (!connectionString) {
  console.warn('No Postgres connection string set in DATABASE_URL or PG_CONNECTION. Local dev requires this.');
}

export const pool = new Pool({ connectionString });

// Ensure structured schema for agencies, users, drivers, tickets, gps_updates
export async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agencies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        active BOOLEAN DEFAULT true,
        tier TEXT,
        contact TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        firebase_uid TEXT UNIQUE,
        name TEXT,
        email TEXT UNIQUE,
        role TEXT,
        agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
        status TEXT,
        meta JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS drivers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT,
        license TEXT,
        agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
        vehicle TEXT,
        status TEXT,
        meta JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender JSONB,
        receiver JSONB,
        package_type TEXT,
        weight NUMERIC,
        declared_value NUMERIC,
        agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
        driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
        status TEXT,
        route JSONB,
        current_lat DOUBLE PRECISION,
        current_lng DOUBLE PRECISION,
        last_gps_update TIMESTAMPTZ,
        meta JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS gps_updates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
        driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        speed DOUBLE PRECISION,
        recorded_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_tickets_agency ON tickets(agency_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_driver ON tickets(driver_id);
      CREATE INDEX IF NOT EXISTS idx_gps_ticket ON gps_updates(ticket_id);
    `);
  } finally {
    client.release();
  }
}

export default pool;
