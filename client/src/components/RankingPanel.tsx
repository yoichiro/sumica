import { rankRecipes, type RankingRollup, type RankedRecipe } from '../utils/rankingAnalysis';
import { t } from '../i18n';
import type { SdModel } from './presets';
import { AspectRatioRect } from './AspectRatioRect';
import { inferSdArchitectureFromTitle } from './loadIntoFormState';

// Presentational-only Top-N favorite-recipe ranking list. Consumes the raw
// rollup counters and runs them through `rankRecipes` (favs-desc sort per
// ADR 35) itself, so the parent only has to supply the rollup data and an
// apply-to-form callback. `sdModels` is threaded down to each row so the
// architecture chip (SDXL / SD1.5) can be resolved against the currently-
// loaded checkpoint list.
export interface RankingPanelProps {
  rollups: RankingRollup[];
  sdModels: SdModel[];
  onApplyRecipe: (recipe: RankedRecipe) => void;
  topN?: number;
}

const RANK_EMOJI = ['🥇', '🥈', '🥉'];

// Euclidean GCD, integer-only. Used to reduce a raw pixel WxH pair to its
// simplest aspect-ratio form (e.g. 1024x768 → gcd 256 → 4:3). Returns 1 when
// either side is non-positive so callers still get a valid ratio string.
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  if (a === 0 || b === 0) return 1;
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

// Parse a "WxH" NormalizedParams.size string into structured display data.
// Returns null if the string is malformed or has zero-ish dimensions —
// callers just skip the size block in that case.
function parseSize(size: string): {
  width: number;
  height: number;
  ratioLabel: string;
} | null {
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const g = gcd(width, height);
  return { width, height, ratioLabel: `${width / g}:${height / g}` };
}

export default function RankingPanel({
  rollups,
  sdModels,
  onApplyRecipe,
  topN = 10,
}: RankingPanelProps) {
  const ranked = rankRecipes(rollups, topN);

  if (ranked.length === 0) {
    return (
      <div
        style={{
          padding: '32px 16px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 14,
        }}
      >
        {t.ranking.emptyState}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 4px' }}>
      {ranked.map((recipe, i) => (
        <RankingRow
          key={recipe.hash}
          recipe={recipe}
          rank={i}
          sdModels={sdModels}
          onApply={onApplyRecipe}
        />
      ))}
    </div>
  );
}

function formatHiresDetail(p: RankedRecipe['params']): string {
  // Concatenate whichever hires fields are populated. Recipes migrated from
  // pre-ADR-24 records may have zeros here, so blanks are elided rather than
  // shown as "0x" / "0 steps".
  const parts: string[] = [];
  if (p.hiresUpscaler) parts.push(p.hiresUpscaler);
  if (p.hiresScale) parts.push(`${p.hiresScale}x`);
  if (p.hiresSteps) parts.push(`${p.hiresSteps} steps`);
  if (p.hiresDenoising) parts.push(`denoise ${p.hiresDenoising}`);
  return parts.join(' · ');
}

function RankingRow({
  recipe,
  rank,
  sdModels,
  onApply,
}: {
  recipe: RankedRecipe;
  rank: number;
  sdModels: SdModel[];
  onApply: (recipe: RankedRecipe) => void;
}) {
  const badge = RANK_EMOJI[rank] ?? `${rank + 1}`;
  const { params } = recipe;
  // meta line no longer carries size — the dedicated size block below takes over.
  const metaParts = [params.sampler, params.scheduler].filter(Boolean);
  if (params.steps) metaParts.push(`${t.lightbox.infoPanel.steps} ${params.steps}`);
  if (params.cfg) metaParts.push(`${t.lightbox.infoPanel.cfg} ${params.cfg}`);
  const metaLine = metaParts.join(' · ');
  const hiresDetail = params.hires ? formatHiresDetail(params) : '';
  const loraLabel = params.loras
    .map((l) => `${l.name} (${l.weight})`)
    .join(', ');
  const sizeInfo = parseSize(params.size);
  // Resolve the recipe's architecture against the currently-loaded checkpoint
  // list. Returns null for blank model names; falls back to the "xl"-in-title
  // heuristic when the model isn't in `sdModels` (e.g. SD disconnected or the
  // checkpoint was renamed). No chip renders when arch is null.
  const arch = inferSdArchitectureFromTitle(params.model, sdModels);
  const archLabel = arch === 'sdxl' ? 'SDXL' : arch === 'sd15' ? 'SD1.5' : null;

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: 12,
        border: '1px solid var(--panel-border)',
        borderRadius: 12,
        background: 'var(--panel-bg-sunk)',
      }}
    >
      <div style={{ fontSize: 20, minWidth: 32, textAlign: 'center' }}>{badge}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header row: fav count on the left, Apply button on the right. Sharing
            the row lets model name and info below use the full column width. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--pop-blue)', fontWeight: 700 }}>
            ⭐ {t.ranking.favCountLabel(recipe.favs)}
          </span>
          <button
            type="button"
            onClick={() => onApply(recipe)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              background: 'var(--pop-blue)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {t.ranking.applyToForm}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          {archLabel && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 0.3,
                padding: '2px 6px',
                borderRadius: 6,
                background: arch === 'sdxl' ? 'var(--pop-blue)' : 'var(--text-muted)',
                color: '#fff',
                flexShrink: 0,
              }}
            >
              {archLabel}
            </span>
          )}
          <span style={{ fontSize: 13, wordBreak: 'break-all', color: 'var(--text-primary)' }}>
            {params.model || t.caption.unknownModel}
          </span>
        </div>
        {sizeInfo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>
            <AspectRatioRect width={sizeInfo.width} height={sizeInfo.height} />
            <span>{sizeInfo.ratioLabel}</span>
            <span>·</span>
            <span>{sizeInfo.width}×{sizeInfo.height}</span>
          </div>
        )}
        {metaLine && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
            {metaLine}
          </div>
        )}
        {params.hires && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-all' }}>
            {t.lightbox.infoPanel.hires}
            {hiresDetail && `: ${hiresDetail}`}
          </div>
        )}
        {params.loras.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-all' }}>
            {t.lightbox.infoPanel.lora}: {loraLabel}
          </div>
        )}
        {(params.refiner || params.vae) && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-all' }}>
            {params.refiner && (
              <>
                {t.lightbox.infoPanel.refiner}: {params.refiner}
                {params.refinerSwitchAt ? ` @${params.refinerSwitchAt}` : ''}
              </>
            )}
            {params.refiner && params.vae && ' · '}
            {params.vae && `${t.lightbox.infoPanel.vae}: ${params.vae}`}
          </div>
        )}
      </div>
    </div>
  );
}
