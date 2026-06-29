# Client-Side Firebase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all Firebase access from the server; the client authenticates with Google and writes generated images + metadata directly to Firebase Storage and Firestore, with the server falling back to local storage for signed-out users.

**Architecture:** The server becomes a pure image-generation engine (LM Studio enhance + Stable Diffusion). When the client is signed in it sends `clientPersist: true`; the server returns the base64 image without saving, and the client uploads to `users/{uid}/images/...` (Storage) and writes `users/{uid}/generations/{id}` (Firestore). When signed out, the server keeps its existing local-save path. All Firebase data-access lives in a focused `client/src/firebase.ts` module so `App.tsx` stays lean.

**Tech Stack:** React 19 + Vite 8 + TypeScript (client), Express 5 + tsx (server), Firebase Web SDK v10+ (modular: `firebase/app`, `/auth`, `/firestore`, `/storage`), oxlint.

## Global Constraints

- Both packages are ESM (`"type": "module"`); use `import`.
- Client uses the **modular** Firebase Web SDK (`firebase/app`, `firebase/auth`, `firebase/firestore`, `firebase/storage`) — never the legacy `firebase/compat`.
- No test framework exists. Each task's verification cycle is: server type-check (`npm run typecheck --prefix server`), client build (`npm run build --prefix client` = `tsc -b && vite build`), client lint (`npm run lint --prefix client`), plus the manual browser check named in the task.
- Do NOT `git add`/`commit`/`push` until the user approves each commit step (per user's standing rule). Each task's commit step is drafted but must be confirmed by the user before running.
- Browser-side API host stays dynamic: `http://${window.location.hostname}:5000/api` (WSL2 constraint — do not hardcode `127.0.0.1`).
- Server-side URLs stay `localhost`/`127.0.0.1`.
- Firestore path: `users/{uid}/generations/{autoId}`. Storage path: `users/{uid}/images/generated_<timestamp>.png`.
- Security rule predicate: `request.auth != null && request.auth.uid == uid`.
- Firebase web config (public values) read from `client/.env` `VITE_FIREBASE_*`. Empty `apiKey` ⇒ Firebase disabled ⇒ local-only, no auth UI.

---

## File Structure

- **Create** `client/src/firebase.ts` — Firebase init + all auth/data-access helpers (`isFirebaseConfigured`, `auth`, `signInWithGoogle`, `signOutUser`, `onAuth`, `saveGeneration`, `subscribeGenerations`, `deleteGenerations`). Exports the `GenerationRecord` type.
- **Create** `client/.env.example` — documents the `VITE_FIREBASE_*` keys.
- **Create** `firestore.rules`, **Create** `storage.rules` — security rules (deployed by the user).
- **Modify** `client/package.json` — add `firebase` dependency.
- **Modify** `client/src/App.tsx` — auth state + header account UI, generate/history/delete branch by auth state (delegating to `firebase.ts` helpers).
- **Modify** `server/index.ts` — strip `firebase-admin`, add `clientPersist` branch to `/api/generate`, make `/api/history` + `/api/generations/delete` local-only, clean `/api/status`.
- **Modify** `server/package.json` — drop `firebase-admin`.
- **Modify** `README.md`, `CLAUDE.md` — rewrite Firebase sections.

---

## Task 1: Strip Firebase Admin from the server

**Files:**
- Modify: `server/index.ts` (imports ~8-10, init block ~39-65, `GenerationMetadata` ~67-87, `/api/generate` ~271-400, `/api/history` ~403-421, `/api/status` ~424-433, `/api/generations/delete` ~519-567)
- Modify: `server/package.json:21` (remove `firebase-admin`)

**Interfaces:**
- Produces: `/api/generate` now accepts `clientPersist?: boolean`. When `clientPersist === true`, responds `{ success: true, image: string /* base64 */, params: GenerationParams }` and persists nothing. Otherwise responds `{ success: true, data: GenerationMetadata }` (local save, unchanged). `GenerationParams = { originalPrompt, enhancedPrompt, negativePrompt, width, height, steps, cfgScale, model, seed, sampler, loras }`.
- `/api/history` and `/api/generations/delete` are local-only. `/api/status` drops `firebaseEnabled` and `storageBucketName`.

- [ ] **Step 1: Remove firebase-admin imports and init block**

In `server/index.ts`, delete these three imports (currently lines ~8-10):

```ts
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
```

Delete the entire Firebase init block (currently lines ~39-65), i.e. from the `// Initialize Firebase Admin` comment through the closing `}` of the `else` that logs "Running in Local Storage mode". Remove the `type Bucket`, `let db`, `let bucket`, `let firebaseEnabled`, `const firebaseKeyPath`, `const storageBucketName` declarations.

- [ ] **Step 2: Trim the `GenerationMetadata` interface**

Keep the interface but drop the Firebase-only field. Find `storagePath?: string;` (currently ~79) and remove it. Leave `localPath?`, `imageUrl`, `backendMode` etc. intact. `backendMode` stays `'firebase' | 'local'` (client still writes `'firebase'`).

- [ ] **Step 3: Rewrite `/api/generate` persistence section**

Replace the "Step 3: Save image" block (currently ~322-395, from `let imageUrl = '';` through the end of the `else` local-save branch, just before the closing `} catch`) with:

```ts
    // Step 3: Persist. When the client owns persistence (signed in), return the
    // raw image + params and save nothing. Otherwise fall back to local save.
    if (clientPersist) {
      res.json({
        success: true,
        image: base64Image,
        params: {
          originalPrompt: finalOriginalPrompt,
          enhancedPrompt: finalPrompt,
          negativePrompt: finalNegativePrompt,
          width: width || 512,
          height: height || 512,
          steps: steps || 20,
          cfgScale: cfgScale || 7,
          model: model || null,
          seed: actualSeed,
          sampler: sampler || 'Euler a',
          loras: loraList,
        },
      });
    } else {
      // Local Fallback Mode
      console.log('Local mode: Saving image to outputs/ directory...');
      const timestamp = Date.now();
      const fileName = `generated_${timestamp}.png`;
      const localFilePath = path.join(outputsDir, fileName);
      fs.writeFileSync(localFilePath, imageBuffer);

      const imageUrl = `http://localhost:${PORT}/api/outputs/${fileName}`;
      const metadata: GenerationMetadata = {
        id: `local_${timestamp}`,
        originalPrompt: finalOriginalPrompt,
        enhancedPrompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        width: width || 512,
        height: height || 512,
        steps: steps || 20,
        cfgScale: cfgScale || 7,
        model: model || null,
        seed: actualSeed,
        sampler: sampler || 'Euler a',
        loras: loraList,
        imageUrl,
        localPath: localFilePath,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        backendMode: 'local',
      };

      const history = getLocalHistory();
      history.unshift(metadata);
      saveLocalHistory(history);

      res.json({ success: true, data: metadata });
    }
