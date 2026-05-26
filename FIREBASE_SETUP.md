# Creating a new Firebase project for RCTTS

Follow these steps to create a fresh Firebase project and configure this repo to use it.

1. Create a Firebase project
   - Go to https://console.firebase.google.com/ and click "Add project".
   - Follow the steps; enable Authentication (Email/Password and Google) and Firestore (Native mode).

2. Register a web app and get config
   - In Project settings → General, add a new web app.
   - Copy the Firebase SDK config object (the JSON with apiKey, projectId, authDomain, etc.).

3. Add the config to the repo (recommended: keep secrets out of git)
   - Save the JSON to a local file outside source control, e.g. `secrets/firebase-config.json`.
   - Update `.gitignore` to ensure you don't commit it (this repo already ignores `.env*`).

4. Point the app to the new config
   - Option A (env path): set `FIREBASE_CONFIG_PATH` to the local file path before running.
     Example:
     ```bash
     FIREBASE_CONFIG_PATH=./secrets/firebase-config.json npm run build
     FIREBASE_CONFIG_PATH=./secrets/firebase-config.json npm start
     ```

   - Option B (env json): set `FIREBASE_CONFIG_JSON` with the JSON string (less recommended):
     ```bash
     FIREBASE_CONFIG_JSON='{"projectId":"...","apiKey":"..."}' npm start
     ```

5. Create a service account (for admin tasks like cleanup)
   - In Firebase Console → Project Settings → Service accounts → Generate new private key.
   - Save the file locally (e.g. `secrets/serviceAccountKey.json`).
   - Use `SERVICE_ACCOUNT_PATH` when running `npm run cleanup:firebase` for preview or deletion.

6. Verify
   - Start the app and sign up a new user; the Google OAuth consent will reference your Firebase project.

If you want, I can prepare a minimal step-by-step script to run these commands for macOS. Do you want that?