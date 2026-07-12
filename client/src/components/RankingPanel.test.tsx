import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RankingPanel from './RankingPanel';
import type { RankingRollup, RankedRecipe } from '../utils/rankingAnalysis';
import { t } from '../i18n';

const BASE_PARAMS = {
  model: 'm',
  sampler: '',
  scheduler: '',
  size: '',
  steps: 0,
  cfg: 0,
  hires: false,
  hiresUpscaler: '',
  hiresScale: 0,
  hiresSteps: 0,
  hiresDenoising: 0,
  loras: [] as { name: string; weight: number }[],
  refiner: '',
  refinerSwitchAt: 0,
  vae: '',
};

function rollup(hash: string, total: number, favs: number, overrides: Partial<RankingRollup['params']> = {}): RankingRollup {
  return {
    hash,
    params: { ...BASE_PARAMS, model: hash, ...overrides },
    total,
    favs,
    updatedAt: 0,
  };
}

describe('RankingPanel', () => {
  it('renders the empty state when there are no rollups', () => {
    render(<RankingPanel rollups={[]} sdModels={[]} onApplyRecipe={vi.fn()} />);
    expect(screen.getByText(t.ranking.emptyState)).toBeInTheDocument();
  });

  it('renders the empty state (gracefully filtered) when every rollup is below minSample', () => {
    const rollups = [rollup('a', 1, 1), rollup('b', 2, 2)];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} minSample={3} />);
    expect(screen.getByText(t.ranking.emptyState)).toBeInTheDocument();
    // Neither under-threshold recipe should have rendered a row.
    expect(screen.queryByText('a')).not.toBeInTheDocument();
    expect(screen.queryByText('b')).not.toBeInTheDocument();
  });

  it('renders qualifying recipes sorted by Wilson lower bound (descending)', () => {
    // 'weak': 5 favs / 10 total (wilson ~0.237); 'strong': 20/25 (wilson ~0.61)
    const rollups = [rollup('weak', 10, 5), rollup('strong', 25, 20)];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} minSample={3} />);

    const rows = screen.getAllByText(/^strong$|^weak$/);
    expect(rows.map((el) => el.textContent)).toEqual(['strong', 'weak']);
  });

  it('caps the rendered list at topN', () => {
    const rollups = Array.from({ length: 15 }, (_, i) => rollup(`r${i}`, 5, i % 5));
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} minSample={3} topN={10} />);
    expect(screen.getAllByRole('button', { name: t.ranking.applyToForm })).toHaveLength(10);
  });

  it('renders the favorite count for a row (no Wilson/Rate percentages)', () => {
    const rollups = [rollup('solo', 4, 2)];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} minSample={3} />);
    expect(screen.getByText(`⭐ ${t.ranking.favCountLabel(2)}`)).toBeInTheDocument();
    // Wilson / Rate percentages are intentionally removed from the header.
    expect(screen.queryByText(new RegExp(t.ranking.headerWilson))).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(t.ranking.headerRate))).not.toBeInTheDocument();
  });

  it('renders a compact, readable description of the recipe params', () => {
    const rollups = [
      rollup('checkpointA', 5, 3, {
        sampler: 'DPM++ 2M',
        scheduler: 'Karras',
        size: '1024x1024',
        steps: 25,
        cfg: 7,
        hires: true,
        hiresUpscaler: 'Latent',
        hiresScale: 2,
        hiresSteps: 15,
        hiresDenoising: 0.5,
        loras: [
          { name: 'loraOne', weight: 0.7 },
          { name: 'loraTwo', weight: 0.9 },
        ],
        refiner: 'refinerX',
        refinerSwitchAt: 0.8,
        vae: 'vaeY',
      }),
    ];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} minSample={3} />);
    expect(screen.getByText('checkpointA')).toBeInTheDocument();
    // meta line no longer contains the size — sampler/scheduler/steps/cfg only.
    expect(
      screen.getByText(
        `DPM++ 2M · Karras · ${t.lightbox.infoPanel.steps} 25 · ${t.lightbox.infoPanel.cfg} 7`,
      ),
    ).toBeInTheDocument();
    // The dedicated size block shows the ratio (1024:1024 → 1:1) and pixels.
    expect(screen.getByText('1:1')).toBeInTheDocument();
    expect(screen.getByText('1024×1024')).toBeInTheDocument();
    expect(
      screen.getByText(`${t.lightbox.infoPanel.hires}: Latent · 2x · 15 steps · denoise 0.5`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${t.lightbox.infoPanel.lora}: loraOne (0.7), loraTwo (0.9)`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${t.lightbox.infoPanel.refiner}: refinerX @0.8 · ${t.lightbox.infoPanel.vae}: vaeY`,
      ),
    ).toBeInTheDocument();
  });

  it('falls back to the unknown-model label when model is blank', () => {
    const rollups = [rollup('', 5, 3)];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} minSample={3} />);
    expect(screen.getByText(t.caption.unknownModel)).toBeInTheDocument();
  });

  it('calls onApplyRecipe with the full recipe (including params) when Apply is clicked', async () => {
    const user = userEvent.setup();
    const onApplyRecipe = vi.fn();
    const rollups = [rollup('only-one', 5, 4)];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={onApplyRecipe} minSample={3} />);

    await user.click(screen.getByRole('button', { name: t.ranking.applyToForm }));

    expect(onApplyRecipe).toHaveBeenCalledTimes(1);
    const passed = onApplyRecipe.mock.calls[0][0] as RankedRecipe;
    expect(passed.hash).toBe('only-one');
    expect(passed.total).toBe(5);
    expect(passed.favs).toBe(4);
    expect(passed.params.model).toBe('only-one');
    expect(passed.rate).toBeCloseTo(0.8);
    expect(typeof passed.wilson).toBe('number');
  });
});