```

Then near the top of the handler, add `clientPersist` to the destructure (currently ~272) and remove the now-unused early `const imageBuffer`/`timestamp`/`fileName` lines that lived above the branch (the new `else` declares its own `timestamp`/`fileName`). Keep `const imageBuffer = Buffer.from(base64Image, 'base64');` since both old branches used it — but it's only needed in the local branch now, so move it inside the `else`. Final destructure line:

```ts
  const { prompt, negativePrompt, originalPrompt, width, height, steps, cfgScale, skipEnhance, model, seed, sampler, loras, clientPersist } = req.body;
```

And inside the `else` branch add as its first line:

```ts
      const imageBuffer = Buffer.from(base64Image, 'base64');
```

(Delete the old standalone `const imageBuffer`, `const timestamp`, `const fileName`, `let imageUrl`, `let storagePath` that preceded the removed Firebase branch.)

- [ ] **Step 4: Make `/api/history` local-only**

Replace the handler body (currently ~403-421) with:

```ts
app.get('/api/history', async (_req: Request, res: Response) => {
  try {
    res.json(getLocalHistory());
  } catch (error) {
    console.error('Failed to fetch history:', error);
    res.status(500).json({ error: 'Failed to fetch generation history.' });
  }
});
```

- [ ] **Step 5: Clean `/api/status`**

Replace its body (currently ~424-433) with:

```ts
app.get('/api/status', (_req: Request, res: Response) => {
  res.json({
    lmStudioUrl,
    stableDiffusionUrl,
    lmStudioModel,
    localHistoryCount: getLocalHistory().length,
  });
});
```

- [ ] **Step 6: Make `/api/generations/delete` local-only**

Replace the handler (currently ~519-567) with the local-only version:

```ts
app.post('/api/generations/delete', async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'A non-empty ids array is required' });
  }

  let deleted = 0;
  try {
    const idSet = new Set(ids.map(String));
    const remaining: GenerationMetadata[] = [];
    for (const item of getLocalHistory()) {
      if (item.id && idSet.has(item.id)) {
        if (item.localPath && fs.existsSync(item.localPath)) {
          try {
            fs.unlinkSync(item.localPath);
          } catch (e) {
            console.error(`Failed to remove file ${item.localPath}:`, (e as Error).message);
          }
        }
        deleted++;
      } else {
        remaining.push(item);
      }
    }
    saveLocalHistory(remaining);
    res.json({ success: true, deleted });
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to delete generations.' });
  }
});
```

- [ ] **Step 7: Remove the `firebase-admin` dependency**

In `server/package.json`, delete the `"firebase-admin": "^14.1.0"` line (and fix the trailing comma on the preceding dependency line). Then run `npm install` at the repo root to refresh the lockfile.

- [ ] **Step 8: Type-check the server**

Run: `npm run typecheck --prefix server`
Expected: PASS (no errors). If `noUnusedLocals` flags a leftover (`Bucket`, `db`, `bucket`, `firebaseEnabled`, `storageBucketName`, `firebaseKeyPath`, `cert`, etc.), delete that leftover.

- [ ] **Step 9: Manual check — signed-out generation still works**

Start the dev servers (`npm run dev`), open the client, generate one image with LM Studio + SD running. Expected: image appears, "ローカル保存 📁" still shown, history shows the new image, `server/outputs/` gained the PNG, `metadata.json` updated. (This proves the server still works standalone before the client gains Firebase.)

- [ ] **Step 10: Commit**

```bash
git add server/index.ts server/package.json package-lock.json
git commit -m "refactor: remove Firebase Admin from server; add clientPersist passthrough"
```

---

## Task 2: Firebase client module + config scaffolding

**Files:**
- Modify: `client/package.json` (add `firebase`)
- Create: `client/src/firebase.ts`
- Create: `client/.env.example`

**Interfaces:**
- Produces (all imported by `App.tsx` in later tasks):
  - `isFirebaseConfigured: boolean`
  - `signInWithGoogle(): Promise<void>`
  - `signOutUser(): Promise<void>`
  - `onAuth(cb: (user: AuthUser | null) => void): () => void` where `AuthUser = { uid: string; displayName: string | null; photoURL: string | null }`
  - `saveGeneration(uid: string, base64: string, params: GenerationParams): Promise<GenerationRecord>`
  - `subscribeGenerations(uid: string, cb: (records: GenerationRecord[]) => void): () => void`
  - `deleteGenerations(uid: string, records: GenerationRecord[]): Promise<void>`
  - Types `GenerationParams` (matches the server's `params` payload) and `GenerationRecord` (params + `id`, `imageUrl`, `storagePath`, `timestamp`, `createdAt`, `backendMode: 'firebase'`).

- [ ] **Step 1: Add the firebase dependency**

In `client/package.json`, add to `dependencies` (alphabetical, after `canvas-confetti`):

```json
    "firebase": "^12.0.0",
