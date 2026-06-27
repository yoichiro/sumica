# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sumica AI Studio chains a local LLM (LM Studio) and Stable Diffusion (AUTOMATIC1111/Forge) to turn natural-language (e.g. Japanese) prompts into images, persisting results to Firebase or a local fallback. See `README.md` for the full LM Studio / Stable Diffusion setup prerequisites.

## Commands

Run from the **repository root** unless noted:

```bash
npm install        # installs root, client, and server deps in one shot
npm run dev        # concurrently runs server (nodemon) + client (vite)
npm run dev:server # server only — http://localhost:5000
npm run dev:client # client only — http://localhost:5173
```

- **Lint** (client): `npm run lint --prefix client` (uses **oxlint**, not ESLint; config in `client/.oxlintrc.json`).
- **Type-check / build** (client): `npm run build --prefix client` (`tsc -b && vite build`).
- **Tests**: none exist. `npm test` is a placeholder that exits 1 at every level.

## Architecture

Two packages, each collapsed into a single source file:
- **`server/index.js`** — Express 5 (ESM) API, all routes + the LLM/SD pipeline.
- **`client/src/App.tsx`** — the entire React 19 UI (~1200 lines, one component tree).

### The generation pipeline (the key flow)

The enhance and generate steps are **split into two client requests on purpose** so the UI can render a live step indicator (`loadingStep` 1→2→3). Editing one side without the other will break this:

1. Client `POST /api/enhance` → server `enhancePrompt()` asks LM Studio (`/v1/chat/completions`, OpenAI-compatible) to translate+expand the prompt. The LLM is instructed to reply with `<prompts><positive>…</positive><negative>…</negative></prompts>`, which the server **parses by regex**. If the model omits the tags, it falls back to the raw prompt / a default negative.
2. Client `POST /api/generate` with the returned positive/negative and **`skipEnhance: true`**. That flag tells the server to skip a second enhancement — `/api/generate` *can* enhance on its own, but the client never lets it (it already enhanced in step 1). `generateImage()` then calls Stable Diffusion `/sdapi/v1/txt2img` (180s timeout) and gets a base64 PNG.
3. Server persists and returns metadata; client fires confetti and refreshes history.

### Storage: Firebase ↔ local fallback

On startup the server tries to init Firebase Admin from `FIREBASE_KEY_PATH`. **If the key file is missing or init fails, `firebaseEnabled` stays false and everything silently uses local mode** — images to `server/outputs/`, history to `server/outputs/metadata.json`, served back via `GET /api/outputs/*` static route. Every storage-touching route (`/api/generate`, `/api/history`) branches on `firebaseEnabled`; keep both branches in sync when changing the metadata shape.

### Runtime-mutable config

`lmStudioUrl`, `stableDiffusionUrl`, and `lmStudioModel` are **module-level mutable variables**, seeded from `.env` but rewritable at runtime via `POST /api/settings` (driven by the UI gear panel). They are in-memory only — not persisted, reset on restart. `GET /api/status` exposes current values + mode.

### Client ↔ server wiring

`client/src/App.tsx` hard-codes `API_BASE = 'http://127.0.0.1:5000/api'` — there is **no Vite proxy**; the client talks to the server directly and relies on the server's `cors()`. IPv4 `127.0.0.1` (not `localhost`) is used deliberately across the codebase for reliable WSL/local networking — preserve this when adding URLs.

## Config

Server reads `server/.env`: `PORT`, `LM_STUDIO_URL`, `STABLE_DIFFUSION_URL`, `LM_STUDIO_MODEL` (empty = use LM Studio's currently-loaded model), `FIREBASE_KEY_PATH`, `FIREBASE_STORAGE_BUCKET`.

## Conventions

- Both packages are ESM (`"type": "module"`); use `import`, and the `__dirname` shim already present in `server/index.js`.
- Client stack is intentionally lean: React 19 + Vite 8 + TypeScript, `lucide-react` for icons, `canvas-confetti` for the success effect. No router, no state library, no CSS framework — styling lives in `App.css`/`index.css`.
