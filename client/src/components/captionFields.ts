import type { GenerationData } from '../App';
import { findSdxlSelection, findSd15Selection } from './presets';
import { t } from '../i18n';

export type CaptionInfoData = {
  model: string;
  size: string;
  date: string;
  hasHires: boolean;
  hasLora: boolean;
};

function formatDateShort(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatSize(width: number, height: number): string {
  const sdxl = findSdxlSelection(width, height);
  if (sdxl) return `${width}×${height} (${sdxl.ratio})`;
  const sd15 = findSd15Selection(width, height);
  if (sd15) return `${width}×${height} (${sd15.ratio})`;
  return `${width}×${height}`;
}

export function buildCaptionInfo(item: GenerationData): CaptionInfoData {
  return {
    model: item.model && item.model.length > 0 ? item.model : t.caption.unknownModel,
    size: formatSize(item.width, item.height),
    date: formatDateShort(item.timestamp),
    hasHires: !!item.enableHr,
    hasLora: !!(item.loras && item.loras.length > 0),
  };
}
