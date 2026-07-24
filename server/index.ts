import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { normalizeParams, updateLocalRollup, type LocalRollupFile } from './utils/rankingRollup.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Restrict CORS to the known frontend origin(s). A wide-open policy would let any
// website the user has open POST to this server. Override with CORS_ORIGINS
// (comma-separated) when serving the client from a different origin.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '50mb' }));

// Ensure outputs directory exists for local fallback
const outputsDir = path.join(__dirname, 'outputs');
if (!fs.existsSync(outputsDir)) {
  fs.mkdirSync(outputsDir, { recursive: true });
}


// Architecture union shared across the server API surface. Values match
// client/src/components/presets.ts's Architecture union.
type Architecture = 'sd15' | 'sdxl' | 'flux';
type FluxVariant = 'schnell' | 'dev';

// Shape of a single generation record persisted to Firestore or local metadata.json
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
  // Optional 256px WebP produced alongside the PNG. Present on new generations
  // and on legacy items after the backfill script runs. Undefined = fall back
  // to imageUrl in the gallery.
  thumbnailUrl?: string;
  localPath?: string;
  thumbnailPath?: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase' | 'local';
  seed?: number;
  sampler?: string;
  scheduler?: string;
  enableHr?: boolean;
  hrUpscaler?: string;
  hrScale?: number;
  hrSecondPassSteps?: number;
  denoisingStrength?: number;
  loras?: { name: string; weight: number }[];
  // SDXL-only refinement pass: a second checkpoint applied for the last
  // (1 − refinerSwitchAt) fraction of steps. Both fields are absent when the
  // user didn't opt in.
  refiner?: string;
  refinerSwitchAt?: number;
  // External VAE override (SDXL benefits from an SDXL-matched VAE when the
  // checkpoint didn't bake one in). Empty / undefined means "leave SD's current
  // VAE setting alone", which is usually "Automatic".
  vae?: string;
  isFavorite?: boolean;
  // Ground-truth architecture from the user's toggle at generation time.
  // Absent on legacy records; loadIntoForm falls back to name/title heuristics.
  modelArchitecture?: Architecture;
}

// Thumbnail spec — 256px max dimension, WebP quality 80. Aspect ratio preserved
// (sharp's `fit: 'inside'`). At SD's common 512-1024px inputs this yields
// ~15-30KB per thumb, vs 500KB-2MB PNG originals.
const THUMBNAIL_MAX_DIMENSION = 256;
const THUMBNAIL_QUALITY = 80;

const generateThumbnailBuffer = async (imageBuffer: Buffer): Promise<Buffer> =>
  sharp(imageBuffer)
    .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();