```

Run: `npm install --prefix client`
Expected: `firebase` added, no peer-dep errors.

- [ ] **Step 2: Create `client/.env.example`**

```
# Firebase Web App config (public values shipped to the browser).
# Copy this file to client/.env and fill in from Firebase Console > Project Settings > Your apps.
# Leave VITE_FIREBASE_API_KEY empty to disable Firebase and run in local-only mode.
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

- [ ] **Step 3: Create `client/src/firebase.ts`**

```ts
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
  type Firestore,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadString,
  getDownloadURL,
  deleteObject,
  type FirebaseStorage,
} from 'firebase/storage';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

// Empty apiKey ⇒ Firebase disabled ⇒ the app runs in local-only mode (no auth UI).
export const isFirebaseConfigured = Boolean(config.apiKey);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(config);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
  storageInstance = getStorage(app);
}

export type AuthUser = {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
};

// The generation parameters returned by the server when clientPersist is true.
export type GenerationParams = {
  originalPrompt: string;
  enhancedPrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  model: string | null;
  seed?: number;
  sampler?: string;
  loras?: { name: string; weight: number }[];
};

// A fully-persisted generation (params + storage/firestore bookkeeping).
export type GenerationRecord = GenerationParams & {
  id: string;
  imageUrl: string;
  storagePath: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase';
};

export function onAuth(cb: (user: AuthUser | null) => void): () => void {
  if (!authInstance) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(authInstance, (u) => {
    cb(u ? { uid: u.uid, displayName: u.displayName, photoURL: u.photoURL } : null);
  });
}

export async function signInWithGoogle(): Promise<void> {
  if (!authInstance) throw new Error('Firebase is not configured');
  await signInWithPopup(authInstance, new GoogleAuthProvider());
}

export async function signOutUser(): Promise<void> {
  if (!authInstance) return;
  await signOut(authInstance);
}

export async function saveGeneration(
  uid: string,
  base64: string,
  params: GenerationParams,
): Promise<GenerationRecord> {
  if (!dbInstance || !storageInstance) throw new Error('Firebase is not configured');
  const timestamp = Date.now();
  const storagePath = `users/${uid}/images/generated_${timestamp}.png`;
  const objectRef = ref(storageInstance, storagePath);
  await uploadString(objectRef, base64, 'base64', { contentType: 'image/png' });
  const imageUrl = await getDownloadURL(objectRef);

  const record: Omit<GenerationRecord, 'id'> = {
    ...params,
    imageUrl,
    storagePath,
    timestamp,
    createdAt: new Date(timestamp).toISOString(),
    backendMode: 'firebase',
  };
  const docRef = await addDoc(collection(dbInstance, 'users', uid, 'generations'), record);
  return { id: docRef.id, ...record };
}

export function subscribeGenerations(
  uid: string,
  cb: (records: GenerationRecord[]) => void,
): () => void {
  if (!dbInstance) {
    cb([]);
    return () => {};
  }
  const q = query(
    collection(dbInstance, 'users', uid, 'generations'),
    orderBy('timestamp', 'desc'),
    limit(50),
  );
  return onSnapshot(q, (snap) => {
    const records: GenerationRecord[] = [];
    snap.forEach((d) => records.push({ id: d.id, ...(d.data() as Omit<GenerationRecord, 'id'>) }));
    cb(records);
  });
}

export async function deleteGenerations(uid: string, records: GenerationRecord[]): Promise<void> {
  if (!dbInstance || !storageInstance) throw new Error('Firebase is not configured');
  await Promise.all(
    records.map(async (r) => {
      if (r.storagePath) {
        await deleteObject(ref(storageInstance!, r.storagePath)).catch(() => {});
      }
      await deleteDoc(doc(dbInstance!, 'users', uid, 'generations', r.id));
    }),
  );
}
```

