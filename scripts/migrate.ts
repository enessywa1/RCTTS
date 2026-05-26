import pool, { ensureSchema } from '../server/db.js';

async function main() {
  try {
    await ensureSchema();
    console.log('Schema ensured');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
