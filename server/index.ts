import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

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
  isFavorite?: boolean;
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

// Helper: Translate and enhance prompt via LM Studio, returning positive and negative prompts in XML format
async function enhancePrompt(userPrompt: string): Promise<EnhancedPrompt> {
  const defaultNegative = 'nsfw, low quality, worst quality, deformed, bad anatomy, blurry, disfigured';
  try {
    console.log(`Sending prompt to LM Studio (${lmStudioUrl}/v1/chat/completions)...`);
    const response = await axios.post(`${lmStudioUrl}/v1/chat/completions`, {
      model: lmStudioModel || undefined,
      messages: [
        {
          role: 'system',
          content: `You are an expert prompt engineer for Stable Diffusion. Your task is to translate any non-English concept to English and generate both the detailed positive prompt and the negative prompt to achieve the best quality image.

You MUST encapsulate your prompts using the following XML tags:
<prompts>
  <positive>detailed positive prompt words, comma-separated...</positive>
  <negative>detailed negative prompt words, comma-separated...</negative>
</prompts>

Do not include any introductory or concluding text, explanations, or notes. Reply ONLY with the XML structure.`
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
  denoisingStrength = 0.7
): Promise<{ image: string; seed: number }> {
  try {
    console.log(`Sending generation request to Stable Diffusion (${stableDiffusionUrl}/sdapi/v1/txt2img)...`);
    const payload: Record<string, unknown> = {
      prompt,
      negative_prompt: negativePrompt || 'nsfw, low quality, worst quality, deformed, bad anatomy, blurry',
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
    // Switch checkpoint for this request; SD keeps it loaded for subsequent generations.
    if (model) {
      payload.override_settings = { sd_model_checkpoint: model };
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

// Detect whether a checkpoint is SDXL-based by reading the .safetensors header (an 8-byte
// little-endian length prefix followed by that many bytes of JSON tensor metadata) without
// loading any tensor data. SDXL's GeneralConditioner wraps its text encoder(s) under keys
// named "conditioner.embedders.N" — present for both the base checkpoint (2 encoders) and the
// refiner checkpoint (1 encoder, so a "dual encoder" check alone would miss it) — whereas SD1.5
// uses "cond_stage_model.*" and other architectures (e.g. Flux) use neither, so this check
// naturally leaves them un-excluded. Falls back to the old name-based heuristic if the file
// can't be read (e.g. filename missing, or an unreachable path), so a filesystem hiccup
// degrades gracefully instead of breaking the model list.
async function isSdxlCheckpoint(filename: string | undefined, title: string): Promise<boolean> {
  if (filename) {
    try {
      const handle = await fs.promises.open(toWslPath(filename), 'r');
      try {
        const lengthBuffer = Buffer.alloc(8);
        await handle.read(lengthBuffer, 0, 8, 0);
        const headerLength = Number(lengthBuffer.readBigUInt64LE(0));
        const headerBuffer = Buffer.alloc(headerLength);
        await handle.read(headerBuffer, 0, headerLength, 8);
        const keys = Object.keys(JSON.parse(headerBuffer.toString('utf-8')));
        return keys.some((k) => k.startsWith('conditioner.embedders.'));
      } finally {
        await handle.close();
      }
    } catch (error) {
      console.error(`Failed to read safetensors header for ${title}, falling back to name heuristic:`, (error as Error).message);
    }
  }
  return title.toLowerCase().includes('xl');
}

// Serve local outputs statically
app.use('/api/outputs', express.static(outputsDir));

// --- API ROUTES ---

// 1. New Prompt Enhance Endpoint
app.post('/api/enhance', async (req: Request, res: Response) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  try {
    const enhanced = await enhancePrompt(prompt);
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
  const { prompt, negativePrompt, originalPrompt, width, height, steps, cfgScale, skipEnhance, model, seed, sampler, scheduler, loras, enableHr, hrUpscaler, hrScale, hrSecondPassSteps, denoisingStrength, clientPersist } = req.body;
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
  let finalNegativePrompt = negativePrompt || defaultNegative;
  const finalOriginalPrompt = originalPrompt || prompt;

  try {
    // Step 1: Enhance prompt using LM Studio if not skipped
    if (!skipEnhance) {
      const enhanced = await enhancePrompt(prompt);
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
      denoisingStrength !== undefined ? parseFloat(denoisingStrength) : 0.7
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
        loras: loraList,
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
          type: (await isSdxlCheckpoint(m.filename, m.title)) ? 'sdxl' as const : 'sd15' as const,
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

// 7b. List Stable Diffusion LoRAs (for the LoRA picker). Applied via <lora:name:weight> in the prompt.
app.get('/api/sd-loras', async (_req: Request, res: Response) => {
  try {
    const listRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/loras`, { timeout: 5000 });
    const loras = Array.isArray(listRes.data)
      ? listRes.data.map((l: { name?: string }) => l.name).filter((n): n is string => Boolean(n))
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

// Start Express Server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT} 🚀`);
});
