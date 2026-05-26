import pool from '../server/db.js';

async function main() {
  const firebaseUid = process.env.SUPERADMIN_FIREBASE_UID;
  const name = process.env.SUPERADMIN_NAME || 'Super Admin';
  const email = process.env.SUPERADMIN_EMAIL || 'admin@local';
  if (!firebaseUid) {
    console.error('Set SUPERADMIN_FIREBASE_UID env var');
    process.exit(1);
  }
  try {
    const r = await pool.query('INSERT INTO users(firebase_uid, name, email, role, status) VALUES($1,$2,$3,$4,$5) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role RETURNING id', [firebaseUid, name, email, 'admin', 'Active']);
    console.log('Super admin created with id', r.rows[0].id);
    process.exit(0);
  } catch (e) {
    console.error('Failed to seed super admin', e);
    process.exit(1);
  }
}

main();
