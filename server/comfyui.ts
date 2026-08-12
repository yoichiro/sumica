// ComfyUI HTTP + WebSocket client used by the video-generation endpoint. Kept
// separate from index.ts so the pure workflow-mutation logic can be unit tested
// without spinning up Express.
//
// Note: LtxParams-shaped fields are also declared in client/src/firebase.ts —
// keep them in sync when adding new knobs. The server is intentionally
// Firebase-free and cannot import from the client tree.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import FormData from 'form-data';
import WebSocket from 'ws';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';

// ESM has no __dirname; polyfill it the same way server/index.ts does.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type WorkflowJson = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }>;

export type MutateArgs = {
  sourceImageFilename: string;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  length: number;
  fidelity: number;
  motion: number;
  identity: number;
  seed: number;
};

export type HistoryEntry = {
  outputs: Record<string, Record<string, unknown>>;
  status: { status_str: string; completed: boolean };
};

export type WsEvent =
  | { type: 'status'; data: unknown }
  | { type: 'executing'; data: { node: string | null; prompt_id?: string } }
  | { type: 'progress'; data: { value: number; max: number; node: string | null } }
  | { type: 'progress_state'; data: unknown }
  | { type: 'executed'; data: unknown }
  | { type: 'execution_success'; data: { prompt_id: string } }
  | { type: 'execution_error'; data: unknown };

export class CancelledError extends Error {
  constructor() { super('cancelled'); this.name = 'CancelledError'; }
}

// ComfyUI's Seed(rgthree) node caps at 2^50; go over and the prompt is rejected.
export const SEED_MAX = 1125899906842624;

export function clampSeed(seed: number): number {
  const abs = Math.abs(Math.floor(seed));
  return abs > SEED_MAX ? abs % (SEED_MAX + 1) : abs;
}

// Deep-clone-then-mutate: writes the dynamic Tier 1 + Tier 2 parameters into a
// fresh copy of the workflow and returns it. The input workflow is untouched.
export function mutateWorkflow(workflow: WorkflowJson, args: MutateArgs): WorkflowJson {
  const clone: WorkflowJson = JSON.parse(JSON.stringify(workflow));
  clone['837'].inputs.image = args.sourceImageFilename;
  clone['536'].inputs.text = args.positivePrompt;
  clone['537'].inputs.text = args.negativePrompt;
  clone['524'].inputs.seed = clampSeed(args.seed);
  const setSlider = (nodeId: string, v: number) => {
    clone[nodeId].inputs.Xi = v;
    clone[nodeId].inputs.Xf = v;
  };
  setSlider('791', args.width);
  setSlider('792', args.height);
  setSlider('796', args.length);
  setSlider('797', args.fidelity);
  setSlider('915', args.motion);
  setSlider('941', args.identity);
  // Force temp-only save so ComfyUI's persistent output/ folder is not written to
  // — Sumica saves videos on its own (Firebase Storage / server/outputs).
  clone['597'].inputs.save_output = false;
  return clone;
}

const comfyBase = () => process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const wsBase = () => comfyBase().replace(/^http/, 'ws');

export async function loadBundledWorkflow(): Promise<WorkflowJson> {
  const rel = process.env.COMFYUI_WORKFLOW_PATH || './workflows/i2v.json';
  const abs = path.isAbsolute(rel) ? rel : path.join(__dirname, rel);
  const text = await fs.readFile(abs, 'utf-8');
  return JSON.parse(text) as WorkflowJson;
}

export async function uploadImageToComfy(bytes: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append('image', bytes, { filename });
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const res = await axios.post(`${comfyBase()}/upload/image`, form, {
    headers: form.getHeaders(),
    timeout: 30_000,
  });
  const name = res.data?.name;
  if (typeof name !== 'string') throw new Error('ComfyUI upload/image returned no name');
  return name;
}

