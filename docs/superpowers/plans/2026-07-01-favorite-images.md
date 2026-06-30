# Favorite Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-image favorite toggle (Star button) to the history gallery, plus a "favorites only" toolbar switch that lists every favorited image across all dates.

**Architecture:** Adds a single optional `isFavorite?: boolean` field to all three generation type shapes (client, server, Firestore record). UI exposes a Star button stacked above `ZoomButton` on each gallery tile, plus equivalents on the preview image and inside the lightbox. A new toolbar toggle "⭐ お気に入りのみ" switches the history list to a Firestore-side dedicated query (`where('isFavorite','==',true)+orderBy('timestamp','desc')`, backed by a new composite index) when signed in, and to a client-side filter over `/api/history` when signed out. Date filter is disabled while the toggle is ON.

**Tech Stack:** React 19 + TypeScript + Vite (client), Express 5 + tsx (server, ESM), Firebase Web SDK v9+ (Auth / Firestore / Storage), lucide-react icons. No test framework — each task ends with type-check + manual verification.

## Global Constraints

- **No test framework exists.** `npm test` is a placeholder at every level — do not invent tests. Each task verifies with `npm run typecheck --prefix server`, `npm run build --prefix client`, `npm run lint --prefix client`, and manual UI checks.
- **Server runs `.ts` directly via tsx; no build step / no `dist/`.** Do not create build artifacts.
- **All edits use ESM imports.** Both packages have `"type": "module"`.
- **Comments are English, commit messages are English (single line), PRs are English.** Per CLAUDE.md.
- **Client lint is oxlint, not ESLint.** Config is `client/.oxlintrc.json`.
- **CORS is restricted to the frontend origin(s).** Do not widen.
- **Firebase is module-mutable at runtime.** Do not assume `dbInstance` / `storageInstance` are non-null without the existing guard pattern.
- **`!!record.isFavorite` is the read pattern everywhere.** Treat `undefined` and `false` identically — no backfill, no migration.
- **Existing data in `metadata.json` and Firestore must continue to load.** All schema additions are optional fields.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `firestore.indexes.json` | Create | Declare the composite index for the favorites Firestore query. |
| `server/index.ts` | Modify | Add `isFavorite` to `GenerationMetadata`; add `POST /api/generations/favorite` endpoint. |
| `client/src/firebase.ts` | Modify | Add `isFavorite` to `GenerationRecord`; add `updateFavorite` and `subscribeFavorites` helpers; extend imports with `updateDoc`. |
| `client/src/App.tsx` | Modify | Add `isFavorite` to `GenerationData`; add `favoritesOnly` state; add `toggleFavorite`; add `FavoriteButton` component; integrate the button at 3 places (tile, preview, lightbox); add `displayedHistory` and replace `filteredHistory`; add toolbar toggle; switch subscription on `favoritesOnly`; add `F` key shortcut in the lightbox onKey effect. |

No new client modules. All UI logic stays in `App.tsx` (this codebase intentionally collapses the React tree into a single file — follow the established pattern).

---

## Task 1: Data layer — type fields and Firestore index

**Files:**
- Modify: `server/index.ts` (interface `GenerationMetadata`, ~line 37–57)
- Modify: `client/src/firebase.ts` (type `GenerationRecord`, ~line 79–86)
- Modify: `client/src/App.tsx` (interface `GenerationData`, ~line 31–50)
- Create: `firestore.indexes.json` (repository root)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `GenerationMetadata.isFavorite?: boolean` (server)
  - `GenerationRecord.isFavorite?: boolean` (client firebase.ts)
  - `GenerationData.isFavorite?: boolean` (client App.tsx)
  - `firestore.indexes.json` at repo root declaring `generations` composite index `isFavorite ASC + timestamp DESC`

- [ ] **Step 1: Add `isFavorite` to `GenerationMetadata` in `server/index.ts`**

Locate the interface (around line 37). Append `isFavorite` as an optional boolean after `loras`:

```ts
interface GenerationMetadata {
  id?: string;
  originalPrompt: string;
  enhancedPrompt: string;
  negativePrompt: string;
  width: number | string;
  height: number | string;
  steps: number | string;
  cfgScale: number | string;
  model: string | null;
  imageUrl: string;
  localPath?: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase' | 'local';
  seed?: number;
  sampler?: string;
  scheduler?: string;
  loras?: { name: string; weight: number }[];
  isFavorite?: boolean;
}
```

- [ ] **Step 2: Add `isFavorite` to `GenerationRecord` in `client/src/firebase.ts`**

Locate the type (around line 79). Append the field to the intersection type:

```ts
export type GenerationRecord = GenerationParams & {
  id: string;
  imageUrl: string;
  storagePath: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase';
  isFavorite?: boolean;
};
```

- [ ] **Step 3: Add `isFavorite` to `GenerationData` in `client/src/App.tsx`**

Locate the interface (around line 31). Append the field:

