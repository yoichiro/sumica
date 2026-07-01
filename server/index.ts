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
// website the user has open POST to this server (e.g. silently repointing the
// outbound LM Studio / Stable Diffusion URLs via /api/settings). Override with
// CORS_ORIGINS (comma-separated) when serving the client from a different origin.
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

// API settings (mutable at runtime)
let lmStudioUrl = process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234';
let stableDiffusionUrl = process.env.STABLE_DIFFUSION_URL || 'http://127.0.0.1:7860';
let lmStudioModel = process.env.LM_STUDIO_MODEL || ''; // Empty string means using the currently loaded model

// Accept only http(s) URLs for runtime-configurable outbound targets. Loopback/LAN
// hosts stay allowed on purpose — the legitimate LM Studio / SD services are local.
const isValidHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

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
  scheduler = ''
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
    // Switch checkpoint for this request; SD keeps it loaded for subsequent generations.
    if (model) {
      payload.override_settings = { sd_model_checkpoint: model };
    }
    const response = await axios.post(`${stableDiffusionUrl}/sdapi/v1/txt2img`, payload, { timeout: 180000 }); // 3 minutes timeout

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
  const { prompt, negativePrompt, originalPrompt, width, height, steps, cfgScale, skipEnhance, model, seed, sampler, scheduler, loras, clientPersist } = req.body;
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
      scheduler || ''
    );

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

// 4. Update API Configuration
app.post('/api/settings', (req: Request, res: Response) => {
  const { newLmStudioUrl, newStableDiffusionUrl, newLmStudioModel } = req.body;

  if (newLmStudioUrl && !isValidHttpUrl(newLmStudioUrl)) {
    return res.status(400).json({ error: 'newLmStudioUrl must be a valid http(s) URL' });
  }
  if (newStableDiffusionUrl && !isValidHttpUrl(newStableDiffusionUrl)) {
    return res.status(400).json({ error: 'newStableDiffusionUrl must be a valid http(s) URL' });
  }

  if (newLmStudioUrl) lmStudioUrl = newLmStudioUrl;
  if (newStableDiffusionUrl) stableDiffusionUrl = newStableDiffusionUrl;
  if (newLmStudioModel !== undefined) lmStudioModel = newLmStudioModel;

  res.json({
    success: true,
    settings: {
      lmStudioUrl,
      stableDiffusionUrl,
      lmStudioModel
    }
  });
});

// 5. Connection health check for upstream services (LM Studio + Stable Diffusion).
// Always responds 200 with per-service flags so the client can branch on the result.
app.get('/api/health', async (_req: Request, res: Response) => {
  const [lmStudio, stableDiffusion] = await Promise.all([
    checkLmStudio(),
    checkStableDiffusion(),
  ]);
  res.json({ lmStudio, stableDiffusion });
});

// 6. List Stable Diffusion checkpoints and the currently active one (for the model picker).
// Always responds 200; on failure returns an empty list so the client can disable the selector.
app.get('/api/sd-models', async (_req: Request, res: Response) => {
  try {
    const [listRes, optionsRes] = await Promise.all([
      axios.get(`${stableDiffusionUrl}/sdapi/v1/sd-models`, { timeout: 5000 }),
      axios.get(`${stableDiffusionUrl}/sdapi/v1/options`, { timeout: 5000 }),
    ]);
    // Exclude Stable Diffusion XL checkpoints: judged purely by the name containing "xl".
    const models = Array.isArray(listRes.data)
      ? listRes.data
          .map((m: { title?: string }) => m.title)
          .filter((t): t is string => Boolean(t))
          .filter((t) => !t.toLowerCase().includes('xl'))
      : [];
    const activeCheckpoint = optionsRes.data?.sd_model_checkpoint ?? null;
    // If the active checkpoint was filtered out (e.g. an XL model), fall back to the
    // first valid model so the picker never points at a hidden entry.
    const current = activeCheckpoint && models.includes(activeCheckpoint)
      ? activeCheckpoint
      : models[0] ?? null;
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
