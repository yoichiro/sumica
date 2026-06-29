# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sumica AI Studio chains a local LLM (LM Studio) and Stable Diffusion (AUTOMATIC1111/Forge) to turn natural-language (e.g. Japanese) prompts into images, persisting results to Firebase or a local fallback. See `README.md` for the full LM Studio / Stable Diffusion setup prerequisites.

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

Two packages, each collapsed into a single source file:
- **`server/index.ts`** — Express 5 (TypeScript, ESM) API, all routes + the LLM/SD pipeline. Run on the fly with tsx.
- **`client/src/App.tsx`** — the entire React 19 UI (~1200 lines, one component tree).

### The generation pipeline (the key flow)

The enhance and generate steps are **split into two client requests on purpose** so the UI can render a live step indicator (`loadingStep` 1→2→3). Editing one side without the other will break this:

1. Client `POST /api/enhance` → server `enhancePrompt()` asks LM Studio (`/v1/chat/completions`, OpenAI-compatible) to translate+expand the prompt. The LLM is instructed to reply with `<prompts><positive>…</positive><negative>…</negative></prompts>`, which the server **parses by regex**. If the model omits the tags, it falls back to the raw prompt / a default negative.
2. Client `POST /api/generate` with the returned positive/negative and **`skipEnhance: true`**. That flag tells the server to skip a second enhancement — `/api/generate` *can* enhance on its own, but the client never lets it (it already enhanced in step 1). `generateImage()` then calls Stable Diffusion `/sdapi/v1/txt2img` (180s timeout) and gets a base64 PNG. An optional `model` in the request is passed as `override_settings.sd_model_checkpoint` (SD switches checkpoint and keeps it loaded), and the chosen model is persisted in the generation metadata.
3. Server persists and returns metadata; client fires confetti and refreshes history.

### Storage: Firebase ↔ local fallback

On startup the server tries to init Firebase Admin from `FIREBASE_KEY_PATH`. **If the key file is missing or init fails, `firebaseEnabled` stays false and everything silently uses local mode** — images to `server/outputs/`, history to `server/outputs/metadata.json`, served back via `GET /api/outputs/*` static route. Every storage-touching route (`/api/generate`, `/api/history`) branches on `firebaseEnabled`; keep both branches in sync when changing the metadata shape.

### Runtime-mutable config

`lmStudioUrl`, `stableDiffusionUrl`, and `lmStudioModel` are **module-level mutable variables**, seeded from `.env` but rewritable at runtime via `POST /api/settings` (driven by the UI gear panel). They are in-memory only — not persisted, reset on restart. `GET /api/status` exposes current values + mode. `/api/settings` validates that submitted URLs use the `http(s)` scheme via `isValidHttpUrl` (SSRF hardening); loopback/LAN hosts stay allowed on purpose since the legitimate LM Studio / SD targets are local. `GET /api/health` pings both upstreams (LM Studio `/v1/models`, SD `/sdapi/v1/sd-models`) and always returns 200 with per-service `connected` flags — the client polls it every 20s to drive the top-right status badges. `GET /api/sd-models` proxies SD's `/sdapi/v1/sd-models` + `/sdapi/v1/options` to return `{ models, current }` for the checkpoint picker in the advanced-settings UI. `GET /api/sd-samplers` and `GET /api/sd-loras` likewise proxy SD's sampler and LoRA lists for the advanced-settings pickers; selected LoRAs are applied by appending comma-separated `<lora:name:weight>` tags to the positive prompt at generation, and the `model`/`sampler`/`seed`/`loras` choices are persisted in the generation metadata. `POST /api/generations/delete` (body `{ ids }`) removes selected generations — Firestore docs + Storage objects in Firebase mode, or the image files + `metadata.json` entries in local mode; the gallery supports single-click select / double-click open, and deletion is gated behind a confirm modal.

### Client ↔ server wiring

`client/src/App.tsx` derives `API_BASE` from the page's own host — ``const API_BASE = `http://${window.location.hostname}:5000/api` `` — there is **no Vite proxy**; the client talks to the server directly. This deliberately tracks `window.location.hostname` instead of a hardcoded `127.0.0.1`: under **WSL2, Windows→WSL forwarding can work for `localhost` but NOT for `127.0.0.1`**, so a hardcoded `127.0.0.1` makes every API call fail from a Windows browser even though the page loaded fine — keep the host dynamic. CORS is **restricted to the frontend origin(s)** (default `http://localhost:5173,http://127.0.0.1:5173`, overridable via the `CORS_ORIGINS` env var) — not wide open — so an arbitrary website can't drive the API; both `localhost` and `127.0.0.1` origins are allowed so the dynamic host resolves either way. Note the asymmetry: **server-side** URLs (server→LM Studio/SD, the local-mode `imageUrl`) use plain `localhost`/`127.0.0.1` for reliable in-WSL networking, but the **browser-side** API host must follow the page host as above.

## Config

Server reads `server/.env`: `PORT`, `LM_STUDIO_URL`, `STABLE_DIFFUSION_URL`, `LM_STUDIO_MODEL` (empty = use LM Studio's currently-loaded model), `FIREBASE_KEY_PATH`, `FIREBASE_STORAGE_BUCKET`, `CORS_ORIGINS` (comma-separated allowed origins; defaults to the Vite dev origins).

## Conventions

- Both packages are ESM (`"type": "module"`); use `import`, and the `__dirname` shim already present in `server/index.ts`.
- The server uses **firebase-admin's modular API** (`firebase-admin/app`, `/firestore`, `/storage`), not the legacy default `admin.*` namespace — required for clean types under `nodenext`.
- Client stack is intentionally lean: React 19 + Vite 8 + TypeScript, `lucide-react` for icons, `canvas-confetti` for the success effect. No router, no state library, no CSS framework — styling lives in `App.css`/`index.css`.
