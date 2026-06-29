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