- [ ] **Step 4: Build + lint the client**

Run: `npm run build --prefix client`
Expected: PASS (TypeScript compiles `firebase.ts`).
Run: `npm run lint --prefix client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/package.json client/package-lock.json package-lock.json client/src/firebase.ts client/.env.example
git commit -m "feat: add client Firebase module (auth + firestore/storage helpers)"
```

---

## Task 3: Auth state + header account UI

**Files:**
- Modify: `client/src/App.tsx` (imports near top; `StatusData` interface ~48; state block ~160s; new auth `useEffect`; header status region ~687-700)

**Interfaces:**
- Consumes: `isFirebaseConfigured`, `onAuth`, `signInWithGoogle`, `signOutUser`, `AuthUser` from `./firebase`.
- Produces: `user: AuthUser | null` state used by Tasks 4-6. `cloudActive = isFirebaseConfigured && !!user` boolean for the storage-mode badge.

- [ ] **Step 1: Import the auth helpers**

At the top of `App.tsx`, add:

```ts
import { isFirebaseConfigured, onAuth, signInWithGoogle, signOutUser, type AuthUser } from './firebase';
```

- [ ] **Step 2: Remove `firebaseEnabled` from `StatusData`**

In the `StatusData` interface (~48), delete the `firebaseEnabled: boolean;` line. (The badge now derives from auth state, not server status.)

- [ ] **Step 3: Add auth state + subscription**

Add with the other `useState` hooks (near `const [history, ...]`, ~162):

