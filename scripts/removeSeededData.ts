import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

const AGENCIES = [
  'Zebre Car Express',
  'Ritco',
  'Capital Express',
  'LogExpress',
  'Swift RW',
  'EastLink Courier',
  'Horizon Transport',
  'PaceSetter Express'
];

async function loadServiceAccount() {
  const svcJson = process.env.SERVICE_ACCOUNT_JSON;
  const svcPath = process.env.SERVICE_ACCOUNT_PATH;

  if (svcJson) return JSON.parse(svcJson);
  if (svcPath) {
    const resolved = path.isAbsolute(svcPath) ? svcPath : path.join(process.cwd(), svcPath);
    if (!fs.existsSync(resolved)) throw new Error(`SERVICE_ACCOUNT_PATH does not exist: ${resolved}`);
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }
  throw new Error('Provide SERVICE_ACCOUNT_JSON or SERVICE_ACCOUNT_PATH pointing to a Firebase service account JSON.');
}

async function main() {
  const preview = process.env.PREVIEW === 'true' || process.env.PREVIEW === '1';
  const confirm = process.env.CONFIRM === 'YES';

  try {
    const serviceAccount = await loadServiceAccount();
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    const firestore = admin.firestore();

    console.log('Connected to Firebase Admin');

    // Find seeded agencies by name
    console.log('Looking for seeded agencies...');
    const chunks: string[][] = [];
    const chunkSize = 10;
    for (let i = 0; i < AGENCIES.length; i += chunkSize) chunks.push(AGENCIES.slice(i, i + chunkSize));

    const agencyIds: string[] = [];
    for (const names of chunks) {
      const q = firestore.collection('agencies').where('name', 'in', names);
      const snap = await q.get();
      snap.forEach(d => agencyIds.push(d.id));
    }

    console.log(`Found ${agencyIds.length} seeded agencies.`);
    if (agencyIds.length === 0) {
      console.log('No seeded agencies found. Exiting.');
      process.exit(0);
    }

    // Find tickets referencing these agencies
    const ticketRefs: FirebaseFirestore.DocumentReference[] = [];
    for (const idChunk of chunkArray(agencyIds, 10)) {
      const q = firestore.collection('tickets').where('agencyId', 'in', idChunk);
      const snap = await q.get();
      snap.forEach(d => ticketRefs.push(d.ref));
    }

    console.log(`Found ${ticketRefs.length} tickets referencing seeded agencies.`);

    if (preview) {
      console.log('Preview mode: no deletions will be performed. Set PREVIEW=false and CONFIRM=YES to delete.');
      process.exit(0);
    }

    if (!confirm) {
      console.error('Aborting: set CONFIRM=YES to perform deletions. This action is irreversible.');
      process.exit(1);
    }

    // Delete tickets
    console.log('Deleting tickets...');
    await deleteInBatches(ticketRefs.map(r => r), firestore);

    // Delete agencies
    console.log('Deleting agencies...');
    const agencyRefs = agencyIds.map(id => firestore.collection('agencies').doc(id));
    await deleteInBatches(agencyRefs, firestore);

    console.log('Deletion complete. Verify your Firestore console for results.');
    process.exit(0);
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

async function deleteInBatches(refs: FirebaseFirestore.DocumentReference[], firestore: FirebaseFirestore.Firestore) {
  const batchSize = 500;
  for (let i = 0; i < refs.length; i += batchSize) {
    const batch = firestore.batch();
    const slice = refs.slice(i, i + batchSize);
    slice.forEach(r => batch.delete(r));
    await batch.commit();
    console.log(`Deleted ${slice.length} documents (batch ${i / batchSize + 1}).`);
  }
}

main();