// Local history metadata helper
const metadataPath = path.join(outputsDir, 'metadata.json');
// Local mirror of the ranking rollup counters the client writes to Firestore
// when signed in (see client/src/firebase.ts). Kept alongside metadata.json
// so signed-out usage still feeds the favorite-recipe ranking feature.
const LOCAL_ROLLUPS_PATH = path.join(outputsDir, 'rankingRollups.json');
const getLocalHistory = (): GenerationMetadata[] => {
  if (!fs.existsSync(metadataPath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {
    return [];
  }
};

const saveLocalHistory = (history: GenerationMetadata[]): void => {
  fs.writeFileSync(metadataPath, JSON.stringify(history, null, 2));
};

// LM Studio / Stable Diffusion endpoints — .env-only, no runtime override.
// The UI panel that changed these at runtime was removed; users edit
// server/.env and restart if they need different targets.
const lmStudioUrl = process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234';
const stableDiffusionUrl = process.env.STABLE_DIFFUSION_URL || 'http://127.0.0.1:7860';
const lmStudioModel = process.env.LM_STUDIO_MODEL || ''; // Empty ⇒ use LM Studio's currently loaded model

// Set by POST /api/generate/interrupt, consumed by the in-flight POST /api/generate
// handler once its call to generateImage() resolves. A single flag is sufficient
// because SD only ever processes one generation job at a time for this
// single-local-user tool — no per-job tracking is needed.
let cancelRequested = false;

interface EnhancedPrompt {
  positive: string;
  negative: string;
}

// System prompt for Stable Diffusion (SD1.5 / SDXL) prompt enhancement. Extracted
// verbatim from the previous inline template literal — content unchanged.
const SD_SYSTEM_PROMPT = `You are an expert prompt engineer for Stable Diffusion. Your task is to translate any non-English concept to English and generate both the detailed positive prompt and the negative prompt to achieve the best quality image.

## Emphasis handling — CRITICAL

The user writes prompts in natural language and cannot edit the expanded English prompt directly, so they express emphasis using natural-language cues. When you detect such a cue tied to a specific element, wrap the corresponding English phrase(s) in Stable Diffusion emphasis syntax "(phrase:weight)".

### Recognized cues and their target weights

- Mild → (phrase:1.2)
  - Japanese: "かなり", "特に", "とても", "しっかり", "ちゃんと", "多少"
  - English: "especially", "very", "quite", "notably"
- Strong → (phrase:1.3)
  - Japanese: "強く", "めっちゃ", "すごく", "はっきり", "大きく", "しっかりと"
  - English: "strongly", "clearly", "pronounced", "significantly"
- Extreme → (phrase:1.4)
  - Japanese: "ものすごく", "極めて", "際立って", "目立たせて", "強調して", "とびっきり", "完全に", "一切"
  - English: "highlight", "emphasize", "prominent", "extremely", "utterly", "completely"

### De-emphasis (suppress) — put in NEGATIVE prompt

If the user asks to de-emphasize or avoid something ("あまり〜させないで", "控えめに", "少なめに", "避けて", "subtle", "less"), place the phrase in the negative prompt, optionally with weight below 1.0 like (phrase:0.8).

### Processing procedure — MUST FOLLOW

Before writing the final XML output, silently:
1. Scan the user's input from start to end and enumerate EVERY emphasis cue you find. Do not skip any — long prompts often stack multiple cues.
2. For each cue, identify the specific concept it modifies (it usually attaches to the immediately-following noun phrase in Japanese).
3. Translate the concept to English and wrap it with the appropriate weight.
4. If the same concept has multiple cues, use the strongest tier.
5. In your written output, the cue word itself MUST NOT survive — only the (phrase:weight) form does.

Do NOT wrap generic quality tags like "masterpiece", "best quality", "8k". Only wrap the specific concepts the user targeted.

### Few-shot examples

Input: 美しい女性、かなり足を開いていて、明るい照明
Output positive should contain: (spread legs:1.2) or (legs wide open:1.2). Both "美しい女性" and "明るい照明" stay plain.

Input: サイバーパンクな都市、めっちゃ光るネオン、未来的
Output positive should contain: (glowing neon:1.3) or (vibrant neon lights:1.3). Others stay plain.

Input: ミディアムシャギーヘアで、かなり丸顔で、かなり長身で、とびっきりの笑顔で、かなり足を開いて
Output positive should contain FOUR emphasis wrappers — one each for face-round (1.2), tall (1.2), smile (1.4), spread-legs (1.2). Missing any of these is a failure.

Input: 夕焼けの海、鳥はあまり写さないで
Output negative should contain (birds:0.8). Positive should not mention birds.

## Output format

You MUST encapsulate your prompts using the following XML tags:
<prompts>
  <positive>detailed positive prompt words, comma-separated...</positive>
  <negative>detailed negative prompt words, comma-separated...</negative>
</prompts>

Do not include any introductory or concluding text, explanations, or notes. Reply ONLY with the XML structure.`;

// Flux uses a T5 text encoder and does not honor SD-style (phrase:weight)
// emphasis, and its distilled variants ignore negative prompts. This system
// prompt tells the LLM to output natural-language prose and an empty negative.
const FLUX_SYSTEM_PROMPT = `You are an expert prompt engineer for FLUX image generation.

Flux uses a T5 text encoder which understands NATURAL LANGUAGE prompts.
Do NOT use Stable Diffusion emphasis syntax like (phrase:weight) — that
syntax does not exist in Flux and will be treated as literal text.

Instead, translate the user's concept into fluent, descriptive English
sentences that read like natural writing. Include the subject, action,
setting, lighting, mood, and camera / composition / style as prose.
Prefer 2–5 sentences over a comma-separated tag list.

Emphasis: when the user uses natural-language emphasis cues in Japanese
(かなり / めっちゃ / とびっきり / 強く / 極めて / 完全に etc.) or
English (very / strongly / extremely / prominently), express strength
through wording — repeat / rephrase the concept, use a strong adjective,
or lead the sentence with the emphasized element. Do NOT wrap anything
in parentheses with a numeric weight.

Negative prompt: Flux models do not use negative prompts effectively.
Always return an EMPTY <negative></negative> tag.

Output format:
<prompts><positive>your natural-language prompt</positive><negative></negative></prompts>
Reply ONLY with the XML structure — no introduction, no explanation.`;

// Helper: Translate and enhance prompt via LM Studio, returning positive and negative prompts in XML format
async function enhancePrompt(userPrompt: string, arch: Architecture = 'sd15'): Promise<EnhancedPrompt> {
  const defaultNegative = 'nsfw, low quality, worst quality, deformed, bad anatomy, blurry, disfigured';
  const systemPrompt = arch === 'flux' ? FLUX_SYSTEM_PROMPT : SD_SYSTEM_PROMPT;
  try {
    console.log(`Sending prompt to LM Studio (${lmStudioUrl}/v1/chat/completions)...`);
    const response = await axios.post(`${lmStudioUrl}/v1/chat/completions`, {
      model: lmStudioModel || undefined,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Translate and expand this concept into positive and negative prompts: "${userPrompt}"`
        }
      ],
      temperature: 0.7
    });

    if (response.data && response.data.choices && response.data.choices[0]) {
      const content: string = response.data.choices[0].message.content.trim();
      console.log(`LM Studio Raw Response:\n${content}`);

      const positiveMatch = content.match(/<positive>([\s\S]*?)<\/positive>/);
      const negativeMatch = content.match(/<negative>([\s\S]*?)<\/negative>/);

      const positive = positiveMatch ? positiveMatch[1].trim() : userPrompt;
      const negative = negativeMatch ? negativeMatch[1].trim() : defaultNegative;

      return { positive, negative };
    }
    throw new Error('Unexpected response format from LM Studio');
  } catch (error) {
    console.error('LM Studio prompt enhancement failed:', (error as Error).message);
    throw new Error(`LM Studioへの接続またはパースに失敗しました: ${(error as Error).message}`);
  }
}

// Helper: Generate Image via Stable Diffusion sdapi/v1/txt2img
async function generateImage(
  prompt: string,
  negativePrompt: string,
  width = 512,
  height = 512,
  steps = 20,
  cfgScale = 7,
  model = '',
  seed = -1,
  sampler = 'Euler a',
  scheduler = '',
  enableHr = false,
  hrUpscaler = '',
  hrScale = 2,
  hrSecondPassSteps = 0,
  denoisingStrength = 0.7,
  refiner = '',
  refinerSwitchAt = 0.8,
  vae = '',
  arch: Architecture = 'sd15'
): Promise<{ image: string; seed: number }> {
  try {
    console.log(`Sending generation request to Stable Diffusion (${stableDiffusionUrl}/sdapi/v1/txt2img)...`);
    const payload: Record<string, unknown> = {
      prompt,
      // Flux doesn't use a negative prompt (ADR-42) — respect an explicitly empty
      // negativePrompt for 'flux' instead of silently falling back to the SD default.
      negative_prompt: arch === 'flux' ? negativePrompt : (negativePrompt || 'nsfw, low quality, worst quality, deformed, bad anatomy, blurry'),
      steps,
      cfg_scale: cfgScale,
      width,
      height,
      sampler_name: sampler,
      seed,
    };
    // The `scheduler` field is only present on AUTOMATIC1111 ≥1.9 / recent Forge —
    // omit it entirely on older SD builds so the API doesn't reject the payload.
    if (scheduler) {
      payload.scheduler = scheduler;
    }
    // Hires.fix fields are only meaningful (and only sent) when enabled, so a
    // disabled request produces a payload identical to pre-Hires.fix behavior.
    if (enableHr) {
      payload.enable_hr = true;
      payload.hr_scale = hrScale;
      payload.denoising_strength = denoisingStrength;
      if (hrUpscaler) payload.hr_upscaler = hrUpscaler;
      if (hrSecondPassSteps) payload.hr_second_pass_steps = hrSecondPassSteps;
    }
    // SDXL Refiner: only send both fields when a refiner checkpoint is chosen,
    // so opt-out requests keep the exact pre-refiner payload shape.
    if (refiner) {
      payload.refiner_checkpoint = refiner;
      payload.refiner_switch_at = refinerSwitchAt;
    }
    // Switch checkpoint (and optionally VAE) for this request; SD keeps them
    // loaded for subsequent generations. Empty string / "Automatic" means "leave
    // the current VAE alone" and is intentionally NOT forwarded.
    const overrides: Record<string, unknown> = {};
    if (model) overrides.sd_model_checkpoint = model;
    if (vae && vae !== 'Automatic') overrides.sd_vae = vae;
    // Forge Neo Preset synchronization. Forge stores preset-scoped module
    // lists (forge_additional_modules_flux / _xl / _sd) and applies the active
    // preset's modules to every checkpoint load. Without this sync, e.g. an
    // SDXL checkpoint arriving while forge_preset stays on 'flux' triggers a
    // state_dict shape mismatch (Flux VAE has 16-channel latents, SD/SDXL 4).
    // Sending forge_preset + forge_additional_modules in override_settings
    // scopes the switch to this request (persistent options stay unchanged).
    // AUTOMATIC1111 (non-Forge) silently ignores unknown override keys, so the
    // same payload is safe on both backends.
    if (arch === 'flux') {
      // Fetch the persistent Flux module list from Forge's options so we can
      // include it in the override. If Forge isn't the backend (no such key
      // in options) the injection is skipped and the request behaves as before.
      try {
        const optRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/options`, { timeout: 4000 });
        const fluxModules = optRes.data?.forge_additional_modules_flux;
        if (Array.isArray(fluxModules) && fluxModules.length > 0) {
          overrides.forge_preset = 'flux';
          overrides.forge_additional_modules = fluxModules;
        }
      } catch (error) {
        console.error('Failed to fetch forge_additional_modules_flux, continuing without preset sync:', (error as Error).message);
      }
    } else if (arch === 'sdxl') {
      overrides.forge_preset = 'xl';
      overrides.forge_additional_modules = [];
    } else if (arch === 'sd15') {
      overrides.forge_preset = 'sd';
      overrides.forge_additional_modules = [];
    }
    if (Object.keys(overrides).length > 0) {
      payload.override_settings = overrides;
    }
    const response = await axios.post(`${stableDiffusionUrl}/sdapi/v1/txt2img`, payload, { timeout: 600000 }); // 10 minutes timeout — Hires.fix's second pass can push generation well past the old 3-minute cap

    if (response.data && response.data.images && response.data.images[0]) {
      let actualSeed = seed;
      if (response.data.info) {
        try {
          const info = JSON.parse(response.data.info as string);
          if (typeof info.seed === 'number') actualSeed = info.seed;
        } catch {
          // keep requested seed as fallback
        }
      }
      return { image: response.data.images[0], seed: actualSeed };
    }
    throw new Error('No image returned from Stable Diffusion API');
  } catch (error) {
    console.error('Stable Diffusion generation failed:', (error as Error).message);
    throw error;
  }
}

// Helper: lightweight reachability check for LM Studio (OpenAI-compatible /v1/models,
// no inference). Returns the loaded/configured model name when reachable.
async function checkLmStudio(): Promise<{ connected: boolean; model: string | null; error: string | null }> {
  try {
    const response = await axios.get(`${lmStudioUrl}/v1/models`, { timeout: 4000 });
    const models = response.data?.data;
    const model = lmStudioModel || (Array.isArray(models) ? models[0]?.id ?? null : null);
    return { connected: true, model, error: null };
  } catch (error) {
    return { connected: false, model: null, error: (error as Error).message };
  }
}

// Helper: reachability check for Stable Diffusion. Hitting an sdapi endpoint confirms
// the WebUI is up AND launched with --api (a bare page load would not).
async function checkStableDiffusion(): Promise<{ connected: boolean; error: string | null }> {
  try {
    await axios.get(`${stableDiffusionUrl}/sdapi/v1/sd-models`, { timeout: 4000 });
    return { connected: true, error: null };
  } catch (error) {
    return { connected: false, error: (error as Error).message };
  }
}

// Translate a Windows-style absolute path (e.g. "E:\foo\bar.safetensors", as returned by
// SD running natively on Windows) into its WSL2 mount-point equivalent ("/mnt/e/foo/bar.safetensors")
// so Node running inside WSL can open the file. No-op for any other path shape or platform
// (native Linux SD installs already report a POSIX path; native Windows Node can open the path as-is).
function toWslPath(windowsPath: string): string {
  if (process.platform !== 'linux') return windowsPath;
  const match = /^([A-Za-z]):\\(.*)$/.exec(windowsPath);
  if (!match) return windowsPath;
  const [, drive, rest] = match;
  return `/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`;
}

// Classify a checkpoint into 'sd15' / 'sdxl' / 'flux' by reading the .safetensors
// header (an 8-byte little-endian length prefix followed by that many bytes of
// JSON tensor metadata) without loading any tensor data. Detection order:
//   1) double_blocks.* (bare/raw layout — official flux1-schnell/-dev and
//      derivatives) OR model.diffusion_model.double_blocks.* (ComfyUI-wrapped
//      layout — typical of merges/finetunes redistributed via ComfyUI). Then
//      peek at __metadata__ for a flux1-dev reference; default to schnell
//      otherwise.
//   2) conditioner.embedders.* (SDXL — both base and refiner).
//   3) Fallback → sd15.
// Falls back to a name heuristic on read failure so the model list keeps
// working even if the file path is unreachable.
async function classifyCheckpointArch(
  filename: string | undefined,
  title: string,
): Promise<{ type: Architecture; fluxVariant?: FluxVariant }> {
  if (filename) {
    try {
      const handle = await fs.promises.open(toWslPath(filename), 'r');
      try {
        const lengthBuffer = Buffer.alloc(8);
        await handle.read(lengthBuffer, 0, 8, 0);
        const headerLength = Number(lengthBuffer.readBigUInt64LE(0));
        const headerBuffer = Buffer.alloc(headerLength);
        await handle.read(headerBuffer, 0, headerLength, 8);
        const header = JSON.parse(headerBuffer.toString('utf-8')) as Record<string, unknown>;
        const keys = Object.keys(header).filter((k) => k !== '__metadata__');
        if (keys.some((k) =>
          k.startsWith('double_blocks.') ||
          k.startsWith('model.diffusion_model.double_blocks.')
        )) {
          const metaStr = JSON.stringify(header.__metadata__ ?? {});
          const fluxVariant: FluxVariant = /flux1?[-_]?dev/i.test(metaStr) ? 'dev' : 'schnell';
          return { type: 'flux', fluxVariant };
        }
        if (keys.some((k) => k.startsWith('conditioner.embedders.'))) {
          return { type: 'sdxl' };
        }
        return { type: 'sd15' };
      } finally {
        await handle.close();
      }
    } catch (error) {
      console.error(`Failed to read safetensors header for ${title}, falling back to name heuristic:`, (error as Error).message);
    }
  }
  const lower = title.toLowerCase();
  if (lower.includes('flux')) {
    return { type: 'flux', fluxVariant: lower.includes('dev') ? 'dev' : 'schnell' };
  }
  if (lower.includes('xl')) return { type: 'sdxl' };
  return { type: 'sd15' };
}

// Serve local outputs statically
app.use('/api/outputs', express.static(outputsDir));

// --- API ROUTES ---

// 1. New Prompt Enhance Endpoint
app.post('/api/enhance', async (req: Request, res: Response) => {
  const { prompt, arch } = req.body as { prompt: string; arch?: Architecture };
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  try {
    const enhanced = await enhancePrompt(prompt, arch);
    res.json({
      success: true,
      positive: enhanced.positive,
      negative: enhanced.negative
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 2. Generate Image Pipeline (Updated to support pre-enhanced prompts)
app.post('/api/generate', async (req: Request, res: Response) => {
  const { prompt, negativePrompt, originalPrompt, width, height, steps, cfgScale, skipEnhance, model, seed, sampler, scheduler, loras, enableHr, hrUpscaler, hrScale, hrSecondPassSteps, denoisingStrength, refiner, refinerSwitchAt, vae, clientPersist } = req.body;
  // Ground-truth architecture sent by the client's toggle at generation time.
  // Only consumed on the local-save path below (clientPersist skips server-side
  // persistence entirely — the client already has modelTypeFilter in scope for
  // its own Firebase write).
  const { modelArchitecture } = req.body as { modelArchitecture?: Architecture };
  // Ground-truth architecture for this generation request, sent alongside
  // modelArchitecture (Task 7). Used here to keep Flux's empty negative prompt
  // empty end-to-end instead of falling back to the SD default negative.
  const { arch } = req.body as { arch?: Architecture };
  cancelRequested = false; // defensive reset — clears any stale flag from an unrelated, already-finished request
  const seedVal = seed !== undefined ? parseInt(seed) : -1;
  // Normalize the selected LoRAs (default weight 0.8); applied as <lora:name:weight> in the prompt.
  const loraList: { name: string; weight: number }[] = (Array.isArray(loras) ? loras : [])
    .filter((l: { name?: string }) => l && l.name)
    .map((l: { name: string; weight?: number }) => ({ name: l.name, weight: typeof l.weight === 'number' ? l.weight : 0.8 }));

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const defaultNegative = 'nsfw, low quality, worst quality, deformed, bad anatomy, blurry, disfigured';
  let finalPrompt = prompt;
  // Flux doesn't use a negative prompt (ADR-42) — an explicitly empty negativePrompt
  // for 'flux' must stay empty here, not get silently upgraded to the SD default.
  let finalNegativePrompt = negativePrompt || (arch === 'flux' ? '' : defaultNegative);
  const finalOriginalPrompt = originalPrompt || prompt;

  try {
    // Step 1: Enhance prompt using LM Studio if not skipped
    if (!skipEnhance) {
      const enhanced = await enhancePrompt(prompt, arch);
      finalPrompt = enhanced.positive;
      finalNegativePrompt = enhanced.negative;
      console.log(`Original: "${prompt}" -> Enhanced Positive: "${finalPrompt}" | Enhanced Negative: "${finalNegativePrompt}"`);
    } else {
      console.log(`Using pre-enhanced prompts. Positive: "${finalPrompt}" | Negative: "${finalNegativePrompt}"`);
    }

    // Apply selected LoRAs by appending <lora:name:weight> to the positive prompt.
    if (loraList.length > 0) {
      const loraSuffix = loraList.map((l) => `<lora:${l.name}:${l.weight}>`).join(', ');
      finalPrompt = `${finalPrompt}, ${loraSuffix}`;
      console.log(`Applied LoRAs: ${loraSuffix}`);
    }

    // Step 2: Generate image with Stable Diffusion
    const { image: base64Image, seed: actualSeed } = await generateImage(
      finalPrompt,
      finalNegativePrompt,
      width ? parseInt(width) : 512,
      height ? parseInt(height) : 512,
      steps ? parseInt(steps) : 20,
      cfgScale ? parseFloat(cfgScale) : 7,
      model || '',
      seedVal,
      sampler || 'Euler a',
      scheduler || '',
      !!enableHr,
      hrUpscaler || '',
      hrScale ? parseFloat(hrScale) : 2,
      hrSecondPassSteps ? parseInt(hrSecondPassSteps) : 0,
      denoisingStrength !== undefined ? parseFloat(denoisingStrength) : 0.7,
      refiner || '',
      refinerSwitchAt !== undefined ? parseFloat(refinerSwitchAt) : 0.8,
      vae || '',
      arch || 'sd15'
    );

    // If the user cancelled while SD was still rendering, generateImage() resolves
    // with whatever partial image SD had at the moment of interruption — discard it
    // instead of persisting it.
    if (cancelRequested) {
      cancelRequested = false;
      return res.json({ success: false, cancelled: true });
    }

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
          scheduler: scheduler || '',
          enableHr: !!enableHr,
          ...(enableHr ? {
            hrUpscaler: hrUpscaler || undefined,
            hrScale: hrScale ? parseFloat(hrScale) : 2,
            hrSecondPassSteps: hrSecondPassSteps ? parseInt(hrSecondPassSteps) : 0,
            denoisingStrength: denoisingStrength !== undefined ? parseFloat(denoisingStrength) : 0.7,
          } : {}),
          ...(refiner ? {
            refiner,
            refinerSwitchAt: refinerSwitchAt !== undefined ? parseFloat(refinerSwitchAt) : 0.8,
          } : {}),
          ...(vae && vae !== 'Automatic' ? { vae } : {}),
          loras: loraList,
        },
      });
    } else {
      // Local Fallback Mode
      console.log('Local mode: Saving image to outputs/ directory...');
      const timestamp = Date.now();
      const fileName = `generated_${timestamp}.png`;
      const imageBuffer = Buffer.from(base64Image, 'base64');
      const localFilePath = path.join(outputsDir, fileName);
      fs.writeFileSync(localFilePath, imageBuffer);

      // Sidecar 256px WebP thumbnail used by the gallery grid. Failure to
      // generate it is non-fatal — we still save the PNG and metadata; the
      // gallery will fall back to the full image via `thumbnailUrl ?? imageUrl`.
      const thumbFileName = `generated_${timestamp}_thumb.webp`;
      const thumbLocalPath = path.join(outputsDir, thumbFileName);
      let thumbnailUrl: string | undefined;
      try {
        const thumbBuffer = await generateThumbnailBuffer(imageBuffer);
        fs.writeFileSync(thumbLocalPath, thumbBuffer);
        thumbnailUrl = `http://localhost:${PORT}/api/outputs/${thumbFileName}`;
      } catch (thumbErr) {
        console.error('Thumbnail generation failed (non-fatal):', (thumbErr as Error).message);
      }

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
        scheduler: scheduler || '',
        enableHr: !!enableHr,
        ...(enableHr ? {
          hrUpscaler: hrUpscaler || undefined,
          hrScale: hrScale ? parseFloat(hrScale) : 2,
          hrSecondPassSteps: hrSecondPassSteps ? parseInt(hrSecondPassSteps) : 0,
          denoisingStrength: denoisingStrength !== undefined ? parseFloat(denoisingStrength) : 0.7,
        } : {}),
        ...(refiner ? {
          refiner,
          refinerSwitchAt: refinerSwitchAt !== undefined ? parseFloat(refinerSwitchAt) : 0.8,
        } : {}),
        ...(vae && vae !== 'Automatic' ? { vae } : {}),
        loras: loraList,
        modelArchitecture,
        imageUrl,
        thumbnailUrl,
        localPath: localFilePath,
        thumbnailPath: thumbnailUrl ? thumbLocalPath : undefined,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        backendMode: 'local',
      };

      const history = getLocalHistory();
      history.unshift(metadata);
      saveLocalHistory(history);

      try {
        updateLocalRollup(
          LOCAL_ROLLUPS_PATH,
          normalizeParams(metadata as unknown as Record<string, unknown>),
          1,
          metadata.isFavorite ? 1 : 0,
        );
      } catch (rollupError) {
        console.error('Failed to update local rollup on save:', rollupError);
        // Non-fatal: the image and its metadata are already saved above;
        // the rollup can be rebuilt later via a backfill script.
      }

      res.json({ success: true, data: metadata });
    }
  } catch (error) {
    console.error('Generation pipeline failed:', error);
    res.status(500).json({ error: (error as Error).message || 'Image generation pipeline failed.' });
  }
});

// 1b. Interrupt the currently-running Stable Diffusion generation, if any.
// Best-effort: always reports success, since there's nothing the client can do
// differently if SD itself is unreachable (the pending generation will fail on
// its own regardless).
app.post('/api/generate/interrupt', async (_req: Request, res: Response) => {
  cancelRequested = true;
  try {
    await axios.post(`${stableDiffusionUrl}/sdapi/v1/interrupt`, {}, { timeout: 5000 });
  } catch (error) {
    console.error('Failed to interrupt Stable Diffusion generation:', (error as Error).message);
  }
  res.json({ success: true });
});

// 2. Retrieve History
app.get('/api/history', async (_req: Request, res: Response) => {
  try {
    res.json(getLocalHistory());
  } catch (error) {
    console.error('Failed to fetch history:', error);
    res.status(500).json({ error: 'Failed to fetch generation history.' });
  }
});

// 3. System status endpoints
app.get('/api/status', (_req: Request, res: Response) => {
  res.json({
    lmStudioUrl,
    stableDiffusionUrl,
    lmStudioModel,
    localHistoryCount: getLocalHistory().length,
  });
});

// 4. Connection health check for upstream services (LM Studio + Stable Diffusion).
// Always responds 200 with per-service flags so the client can branch on the result.
app.get('/api/health', async (_req: Request, res: Response) => {
  const [lmStudio, stableDiffusion] = await Promise.all([
    checkLmStudio(),
    checkStableDiffusion(),
  ]);
  res.json({ lmStudio, stableDiffusion });
});

// 6. List Stable Diffusion checkpoints, tagged with their architecture, and the
// currently active one (for the model picker). Always responds 200; on failure
// returns an empty list so the client can disable the selector. No checkpoints
// are excluded — the client scopes the picker to one architecture via its own
// "SD / SDXL" toggle instead.
app.get('/api/sd-models', async (_req: Request, res: Response) => {
  try {
    const [listRes, optionsRes] = await Promise.all([
      axios.get(`${stableDiffusionUrl}/sdapi/v1/sd-models`, { timeout: 5000 }),
      axios.get(`${stableDiffusionUrl}/sdapi/v1/options`, { timeout: 5000 }),
    ]);
    const rawModels: Array<{ title?: string; filename?: string }> = Array.isArray(listRes.data) ? listRes.data : [];
    const models = await Promise.all(
      rawModels
        .filter((m): m is { title: string; filename?: string } => Boolean(m.title))
        .map(async (m) => ({
          title: m.title,
          ...(await classifyCheckpointArch(m.filename, m.title)),
        }))
    );
    const activeCheckpoint = optionsRes.data?.sd_model_checkpoint ?? null;
    const current = activeCheckpoint && models.some((m) => m.title === activeCheckpoint)
      ? activeCheckpoint
      : models[0]?.title ?? null;
    res.json({ models, current });
  } catch (error) {
    console.error('Failed to fetch SD models:', (error as Error).message);
    res.json({ models: [], current: null });
  }
});

// 7. List Stable Diffusion samplers (for the sampler picker).
// Always responds 200; on failure returns an empty list so the client can disable the selector.
app.get('/api/sd-samplers', async (_req: Request, res: Response) => {
  try {
    const listRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/samplers`, { timeout: 5000 });
    const samplers = Array.isArray(listRes.data)
      ? listRes.data.map((s: { name?: string }) => s.name).filter((n): n is string => Boolean(n))
      : [];
    res.json({ samplers });
  } catch (error) {
    console.error('Failed to fetch SD samplers:', (error as Error).message);
    res.json({ samplers: [] });
  }
});

// 7a. List Stable Diffusion schedulers (for the schedule-type picker).
// Available on AUTOMATIC1111 ≥1.9 / recent Forge; older builds return 404 and we
// gracefully degrade to an empty list so the picker hides itself client-side.
app.get('/api/sd-schedulers', async (_req: Request, res: Response) => {
  try {
    const listRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/schedulers`, { timeout: 5000 });
    const schedulers = Array.isArray(listRes.data)
      ? listRes.data
          .map((s: { name?: string; label?: string }) => s.label || s.name)
          .filter((n): n is string => Boolean(n))
      : [];
    res.json({ schedulers });
  } catch (error) {
    console.error('Failed to fetch SD schedulers:', (error as Error).message);
    res.json({ schedulers: [] });
  }
});

