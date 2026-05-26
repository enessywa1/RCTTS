import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

async function main() {
  const svcJson = process.env.SERVICE_ACCOUNT_JSON;
  const svcPath = process.env.SERVICE_ACCOUNT_PATH;
  const confirm = process.env.CONFIRM;
  const preview = process.env.PREVIEW === 'true' || process.env.PREVIEW === '1';
  const collectionsEnv = process.env.COLLECTIONS; // comma separated

  if (confirm !== 'YES') {
    console.error('Aborting: set CONFIRM=YES to run this script. This action is irreversible.');
    process.exit(1);
  }

  let serviceAccount: any = null;
  if (svcJson) {
    try {
      serviceAccount = JSON.parse(svcJson);
    } catch (e) {
      console.error('Failed to parse SERVICE_ACCOUNT_JSON:', e);
      process.exit(1);
    }
  } else if (svcPath) {
    const resolved = path.isAbsolute(svcPath) ? svcPath : path.join(process.cwd(), svcPath);
    if (!fs.existsSync(resolved)) {
      console.error('SERVICE_ACCOUNT_PATH does not exist:', resolved);
      process.exit(1);
    }
    serviceAccount = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } else {
    console.error('Provide SERVICE_ACCOUNT_JSON or SERVICE_ACCOUNT_PATH pointing to a Firebase service account JSON.');
    process.exit(1);
  }

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const firestore = admin.firestore();
  const auth = admin.auth();

  const defaultCollections = ['tickets', 'drivers', 'agencies', 'custom_users', 'rra_records', 'fundraising'];
  const collections = collectionsEnv ? collectionsEnv.split(',').map(s => s.trim()).filter(Boolean) : defaultCollections;

  console.log('Connected to Firebase Admin. Collections:', collections, '| preview mode:', preview);

  // Preview: report document counts without deleting
  for (const col of collections) {
    try {
      const colRef = firestore.collection(col);
      const docs = await colRef.listDocuments();
      console.log(`Collection ${col}: ${docs.length} documents`);
      if (!preview) {
        console.log(`Deleting documents in collection: ${col}`);
        const batchSize = 500;
        for (let i = 0; i < docs.length; i += batchSize) {
          const batch = firestore.batch();
          const slice = docs.slice(i, i + batchSize);
          slice.forEach(dref => batch.delete(dref));
          await batch.commit();
          console.log(`Deleted ${slice.length} documents from ${col}`);
        }
      }
    } catch (e) {
      console.error(`Failed to access/delete collection ${col}:`, e);
    }
  }

  // Handle Auth users: preview counts or delete
  try {
    console.log(preview ? 'Previewing Firebase Auth user counts...' : 'Deleting all Firebase Auth users...');
    let nextPageToken: string | undefined = undefined;
    let totalUsers = 0;
    do {
      const list = await auth.listUsers(1000, nextPageToken);
      if (!list.users || list.users.length === 0) break;
      totalUsers += list.users.length;
      if (!preview) {
        const uids = list.users.map(u => u.uid);
        const res = await auth.deleteUsers(uids);
        console.log(`Requested deletion of ${uids.length} users. Errors: ${res.failureCount}`);
        if (res.failureCount && res.errors && res.errors.length > 0) {
          console.warn('Some user deletions failed:', res.errors.slice(0, 5));
        }
      }
      nextPageToken = list.pageToken || undefined;
    } while (nextPageToken);
    console.log(preview ? `Total Auth users: ${totalUsers}` : 'Auth users deletion complete.');
  } catch (e) {
    console.error('Failed to access/delete auth users:', e);
  }

  console.log('Cleanup finished. Double-check your Firebase console to confirm deletions.');
  process.exit(0);
}

main().catch(err => {
  console.error('Unexpected error in cleanup script:', err);
  process.exit(1);
});