```ts
  const [user, setUser] = useState<AuthUser | null>(null);
```

Add a `useEffect` near the other mount effects (after the one that calls `fetchHistory()`, ~326):

```ts
  // Subscribe to Firebase auth state (no-op when Firebase is unconfigured).
  useEffect(() => {
    return onAuth(setUser);
  }, []);
```

Add a derived flag right after the `user` state or near `filteredHistory`:

```ts
  const cloudActive = isFirebaseConfigured && !!user;
```

- [ ] **Step 4: Replace the Firebase status badge with the account UI**

Replace the `{/* Firebase Status */}` block (currently ~687-700, the `<div>` rendering `status?.firebaseEnabled ? Cloud : Folder`) with:

```tsx
            {/* Storage mode + account */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: cloudActive ? 'var(--pop-green)' : 'var(--text-secondary)', fontWeight: '700' }}>
              {cloudActive ? (<><Cloud size={14} /><span>クラウド保存 ☁️</span></>) : (<><Folder size={14} /><span>ローカル保存 📁</span></>)}
            </div>

            {isFirebaseConfigured && (
              <>
                <div style={{ width: '2px', height: '12px', background: '#e9ecef' }}></div>
                {user ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {user.photoURL && (
                      <img src={user.photoURL} alt="" referrerPolicy="no-referrer" style={{ width: 22, height: 22, borderRadius: '50%' }} />
                    )}
                    <span style={{ fontWeight: 700, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.displayName ?? 'ユーザー'}</span>
                    <button onClick={() => { signOutUser(); }} className="scale-hover" style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>ログアウト</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { signInWithGoogle().catch((e) => addToast(`サインインに失敗しました: ${e.message}`, 'error')); }}
                    className="scale-hover"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', border: '2px solid #e9ecef', background: '#fff', borderRadius: '20px', padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                  >
                    <LogIn size={14} /> Googleでログイン
                  </button>
                )}
              </>
            )}
```

- [ ] **Step 5: Ensure icon imports exist**

Confirm `Cloud` and `Folder` are still imported from `lucide-react` (they were used by the old badge). Add `LogIn` to that import list.

- [ ] **Step 6: Build + lint**

Run: `npm run build --prefix client`
Expected: PASS.
Run: `npm run lint --prefix client`
Expected: PASS. (If `status` is now unused anywhere, leave it — it still feeds other UI. Only fix genuine unused-var errors.)

- [ ] **Step 7: Manual check — auth UI**

With `client/.env` populated (or temporarily, to exercise the path), reload: signed-out shows "Googleでログイン" + "ローカル保存 📁". Click it → Google popup → on success the avatar + name + "ログアウト" appear and the badge flips to "クラウド保存 ☁️". With no `client/.env`, no auth button appears and the badge stays local. (Use Playwright MCP; sign-in popup may need a real Google session — if unavailable, verify the unconfigured + configured-signed-out states and defer the live popup to the user.)

- [ ] **Step 8: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add Google auth state and header account UI"
```

---

## Task 4: Client-side persistence on generate (signed in)

**Files:**
- Modify: `client/src/App.tsx` (`handleGenerate` ~511-605)

**Interfaces:**
- Consumes: `user`, `saveGeneration` from Task 2/3.
- Produces: when signed in, `handleGenerate` sends `clientPersist: true`, receives `{ image, params }`, calls `saveGeneration`, and sets `currentGeneration` to the resulting `GenerationRecord`.

- [ ] **Step 1: Send `clientPersist` and branch on the response**

In `handleGenerate`, in the `/api/generate` fetch body (currently ~550-563), add `clientPersist: !!user` to the JSON payload.

Then replace the success block (currently ~576-591, from `const result = await genRes.json();` through the `addToast('画像を生成しました！🎨⚡️', 'success');`) with:

```ts
      const result = await genRes.json();

      if (result.success) {
        let saved: GenerationData;
        if (user && result.image) {
          // Signed in: the server returned raw bytes — persist to Firebase from the client.
          setGenStatus('saving');
          saved = await saveGeneration(user.uid, result.image, result.params) as unknown as GenerationData;
        } else {
          // Signed out: the server already saved locally and returned metadata.
          saved = result.data;
        }

        confetti({
          particleCount: 150,
          spread: 85,
          origin: { y: 0.6 },
          colors: ['#339af0', '#fcc419', '#ff922b', '#51cf66'],
        });

        setCurrentGeneration(saved);
        setGenStatus('success');
        if (!user) fetchHistory(); // signed-in history updates via onSnapshot (Task 5)
        addToast('画像を生成しました！🎨⚡️', 'success');
      }
