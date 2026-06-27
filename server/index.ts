import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Ensure outputs directory exists for local fallback
const outputsDir = path.join(__dirname, 'outputs');
if (!fs.existsSync(outputsDir)) {
  fs.mkdirSync(outputsDir, { recursive: true });
}

// Initialize Firebase Admin
type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;
let db: Firestore | null = null;
let bucket: Bucket | null = null;
let firebaseEnabled = false;

const firebaseKeyPath = process.env.FIREBASE_KEY_PATH;
const storageBucketName = process.env.FIREBASE_STORAGE_BUCKET;

if (firebaseKeyPath && fs.existsSync(firebaseKeyPath)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(firebaseKeyPath, 'utf8'));
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: storageBucketName || `${serviceAccount.project_id}.firebasestorage.app`
    });
    db = getFirestore();
    bucket = getStorage().bucket();
    firebaseEnabled = true;
    console.log('Firebase Admin SDK initialized successfully! 🎉');
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', (error as Error).message);
    console.log('Falling back to Local Storage mode.');
  }
} else {
  console.log('FIREBASE_KEY_PATH not set or service account file not found. Running in Local Storage mode. 📁');
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
  imageUrl: string;
  storagePath?: string;
  localPath?: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase' | 'local';
}

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
  cfgScale = 7
): Promise<string> {
  try {
    console.log(`Sending generation request to Stable Diffusion (${stableDiffusionUrl}/sdapi/v1/txt2img)...`);
    const response = await axios.post(`${stableDiffusionUrl}/sdapi/v1/txt2img`, {
      prompt,
      negative_prompt: negativePrompt || 'nsfw, low quality, worst quality, deformed, bad anatomy, blurry',
      steps,
      cfg_scale: cfgScale,
      width,
      height,
      sampler_name: 'Euler a',
    }, { timeout: 180000 }); // 3 minutes timeout

    if (response.data && response.data.images && response.data.images[0]) {
      return response.data.images[0]; // Returns base64 image string
    }
    throw new Error('No image returned from Stable Diffusion API');
  } catch (error) {
    console.error('Stable Diffusion generation failed:', (error as Error).message);
    throw error;
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
  const { prompt, negativePrompt, originalPrompt, width, height, steps, cfgScale, skipEnhance } = req.body;

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

    // Step 2: Generate image with Stable Diffusion
    const base64Image = await generateImage(
      finalPrompt,
      finalNegativePrompt,
      width ? parseInt(width) : 512,
      height ? parseInt(height) : 512,
      steps ? parseInt(steps) : 20,
      cfgScale ? parseFloat(cfgScale) : 7
    );

    const imageBuffer = Buffer.from(base64Image, 'base64');
    const timestamp = Date.now();
    const fileName = `generated_${timestamp}.png`;
    let imageUrl = '';
    let storagePath = '';

    // Step 3: Save image (Firebase Cloud Storage vs. Local filesystem)
    if (firebaseEnabled && bucket && db) {
      console.log('Firebase mode: Uploading image to Storage...');
      const file = bucket.file(`images/${fileName}`);
      await file.save(imageBuffer, {
        metadata: { contentType: 'image/png' },
      });

      imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(`images/${fileName}`)}?alt=media`;
      storagePath = `images/${fileName}`;

      console.log('Firebase mode: Saving metadata to Firestore...');
      const metadata: GenerationMetadata = {
        originalPrompt: finalOriginalPrompt,
        enhancedPrompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        width: width || 512,
        height: height || 512,
        steps: steps || 20,
        cfgScale: cfgScale || 7,
        imageUrl,
        storagePath,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        backendMode: 'firebase'
      };

      const docRef = await db.collection('generations').add(metadata);

      res.json({
        success: true,
        data: { id: docRef.id, ...metadata }
      });
    } else {
      // Local Fallback Mode
      console.log('Local mode: Saving image to outputs/ directory...');
      const localFilePath = path.join(outputsDir, fileName);
      fs.writeFileSync(localFilePath, imageBuffer);

      imageUrl = `http://localhost:${PORT}/api/outputs/${fileName}`;

      const metadata: GenerationMetadata = {
        id: `local_${timestamp}`,
        originalPrompt: finalOriginalPrompt,
        enhancedPrompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        width: width || 512,
        height: height || 512,
        steps: steps || 20,
        cfgScale: cfgScale || 7,
        imageUrl,
        localPath: localFilePath,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        backendMode: 'local'
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
    if (firebaseEnabled && db) {
      console.log('Fetching history from Firestore...');
      const snapshot = await db.collection('generations').orderBy('timestamp', 'desc').limit(50).get();
      const history: GenerationMetadata[] = [];
      snapshot.forEach(doc => {
        history.push({ id: doc.id, ...doc.data() } as GenerationMetadata);
      });
      res.json(history);
    } else {
      console.log('Fetching history from Local JSON...');
      res.json(getLocalHistory());
    }
  } catch (error) {
    console.error('Failed to fetch history:', error);
    res.status(500).json({ error: 'Failed to fetch generation history.' });
  }
});

// 3. System status endpoints
app.get('/api/status', (_req: Request, res: Response) => {
  res.json({
    firebaseEnabled,
    lmStudioUrl,
    stableDiffusionUrl,
    lmStudioModel,
    storageBucketName: bucket ? bucket.name : null,
    localHistoryCount: getLocalHistory().length
  });
});

// 4. Update API Configuration
app.post('/api/settings', (req: Request, res: Response) => {
  const { newLmStudioUrl, newStableDiffusionUrl, newLmStudioModel } = req.body;

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

// Start Express Server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT} 🚀`);
});
