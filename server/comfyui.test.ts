import { describe, it, expect } from 'vitest';
import { clampSeed, mutateWorkflow, SEED_MAX, type MutateArgs, type WorkflowJson } from './comfyui.js';
import { promises as fs } from 'fs';
import path from 'path';

describe('clampSeed', () => {
  it('passes through positive seeds already under SEED_MAX', () => {
    expect(clampSeed(0)).toBe(0);
    expect(clampSeed(42)).toBe(42);
    expect(clampSeed(999_888_777)).toBe(999_888_777);
    expect(clampSeed(SEED_MAX)).toBe(SEED_MAX);
  });

  it('modulo-reduces seeds larger than SEED_MAX', () => {
    // The over-flow example from the earlier ComfyUI dry run (seed error at 1.138e18)
    const overflow = 1138015119000763924;
    const clamped = clampSeed(overflow);
    expect(clamped).toBeGreaterThanOrEqual(0);
    expect(clamped).toBeLessThanOrEqual(SEED_MAX);
  });

  it('floors non-integer seeds', () => {
    expect(clampSeed(42.9)).toBe(42);
    expect(clampSeed(42.1)).toBe(42);
  });

  it('turns negative seeds into positives via abs', () => {
    expect(clampSeed(-42)).toBe(42);
    expect(clampSeed(-999_888_777)).toBe(999_888_777);
  });
});

describe('mutateWorkflow', () => {
  // Load the bundled workflow once for all tests; each test then mutates a fresh
  // deep clone via mutateWorkflow's own clone (mutateWorkflow must not mutate its input).
  const loadWorkflow = async (): Promise<WorkflowJson> => {
    const p = path.join(__dirname, 'workflows', 'i2v.json');
    return JSON.parse(await fs.readFile(p, 'utf-8'));
  };

  const baseArgs: MutateArgs = {
    sourceImageFilename: 'test_source.png',
    positivePrompt: 'She smiles softly.',
    negativePrompt: 'still image, watermark',
    width: 1024,
    height: 1088,
    length: 240,
    fidelity: 1.0,
    motion: 35,
    identity: 1.0,
    seed: 12345,
  };

  it('substitutes the main input image (node 837) and leaves reference (node 923) at its workflow default', async () => {
    const wf = await loadWorkflow();
    const referenceBefore = wf['923'].inputs.image;
    const out = mutateWorkflow(wf, baseArgs);
    expect(out['837'].inputs.image).toBe('test_source.png');
    expect(out['923'].inputs.image).toBe(referenceBefore);
  });

  it('writes both Xi and Xf on each mxSlider so the value takes effect', async () => {
    const wf = await loadWorkflow();
    const out = mutateWorkflow(wf, baseArgs);
    // Width (791), Height (792), Length (796), Fidelity (797), Motion (915), Identity (941)
    expect(out['791'].inputs.Xi).toBe(1024);
    expect(out['791'].inputs.Xf).toBe(1024);
    expect(out['792'].inputs.Xi).toBe(1088);
    expect(out['792'].inputs.Xf).toBe(1088);
    expect(out['796'].inputs.Xi).toBe(240);
    expect(out['796'].inputs.Xf).toBe(240);
    expect(out['797'].inputs.Xi).toBe(1.0);
    expect(out['797'].inputs.Xf).toBe(1.0);
    expect(out['915'].inputs.Xi).toBe(35);
    expect(out['915'].inputs.Xf).toBe(35);
    expect(out['941'].inputs.Xi).toBe(1.0);
    expect(out['941'].inputs.Xf).toBe(1.0);
  });

  it('substitutes positive (536) and negative (537) prompts', async () => {
    const wf = await loadWorkflow();
    const out = mutateWorkflow(wf, baseArgs);
    expect(out['536'].inputs.text).toBe('She smiles softly.');
    expect(out['537'].inputs.text).toBe('still image, watermark');
  });

  it('clamps the seed and writes it to node 524', async () => {
    const wf = await loadWorkflow();
    const out = mutateWorkflow(wf, { ...baseArgs, seed: 999999999999999999 });
    const written = out['524'].inputs.seed;
    expect(typeof written).toBe('number');
    expect(written).toBeGreaterThanOrEqual(0);
    expect(written).toBeLessThanOrEqual(SEED_MAX);
  });

  it('sets save_output=false on the final VHS_VideoCombine node 597 so ComfyUI writes to temp/', async () => {
    const wf = await loadWorkflow();
    const out = mutateWorkflow(wf, baseArgs);
    expect(out['597'].inputs.save_output).toBe(false);
  });

  it('does not mutate the input workflow', async () => {
    const wf = await loadWorkflow();
    const originalImage = wf['837'].inputs.image;
    const originalSeed = wf['524'].inputs.seed;
    mutateWorkflow(wf, baseArgs);
    expect(wf['837'].inputs.image).toBe(originalImage);
    expect(wf['524'].inputs.seed).toBe(originalSeed);
  });
});
