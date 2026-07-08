# Sumica AI Studio 🎨🌌

**English | [日本語](README_ja.md)**

A futuristic desktop web app that pairs LM Studio (local LLM) with Stable Diffusion via API to turn natural-language instructions into high-quality images. Sign in with your Google account and generated images are automatically saved to your personal Firebase (Storage & Firestore). Even without signing in, images are automatically saved to a local folder on the server — so you can try it out right away!

**Japanese / English UI support** — the language is auto-detected from your browser's `navigator.language`, and the URL query `?hl=ja` / `?hl=en` overrides it explicitly.

---

## 🚀 Prerequisites

Before starting the app, make sure the following local services are running.

### 1. LM Studio (local LLM)
* **Role**: Translates natural-language input (in Japanese or any other language) into a detailed, high-quality English prompt that Stable Diffusion can consume (prompt engineering). It also has a built-in mechanism that **automatically converts emphasis cues like "特に" ("especially"), "かなり" ("quite"), "強く" ("strongly"), "めっちゃ" ("very") into `(phrase:weight)` syntax**.
* **Setup**:
  * Launch LM Studio and load your LLM of choice (Llama 3, Gemma 2, Command R, …).
  * Open the "**Local Server**" tab from the left menu and start the server on port `1234` (**Start Server**).

### 2. Stable Diffusion Web UI (AUTOMATIC1111 / Forge)
* **Role**: Generates high-quality images from the expanded English prompt. Both SDXL and SD1.5 are supported.
* **Setup**:
  * Add **`--api`** to `COMMANDLINE_ARGS` in the launch script (`webui-user.sh` / `webui-user.bat`) so external APIs are accepted.
  * The default port is `7860` (`http://127.0.0.1:7860`).

---

## 🛠️ Setup

### Step 1. Install dependencies
Run the following command at the project root to install every frontend and backend dependency in one shot.
```bash
npm install
```

