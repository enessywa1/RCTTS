import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION || '';
if (!connectionString) {
  console.warn('No Postgres connection string set in DATABASE_URL or PG_CONNECTION. Local dev requires this.');
}

export const pool = new Pool({ connectionString });

// Ensure documents table exists for generic collection storage
export async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id serial PRIMARY KEY,
        collection TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_collection_docid ON documents(collection, doc_id);`);
  } finally {
    client.release();
  }
}

export default pool;
