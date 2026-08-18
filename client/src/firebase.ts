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
  doc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  writeBatch,
  increment,
  getDocs,
  setDoc,
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
import { generateThumbnail } from './utils/thumbnail';
import { collectVideoParentCounts } from './utils/videoParentIndex';
import { normalizeParams, buildRollupKey } from './utils/rankingRollup';
import type { RankingRollup } from './utils/rankingAnalysis';
import type { Architecture } from './components/presets';

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
  scheduler?: string;
  enableHr?: boolean;
  hrUpscaler?: string;
  hrScale?: number;
  hrSecondPassSteps?: number;
  denoisingStrength?: number;
  loras?: { name: string; weight: number }[];
  // SDXL-only refinement pass: `refiner` is the checkpoint title, `refinerSwitchAt`
  // is the 0.0-1.0 fraction of steps at which SD switches from the base model to
  // the refiner. Both absent (or refiner === '') means no refinement.
  refiner?: string;
  refinerSwitchAt?: number;
  // External VAE override. Absent or 'Automatic' means SD keeps its current setting
  // (usually the checkpoint's baked-in VAE).
  vae?: string;
  // Ground-truth architecture from the user's toggle at generation time.
  // Absent on legacy records; loadIntoForm falls back to name/title heuristics.
  modelArchitecture?: Architecture;
};

// LTX-Video 2 image-to-video parameters, persisted only on mediaType === 'video'
// records. Length is in frames (workflow uses 24 fps, so 240 frames = 10 s). The
// three float knobs (fidelity/motion/identity) are the mxSlider values authored
// into the workflow (see server/workflows/i2v.json nodes 797/915/941). Prompts
// are stored so the record fully round-trips through "load into form".
export type LtxParams = {
  fidelity: number;
  motion: number;
  identity: number;
  length: number;
  positivePrompt: string;
  negativePrompt: string;
  // Original natural-language prompt the user typed (before LM Studio
  // enhancement). Optional because legacy records (persisted before the
  // enhance flow was introduced) do not carry it — "load into form" of
  // those records restores an empty input per the intended fallback.
  videoPrompt?: string;
};