```

- [ ] **Step 2: Import `saveGeneration`**

Add `saveGeneration` (and later-needed `subscribeGenerations`, `deleteGenerations`) to the `./firebase` import. For this task add at least `saveGeneration`.

- [ ] **Step 3: Confirm `GenerationData` is compatible**

In `App.tsx`'s `GenerationData` interface (~38), ensure it has `storagePath?: string` (add it if missing) so a `GenerationRecord` assigns cleanly. It already has `imageUrl`, `backendMode`, `seed?`, `sampler?`, `loras?`.

- [ ] **Step 4: Build + lint**

Run: `npm run build --prefix client`
Expected: PASS.
Run: `npm run lint --prefix client`
Expected: PASS.

- [ ] **Step 5: Manual check — signed-in generate writes to Firebase**

(Requires `client/.env` + deployed rules from Task 7, or test rules.) Sign in, generate. Expected: progress reaches "保存" step, image appears with "クラウド保存 ☁️", a new object appears under `users/{uid}/images/` in Storage and a doc under `users/{uid}/generations/` in Firestore. On a write failure, an error toast shows and the image stays visible. Also verify signed-out still local-saves.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: persist generations to Firebase from the client when signed in"
```

---

## Task 5: History source switches by auth state

**Files:**
- Modify: `client/src/App.tsx` (history `useEffect` / `fetchHistory` region ~326, ~373-385)

**Interfaces:**
- Consumes: `user`, `subscribeGenerations`, existing `fetchHistory`, `setHistory`.
- Produces: signed-in history is a live `onSnapshot`; signed-out uses `GET /api/history`.

- [ ] **Step 1: Replace the mount history fetch with an auth-aware effect**

The current mount effect calls `fetchHistory()` once (~326). Replace it (keep `fetchHistory` for the signed-out path and load-into-form refreshes) with an effect keyed on `user`:

```ts
  // History source follows auth: live Firestore subscription when signed in,
  // local REST fetch when signed out.
  useEffect(() => {
    if (user) {
      setHistory([]); // clear local items before the cloud snapshot arrives
      const unsub = subscribeGenerations(user.uid, (records) => {
        setHistory(records as unknown as GenerationData[]);
      });
      return unsub;
    }
    fetchHistory();
    return undefined;
  }, [user]);
```

If `fetchHistory` is defined with `const fetchHistory = async () => {...}` below this effect, either move the effect after the definition or wrap the call — keep ordering valid (function declarations vs const). Place this effect after `fetchHistory` is defined to avoid a TDZ error (mirror the existing pattern where `lightboxIndex` was moved to fix TDZ).

- [ ] **Step 2: Import `subscribeGenerations`**

Add `subscribeGenerations` to the `./firebase` import.

- [ ] **Step 3: Build + lint**

Run: `npm run build --prefix client`
Expected: PASS.
Run: `npm run lint --prefix client`
Expected: PASS.

- [ ] **Step 4: Manual check — history switching**