```ts
interface GenerationData {
  id?: string;
  originalPrompt: string;
  enhancedPrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  model?: string | null;
  imageUrl: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase' | 'local';
  storagePath?: string;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  loras?: { name: string; weight: number }[];
  isFavorite?: boolean;
}
```

- [ ] **Step 4: Create `firestore.indexes.json` at the repository root**

Path: `/home/yoichiro/projects/sumica/firestore.indexes.json` (repo root).

```json
{
  "indexes": [
    {
      "collectionGroup": "generations",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isFavorite", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 5: Type-check both packages**

Run: `npm run typecheck --prefix server && npm run build --prefix client`
Expected: both succeed with no TypeScript errors. The build step also runs `tsc -b`.

- [ ] **Step 6: Lint client**

Run: `npm run lint --prefix client`
Expected: no new lint errors.

- [ ] **Step 7: Commit**

```bash
git add server/index.ts client/src/firebase.ts client/src/App.tsx firestore.indexes.json
git commit -m "feat: add isFavorite field and Firestore composite index"
```

---

## Task 2: Server endpoint — POST /api/generations/favorite

**Files:**
- Modify: `server/index.ts` (insert new route before the `app.listen` call at the bottom, ~line 522)

**Interfaces:**
- Consumes: `GenerationMetadata.isFavorite` (from Task 1), `getLocalHistory`, `saveLocalHistory` (existing helpers at lines 61, 72)
- Produces: HTTP route `POST /api/generations/favorite` accepting `{ id: string, isFavorite: boolean }`, returning `{ success: true }` on 200, or `{ error: string }` on 400/404.

- [ ] **Step 1: Add the new route to `server/index.ts`**

Insert the route immediately before the `// Start Express Server` comment block (around line 522). The numbering follows the existing route numbering (`// 8. Delete selected generations` is the prior route):

```ts
// 9. Toggle favorite flag (local mode only).
app.post('/api/generations/favorite', (req: Request, res: Response) => {
  const { id, isFavorite } = req.body;
  if (typeof id !== 'string' || typeof isFavorite !== 'boolean') {
    return res.status(400).json({
      error: 'id (string) and isFavorite (boolean) are required',
    });
  }
  const history = getLocalHistory();
  const target = history.find((it) => it.id === id);
  if (!target) {
    return res.status(404).json({ error: 'Generation not found' });
  }
  target.isFavorite = isFavorite;
  saveLocalHistory(history);
  res.json({ success: true });
});
```

- [ ] **Step 2: Type-check server**

Run: `npm run typecheck --prefix server`
Expected: success, no errors.

- [ ] **Step 3: Manually verify the endpoint**

Start the dev server in one terminal:

```bash
npm run dev:server
```

In a second terminal, exercise the endpoint. First find an existing id in `server/outputs/metadata.json` (or skip to error cases if the file is empty):

```bash
# Find an existing id (skip if metadata.json is missing or empty)
jq -r '.[0].id' server/outputs/metadata.json
# Set a favorite
curl -s -X POST http://localhost:5000/api/generations/favorite \
  -H 'Content-Type: application/json' \
  -d '{"id":"<paste-id>","isFavorite":true}'
# Expected: {"success":true}
# Verify in metadata.json
jq '.[] | select(.id == "<paste-id>") | .isFavorite' server/outputs/metadata.json
# Expected: true

# Error path: missing field
curl -s -X POST http://localhost:5000/api/generations/favorite \
  -H 'Content-Type: application/json' \
  -d '{"id":"abc"}'
# Expected: HTTP 400 with {"error":"id (string) and isFavorite (boolean) are required"}

# Error path: unknown id
curl -s -X POST http://localhost:5000/api/generations/favorite \
  -H 'Content-Type: application/json' \
  -d '{"id":"does-not-exist","isFavorite":true}'
# Expected: HTTP 404 with {"error":"Generation not found"}
```