// Classify a LoRA's base architecture from the training metadata AUTOMATIC1111/Forge
// already parses and returns via /sdapi/v1/loras. Prefers the modelspec.sai_model_spec
// convention's `modelspec.architecture` field; falls back to the looser `ss_base_model_version`
// field some older trainers write instead. Returns 'unknown' when neither is present, or
// when present but naming a third architecture (e.g. Flux, HunyuanVideo) — a large
// fraction of LoRAs in practice, so callers must not treat 'unknown' as "incompatible".
function classifyLoraArchitecture(metadata: Record<string, unknown> | undefined): Architecture | 'unknown' {
  const arch = String(metadata?.['modelspec.architecture'] ?? metadata?.['ss_base_model_version'] ?? '').toLowerCase();
  // Flux markers precede SDXL because 'flux1-schnell' does not contain 'xl'
  // but SDXL merges based on Flux naming conventions may exist elsewhere;
  // ordering keeps genuine Flux LoRAs correctly typed.
  if (arch.includes('flux') || arch.startsWith('flux1')) return 'flux';
  if (arch.includes('xl')) return 'sdxl';
  if (arch.includes('stable-diffusion-v1') || arch.startsWith('sd_v1') || arch.startsWith('sd_1')) return 'sd15';
  return 'unknown';
}