export async function submitWorkflow(workflow: WorkflowJson, clientId: string): Promise<string> {
  const res = await axios.post(`${comfyBase()}/prompt`, { prompt: workflow, client_id: clientId }, { timeout: 30_000 });
  const errors = res.data?.node_errors;
  if (errors && Object.keys(errors).length > 0) {
    throw new Error(`ComfyUI node_errors: ${JSON.stringify(errors)}`);
  }
  const promptId = res.data?.prompt_id;
  if (typeof promptId !== 'string') throw new Error('ComfyUI /prompt returned no prompt_id');
  return promptId;
}

export async function fetchVideo(filename: string, subfolder: string, type: 'output' | 'temp'): Promise<Buffer> {
  const url = `${comfyBase()}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
  const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 60_000 });
  return Buffer.from(res.data);
}

// Extract the first video frame and re-encode to a 256px-max-dimension WebP at
// quality 80. Uses a temp file for input because ffmpeg needs seekable input.
export async function extractPoster(mp4: Buffer): Promise<Buffer> {
  const tmp = path.join('/tmp', `sumica-poster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
  await fs.writeFile(tmp, mp4);
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const out = new PassThrough();
      out.on('data', (c: Buffer) => chunks.push(c));
      out.on('end', () => resolve(Buffer.concat(chunks)));
      out.on('error', reject);
      ffmpeg(tmp)
        .inputOptions('-ss', '00:00:00.000')
        .outputOptions('-frames:v', '1')
        .outputOptions('-vf', 'scale=w=256:h=256:force_original_aspect_ratio=decrease')
        .outputOptions('-c:v', 'libwebp')
        .outputOptions('-quality', '80')
        .format('webp')
        .on('error', reject)
        .pipe(out, { end: true });
    });
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
}

export async function waitForCompletion(
  promptId: string,
  clientId: string,
  onProgress: (evt: WsEvent) => void,
  isCancelled: () => boolean,
): Promise<HistoryEntry> {
  return new Promise<HistoryEntry>((resolve, reject) => {
    // Must subscribe with the SAME client_id that was registered with /prompt in
    // submitWorkflow() — ComfyUI routes execution-scoped events (executing,
    // progress, execution_success/error) only to the socket whose clientId
    // matches the submission's client_id, not to a socket keyed by promptId.
    const ws = new WebSocket(`${wsBase()}/ws?clientId=${encodeURIComponent(clientId)}`);
    const cancelPoll = setInterval(async () => {
      if (!isCancelled()) return;
      clearInterval(cancelPoll);
      try { await axios.post(`${comfyBase()}/interrupt`, {}); } catch { /* best-effort */ }
      try { ws.close(); } catch { /* ignore */ }
      reject(new CancelledError());
    }, 500);
    ws.on('message', async (raw: WebSocket.RawData) => {
      let msg: WsEvent;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      onProgress(msg);
      if (msg.type === 'execution_success' && msg.data?.prompt_id === promptId) {
        clearInterval(cancelPoll);
        try {
          const hist = await axios.get(`${comfyBase()}/history/${promptId}`, { timeout: 15_000 });
          const entry = hist.data?.[promptId];
          if (!entry) return reject(new Error('ComfyUI history entry missing after execution_success'));
          try { ws.close(); } catch { /* ignore */ }
          resolve(entry as HistoryEntry);
        } catch (err) { reject(err); }
      }
      if (msg.type === 'execution_error') {
        clearInterval(cancelPoll);
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`ComfyUI execution_error: ${JSON.stringify(msg.data)}`));
      }
    });
    ws.on('error', (err) => { clearInterval(cancelPoll); reject(err); });
    // If ComfyUI drops the socket without ever emitting an `error` event (e.g. a
    // restart, or the OS closing the fd), the promise would otherwise never settle
    // and the cancel-poll interval would leak while /api/video/generate hangs forever.
    ws.on('close', () => {
      clearInterval(cancelPoll);
      reject(new Error('ComfyUI ws closed before execution_success'));
    });
  });
}
