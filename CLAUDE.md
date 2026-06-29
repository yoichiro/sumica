# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sumica AI Studio chains a local LLM (LM Studio) and Stable Diffusion (AUTOMATIC1111/Forge) to turn natural-language (e.g. Japanese) prompts into images. When the user is signed in via Google (Firebase Auth), the client persists images to Firebase Storage and metadata to Firestore; when signed out, the server saves locally. See `README.md` for the full LM Studio / Stable Diffusion setup prerequisites.

## Commands

Run from the **repository root** unless noted:

```bash
npm install        # installs root, client, and server deps in one shot
npm run dev        # concurrently runs server (tsx watch) + client (vite)
npm run dev:server # server only — http://localhost:5000
npm run dev:client # client only — http://localhost:5173
```

- **Lint** (client): `npm run lint --prefix client` (uses **oxlint**, not ESLint; config in `client/.oxlintrc.json`).
- **Type-check / build** (client): `npm run build --prefix client` (`tsc -b && vite build`).
- **Type-check** (server): `npm run typecheck --prefix server` (`tsc --noEmit`). The server runs `.ts` directly via **tsx** — there is no build step and no `dist/`; `tsc` is type-checking only.
- **Tests**: none exist. `npm test` is a placeholder that exits 1 at every level.

## Architecture

Two packages, each collapsed into a small number of source files:
- **`server/index.ts`** — Express 5 (TypeScript, ESM) API, all routes + the LLM/SD pipeline. Firebase-free; run on the fly with tsx.
- **`client/src/App.tsx`** — the entire React 19 UI (~1950 lines, one component tree).
- **`client/src/firebase.ts`** — Firebase SDK initialization (Auth, Firestore, Storage) and helper types (`AuthUser`, `GenerationRecord`, `GenerationParams`).

### The generation pipeline (the key flow)

The enhance and generate steps are **split into two client requests on purpose** so the UI can render a live step indicator (`loadingStep` 1→2→3). Editing one side without the other will break this:

1. Client `POST /api/enhance` → server `enhancePrompt()` asks LM Studio (`/v1/chat/completions`, OpenAI-compatible) to translate+expand the prompt. The LLM is instructed to reply with `<prompts><positive>…</positive><negative>…</negative></prompts>`, which the server **parses by regex**. If the model omits the tags, it falls back to the raw prompt / a default negative.
2. Client `POST /api/generate` with the returned positive/negative, **`skipEnhance: true`**, and **`clientPersist: true`** (when the user is signed in). `generateImage()` then calls Stable Diffusion `/sdapi/v1/txt2img` (180s timeout) and gets a base64 PNG. An optional `model` in the request is passed as `override_settings.sd_model_checkpoint` (SD switches checkpoint and keeps it loaded). When `clientPersist: true`, the server returns `{ success: true, image: <base64>, params: {...} }` without saving anything; when `clientPersist` is absent/false, it local-saves and returns `{ success: true, data: metadata }`.
3. Client receives the response. If signed in (`clientPersist` path): client uploads the base64 image to Firebase Storage (`users/{uid}/images/…`) and writes metadata to Firestore (`users/{uid}/generations/{id}`). If signed out (local path): server has already saved; client refreshes history via `/api/history`.

### Batch generation (client-side sequential loop)

"まとめて生成" opens a modal with two mutually-exclusive modes selected by a segmented tab: **count** (2–10 copies at the main-form size) and **size combinations** (one image per width×height cross product, candidates `[512, 768, 1024]` per axis, capped at 16 combinations). Both modes build a normalized job list of `{ width, height }` entries (`SizeJob[]`) that `handleBatchGenerate(jobs)` (in `client/src/App.tsx`) runs through a single sequential loop — the same per-image progress indicator ("画像 i/N"), incremental persistence (Firebase when signed in, server-local when signed out), continue-on-failure, and summary toast back both modes. The prompt is enhanced **once** before the loop; seed follows the existing seed-lock setting, identical to single generation. SD's own Batch Count parameter is deliberately **not** used. The server is unchanged — batch is purely a client-side loop over the existing single-image endpoint. The shared helpers `enhanceOnce` / `generateImage` / `persistResult` / `generateAndPersist` back both the single and batch flows; `generateImage` and `generateAndPersist` take `width`/`height` as explicit parameters so each job's size flows through to SD and into the persisted metadata.

### Storage: client Firebase ↔ server local fallback

The server is **Firebase-free** — `firebase-admin` has been removed from `server/package.json`; no service-account key is required. Storage is split by auth state:

- **Signed in** (Firebase Auth via Google): the client (`client/src/firebase.ts`) uploads the base64 image to Firebase Storage at `users/{uid}/images/<timestamp>.png` and writes metadata to Firestore at `users/{uid}/generations/{id}`. History is driven by a live Firestore `onSnapshot` subscription. Deletion removes the Firestore doc and the Storage object.
- **Signed out**: the client sends `POST /api/generate` without `clientPersist`; the server saves to `server/outputs/` and records metadata in `server/outputs/metadata.json`, served back via `GET /api/outputs/*`. `/api/history` reads that JSON. `/api/generations/delete` removes the image files and JSON entries.

The `clientPersist` flag in the `/api/generate` request body is the switch: present-and-true → server returns raw base64 and skips saving; absent/false → server saves locally and returns metadata.

### Runtime-mutable config

`lmStudioUrl`, `stableDiffusionUrl`, and `lmStudioModel` are **module-level mutable variables**, seeded from `.env` but rewritable at runtime via `POST /api/settings` (driven by the UI gear panel). They are in-memory only — not persisted, reset on restart. `GET /api/status` exposes current values (LM Studio URL, SD URL, model, `localHistoryCount`). `/api/settings` validates that submitted URLs use the `http(s)` scheme via `isValidHttpUrl` (SSRF hardening); loopback/LAN hosts stay allowed on purpose since the legitimate LM Studio / SD targets are local. `GET /api/health` pings both upstreams (LM Studio `/v1/models`, SD `/sdapi/v1/sd-models`) and always returns 200 with per-service `connected` flags — the client polls it every 20s to drive the top-right status badges. `GET /api/sd-models` proxies SD's `/sdapi/v1/sd-models` + `/sdapi/v1/options` to return `{ models, current }` for the checkpoint picker in the advanced-settings UI. `GET /api/sd-samplers` and `GET /api/sd-loras` likewise proxy SD's sampler and LoRA lists for the advanced-settings pickers; selected LoRAs are applied by appending comma-separated `<lora:name:weight>` tags to the positive prompt at generation, and the `model`/`sampler`/`seed`/`loras` choices are persisted in the generation metadata. `POST /api/generations/delete` (body `{ ids }`) is **local-only**: removes the image files and `metadata.json` entries from `server/outputs/`; the gallery supports single-click select / double-click open, and deletion is gated behind a confirm modal. (When signed in, deletion is handled client-side via Firebase SDK calls, not this endpoint.)

### Client ↔ server wiring

`client/src/App.tsx` derives `API_BASE` from the page's own host — ``const API_BASE = `http://${window.location.hostname}:5000/api` `` — there is **no Vite proxy**; the client talks to the server directly. This deliberately tracks `window.location.hostname` instead of a hardcoded `127.0.0.1`: under **WSL2, Windows→WSL forwarding can work for `localhost` but NOT for `127.0.0.1`**, so a hardcoded `127.0.0.1` makes every API call fail from a Windows browser even though the page loaded fine — keep the host dynamic. CORS is **restricted to the frontend origin(s)** (default `http://localhost:5173,http://127.0.0.1:5173`, overridable via the `CORS_ORIGINS` env var) — not wide open — so an arbitrary website can't drive the API; both `localhost` and `127.0.0.1` origins are allowed so the dynamic host resolves either way. Note the asymmetry: **server-side** URLs (server→LM Studio/SD, the local-mode `imageUrl`) use plain `localhost`/`127.0.0.1` for reliable in-WSL networking, but the **browser-side** API host must follow the page host as above.

## Config

Server reads `server/.env`: `PORT`, `LM_STUDIO_URL`, `STABLE_DIFFUSION_URL`, `LM_STUDIO_MODEL` (empty = use LM Studio's currently-loaded model), `CORS_ORIGINS` (comma-separated allowed origins; defaults to the Vite dev origins).

Client reads `client/.env` (see `client/.env.example`): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`. These are the Firebase web config values from the Firebase Console. If `VITE_FIREBASE_API_KEY` is empty, Firebase is disabled entirely — no auth UI is shown and the app operates in local-only mode.

## Conventions

- Both packages are ESM (`"type": "module"`); use `import`, and the `__dirname` shim already present in `server/index.ts`.
- Client stack is intentionally lean: React 19 + Vite 8 + TypeScript, `lucide-react` for icons. Firebase is added via the `firebase` npm package (client-side SDK only — no `firebase-admin`). No router, no state library, no CSS framework — styling lives in `App.css`/`index.css`.