// 7b. List Stable Diffusion LoRAs, tagged with their architecture (for the LoRA picker).
// Applied via <lora:name:weight> in the prompt.
app.get('/api/sd-loras', async (_req: Request, res: Response) => {
  try {
    const listRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/loras`, { timeout: 5000 });
    const loras = Array.isArray(listRes.data)
      ? listRes.data
          .filter((l: { name?: string }): l is { name: string; metadata?: Record<string, unknown> } => Boolean(l.name))
          .map((l) => ({ name: l.name, type: classifyLoraArchitecture(l.metadata) }))
      : [];
    res.json({ loras });
  } catch (error) {
    console.error('Failed to fetch SD LoRAs:', (error as Error).message);
    res.json({ loras: [] });
  }
});

// 7c. List Stable Diffusion upscalers (for the Hires.fix upscaler picker). Merges
// GAN-based upscalers with latent-space upscale modes into one flat name list,
// since SD's `hr_upscaler` field accepts either kind interchangeably.
app.get('/api/sd-upscalers', async (_req: Request, res: Response) => {
  try {
    const [upscalersRes, latentRes] = await Promise.all([
      axios.get(`${stableDiffusionUrl}/sdapi/v1/upscalers`, { timeout: 5000 }),
      axios.get(`${stableDiffusionUrl}/sdapi/v1/latent-upscale-modes`, { timeout: 5000 }),
    ]);
    const names = (data: unknown): string[] =>
      Array.isArray(data)
        ? data.map((u: { name?: string }) => u.name).filter((n): n is string => Boolean(n))
        : [];
    const upscalers = [...names(upscalersRes.data), ...names(latentRes.data)];
    res.json({ upscalers });
  } catch (error) {
    console.error('Failed to fetch SD upscalers:', (error as Error).message);
    res.json({ upscalers: [] });
  }
});

// 7ca. List Stable Diffusion VAEs (Variational AutoEncoders). SDXL benefits from
// picking a matching external VAE (e.g. `sdxl_vae.safetensors`) when the checkpoint
// wasn't shipped with one baked in; SD1.5 has its own VAE files too but the
// current UI only surfaces this picker on SDXL. Returns `[]` on failure so the
// client-side selector can hide itself, matching the other optional SD proxies.
app.get('/api/sd-vaes', async (_req: Request, res: Response) => {
  try {
    const listRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/sd-vae`, { timeout: 5000 });
    const vaes = Array.isArray(listRes.data)
      ? listRes.data.map((v: { model_name?: string }) => v.model_name).filter((n): n is string => Boolean(n))
      : [];
    res.json({ vaes });
  } catch (error) {
    console.error('Failed to fetch SD VAEs:', (error as Error).message);
    res.json({ vaes: [] });
  }
});

