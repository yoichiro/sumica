import type { GenerationData } from '../App';
import { findSdxlSelection, findSd15Selection } from './presets';
import { t } from '../i18n';

// Primary line of the gallery card caption is either `model` (image records)
// or `length` (video records). Both are optional so the renderer picks
// whichever the current record populated. hasHires/hasLora are SD-only
// concepts and stay false on video records.
export type CaptionInfoData = {
  model?: string;
  length?: string;
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

// LTX-Video workflow's mxSlider outputs a frame count; the workflow is
// wired to 24 fps, so seconds = frames / 24. Keep both units so the caller
// can read the duration at a glance and match it to the workflow input.
const VIDEO_FPS = 24;

function formatVideoLength(frames: number): string {
  return `${(frames / VIDEO_FPS).toFixed(1)}s (${frames}f)`;
}

export function buildCaptionInfo(item: GenerationData): CaptionInfoData {
  const isVideo = (item.mediaType ?? 'image') === 'video';
  if (isVideo) {
    const frames = item.ltxParams?.length ?? 0;
    return {
      length: formatVideoLength(frames),
      size: formatSize(item.width, item.height),
      date: formatDateShort(item.timestamp),
      hasHires: false,
      hasLora: false,
    };
  }
  return {
    model: item.model && item.model.length > 0 ? item.model : t.caption.unknownModel,
    size: formatSize(item.width, item.height),
    date: formatDateShort(item.timestamp),
    hasHires: !!item.enableHr,
    hasLora: !!(item.loras && item.loras.length > 0),
  };
}