Stop the dev server after verification.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: add POST /api/generations/favorite endpoint for local mode"
```

---

## Task 3: Firebase helpers — updateFavorite and subscribeFavorites

**Files:**
- Modify: `client/src/firebase.ts` (extend `firestore` import at line 10–21; append two new exported functions after `deleteGenerations` at line 193)

**Interfaces:**
- Consumes: `GenerationRecord.isFavorite` (from Task 1), `dbInstance`, `collection`, `doc`, `onSnapshot`, `query`, `where`, `orderBy` (already imported)
- Produces:
  - `updateFavorite(uid: string, id: string, isFavorite: boolean): Promise<void>`
  - `subscribeFavorites(uid: string, cb: (records: GenerationRecord[]) => void, onError?: (err: Error) => void): () => void` — returns the Firestore unsubscribe function

- [ ] **Step 1: Extend the firestore import to include `updateDoc`**

In `client/src/firebase.ts`, locate the `firebase/firestore` import block (lines 10–21). Add `updateDoc` to the imported names:

```ts
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  where,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
```

- [ ] **Step 2: Append `updateFavorite` and `subscribeFavorites` to `firebase.ts`**

Add both functions at the end of the file (after `deleteGenerations`, line ~193):

```ts
export async function updateFavorite(
  uid: string,
  id: string,
  isFavorite: boolean,
): Promise<void> {
  if (!dbInstance) throw new Error('Firebase is not configured');
  await updateDoc(
    doc(dbInstance, 'users', uid, 'generations', id),
    { isFavorite },
  );
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
```

- [ ] **Step 3: Type-check client**

Run: `npm run build --prefix client`
Expected: success.

- [ ] **Step 4: Lint client**

Run: `npm run lint --prefix client`
Expected: no new lint errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/firebase.ts
git commit -m "feat: add updateFavorite and subscribeFavorites Firestore helpers"
```

---

## Task 4: Client state, toggleFavorite, subscription switch

**Files:**
- Modify: `client/src/App.tsx` (extend firebase import, add state, add `toggleFavorite`, extend the history `useEffect`)

**Interfaces:**
- Consumes: `updateFavorite`, `subscribeFavorites` (from Task 3); `setHistory`, `history`, `user`, `addToast`, `API_BASE`, `subscribeGenerations`, `filterDate`, `fetchHistory` (all existing)
- Produces:
  - State `favoritesOnly: boolean` (with setter `setFavoritesOnly`) — defaults to `false`
  - Function `toggleFavorite(item: GenerationData): Promise<void>` — flips `isFavorite` via Firebase update or POST `/api/generations/favorite`, with optimistic update + rollback in local mode and a Toast on failure
  - Subscription switch in the history `useEffect` keyed on `favoritesOnly`

- [ ] **Step 1: Extend the firebase import in `App.tsx`**

Locate the import at line 23. Add `updateFavorite` and `subscribeFavorites`:

```ts
import { isFirebaseConfigured, onAuth, signInWithGoogle, signOutUser, saveGeneration, subscribeGenerations, subscribeFavorites, updateFavorite, deleteGenerations, type AuthUser, type GenerationRecord, type GenerationParams } from './firebase';
```

- [ ] **Step 2: Add `favoritesOnly` state**

Insert near the other view-state declarations, immediately after `const [rightTab, setRightTab] = useState<'preview' | 'gallery'>('preview');` (around line 182):

```ts
const [favoritesOnly, setFavoritesOnly] = useState(false);
```

- [ ] **Step 3: Add `toggleFavorite` function**

Place it next to `toggleSelected` (around line 207–213). Insert the following after `toggleSelected`:

```ts
// Flip isFavorite on the given item. Signed-in mode writes to Firestore and
// lets onSnapshot reflect the change. Local mode does an optimistic update
// and rolls back on HTTP failure. Items without a persisted id (transient
// preview state before save completes) are a no-op.
const toggleFavorite = async (item: GenerationData) => {
  const id = item.id;
  if (!id) return;
  const next = !item.isFavorite;
  try {
    if (user) {
      await updateFavorite(user.uid, id, next);
    } else {
      setHistory((prev) =>
        prev.map((h) => (h.id === id ? { ...h, isFavorite: next } : h)),
      );
      const res = await fetch(`${API_BASE}/generations/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isFavorite: next }),
      });
      if (!res.ok) {
        setHistory((prev) =>
          prev.map((h) => (h.id === id ? { ...h, isFavorite: !next } : h)),
        );
        throw new Error(`Server returned ${res.status}`);
      }
    }
  } catch (e: any) {
    addToast(`お気に入りの更新に失敗しました: ${e.message}`, 'error');
  }
};
```

- [ ] **Step 4: Rewrite the history `useEffect` to switch subscriptions on `favoritesOnly`**

Locate the existing effect at App.tsx ~lines 443–462. Replace the whole effect with:

```ts
useEffect(() => {
  if (user) {
    setHistory([]);
    const unsub = favoritesOnly
      ? subscribeFavorites(
          user.uid,
          (records) => setHistory(records as unknown as GenerationData[]),
          (err) => {
            const e = err as unknown as { code?: string; message?: string };
            const detail = [e.code, e.message].filter(Boolean).join(' / ') || String(err);
            addToast(
              `お気に入りの取得に失敗しました（Firestore のインデックス (isFavorite + timestamp) がデプロイされているか確認してください）: ${detail}`,
              'error',
            );
          },
        )
      : subscribeGenerations(
          user.uid,
          filterDate || null,
          (records) => setHistory(records as unknown as GenerationData[]),
          (err) => {
            const e = err as unknown as { code?: string; message?: string };
            const detail = [e.code, e.message].filter(Boolean).join(' / ') || String(err);
            addToast(`履歴の取得に失敗しました（Firestore のセキュリティルールがデプロイ済みか確認してください）: ${detail}`, 'error');
          },
        );
    return unsub;
  }
  fetchHistory();
  return undefined;
}, [user, filterDate, favoritesOnly]);
```

- [ ] **Step 5: Type-check / build / lint client**

Run: `npm run build --prefix client && npm run lint --prefix client`
Expected: success. `favoritesOnly` and `toggleFavorite` are unused at this stage — but oxlint's default config does not flag unused locals as errors in this codebase (other unused-in-stage variables exist intentionally). If lint flags them, prefix with `// eslint-disable-next-line` only if necessary; otherwise leave them and proceed — Task 5+ wire them up.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add favoritesOnly state, toggleFavorite, subscription switch"
```

---

## Task 5: displayedHistory derived array, replace filteredHistory everywhere

**Files:**
- Modify: `client/src/App.tsx` (replace the `filteredHistory` derivation at line ~200; migrate 6 call sites)

**Interfaces:**
- Consumes: `history`, `filterDate`, `favoritesOnly`, `user`, `localYMD` (all existing or from Task 4)
- Produces:
  - `displayedHistory: GenerationData[]` — memoized derivation that folds in the favorites mode
  - `filteredHistory` is fully removed; all 6 read sites now read `displayedHistory`

- [ ] **Step 1: Import `useMemo` in App.tsx**

Update the React import at line 1:

```ts
import { useState, useEffect, useRef, useMemo } from 'react';
```

- [ ] **Step 2: Replace `filteredHistory` with `displayedHistory`**

Locate line ~200:

```ts
// History narrowed by the date filter (whole-day match); the gallery renders this.
const filteredHistory = filterDate ? history.filter((it) => localYMD(it.timestamp) === filterDate) : history;
```

Replace with:

```ts
// History narrowed by the active view mode: the favorites-only toggle wins
// over the date filter. Signed in + favoritesOnly: subscribeFavorites already
// scoped the data, so just pass it through. Signed out + favoritesOnly: the
// full history is loaded, filter client-side.
const displayedHistory = useMemo(() => {
  if (favoritesOnly) {
    return user ? history : history.filter((h) => !!h.isFavorite);
  }
  return filterDate ? history.filter((it) => localYMD(it.timestamp) === filterDate) : history;
}, [history, favoritesOnly, filterDate, user]);
```

- [ ] **Step 3: Migrate `navigateLightbox` to `displayedHistory`**

Locate the function at App.tsx ~lines 300–308. Replace every reference to `filteredHistory` with `displayedHistory`. Final form:

```ts
const navigateLightbox = (delta: number) => {
  const idx = displayedHistory.findIndex((it) => itemKey(it) === morphSourceKey || it.imageUrl === lightboxUrl);
  if (idx === -1) return;
  const next = idx + delta;
  if (next < 0 || next >= displayedHistory.length) return;
  const target = displayedHistory[next];
  setMorphSourceKey(itemKey(target));
  setLightboxUrl(target.imageUrl);
};
```

- [ ] **Step 4: Migrate `lightboxIndex` to `displayedHistory`**

Locate the calculation at App.tsx ~lines 320–322:

```ts
const lightboxIndex = lightboxUrl
  ? filteredHistory.findIndex((it) => itemKey(it) === morphSourceKey || it.imageUrl === lightboxUrl)
  : -1;
