import { describe, it, expect } from 'vitest';
import { buildCaptionInfo } from './captionFields';
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
};

describe('buildCaptionInfo', () => {
  it('returns core fields with hasHires and hasLora both false when neither is applied', () => {
    const info = buildCaptionInfo(baseItem);
    expect(info.model).toBe('yayoi_mix_v25-fp16.safetensors [ca28aa4a44]');
    expect(info.size).toBe('512×512 (1:1)');
    expect(info.hasHires).toBe(false);
    expect(info.hasLora).toBe(false);
  });

  it('falls back to "不明" when model is null', () => {
    const info = buildCaptionInfo({ ...baseItem, model: null });
    expect(info.model).toBe('不明');
  });

  it('falls back to "不明" when model is empty string', () => {
    const info = buildCaptionInfo({ ...baseItem, model: '' });
    expect(info.model).toBe('不明');
  });

  it('omits the aspect ratio suffix when dimensions do not match any preset', () => {
    const info = buildCaptionInfo({ ...baseItem, width: 999, height: 555 });
    expect(info.size).toBe('999×555');
  });

  it('recognizes SDXL 832x1216 as 3:2 portrait', () => {
    const info = buildCaptionInfo({ ...baseItem, width: 832, height: 1216 });
    expect(info.size).toBe('832×1216 (3:2)');
  });

  it('sets hasHires true when enableHr is true', () => {
    const info = buildCaptionInfo({ ...baseItem, enableHr: true });
    expect(info.hasHires).toBe(true);
  });

  it('sets hasLora true when at least one LoRA is applied', () => {
    const info = buildCaptionInfo({
      ...baseItem,
      loras: [{ name: 'x', weight: 0.5 }],
    });
    expect(info.hasLora).toBe(true);
  });

  it('sets hasLora true when multiple LoRAs are applied', () => {
    const info = buildCaptionInfo({
      ...baseItem,
      loras: [
        { name: 'x', weight: 0.5 },
        { name: 'y', weight: 0.7 },
        { name: 'z', weight: 0.3 },
      ],
    });
    expect(info.hasLora).toBe(true);
  });

  it('sets hasLora false when loras is an empty array', () => {
    const info = buildCaptionInfo({ ...baseItem, loras: [] });
    expect(info.hasLora).toBe(false);
  });

  it('formats the date as MM-DD (shape-only, timezone-agnostic)', () => {
    const info = buildCaptionInfo(baseItem);
    expect(info.date).toMatch(/^\d{2}-\d{2}$/);
  });

  it('flags both hasHires and hasLora when both are applied', () => {
    const info = buildCaptionInfo({
      ...baseItem,
      enableHr: true,
      loras: [{ name: 'a', weight: 0.5 }],
    });
    expect(info.hasHires).toBe(true);
    expect(info.hasLora).toBe(true);
  });
});
