import { describe, it, expect } from 'vitest';
import { buildCaptionFieldQueue } from './captionFields';
import type { GenerationData } from '../App';

const baseItem: GenerationData = {
  originalPrompt: 'a girl',
  enhancedPrompt: 'a girl',
  negativePrompt: 'bad',
  width: 512,
  height: 512,
  steps: 20,
  cfgScale: 7,
  model: 'yayoi_mix_v25-fp16.safetensors [ca28aa4a44]',
  imageUrl: 'x',
  timestamp: new Date('2026-07-05T14:23:00+09:00').getTime(),
  createdAt: '2026-07-05T05:23:00.000Z',
  backendMode: 'local',
  sampler: 'DPM++ SDE',
  scheduler: 'Karras',
};

describe('buildCaptionFieldQueue', () => {
  it('returns the 4 basic fields for a plain SD1.5 512x512 generation', () => {
    const q = buildCaptionFieldQueue(baseItem);
    expect(q.map(f => f.key)).toEqual(['model', 'size', 'date', 'sampler']);
    expect(q[0].label).toBe('モデル');
    expect(q[0].value).toBe('yayoi_mix_v25-fp16.safetensors [ca28aa4a44]');
    expect(q[1].label).toBe('サイズ');
    expect(q[1].value).toBe('512×512 (1:1)');
    expect(q[3].label).toBe('Sampler');
    expect(q[3].value).toBe('DPM++ SDE · Karras');
  });

  it('falls back to "不明" when model is null or empty', () => {
    const q1 = buildCaptionFieldQueue({ ...baseItem, model: null });
    const q2 = buildCaptionFieldQueue({ ...baseItem, model: '' });
    expect(q1[0].value).toBe('不明');
    expect(q2[0].value).toBe('不明');
  });

  it('drops scheduler suffix when scheduler is missing', () => {
    const q = buildCaptionFieldQueue({ ...baseItem, scheduler: undefined });
    expect(q[3].value).toBe('DPM++ SDE');
  });

  it('skips the sampler field when sampler is missing', () => {
    const q = buildCaptionFieldQueue({ ...baseItem, sampler: undefined, scheduler: undefined });
    expect(q.map(f => f.key)).toEqual(['model', 'size', 'date']);
  });

  it('omits the aspect ratio suffix when no preset matches', () => {
    const q = buildCaptionFieldQueue({ ...baseItem, width: 999, height: 555 });
    expect(q[1].value).toBe('999×555');
  });

  it('recognizes SDXL 1024x1536 as 3:2 portrait', () => {
    const q = buildCaptionFieldQueue({ ...baseItem, width: 832, height: 1216 });
    expect(q[1].value).toBe('832×1216 (3:2)');
  });

  it('adds a Hires.fix slot when enableHr is true', () => {
    const q = buildCaptionFieldQueue({ ...baseItem, enableHr: true, hrScale: 2, denoisingStrength: 0.5 });
    expect(q.map(f => f.key)).toContain('hires');
    const hires = q.find(f => f.key === 'hires')!;
    expect(hires.label).toBe('Hires.fix');
    expect(hires.value).toBe('×2 (denoise 0.5)');
  });

  it('adds one slot per applied LoRA', () => {
    const q = buildCaptionFieldQueue({
      ...baseItem,
      loras: [
        { name: 'siitake-eye', weight: 0.8 },
        { name: 'ClearHand-V2', weight: 0.7 },
      ],
    });
    const loraSlots = q.filter(f => f.key.startsWith('lora-'));
    expect(loraSlots).toHaveLength(2);
    expect(loraSlots[0].label).toBe('LoRA');
    expect(loraSlots[0].value).toBe('siitake-eye × 0.8');
    expect(loraSlots[1].value).toBe('ClearHand-V2 × 0.7');
  });

  it('combines Hires.fix and multiple LoRAs in order', () => {
    const q = buildCaptionFieldQueue({
      ...baseItem,
      enableHr: true,
      hrScale: 2,
      denoisingStrength: 0.5,
      loras: [
        { name: 'a', weight: 0.5 },
        { name: 'b', weight: 0.6 },
        { name: 'c', weight: 0.7 },
      ],
    });
    expect(q.map(f => f.key)).toEqual(['model', 'size', 'date', 'sampler', 'hires', 'lora-0', 'lora-1', 'lora-2']);
  });

  it('formats the date as YYYY-MM-DD HH:mm using the ja-JP locale', () => {
    const q = buildCaptionFieldQueue(baseItem);
    expect(q[2].label).toBe('日時');
    expect(q[2].value).toMatch(/^2026-07-05 \d{2}:\d{2}$/);
  });
});