```

Replace `filteredHistory` with `displayedHistory`:

```ts
const lightboxIndex = lightboxUrl
  ? displayedHistory.findIndex((it) => itemKey(it) === morphSourceKey || it.imageUrl === lightboxUrl)
  : -1;
```

- [ ] **Step 5: Migrate the lightbox Space-key handler**

Locate the keyboard effect at App.tsx ~lines 394–415. Inside the `' '` / `Space` branch (lines ~405–410), update the `filteredHistory[lightboxIndex]` reference:

```ts
} else if (e.key === ' ' || e.code === 'Space') {
  if (lightboxIndex >= 0) {
    e.preventDefault();
    toggleSelected(itemKey(displayedHistory[lightboxIndex]));
  }
}
```

Also update the effect's deps array to use `displayedHistory`:

```ts
}, [lightboxUrl, morphSourceKey, displayedHistory, lightboxIndex]);
```

- [ ] **Step 6: Migrate the toolbar count display**

Locate line ~1717:

```tsx
<span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>{filteredHistory.length}件</span>
```

Replace `filteredHistory.length` with `displayedHistory.length`:

```tsx
<span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>{displayedHistory.length}件</span>
```

- [ ] **Step 7: Migrate the gallery grid mapping**

Locate App.tsx ~line 1761–1767:

```tsx
{filteredHistory.length > 0 ? (
  <div style={{ ... }}>
    {filteredHistory.map((item) => (
```

Replace both occurrences with `displayedHistory`:

```tsx
{displayedHistory.length > 0 ? (
  <div style={{ ... }}>
    {displayedHistory.map((item) => (
```

- [ ] **Step 8: Migrate the lightbox selection-check IIFE**

Locate App.tsx ~line 1893:

```tsx
const k = itemKey(filteredHistory[lightboxIndex]);
```

Replace with:

```tsx
const k = itemKey(displayedHistory[lightboxIndex]);
```

- [ ] **Step 9: Verify no `filteredHistory` references remain**

Run: `grep -n filteredHistory client/src/App.tsx`
Expected: no output (zero matches).

If any reference remains, fix it before continuing.

- [ ] **Step 10: Type-check / build / lint client**

Run: `npm run build --prefix client && npm run lint --prefix client`
Expected: success.

- [ ] **Step 11: Manual smoke check**

Start `npm run dev` (root). In the browser, open the history gallery tab and confirm:
- Date filter still works (no favorites toggle yet — `favoritesOnly` is wired but UI not exposed).
- Lightbox prev/next still works.
- Selection still works.
- "N件" count updates with the date filter.

Stop the dev server.

- [ ] **Step 12: Commit**

```bash
git add client/src/App.tsx
git commit -m "refactor: replace filteredHistory with displayedHistory across gallery and lightbox"
```

---

## Task 6: FavoriteButton component

**Files:**
- Modify: `client/src/App.tsx` (extend lucide-react import; add component definition near `ZoomButton`, ~line 89)

**Interfaces:**
- Consumes: `Star` icon from lucide-react
- Produces:
  - Component `FavoriteButton({ isFavorite, onClick, size?, stackedAbove? }): JSX.Element` exported at module scope (alongside `ZoomButton`). Default `size = 30`, default `stackedAbove = 30`. Outline Star when `isFavorite === false`, filled `#ffd43b` when `true`.

- [ ] **Step 1: Add `Star` to the lucide-react import**

Update App.tsx line 2–22 to include `Star`:

```ts
import {
  Sparkles,
  Settings,
  Image as ImageIcon,
  RotateCw,
  Cloud,
  Folder,
  X,
  ArrowLeftRight,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Trash2,
  Maximize2,
  Maximize,
  Minimize,
  ChevronLeft,
  ChevronRight,
  LogIn,
  Layers,
  Star,
} from 'lucide-react';
```

- [ ] **Step 2: Add the `FavoriteButton` component**

Insert immediately after the `ZoomButton` definition (after line 117). Same styling DNA as `ZoomButton` plus a yellow accent when active:

```tsx
// Bottom-right "favorite" button overlaid on an image; stacks directly above
// ZoomButton (offset by stackedAbove + 8px gap). OFF state shows an outline
// Star; ON state fills it yellow.
function FavoriteButton({
  isFavorite,
  onClick,
  size = 30,
  stackedAbove = 30,
}: {
  isFavorite: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: number;
  stackedAbove?: number;
}) {
  const iconSize = Math.round(size * 0.5);
  return (
    <button
      type="button"
      onClick={onClick}
      title={isFavorite ? 'お気に入りを解除' : 'お気に入りに追加'}
      className="scale-hover"
      style={{
        position: 'absolute',
        bottom: `${8 + stackedAbove + 8}px`,
        right: '8px',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)'
      }}
    >
      {isFavorite
        ? <Star size={iconSize} fill="#ffd43b" stroke="#ffd43b" />
        : <Star size={iconSize} />}
    </button>
  );
}
```

- [ ] **Step 3: Type-check / build / lint client**

Run: `npm run build --prefix client && npm run lint --prefix client`
Expected: success. The component is unused for this one step; that's OK — Task 7+ wire it in.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add FavoriteButton component"
```

---

## Task 7: Wire FavoriteButton into gallery tiles

**Files:**
- Modify: `client/src/App.tsx` (insert `<FavoriteButton>` inside each tile, ~line 1782–1790)

**Interfaces:**
- Consumes: `FavoriteButton` (from Task 6), `toggleFavorite` (from Task 4), `item.isFavorite`
- Produces: nothing new for downstream tasks

- [ ] **Step 1: Add FavoriteButton inside the gallery tile image wrapper**

Locate App.tsx ~line 1782–1790:

```tsx
<div style={{ position: 'relative' }}>
  <img
    src={item.imageUrl}
    alt={item.originalPrompt}
    style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', display: 'block', backgroundColor: '#f8f9fa', viewTransitionName: (morphSourceKey === itemKey(item) && !lightboxUrl) ? 'lightbox-morph' : undefined }}
    loading="lazy"
  />
  <ZoomButton size={26} onClick={(e) => { e.stopPropagation(); openLightbox(item.imageUrl, itemKey(item)); }} />
</div>
```

Add the FavoriteButton after `<ZoomButton ...>` (stacks above it with size 26 and matching `stackedAbove` of 26):

```tsx
<div style={{ position: 'relative' }}>
  <img
    src={item.imageUrl}
    alt={item.originalPrompt}
    style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', display: 'block', backgroundColor: '#f8f9fa', viewTransitionName: (morphSourceKey === itemKey(item) && !lightboxUrl) ? 'lightbox-morph' : undefined }}
    loading="lazy"
  />
  <ZoomButton size={26} onClick={(e) => { e.stopPropagation(); openLightbox(item.imageUrl, itemKey(item)); }} />
  <FavoriteButton
    size={26}
    stackedAbove={26}
    isFavorite={!!item.isFavorite}
    onClick={(e) => { e.stopPropagation(); toggleFavorite(item); }}
  />
</div>
```

- [ ] **Step 2: Type-check / build / lint client**

Run: `npm run build --prefix client && npm run lint --prefix client`
Expected: success.

- [ ] **Step 3: Manual verification**

Start `npm run dev`. Open the history gallery tab:

1. Confirm Star button appears on each tile, directly above the ZoomButton, on the bottom-right.
2. Sign in via Google. Click Star on a gallery image:
   - Outline → filled yellow.
   - In the Firebase Console (Firestore), the corresponding document under `users/{uid}/generations/{id}` should now have `isFavorite: true`.
3. Click Star again — fills back to outline; Firestore field flips to `false`.
4. Sign out. Same flow against a locally-saved image:
   - Star fills yellow.
   - `server/outputs/metadata.json` shows `isFavorite: true` for that id.
5. Tile click (single click) still toggles selection, tile double-click still loads into preview — verifying `stopPropagation()` works.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: show favorite Star button on gallery tiles"
```

---

## Task 8: Wire FavoriteButton into the preview tab image

**Files:**
- Modify: `client/src/App.tsx` (add `<FavoriteButton>` next to the preview `<img>` and its `ZoomButton`, ~line 1391–1393)

**Interfaces:**
- Consumes: `FavoriteButton`, `toggleFavorite`, `currentGeneration`
- Produces: nothing new for downstream tasks

- [ ] **Step 1: Add FavoriteButton to the preview image overlay**

Locate App.tsx ~lines 1385–1395. The preview image `<img>` is followed by a `ZoomButton`:

```tsx
<img
  src={currentGeneration.imageUrl}
  alt="Generated artwork"
  style={{ maxWidth: '100%', maxHeight: '48vh', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block', viewTransitionName: (morphSourceKey === '__preview__' && !lightboxUrl) ? 'lightbox-morph' : undefined }}
/>
<ZoomButton size={34} onClick={(e) => { e.stopPropagation(); openLightbox(currentGeneration.imageUrl, '__preview__'); }} />
```

Add a FavoriteButton stacked above it (size 34, stackedAbove 34):

```tsx
<img
  src={currentGeneration.imageUrl}
  alt="Generated artwork"
  style={{ maxWidth: '100%', maxHeight: '48vh', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block', viewTransitionName: (morphSourceKey === '__preview__' && !lightboxUrl) ? 'lightbox-morph' : undefined }}
/>
<ZoomButton size={34} onClick={(e) => { e.stopPropagation(); openLightbox(currentGeneration.imageUrl, '__preview__'); }} />
<FavoriteButton
  size={34}
  stackedAbove={34}
  isFavorite={!!currentGeneration.isFavorite}
  onClick={(e) => { e.stopPropagation(); toggleFavorite(currentGeneration); }}
/>
```

- [ ] **Step 2: Type-check / build / lint client**

Run: `npm run build --prefix client && npm run lint --prefix client`
Expected: success.

- [ ] **Step 3: Manual verification**

Start `npm run dev`. Generate a new image (any prompt). When the preview shows the result:

1. Confirm the Star button appears in the bottom-right of the preview image, stacked above the ZoomButton.
2. Click Star → outline flips to filled yellow.
3. Switch to the gallery tab → the same image's tile shows a filled Star.
4. Double-click an existing tile to recall it into preview → preview's Star reflects its persisted `isFavorite`.
5. Try clicking Star on a brand-new image *while it's still saving* (rapid Star press right after generation): no error, no toast — the early-return on missing `id` makes the click a silent no-op. (Hard to time precisely; OK if you can't reproduce.)

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: show favorite Star button on preview tab image"
```

---

## Task 9: Lightbox Star button + F-key shortcut

**Files:**
- Modify: `client/src/App.tsx`
  - Add a Star button inside the lightbox overlay, sized 44px to match the existing selection-check button (~line 1892)
  - Extend the lightbox onKey effect (~lines 394–415) with the `F` key branch

**Interfaces:**
- Consumes: `toggleFavorite`, `displayedHistory`, `lightboxIndex`, `Star` (from lucide-react)
- Produces: nothing new for downstream tasks

- [ ] **Step 1: Add the lightbox Star button**

Locate the existing selection-check IIFE in the lightbox at App.tsx ~lines 1892–1921. Immediately after the IIFE closes (after line 1921), insert another IIFE for the favorite toggle. Same `44px` round style, positioned to the right of the selection-check (selection is at `right: 228px`; place the Star at `right: 280px` so they sit side-by-side with a small gap):

```tsx
{lightboxIndex >= 0 && (() => {
  const fav = !!displayedHistory[lightboxIndex].isFavorite;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); toggleFavorite(displayedHistory[lightboxIndex]); }}
      title={fav ? 'お気に入りを解除 (F)' : 'お気に入りに追加 (F)'}
      className="scale-hover"
      style={{
        position: 'absolute',
        top: '20px',
        right: '280px',
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        border: fav ? '2px solid #fff' : 'none',
        background: fav ? '#ffd43b' : 'rgba(255, 255, 255, 0.15)',
        color: fav ? '#1a1a1a' : '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: fav ? '0 0 0 3px rgba(255, 212, 59, 0.35)' : 'none'
      }}
    >
      {fav
        ? <Star size={22} fill="#1a1a1a" stroke="#1a1a1a" />
        : <Star size={22} />}
    </button>
  );
})()}
```

- [ ] **Step 2: Extend the lightbox onKey effect with F-key support**

Locate the keyboard effect at App.tsx ~lines 394–415. Inside the `onKey` handler, after the existing Space branch and before the closing `}`, add an `F` key branch:

```ts
} else if (e.key === 'f' || e.key === 'F') {
  if (lightboxIndex >= 0) {
    e.preventDefault();
    toggleFavorite(displayedHistory[lightboxIndex]);
  }
}
```

Final shape of the effect (for reference):

```ts
useEffect(() => {
  if (!lightboxUrl) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (!document.fullscreenElement) closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateLightbox(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateLightbox(1);
    } else if (e.key === ' ' || e.code === 'Space') {
      if (lightboxIndex >= 0) {
        e.preventDefault();
        toggleSelected(itemKey(displayedHistory[lightboxIndex]));
      }
    } else if (e.key === 'f' || e.key === 'F') {
      if (lightboxIndex >= 0) {
        e.preventDefault();
        toggleFavorite(displayedHistory[lightboxIndex]);
      }
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [lightboxUrl, morphSourceKey, displayedHistory, lightboxIndex]);
```

- [ ] **Step 3: Type-check / build / lint client**

Run: `npm run build --prefix client && npm run lint --prefix client`
Expected: success.

- [ ] **Step 4: Manual verification**

Start `npm run dev`. In the history gallery, click ZoomButton on any tile to open the lightbox:

1. The selection-check button is at top-right (around `right: 228px`).
2. A new 44px circular Star button sits to its right (around `right: 280px`).
3. Click Star → background flips to yellow `#ffd43b`, icon fills dark; persisted in Firestore / metadata.
4. Click Star again → flips back to half-opaque white.
5. Press `F` while the lightbox is open → same toggle as the button.
6. Press `Space` → selection still toggles (no regression).
7. Press `←` / `→` → navigation still works.
8. Open the lightbox from the preview tab's ZoomButton (`sourceKey === '__preview__'`). The current preview image is not in `displayedHistory` so `lightboxIndex === -1` → no Star button shown (correct; this matches the existing selection-check behavior).

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add Star button and F-key shortcut to lightbox"
```

---

## Task 10: Toolbar "⭐ お気に入りのみ" toggle

**Files:**
- Modify: `client/src/App.tsx` (extend the toolbar at ~lines 1706–1717 with a toggle button; disable the date input when `favoritesOnly` is ON)

**Interfaces:**
- Consumes: `favoritesOnly`, `setFavoritesOnly` (from Task 4), `Star` (already imported)
- Produces: the visible UI affordance that flips `favoritesOnly` and the disabled state on the date input

- [ ] **Step 1: Update the toolbar's date-filter group to disable the input when `favoritesOnly` is ON, and append the toggle button**

Locate App.tsx ~lines 1706–1718. The current shape:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
    📅
    <input
      type="date"
      className="input-field"
      value={filterDate}
      onChange={(e) => { if (e.target.value) setFilterDate(e.target.value); }}
      style={{ borderRadius: '8px', padding: '5px 8px', fontSize: '13px', width: 'auto' }}
    />
  </label>
  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>{displayedHistory.length}件</span>
</div>
```

Replace with:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', opacity: favoritesOnly ? 0.4 : 1 }}>
    📅
    <input
      type="date"
      className="input-field"
      value={filterDate}
      onChange={(e) => { if (e.target.value) setFilterDate(e.target.value); }}
      disabled={favoritesOnly}
      style={{ borderRadius: '8px', padding: '5px 8px', fontSize: '13px', width: 'auto' }}
    />
  </label>
  <button
    type="button"
    onClick={() => setFavoritesOnly((v) => !v)}
    title={favoritesOnly ? 'お気に入りのみの表示を解除' : 'お気に入りのみ表示'}
    className="scale-hover"
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '5px 10px',
      borderRadius: '8px',
      border: favoritesOnly ? 'none' : '1.5px solid var(--panel-border)',
      background: favoritesOnly ? 'var(--pop-blue)' : 'transparent',
      color: favoritesOnly ? '#fff' : 'var(--text-secondary)',
      fontSize: '12px',
      fontWeight: 800,
      cursor: 'pointer',
    }}
  >
    {favoritesOnly
      ? <Star size={14} fill="#ffd43b" stroke="#ffd43b" />
      : <Star size={14} />}
    お気に入りのみ
  </button>
  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>{displayedHistory.length}件</span>
</div>
```

- [ ] **Step 2: Type-check / build / lint client**

Run: `npm run build --prefix client && npm run lint --prefix client`
Expected: success.

- [ ] **Step 3: Manual verification — signed-in flow**

Start `npm run dev`. Sign in. Make sure at least 2 favorited images exist (favorite a couple from prior tasks' work, ideally across two different days).

1. Open history gallery. With "お気に入りのみ" OFF, confirm date filter behaves as before, only that day's items show.
2. Click "お気に入りのみ" → date input becomes disabled + grayed out. Gallery now shows *all* favorites across all dates, sorted newest first.
3. Count "N件" matches the number of favorited images.
4. Click Star on one of them → it flips to OFF and disappears from the favorites view live (Firestore onSnapshot).
5. Open the lightbox from inside the favorites view → ←/→ navigation steps through the *favorites* set, not the date-scoped set.
6. Click "お気に入りのみ" again to turn it off → date input re-enables and the previously selected day's history returns.
7. **Composite index sanity:** if you have never deployed the index, you should see a toast like "お気に入りの取得に失敗しました…(failed-precondition / The query requires an index. You can create it here: https://…)". Click that link, create the index in Firebase Console, wait until it's "Enabled", and the favorites view will start populating. Add `firestore.indexes.json` to your Firebase deploy flow for repeatability.

- [ ] **Step 4: Manual verification — signed-out flow**

Sign out. Make sure `metadata.json` has at least 2 favorited entries (use the curl from Task 2 if needed).

1. Open history gallery. Click "お気に入りのみ".
2. Date input disables. Gallery shows only favorites from `metadata.json`.
3. Click Star on one → it disappears optimistically; check `metadata.json` confirms `isFavorite: false`.
4. Force a failure: stop the server, then click Star on another favorite. The optimistic state should roll back and a toast appears: `お気に入りの更新に失敗しました: …`. Restart the server.
5. Toggle "お気に入りのみ" back off → date filter behavior returns to the pre-toggle day.

Stop the dev server.

- [ ] **Step 5: Final smoke test across the whole feature**

Run a complete pass:
- Generate a new image. Preview shows Star (outline) → click → filled.
- Switch to gallery tab. New image's tile shows filled Star.
- Toggle "お気に入りのみ" — only favorites appear; date input disabled.
- Open lightbox on a favorite; press `F` → unfavorites; image disappears live from the favorites view.
- Toggle "お気に入りのみ" off — full date-scoped history returns.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add favorites-only toolbar toggle with date-input disable"
```

---

## Post-implementation: Firestore index deployment (one-time, environment setup)

This is **not** an implementation task — it's an operational step the user (or whoever owns the Firebase project) needs to do once to make the favorites view actually work in production. Surface it after the implementation lands.

Two acceptable paths:

1. **Click-through:** First time the favorites view loads, the Firestore error toast contains a console URL. Open it; the Firebase Console pre-fills the index definition. Click "Create" and wait ~1 minute for the index to build.
2. **Repository-driven:** From a machine with the Firebase CLI installed and authenticated, set up `firebase.json` and run `firebase deploy --only firestore:indexes`. This uses the `firestore.indexes.json` committed in Task 1.

Until the index is deployed, the favorites view emits a `failed-precondition` error toast (with the deployment hint baked in) and shows zero items. The rest of the app continues to function normally.

---

## Self-Review Notes

- **Spec coverage**
  - Data layer (3 type fields + Firestore index): Task 1 ✓
  - Server endpoint for local mode: Task 2 ✓
  - Firestore helpers (`updateFavorite`, `subscribeFavorites`): Task 3 ✓
  - `toggleFavorite` + state + subscription switch: Task 4 ✓
  - `displayedHistory` replacement of `filteredHistory`: Task 5 ✓
  - `FavoriteButton` component: Task 6 ✓
  - Star on gallery tiles: Task 7 ✓
  - Star on preview image: Task 8 ✓
  - Star in lightbox + `F` key: Task 9 ✓
  - Toolbar toggle + date-input disable: Task 10 ✓
  - Composite index deploy: post-implementation note ✓
- **Type consistency**
  - `updateFavorite(uid, id, isFavorite)` — same signature used in Task 3 (definition), Task 4 (call site) ✓
  - `subscribeFavorites(uid, cb, onError?)` — same signature in Task 3 (definition), Task 4 (call site) ✓
  - `FavoriteButton` props (`isFavorite`, `onClick`, `size?`, `stackedAbove?`) — defined in Task 6, used in Tasks 7 and 8 ✓
  - `toggleFavorite(item)` — defined in Task 4, used in Tasks 7, 8, 9 ✓
  - `displayedHistory` — defined in Task 5, used in Tasks 5, 9 (Star button and `F` key both consume it) ✓
- **Placeholder scan:** no TBD / TODO / "implement later" / "add error handling" tokens ✓
