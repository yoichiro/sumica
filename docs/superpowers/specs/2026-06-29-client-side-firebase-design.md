# Client-Side Firebase Migration — Design Spec

- **Date:** 2026-06-29
- **Status:** Approved (design)
- **Topic:** Move all Firebase access from the server to the client (Google Auth + direct Firestore/Storage)

## Goal

Remove every Firebase dependency from the server. The client authenticates the
user with Firebase Authentication (Google sign-in) and writes generated images
and their metadata directly to Firebase Storage and Cloud Firestore. The server
is reduced to a pure image-generation engine (LM Studio prompt enhancement +
Stable Diffusion generation) and a local-storage fallback for signed-out use.

## Decisions (resolved forks)

1. **Signed-out behavior = local fallback (hybrid).** When the user is *not*
   signed in, the server saves locally (`outputs/` + `metadata.json`) exactly as
   today. Only the Firebase Admin path is removed from the server. This preserves
   the "try it instantly without Firebase" property.
2. **Per-user isolation via subcollections.** Firestore:
   `users/{uid}/generations/{id}`. Storage: `users/{uid}/images/<timestamp>.png`.
   Security rules reduce to `request.auth.uid == uid`.
3. **Server returns image bytes; client persists (Approach A).** When signed in,
   `/api/generate` returns the base64 image + generation params and does **not**
   persist. The client uploads to Storage and writes the Firestore doc. The
   server never touches Firebase and never validates ID tokens.

### Rejected alternatives

- **B — Server always writes a temp local file, client re-uploads to Firebase.**
  Double-writes, temp-file cleanup, extra round trip. No upside.
- **C — Server validates the ID token and proxies writes via Firebase Admin.**
  Directly contradicts the goal of removing Firebase from the server.

## Architecture

```
Client (App.tsx) — Firebase Web SDK (modular v10+): auth / firestore / storage
  Auth:    onAuthStateChanged → user: User | null
           signInWithPopup(GoogleAuthProvider) / signOut()
  Generate:
    1) POST /api/enhance                         (unchanged)
    2) POST /api/generate { ..., clientPersist }
         signedIn  → server returns { success, image(base64), params }; CLIENT saves
                       Storage:   users/{uid}/images/<ts>.png
                       Firestore: users/{uid}/generations/<id>  (metadata)
         signedOut → server saves locally, returns { success, data } (unchanged)
  History: signedIn  → onSnapshot(users/{uid}/generations, orderBy ts desc, limit 50)
           signedOut → GET /api/history (local, unchanged)
  Delete:  signedIn  → deleteDoc + deleteObject(storagePath)
           signedOut → POST /api/generations/delete (local, unchanged)

Server (index.ts) — image-generation engine only
  REMOVE: firebase-admin import, db, bucket, firebaseEnabled, storageBucketName,
          FIREBASE_KEY_PATH / FIREBASE_STORAGE_BUCKET env, server/package.json dep.
  /api/generate: clientPersist=true  → { success, image(base64), params }
                 clientPersist=false → local save → { success, data }   (unchanged)
  /api/history, /api/generations/delete: local-only (Firebase branch removed)
  /api/status: Firebase fields removed
```

Three principles: (1) server is purely the generation engine; (2) the client
switches its persistence target by auth state (signed-in = Firebase direct,
signed-out = server/local); (3) data is isolated per user under `users/{uid}/...`.

## Components

### `client/src/firebase.ts` (new)

- `initializeApp(config)` and export `auth = getAuth()`, `db = getFirestore()`,
  `storage = getStorage()`.
- Config read from `client/.env` `VITE_FIREBASE_*` (apiKey, authDomain,
  projectId, storageBucket, appId). These are public browser-side values, but
  `.env` keeps them tidy. Ship a `client/.env.example`; `.env` stays gitignored.
- If `apiKey` is empty/absent, treat Firebase as **disabled**: hide the auth UI
  and always use local mode. Keeps "instant try" working with no Firebase setup.

### `client/src/App.tsx` (modified)

- Auth state: subscribe to `onAuthStateChanged` in a `useEffect`, hold
  `user: User | null`.