### Step 2. Create the server env file (`.env`)
Create `server/.env` and edit the endpoints as needed.
```env
PORT=5000
LM_STUDIO_URL=http://localhost:1234
STABLE_DIFFUSION_URL=http://localhost:7860
LM_STUDIO_MODEL= # leave blank to use whichever model is currently loaded

# Comma-separated list of allowed CORS origins for the frontend.
# If unset, the Vite dev origins (localhost:5173 / 127.0.0.1:5173) are allowed.
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

> These endpoints are read once at server startup. Restart the server after editing.

---

## 🔥 Firebase setup (optional)

Sign in with a Google account to save generated images to your personal cloud (Firebase Storage & Firestore). If you want Firebase integration, follow the steps below.

> **No service-account key is required.** All Firebase access happens in the browser client. The server is fully Firebase-free.

1. **Create a Firebase project**:
   * Open the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. **Create a Firestore Database**:
   * From the menu, choose "Build > Firestore Database" and provision the database.
3. **Create a Cloud Storage bucket**:
   * Choose "Build > Storage" and provision a bucket.
4. **Enable Google sign-in in Authentication**:
   * Open "Build > Authentication" → "Sign-in method" and enable the **Google** provider.
5. **Register a web app and copy its config**:
   * From project settings (the gear icon) open the "Your apps" tab and add a **Web** app.
   * Copy the displayed `firebaseConfig` values into `client/.env` (see `client/.env.example`).
   ```env
   VITE_FIREBASE_API_KEY=your-api-key
   VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   VITE_FIREBASE_APP_ID=your-app-id
   ```
   * If `VITE_FIREBASE_API_KEY` is empty, Firebase is disabled entirely and only local saving is used (the sign-in UI is hidden as well).
6. **Deploy security rules**:
   * Deploy `firestore.rules` and `storage.rules` from the repository root either through the Firebase Console or the Firebase CLI (`firebase deploy --only firestore:rules,storage`). These rules enforce per-user data isolation.

---

## 💻 Running the app

Once everything is set up, run the following single command from the project root!
`concurrently` **starts the frontend and the backend together with a single command**.

```bash
npm run dev
```

* **Frontend**: [http://localhost:5173](http://localhost:5173) (opens in your browser automatically, or navigate manually)
* **Backend API**: [http://localhost:5000](http://localhost:5000)

If you want to start them separately, `npm run dev:server` and `npm run dev:client` are also available.

---

## ✨ Features

### 🖼️ Generation

- **Natural-language prompt expansion** — just write in Japanese (or any language) and LM Studio expands your input into a detailed English prompt for Stable Diffusion. Emphasis cues like "特に (1.2)" ("especially"), "強く (1.3)" ("strongly"), "ものすごく (1.4)" ("extremely"), and "控えめに (0.8)" ("subtly") are automatically translated into `(phrase:weight)` syntax.
- **Flexible generation parameters**:
  - **SDXL**: preset picker over aspect ratio (1:1, 4:3, 9:7, 3:2, 16:9, 21:9, 3:1) × orientation × size (S / M / L). SDXL training buckets are marked with a ⭐ badge.
  - **SD1.5**: 7 aspect ratios (1:1 supports S / M / L; the others use a single native size).
  - **Advanced settings**: Sampler / Scheduler / Steps / CFG / Seed / **LoRA** / **Hires.fix** / **Refiner** / **VAE** (SDXL only).
- **Batch generation** — generate multiple images in one prompt expansion:
  - **Count mode**: N images at the same size
  - **Size mode**: cross product of aspect ratio × orientation × size
  - **Model mode**: one image per available checkpoint
- **Live progress** — elapsed time, remaining time, and a progress bar are polled from Stable Diffusion and shown live during generation.
- **Cancellation** — the "Stop generation" button fires Stable Diffusion's interrupt endpoint to abort in-flight generation immediately.

### 💾 Storage

- **Hybrid persistence**:
  - Signed in: real-time sync to Firebase Storage (`users/{uid}/images/`) + Firestore (`users/{uid}/generations/`)
  - Signed out: local save to `server/outputs/` (metadata in `metadata.json`)
- **Thumbnails**: 256px WebP thumbnails are auto-generated to keep the gallery grid fast.

### 🔍 History gallery

- Date filter, ⭐ favorites-only filter, and inline badges for generation attributes (⚡ Hires / 🎭 LoRA)
- **Shift-click** to range-select, then delete multiple images in one go
- **Lightbox**: info panel with 10 generation parameters, fullscreen view, keyboard shortcuts (←→ / Space / F / Esc), image-to-image navigation, and morph animations powered by View Transitions
- **Load into form** — recall a past image's generation settings (model, size, Seed, Sampler, LoRAs, …) into the form with one click

### 🎨 UX

- **UI internationalization (JP / EN)** — auto-detected from browser language; override with the `?hl=ja` / `?hl=en` URL query
- **OS notifications** — toast notification from your OS when generation completes (🔔 opt-in toggle in the header). Batch generation fires a single notification when the whole batch finishes.
- **View Transitions animations** — thumbnail ↔ lightbox morph, batch modal expanding from and back into the button, and a fade-in on tile entry
- **Dark mode** — follows your OS setting automatically
- **`prefers-reduced-motion` friendly** — animations are automatically disabled when the OS motion-reduction preference is enabled

---

## 📚 For developers

- Significant architectural decisions are recorded as ADRs (Architecture Decision Records) under **[`docs/arch/`](docs/arch/)** (in Japanese). Each ADR captures the context, the decision, considered alternatives, and consequences.
- If you develop with an AI agent such as Claude Code, read **[`CLAUDE.md`](CLAUDE.md)** — it sums up the project structure, conventions, and load-bearing design principles.
- Commands:
  - `npm run lint --prefix client` — static analysis with oxlint
  - `npm run test:run --prefix client` — unit tests with Vitest
  - `npm run build --prefix client` — TypeScript type-check + Vite build
  - `npm run typecheck --prefix server` — server type-check (the runtime executes `.ts` directly via `tsx`, no separate build step)

---

## 📜 License

Sumica AI Studio is licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later). See [LICENSE](LICENSE) for the full text.

The AGPL license means: if you modify Sumica and offer the modified version as a network service to others, you MUST make your modified source code available to those users under the same license. This mirrors the license of [AUTOMATIC1111 Stable Diffusion Web UI](https://github.com/AUTOMATIC1111/stable-diffusion-webui), on which Sumica depends via API — the intent is to keep improvements in the open-source ecosystem rather than being absorbed into closed commercial services.

---

## ⚠️ Disclaimer

Sumica AI Studio is provided **"as is"** without warranty of any kind, express or implied. It **intentionally includes no content moderation or safety filters** — content moderation is out of scope for this personal utility.

- **Users are solely responsible** for the content they generate and for complying with all applicable laws and regulations in their jurisdiction.
- The author **does not endorse** and **takes no responsibility for** any third-party deployment or use of this software, including but not limited to services built on top of it.
- Users must **independently comply with the licenses and terms** of all upstream services this software depends on — most notably the AGPL v3 of [AUTOMATIC1111 Stable Diffusion Web UI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) (or whichever Stable Diffusion frontend they run) and the terms of [LM Studio](https://lmstudio.ai/).
- The choice of Stable Diffusion model checkpoints and LoRAs is entirely the user's responsibility, including compliance with each model's own license terms.

If you deploy Sumica or a fork of it as a service accessible to others, you are the operator of that service and bear full legal responsibility for its operation, including the content it generates and its compliance with all relevant laws.

---

## 🤝 Contributing

Contributions are welcome! By submitting a pull request, issue comment, patch, or other contribution to this project, **you agree that your contribution will be licensed under AGPL-3.0-or-later**, the same license that covers the rest of the project. This keeps the entire codebase under a single, consistent license so all users continue to enjoy the same freedoms.

Before opening a substantial PR, feel free to open an issue first to discuss the direction. For code style, follow the existing conventions in the codebase — see [`CLAUDE.md`](CLAUDE.md) for guidance.