// 7d. Poll Stable Diffusion's own progress/ETA for the currently-running job
// (used by the client to show elapsed/remaining time during step 2). Degrades
// to zeros on any failure, same as the other optional SD proxy endpoints.
app.get('/api/sd-progress', async (_req: Request, res: Response) => {
  try {
    const response = await axios.get(`${stableDiffusionUrl}/sdapi/v1/progress`, {
      params: { skip_current_image: true },
      timeout: 5000,
    });
    res.json({
      progress: typeof response.data?.progress === 'number' ? response.data.progress : 0,
      etaRelative: typeof response.data?.eta_relative === 'number' ? response.data.eta_relative : 0,
    });
  } catch (error) {
    console.error('Failed to fetch SD progress:', (error as Error).message);
    res.json({ progress: 0, etaRelative: 0 });
  }
});

// 8. Delete selected generations (image files + metadata).
app.post('/api/generations/delete', async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'A non-empty ids array is required' });
  }

  let deleted = 0;
  try {
    const idSet = new Set(ids.map(String));
    const remaining: GenerationMetadata[] = [];
    const deletedRecords: GenerationMetadata[] = [];
    for (const item of getLocalHistory()) {
      if (item.id && idSet.has(item.id)) {
        // Remove the PNG and any sidecar WebP thumbnail. `thumbnailPath` is
        // optional on legacy items — silently skip when absent or missing.
        for (const p of [item.localPath, item.thumbnailPath]) {
          if (p && fs.existsSync(p)) {
            try {
              fs.unlinkSync(p);
            } catch (e) {
              console.error(`Failed to remove file ${p}:`, (e as Error).message);
            }
          }
        }
        deletedRecords.push(item);
        deleted++;
      } else {
        remaining.push(item);
      }
    }
    saveLocalHistory(remaining);

    // Rollup updates happen after metadata.json is already rewritten above —
    // if a rollup write fails, the delete itself is still complete and the
    // rollup can be rebuilt later via a backfill script.
    for (const rec of deletedRecords) {
      try {
        updateLocalRollup(
          LOCAL_ROLLUPS_PATH,
          normalizeParams(rec as unknown as Record<string, unknown>),
          -1,
          rec.isFavorite ? -1 : 0,
        );
      } catch (rollupError) {
        console.error('Failed to update local rollup on delete:', rollupError);
      }
    }

    res.json({ success: true, deleted });
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to delete generations.' });
  }
});

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

  try {
    updateLocalRollup(
      LOCAL_ROLLUPS_PATH,
      normalizeParams(target as unknown as Record<string, unknown>),
      0,
      isFavorite ? 1 : -1,
    );
  } catch (rollupError) {
    console.error('Failed to update local rollup on favorite:', rollupError);
  }

  res.json({ success: true });
});

// 10. Return the local ranking rollup counters (signed-out mirror of the
// Firestore `users/{uid}/rankingRollups` collection). `{}` before any local
// generation has been saved or the Task 8 backfill has run.
app.get('/api/ranking-rollups', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(LOCAL_ROLLUPS_PATH)) {
      return res.json({});
    }
    const data = JSON.parse(fs.readFileSync(LOCAL_ROLLUPS_PATH, 'utf8')) as LocalRollupFile;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT} 🚀`);
});