- Header (replace the current Firebase status badge near `App.tsx:687`):
  - signed-out → `[Sign in with Google]` button + "local mode" label.
  - signed-in → user's avatar + display name + `[Sign out]`.
- `backendMode` ('firebase' | 'local') still drives the storage icons in the
  preview/gallery (`App.tsx:1117`, `:1519`); the client now stamps it when it
  builds metadata.
- Generate (signed in): receive base64 → `uploadString(ref, base64, 'base64',
  { contentType: 'image/png' })` → `getDownloadURL` → `addDoc(collection(db,
  'users', uid, 'generations'), metadata)` → `setCurrentGeneration` → confetti.
- History: signed-in subscribes via `onSnapshot`; signed-out uses
  `GET /api/history`. Re-wire the subscription on auth changes (unsubscribe +
  `fetchHistory` on sign-out). The `GenerationData` shape is unchanged, so date
  filter / lightbox / load-into-form keep working unmodified.
- Delete (signed in): `Promise.all` of `deleteDoc` + `deleteObject(ref(storage,
  storagePath))`; `onSnapshot` reflects the change.

### `server/index.ts` (modified)

- Remove `firebase-admin/{app,firestore,storage}` imports, `db`, `bucket`,
  `firebaseEnabled`, `storageBucketName`, and the Firebase init block.
- `/api/generate`: when `clientPersist === true`, return
  `{ success: true, image: <base64>, params: { originalPrompt, enhancedPrompt,
  negativePrompt, width, height, steps, cfgScale, model, seed, sampler, loras } }`
  without saving. Otherwise keep the existing local-save path returning
  `{ success: true, data }`.
- `/api/history` and `/api/generations/delete`: keep only the local branch.
- `/api/status`: drop `firebaseEnabled` and `storageBucketName`. Client
  `StatusData` follows.
- `server/package.json`: drop the `firebase-admin` dependency. Drop
  `FIREBASE_KEY_PATH` / `FIREBASE_STORAGE_BUCKET` from `.env` docs.

## Data model

- Firestore document `users/{uid}/generations/{autoId}`: `originalPrompt`,
  `enhancedPrompt`, `negativePrompt`, `width`, `height`, `steps`, `cfgScale`,
  `model`, `seed`, `sampler`, `loras[]`, `imageUrl`, `storagePath`, `timestamp`,
  `createdAt`, `backendMode: 'firebase'`.
- Storage object `users/{uid}/images/generated_<timestamp>.png`.

## Security rules (committed to repo, deployed by the user)

`firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/generations/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

`storage.rules`:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{uid}/images/{fileName} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## Error handling

- **Storage/Firestore write failure:** the base64 image is already in hand, so
  show a "save failed (retry)" toast and keep `currentGeneration` displayed in
  memory. Never swallow the error.
- **Persistence guard:** all client-side save/delete paths gate on `if (!user)
  return` to prevent a signed-out client from entering the Firebase path.
- **Config absent:** empty `VITE_FIREBASE_apiKey` ⇒ Firebase disabled ⇒ local
  mode, no auth UI.

## Prerequisites (user actions — cannot be automated here)

1. Register a **Web App** in the existing Firebase project and copy its web
   config (the project already exists since a service-account key is in use).
2. **Enable Authentication → Sign-in method → Google** (confirm `localhost` is
   an authorized domain).
3. Put the web config into `client/.env` as `VITE_FIREBASE_*`.
4. Deploy `firestore.rules` and `storage.rules` (Firebase Console or CLI).

Implementation can proceed before 1–2, but runtime verification of the signed-in
path requires 3 and 4.

## Out of scope

- Migrating old server-written `generations` (flat collection) cloud data —
  treated as disposable test data.
- The local `outputs/` directory stays as-is for signed-out mode.

## Testing

No automated tests exist. Manual verification via Playwright MCP across three
scenarios: (a) signed-out → local save / history / delete; (b) Google sign-in →
generate → Firestore/Storage write → real-time history → delete; (c) config
absent → local fallback.

## Docs to update

README and CLAUDE.md Firebase sections rewritten for "client-driven, no service
account required".
