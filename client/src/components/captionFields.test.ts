import { describe, it, expect } from 'vitest';
import { buildCaptionInfo } from './captionFields';
import type { GenerationData } from '../App';
import { t } from '../i18n';

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

  it('falls back to the unknown-model label when model is null', () => {
    const info = buildCaptionInfo({ ...baseItem, model: null });
    expect(info.model).toBe(t.caption.unknownModel);
  });

  it('falls back to the unknown-model label when model is empty string', () => {
    const info = buildCaptionInfo({ ...baseItem, model: '' });
    expect(info.model).toBe(t.caption.unknownModel);
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

  describe('for video records', () => {
    const videoItem: GenerationData = {
      ...baseItem,
      mediaType: 'video',
      parentId: 'parent-abc',
      videoUrl: 'v',
      width: 1024,
      height: 1088,
      // The image side inherited via spread stays put (enableHr/loras/model),
      // but buildCaptionInfo must ignore them for video records.
      enableHr: true,
      loras: [{ name: 'x', weight: 0.5 }],
      ltxParams: {
        fidelity: 1.0,
        motion: 35,
        identity: 1.0,
        length: 240,
        positivePrompt: 'move',
        negativePrompt: 'still',
      },
    };

    it('formats length as seconds (frames) at 24 fps', () => {
      const info = buildCaptionInfo(videoItem);
      expect(info.length).toBe('10.0s (240f)');
    });

    it('drops model, hasHires, hasLora on video records regardless of underlying fields', () => {
      const info = buildCaptionInfo(videoItem);
      expect(info.model).toBeUndefined();
      expect(info.hasHires).toBe(false);
      expect(info.hasLora).toBe(false);
    });

    it('still formats the size string for the video dimensions', () => {
      const info = buildCaptionInfo(videoItem);
      expect(info.size).toBe('1024×1088');
    });

    it('falls back to 0.0s (0f) when ltxParams is missing (legacy/broken record)', () => {
      const info = buildCaptionInfo({ ...videoItem, ltxParams: undefined });
      expect(info.length).toBe('0.0s (0f)');
    });

    it('rounds sub-second lengths to one decimal', () => {
      const info = buildCaptionInfo({
        ...videoItem,
        ltxParams: { ...videoItem.ltxParams!, length: 121 },
      });
      // 121 / 24 = 5.04166... → 5.0
      expect(info.length).toBe('5.0s (121f)');
    });
  });
});