Signed out: gallery shows local history (from `metadata.json`). Sign in: gallery switches to the user's Firestore generations; generating a new one makes it appear in the gallery without a manual refresh (onSnapshot). Sign out: gallery returns to local history.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: switch history between Firestore subscription and local REST by auth"
```

---

## Task 6: Delete switches by auth state

**Files:**
- Modify: `client/src/App.tsx` (`handleDeleteSelected` / delete handler ~210-240)

**Interfaces:**
- Consumes: `user`, `deleteGenerations`, the current `history`/`filteredHistory`, `selectedIds`.
- Produces: signed-in delete uses `deleteGenerations`; signed-out keeps `POST /api/generations/delete`.

- [ ] **Step 1: Branch the delete handler**

In the delete handler (the one that currently `fetch(`${API_BASE}/generations/delete`)`, ~218), replace its core with:

```ts
      if (user) {
        // Signed in: delete from Firestore + Storage; onSnapshot refreshes the gallery.
        const records = history.filter((h) => deleteTargetIds.includes(itemKey(h)));
        await deleteGenerations(user.uid, records as unknown as import('./firebase').GenerationRecord[]);
      } else {
        const res = await fetch(`${API_BASE}/generations/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: deleteTargetIds }),
        });
        if (!res.ok) throw new Error('削除に失敗しました');
        await fetchHistory();
      }
      setSelectedIds(new Set());
```

Keep the surrounding `try/catch`, the confirm-modal gating, toast on success/failure, and `setDeleteTargetIds([])` exactly as they are. (Adapt variable names to the actual handler: it uses `deleteTargetIds` for the confirmed set.)

- [ ] **Step 2: Import `deleteGenerations` (+ type)**

Ensure `deleteGenerations` is in the `./firebase` import. The inline `import('./firebase').GenerationRecord` type avoids a separate value import; alternatively add `type GenerationRecord` to the import list and use it directly.

- [ ] **Step 3: Build + lint**

Run: `npm run build --prefix client`
Expected: PASS.
Run: `npm run lint --prefix client`
Expected: PASS.

- [ ] **Step 4: Manual check — delete switching**

Signed in: select 1-2 cloud images, confirm delete → the Firestore docs + Storage objects are removed and the gallery updates live. Signed out: delete still removes local files + `metadata.json` entries. Use a throwaway generation, not real data.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: delete from Firebase when signed in, local REST when signed out"
```

---

## Task 7: Security rules

**Files:**
- Create: `firestore.rules`
- Create: `storage.rules`

**Interfaces:** none (config files; deployed by the user).

- [ ] **Step 1: Create `firestore.rules`**

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

- [ ] **Step 2: Create `storage.rules`**

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

- [ ] **Step 3: Commit**

```bash
git add firestore.rules storage.rules
git commit -m "chore: add Firestore and Storage security rules for per-user isolation"
```

- [ ] **Step 4: User action (not automated)**

Tell the user to deploy both rule sets (Firebase Console → Firestore/Storage → Rules, or `firebase deploy --only firestore:rules,storage`). Verification of the signed-in paths in Tasks 4-6 depends on this.

---

## Task 8: Documentation

**Files:**
- Modify: `README.md` (Firebase sections, env section, intro)
- Modify: `CLAUDE.md` (storage architecture, endpoints, config sections)

**Interfaces:** none.

- [ ] **Step 1: Update `README.md`**

Rewrite the "🔥 Firebase の連携手順" section to: register a Web App, copy web config into `client/.env` (`VITE_FIREBASE_*`), enable Google sign-in, deploy `firestore.rules`/`storage.rules`. Remove the service-account-key steps. Update the `server/.env` block to drop `FIREBASE_KEY_PATH` and `FIREBASE_STORAGE_BUCKET`. Update the "ハイブリッド保存" feature bullet to "signed in → your Firebase (Storage+Firestore); signed out → server local".

- [ ] **Step 2: Update `CLAUDE.md`**

In "Storage: Firebase ↔ local fallback", rewrite to: server is Firebase-free; client persists to Firebase when signed in (`users/{uid}/...`), server local-saves when signed out via `clientPersist`. Update the generation-pipeline step 2/3 to note `clientPersist` and the `{ image, params }` vs `{ data }` response shapes. Remove `firebaseEnabled`/`storageBucketName` from the `/api/status` description and the `/api/generate`/`/api/history`/`/api/generations/delete` Firebase-branch descriptions. Drop `FIREBASE_KEY_PATH`/`FIREBASE_STORAGE_BUCKET` from the Config section; add `client/.env` `VITE_FIREBASE_*`.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document client-side Firebase architecture"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** server strip (T1), client module/config (T2), auth UI (T3), generate persistence (T4), history switching (T5), delete switching (T6), rules (T7), docs (T8) — every spec section maps to a task. Error handling (toast + keep image, `if (!user)` guards) is folded into T4/T6. "Out of scope" (old cloud data migration, keeping `outputs/`) requires no task.
- **Placeholder scan:** no TBD/TODO; all code blocks are concrete.
- **Type consistency:** `GenerationParams`/`GenerationRecord`/`AuthUser` defined in T2 and consumed verbatim in T3-T6; server `params` payload (T1) matches `GenerationParams` field-for-field; `clientPersist` named consistently on both sides.
