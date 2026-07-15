import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RankingPanel from './RankingPanel';
import type { RankingRollup, RankedRecipe } from '../utils/rankingAnalysis';
import type { SdModel } from './presets';
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
    render(<RankingPanel rollups={[]} sdModels={[]} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} />);
    expect(screen.getByText(t.ranking.emptyState)).toBeInTheDocument();
  });

  it('renders the empty state when every rollup has zero favorites', () => {
    const rollups = [rollup('a', 5, 0), rollup('b', 10, 0)];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} />);
    expect(screen.getByText(t.ranking.emptyState)).toBeInTheDocument();
    expect(screen.queryByText('a')).not.toBeInTheDocument();
    expect(screen.queryByText('b')).not.toBeInTheDocument();
  });

  it('renders qualifying recipes sorted by absolute favorite count (descending)', () => {
    // ADR 35: absolute favs count is the source of truth for "recipe quality",
    // regardless of total attempts.
    const rollups = [rollup('many-attempts', 100, 2), rollup('few-attempts', 3, 3)];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} />);

    const rows = screen.getAllByText(/^few-attempts$|^many-attempts$/);
    expect(rows.map((el) => el.textContent)).toEqual(['few-attempts', 'many-attempts']);
  });

  it('caps the rendered list at topN', () => {
    const rollups = Array.from({ length: 15 }, (_, i) => rollup(`r${i}`, 5, i + 1));
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} topN={10} />);
    expect(screen.getAllByRole('button', { name: t.ranking.applyToForm })).toHaveLength(10);
  });

  it('renders the favorite count for a row', () => {
    const rollups = [rollup('solo', 4, 2)];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} />);
    expect(screen.getByText(`⭐ ${t.ranking.favCountLabel(2)}`)).toBeInTheDocument();
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
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} />);
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
    // Use a non-empty hash so the recipe survives the filter, but override
    // params.model to '' via the overrides object.
    const rollups = [rollup('h', 5, 3, { model: '' })];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} />);
    expect(screen.getByText(t.caption.unknownModel)).toBeInTheDocument();
  });

  it('shows an SDXL chip when the recipe model resolves to an SDXL checkpoint', () => {
    const sdModels: SdModel[] = [{ title: 'coolSDXL.safetensors [abc]', type: 'sdxl' }];
    const rollups = [rollup('h', 5, 3, { model: 'coolSDXL.safetensors' })];
    render(<RankingPanel rollups={rollups} sdModels={sdModels} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} />);
    expect(screen.getByText('SDXL')).toBeInTheDocument();
    expect(screen.queryByText('SD1.5')).not.toBeInTheDocument();
  });

  it('shows an SD1.5 chip when the recipe model resolves to an SD1.5 checkpoint', () => {
    const sdModels: SdModel[] = [{ title: 'plainSD.safetensors [xyz]', type: 'sd15' }];
    const rollups = [rollup('h', 5, 3, { model: 'plainSD.safetensors' })];
    render(<RankingPanel rollups={rollups} sdModels={sdModels} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} />);
    expect(screen.getByText('SD1.5')).toBeInTheDocument();
    expect(screen.queryByText('SDXL')).not.toBeInTheDocument();
  });

  it('omits the arch chip when the model name is blank', () => {
    const rollups = [rollup('h', 5, 3, { model: '' })];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} />);
    expect(screen.queryByText('SDXL')).not.toBeInTheDocument();
    expect(screen.queryByText('SD1.5')).not.toBeInTheDocument();
  });

  it('falls back to the "xl"-in-name heuristic when the model is not in sdModels', () => {
    // No matching entry in sdModels — inferSdArchitectureFromTitle should
    // still infer SDXL from the "xl" substring rather than dropping the chip.
    const rollups = [rollup('h', 5, 3, { model: 'someXLCheckpoint.safetensors' })];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={vi.fn()} onApplyRecipeToGalleryFilter={vi.fn()} />);
    expect(screen.getByText('SDXL')).toBeInTheDocument();
  });

  it('calls onApplyRecipe with the full recipe when Apply is clicked', async () => {
    const user = userEvent.setup();
    const onApplyRecipe = vi.fn();
    const rollups = [rollup('only-one', 5, 4)];
    render(<RankingPanel rollups={rollups} sdModels={[]} onApplyRecipe={onApplyRecipe} onApplyRecipeToGalleryFilter={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: t.ranking.applyToForm }));

    expect(onApplyRecipe).toHaveBeenCalledTimes(1);
    const passed = onApplyRecipe.mock.calls[0][0] as RankedRecipe;
    expect(passed.hash).toBe('only-one');
    expect(passed.total).toBe(5);
    expect(passed.favs).toBe(4);
    expect(passed.params.model).toBe('only-one');
  });
});