// Keep this shape in sync with GenerationData in App.tsx.
// A fully-persisted generation (params + storage/firestore bookkeeping).
export type GenerationRecord = GenerationParams & {
  id: string;
  imageUrl: string;
  storagePath: string;
  // 256px WebP produced client-side and stored alongside the PNG. Optional
  // for backwards-compatibility with pre-thumbnail records; consumers fall
  // back to imageUrl when absent.
  thumbnailUrl?: string;
  thumbnailStoragePath?: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase';
  isFavorite?: boolean;
  // Media type discriminator. Absent on legacy records; treat undefined as 'image'
  // when reading (never write undefined). Videos always carry parentId + videoUrl
  // + videoStoragePath (+ posterUrl/posterStoragePath when the ffmpeg poster
  // extraction succeeded) and ltxParams.
  mediaType: 'image' | 'video';
  parentId?: string;
  videoUrl?: string;
  videoStoragePath?: string;
  posterUrl?: string;
  posterStoragePath?: string;
  ltxParams?: LtxParams;
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

  // Sidecar 256px WebP for the gallery grid. Non-fatal on failure — the
  // gallery falls back to imageUrl via `thumbnailUrl ?? imageUrl`.
  let thumbnailUrl: string | undefined;
  let thumbnailStoragePath: string | undefined;
  try {
    const thumb = await generateThumbnail(base64, 'image/png');
    const ext = thumb.mimeType === 'image/webp' ? 'webp' : 'jpg';
    thumbnailStoragePath = `users/${uid}/thumbs/generated_${timestamp}.${ext}`;
    const thumbRef = ref(storageInstance, thumbnailStoragePath);
    await uploadString(thumbRef, thumb.base64, 'base64', { contentType: thumb.mimeType });
    thumbnailUrl = await getDownloadURL(thumbRef);
  } catch (thumbErr) {
    console.warn('Thumbnail generation/upload failed (non-fatal):', thumbErr);
    thumbnailStoragePath = undefined;
  }

  const record: Omit<GenerationRecord, 'id'> = {
    ...params,
    imageUrl,
    storagePath,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(thumbnailStoragePath ? { thumbnailStoragePath } : {}),
    timestamp,
    createdAt: new Date(timestamp).toISOString(),
    backendMode: 'firebase',
    mediaType: 'image',
  };

  // Compute the rollup key and write the generation doc + rollup counter in
  // one atomic batch — a partial failure cannot leave the rollup ahead of/
  // behind the underlying data. A pre-allocated doc() ref replaces addDoc()
  // so the generated ID is known before the batch commits.
  const normalised = normalizeParams(record);
  const rollupHash = await buildRollupKey(normalised);
  const genRef = doc(collection(dbInstance, 'users', uid, 'generations'));
  const rollupRef = doc(dbInstance, 'users', uid, 'rankingRollups', rollupHash);

  const batch = writeBatch(dbInstance);
  batch.set(genRef, record);
  batch.set(
    rollupRef,
    {
      version: 1,
      params: normalised,
      total: increment(1),
      favs: increment(record.isFavorite ? 1 : 0),
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  await batch.commit();

  return { id: genRef.id, ...record };
}

export type SaveVideoArgs = {
  parentId: string;
  videoBase64: string;
  posterBase64?: string;
  ltxParams: LtxParams;
  timestamp: number;
  params: GenerationParams;
};

export async function saveVideoGeneration(uid: string, args: SaveVideoArgs): Promise<GenerationRecord> {
  if (!dbInstance || !storageInstance) throw new Error('Firebase is not configured');
  const { parentId, videoBase64, posterBase64, ltxParams, timestamp, params } = args;

  // 1. Upload the mp4 bytes to users/{uid}/videos/{ts}.mp4
  const videoStoragePath = `users/${uid}/videos/generated_${timestamp}.mp4`;
  const videoRef = ref(storageInstance, videoStoragePath);
  await uploadString(videoRef, videoBase64, 'base64', { contentType: 'video/mp4' });
  const videoUrl = await getDownloadURL(videoRef);

  // 2. Upload the poster WebP (if extracted) to users/{uid}/posters/{ts}.webp
  let posterStoragePath: string | undefined;
  let posterUrl: string | undefined;
  if (posterBase64) {
    posterStoragePath = `users/${uid}/posters/generated_${timestamp}.webp`;
    const posterRef = ref(storageInstance, posterStoragePath);
    await uploadString(posterRef, posterBase64, 'base64', { contentType: 'image/webp' });
    posterUrl = await getDownloadURL(posterRef);
  }

  // 3. Write the Firestore doc.
  //
  // Defensive strip: callers routinely pass the full parent GenerationRecord as
  // `params` (App.tsx spreads `videoSourceImage` verbatim), so `...params` would
  // otherwise inherit the parent's Firebase-object references — most damagingly
  // `thumbnailStoragePath`, which deleteGenerations then unlinks when the video
  // is later deleted, taking the parent image's thumbnail with it. Strip every
  // Storage / Firestore-bookkeeping field so the video record only owns paths
  // it wrote itself.
  const {
    id: _stripId,
    imageUrl: _stripImageUrl,
    storagePath: _stripStoragePath,
    thumbnailUrl: _stripThumbUrl,
    thumbnailStoragePath: _stripThumbPath,
    timestamp: _stripTs,
    createdAt: _stripCreatedAt,
    backendMode: _stripBackend,
    isFavorite: _stripFav,
    mediaType: _stripMediaType,
    parentId: _stripParentId,
    videoUrl: _stripVideoUrl,
    videoStoragePath: _stripVideoPath,
    posterUrl: _stripPosterUrl,
    posterStoragePath: _stripPosterPath,
    ltxParams: _stripLtx,
    ...cleanParams
  } = params as GenerationParams & Partial<GenerationRecord>;

  const id = `video_${timestamp}`;
  const docRef = doc(dbInstance, `users/${uid}/generations/${id}`);
  const record: GenerationRecord = {
    ...cleanParams,
    id,
    imageUrl: videoUrl,           // legacy field carries the primary media URL
    storagePath: videoStoragePath, // legacy field carries the primary storage path
    ...(posterUrl ? { thumbnailUrl: posterUrl } : {}), // gallery grid uses thumbnailUrl ?? imageUrl
    timestamp,
    createdAt: new Date(timestamp).toISOString(),
    backendMode: 'firebase',
    mediaType: 'video',
    parentId,
    videoUrl,
    videoStoragePath,
    ...(posterUrl ? { posterUrl } : {}),
    ...(posterStoragePath ? { posterStoragePath } : {}),
    ltxParams,
  };
  await setDoc(docRef, record);
  return record;
}

// Subscribe to a user's generations. When `dateYMD` (local YYYY-MM-DD) is provided,
// the query is narrowed server-side to that single local day's timestamp range, so
// Fetch a single generation record by doc id. Useful when a Lightbox/preview
// action needs a record that lives outside the currently-subscribed
// date-scoped history (e.g. "元画像を見る" from a video whose parent image
// was generated on a different day than the video itself). Returns null on
// missing doc, permission failure, or when Firebase isn't configured.
export async function fetchGenerationById(uid: string, id: string): Promise<GenerationRecord | null> {
  if (!dbInstance) return null;
  try {
    const docRef = doc(dbInstance, `users/${uid}/generations/${id}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<GenerationRecord, 'id'>) };
  } catch (e) {
    console.error('fetchGenerationById failed:', e);
    return null;
  }
}

// EVERY generation from that day is returned (no count cap) — matching the gallery's
// date-filter UI. When `dateYMD` is null, falls back to the full collection (no limit).
// Same field (`timestamp`) for where + orderBy → Firestore handles this with the
// automatic single-field index, no composite index needed.
export function subscribeGenerations(
  uid: string,
  dateYMD: string | null,
  cb: (records: GenerationRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  if (!dbInstance) {
    cb([]);
    return () => {};
  }
  const generationsRef = collection(dbInstance, 'users', uid, 'generations');
  let q;
  // Defensive guard: during Vite HMR, an in-flight closure from a previous build can
  // call this with the OLD signature (where arg #2 was the callback). Reject anything
  // that isn't a YYYY-MM-DD string so we don't crash on `.split` — the next HMR pass
  // or a hard reload will sync the call site to the new signature.
  if (typeof dateYMD === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateYMD)) {
    // Local-day boundaries matching App.tsx's localYMD() bucketing.
    const [y, m, d] = dateYMD.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    q = query(
      generationsRef,
      where('timestamp', '>=', dayStart),
      where('timestamp', '<=', dayEnd),
      orderBy('timestamp', 'desc'),
    );
  } else {
    q = query(generationsRef, orderBy('timestamp', 'desc'));
  }
  return onSnapshot(
    q,
    (snap) => {
      const records: GenerationRecord[] = [];
      snap.forEach((d) => records.push({ id: d.id, ...(d.data() as Omit<GenerationRecord, 'id'>) }));
      cb(records);
    },
    (err) => {
      console.error('Firestore subscription failed:', err);
      cb([]);
      onError?.(err);
    },
  );
}

// Subscribe to a live index of "how many videos each image has spawned".
// Independent from subscribeGenerations because the gallery's date filter
// scopes the main subscription to a single day, but the child-video badge
// on an image card must remain accurate even when the child was generated
// on a different day. Query targets mediaType='video' only (single-field
// auto index — no composite index required) and streams a fresh
// Map<parentId, count> on every write.
export function subscribeVideoParentIndex(
  uid: string,
  cb: (parentCounts: Map<string, number>) => void,
  onError?: (err: Error) => void,
): () => void {
  if (!dbInstance) {
    cb(new Map());
    return () => {};
  }
  const generationsRef = collection(dbInstance, 'users', uid, 'generations');
  const q = query(generationsRef, where('mediaType', '==', 'video'));
  return onSnapshot(
    q,
    (snap) => {
      const records: Array<{ mediaType?: string; parentId?: string }> = [];
      snap.forEach((d) => {
        const data = d.data() as Partial<GenerationRecord>;
        records.push({ mediaType: data.mediaType, parentId: data.parentId });
      });
      cb(collectVideoParentCounts(records));
    },
    (err) => {
      console.error('Video parent index subscription failed:', err);
      cb(new Map());
      onError?.(err);
    },
  );
}

export async function deleteGenerations(uid: string, records: GenerationRecord[]): Promise<void> {
  if (!dbInstance || !storageInstance) throw new Error('Firebase is not configured');
  if (records.length === 0) return;

  // 1. Look up children: any record whose parentId is one of the deleted records' ids.
  //    Firestore's `in` operator supports at most 10 ids per call — chunk if needed.
  const parentIds = records.map((r) => r.id).filter((id): id is string => typeof id === 'string');
  const generationsRef = collection(dbInstance, `users/${uid}/generations`);
  const childRecords: GenerationRecord[] = [];
  for (let i = 0; i < parentIds.length; i += 10) {
    const chunk = parentIds.slice(i, i + 10);
    const snap = await getDocs(query(generationsRef, where('parentId', 'in', chunk)));
    snap.forEach((d) => childRecords.push({ id: d.id, ...(d.data() as Omit<GenerationRecord, 'id'>) }));
  }

  // 1b. Update ranking rollups and delete generation docs: decrement counters for all deleted records
  //     (parent + child), and delete their Firestore docs. Batch in chunks of 250 (2 ops per record:
  //     genRef delete + rollup set) to stay within Firestore's 500-write limit.
  const allRecords = [...records, ...childRecords];
  for (let i = 0; i < allRecords.length; i += 250) {
    const chunk = allRecords.slice(i, i + 250);
    const batch = writeBatch(dbInstance);
    for (const rec of chunk) {
      const genRef = doc(dbInstance, 'users', uid, 'generations', rec.id);
      batch.delete(genRef);
      // Videos are outside the Ranking system (see spec Q9) and never increment a
      // rollup on save, so they must not decrement one on delete either — otherwise
      // a parent image's rollup key (inherited by its video children) gets
      // over-decremented by every video generated from it.
      if ((rec.mediaType ?? 'image') !== 'image') continue;
      const normalised = normalizeParams(rec);
      const rollupHash = await buildRollupKey(normalised);
      const rollupRef = doc(dbInstance, 'users', uid, 'rankingRollups', rollupHash);
      batch.set(
        rollupRef,
        {
          version: 1,
          params: normalised,
          total: increment(-1),
          favs: increment(rec.isFavorite ? -1 : 0),
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  // 2. Delete every Storage object referenced by parent OR child records (best-effort;
  //    missing objects are tolerated so partial state cleans up too).
  const storagePaths = new Set<string>();
  for (const r of allRecords) {
    if (r.storagePath) storagePaths.add(r.storagePath);
    if (r.thumbnailStoragePath) storagePaths.add(r.thumbnailStoragePath);
    if (r.videoStoragePath) storagePaths.add(r.videoStoragePath);
    if (r.posterStoragePath) storagePaths.add(r.posterStoragePath);
  }
  for (const path of storagePaths) {
    await deleteObject(ref(storageInstance, path)).catch(() => { /* tolerated */ });
  }
}

export async function updateFavorite(
  uid: string,
  id: string,
  isFavorite: boolean,
): Promise<void> {
  if (!dbInstance) throw new Error('Firebase is not configured');
  const genRef = doc(dbInstance, 'users', uid, 'generations', id);
  const genSnap = await getDoc(genRef);
  if (!genSnap.exists()) throw new Error('Generation not found');
  const data = genSnap.data() as GenerationRecord;
  const normalised = normalizeParams(data);
  const rollupHash = await buildRollupKey(normalised);
  const rollupRef = doc(dbInstance, 'users', uid, 'rankingRollups', rollupHash);

  // Batch the isFavorite flip with the rollup's favs delta so both commit
  // atomically — the rollup can never drift ahead of/behind the flag.
  const batch = writeBatch(dbInstance);
  batch.update(genRef, { isFavorite });
  batch.set(
    rollupRef,
    {
      version: 1,
      params: normalised,
      favs: increment(isFavorite ? 1 : -1),
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  await batch.commit();
}

// Subscribe to the user's favorited generations across all dates.
// Backed by the composite index isFavorite ASC + timestamp DESC declared in
// firestore.indexes.json. If the index is not deployed, onError fires with
// code 'failed-precondition'.
export function subscribeFavorites(
  uid: string,
  cb: (records: GenerationRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  if (!dbInstance) {
    cb([]);
    return () => {};
  }
  const q = query(
    collection(dbInstance, 'users', uid, 'generations'),
    where('isFavorite', '==', true),
    orderBy('timestamp', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const records: GenerationRecord[] = [];
      snap.forEach((d) =>
        records.push({ id: d.id, ...(d.data() as Omit<GenerationRecord, 'id'>) }),
      );
      cb(records);
    },
    (err) => {
      console.error('Firestore favorites subscription failed:', err);
      cb([]);
      onError?.(err);
    },
  );
}

// Subscribe to the user's ranking rollup counters (one doc per distinct
// recipe, keyed by the SHA-256 hash from buildRollupKey). Backs the
// favorite-recipe ranking view — ranking math itself lives in
// utils/rankingAnalysis.ts and runs client-side over this live snapshot.
export function subscribeRankingRollups(
  uid: string,
  cb: (rollups: RankingRollup[]) => void,
  onError?: (err: Error) => void,
): () => void {
  if (!dbInstance) {
    cb([]);
    return () => {};
  }
  const collRef = collection(dbInstance, 'users', uid, 'rankingRollups');
  return onSnapshot(
    collRef,
    (snap) => {
      const rollups: RankingRollup[] = snap.docs.map((d) => {
        const raw = d.data() as Omit<RankingRollup, 'hash'>;
        return { hash: d.id, ...raw };
      });
      cb(rollups);
    },
    (err) => {
      console.error('Ranking rollup subscription failed:', err);
      cb([]);
      onError?.(err);
    },
  );
}
