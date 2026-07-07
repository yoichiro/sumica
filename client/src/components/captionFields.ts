import type { GenerationData } from '../App';
import { findSdxlSelection, findSd15Selection } from './presets';

export type CaptionField = {
  key: string;
  value: string;
};

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(width: number, height: number): string {
  const sdxl = findSdxlSelection(width, height);
  if (sdxl) return `${width}×${height} (${sdxl.ratio})`;
  const sd15 = findSd15Selection(width, height);
  if (sd15) return `${width}×${height} (${sd15.ratio})`;
  return `${width}×${height}`;
}

function formatSampler(item: GenerationData): string | null {
  if (!item.sampler) return null;
  if (item.scheduler) return `${item.sampler} · ${item.scheduler}`;
  return item.sampler;
}

function formatHires(item: GenerationData): string {
  const scale = item.hrScale ?? 2;
  const denoise = item.denoisingStrength ?? 0.7;
  return `×${scale} (denoise ${denoise})`;
}

export function buildCaptionFieldQueue(item: GenerationData): CaptionField[] {
  const fields: CaptionField[] = [];

  fields.push({
    key: 'model',
    value: item.model && item.model.length > 0 ? item.model : '不明',
  });

  fields.push({
    key: 'size',
    value: formatSize(item.width, item.height),
  });

  fields.push({
    key: 'date',
    value: formatDate(item.timestamp),
  });

  const sampler = formatSampler(item);
  if (sampler) {
    fields.push({ key: 'sampler', value: sampler });
  }

  if (item.enableHr) {
    fields.push({ key: 'hires', value: formatHires(item) });
  }

  if (item.loras && item.loras.length > 0) {
    item.loras.forEach((l, i) => {
      fields.push({
        key: `lora-${i}`,
        value: `${l.name} × ${l.weight}`,
      });
    });
  }

  return fields;
}
