import { rankRecipes, type RankingRollup, type RankedRecipe } from '../utils/rankingAnalysis';
import { t } from '../i18n';
import type { SdModel } from './presets';

// Presentational-only Top-N favorite-recipe ranking list. Consumes the raw
// rollup counters and runs them through `rankRecipes` (Wilson-lower-bound
// sort) itself, so the parent only has to supply the rollup data and an
// apply-to-form callback. `sdModels` is accepted (but currently unused) so
// the prop surface is stable if a future revision wants to resolve/display
// friendly model names instead of raw checkpoint filenames.
export interface RankingPanelProps {
  rollups: RankingRollup[];
  sdModels: SdModel[];
  onApplyRecipe: (recipe: RankedRecipe) => void;
  minSample?: number;
  topN?: number;
}

const RANK_EMOJI = ['🥇', '🥈', '🥉'];

export default function RankingPanel({
  rollups,
  onApplyRecipe,
  minSample = 3,
  topN = 10,
}: RankingPanelProps) {
  const ranked = rankRecipes(rollups, minSample, topN);

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
        <RankingRow key={recipe.hash} recipe={recipe} rank={i} onApply={onApplyRecipe} />
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
  onApply,
}: {
  recipe: RankedRecipe;
  rank: number;
  onApply: (recipe: RankedRecipe) => void;
}) {
  const badge = RANK_EMOJI[rank] ?? `${rank + 1}`;
  const { params } = recipe;
  const metaParts = [params.sampler, params.scheduler, params.size].filter(Boolean);
  if (params.steps) metaParts.push(`${t.lightbox.infoPanel.steps} ${params.steps}`);
  if (params.cfg) metaParts.push(`${t.lightbox.infoPanel.cfg} ${params.cfg}`);
  const metaLine = metaParts.join(' · ');
  const hiresDetail = params.hires ? formatHiresDetail(params) : '';
  const loraLabel = params.loras
    .map((l) => `${l.name} (${l.weight})`)
    .join(', ');

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
        <div style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: 'var(--pop-blue)' }}>
            {t.ranking.headerWilson} {(recipe.wilson * 100).toFixed(1)}%
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {t.ranking.headerRate} {(recipe.rate * 100).toFixed(1)}%
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            ({t.ranking.favsShort(recipe.favs, recipe.total)})
          </span>
        </div>
        <div style={{ fontSize: 13, wordBreak: 'break-all', marginBottom: 4, color: 'var(--text-primary)' }}>
          {params.model || t.caption.unknownModel}
        </div>
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
          alignSelf: 'center',
          flexShrink: 0,
        }}
      >
        {t.ranking.applyToForm}
      </button>
    </div>
  );
}
