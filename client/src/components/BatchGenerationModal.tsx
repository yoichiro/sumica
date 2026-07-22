import { type Dispatch, type SetStateAction } from 'react';
import { Layers, X, CheckCircle2, Circle } from 'lucide-react';
import { t } from '../i18n';
import {
  SDXL_PRESETS,
  SDXL_SIZES,
  SD15_PRESETS,
  FLUX_PRESETS,
  FLUX_SIZES,
  resolveSdxlDimensions,
  resolveSd15Dimensions,
  resolveFluxDimensions,
  getArchLabel,
  type SdxlRatio,
  type SdxlSize,
  type Sd15Ratio,
  type SdModel,
  type Architecture,
  type FluxRatio,
  type FluxSize,
  type SdxlOrientation,
} from './presets';

export type BatchMode = 'count' | 'size' | 'model';

// One BatchJob = one call to the single-image /api/generate endpoint. `model`
// overrides the form's selectedModel for that job (model-cycling mode); when
// absent, the job uses the form's selectedModel. Kept identical to the App-side
// definition so both sides can round-trip.
export interface BatchJob {
  width: number;
  height: number;
  model?: string;
}

interface BatchGenerationModalProps {
  open: boolean;
  onClose: () => void;
  modelTypeFilter: Architecture;
  sdModels: SdModel[];
  width: number;
  height: number;

  batchMode: BatchMode;
  setBatchMode: (mode: BatchMode) => void;

  batchCount: number;
  setBatchCount: (n: number) => void;

  selectedBatchRatios: Set<SdxlRatio>;
  setSelectedBatchRatios: Dispatch<SetStateAction<Set<SdxlRatio>>>;
  selectedBatchOrientations: Set<'landscape' | 'portrait'>;
  setSelectedBatchOrientations: Dispatch<SetStateAction<Set<'landscape' | 'portrait'>>>;
  selectedBatchSizes: Set<SdxlSize>;
  setSelectedBatchSizes: Dispatch<SetStateAction<Set<SdxlSize>>>;

  selectedSd15BatchRatios: Set<Sd15Ratio>;
  setSelectedSd15BatchRatios: Dispatch<SetStateAction<Set<Sd15Ratio>>>;
  selectedSd15BatchOrientations: Set<'landscape' | 'portrait'>;
  setSelectedSd15BatchOrientations: Dispatch<SetStateAction<Set<'landscape' | 'portrait'>>>;
  selectedSd15BatchSizes: Set<SdxlSize>;
  setSelectedSd15BatchSizes: Dispatch<SetStateAction<Set<SdxlSize>>>;

  selectedFluxBatchRatios: Set<FluxRatio>;
  setSelectedFluxBatchRatios: Dispatch<SetStateAction<Set<FluxRatio>>>;
  selectedFluxBatchOrientations: Set<SdxlOrientation>;
  setSelectedFluxBatchOrientations: Dispatch<SetStateAction<Set<SdxlOrientation>>>;
  selectedFluxBatchSizes: Set<FluxSize>;
  setSelectedFluxBatchSizes: Dispatch<SetStateAction<Set<FluxSize>>>;

  selectedBatchModels: Set<string>;
  setSelectedBatchModels: Dispatch<SetStateAction<Set<string>>>;
  toggleBatchModel: (name: string) => void;

  onStartBatch: (jobs: BatchJob[]) => void;
}

function toggleInSet<T>(setter: Dispatch<SetStateAction<Set<T>>>, value: T) {
  setter(prev => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });
}

export function BatchGenerationModal(props: BatchGenerationModalProps) {
  const {
    open, onClose, modelTypeFilter, sdModels, width, height,
    batchMode, setBatchMode,
    batchCount, setBatchCount,
    selectedBatchRatios, setSelectedBatchRatios,
    selectedBatchOrientations, setSelectedBatchOrientations,
    selectedBatchSizes, setSelectedBatchSizes,
    selectedSd15BatchRatios, setSelectedSd15BatchRatios,
    selectedSd15BatchOrientations, setSelectedSd15BatchOrientations,
    selectedSd15BatchSizes, setSelectedSd15BatchSizes,
    selectedFluxBatchRatios, setSelectedFluxBatchRatios,
    selectedFluxBatchOrientations, setSelectedFluxBatchOrientations,
    selectedFluxBatchSizes, setSelectedFluxBatchSizes,
    selectedBatchModels, setSelectedBatchModels, toggleBatchModel,
    onStartBatch,
  } = props;

  if (!open) return null;

  // Build the SDXL batch job list from the current (ratios × orientations × sizes)
  // multi-selection. 1:1 collapses orientation (always 'square', one job per size);
  // non-square ratios cross-product landscape/portrait with each selected size.
  // Dedupes by (width, height) — SDXL_PRESETS is designed to avoid overlap but the
  // dedupe protects future preset edits from silently double-charging a slot.
  const buildSdxlBatchJobs = (): BatchJob[] => {
    const jobs: BatchJob[] = [];
    const seen = new Set<string>();
    const push = (dims: { width: number; height: number }) => {
      const key = `${dims.width}x${dims.height}`;
      if (seen.has(key)) return;
      seen.add(key);
      jobs.push({ width: dims.width, height: dims.height });
    };
    for (const ratio of selectedBatchRatios) {
      const preset = SDXL_PRESETS.find(p => p.ratio === ratio);
      if (!preset) continue;
      if (preset.isSquare) {
        for (const size of selectedBatchSizes) {
          push(resolveSdxlDimensions(preset, 'square', size));
        }
        continue;
      }
      for (const orient of selectedBatchOrientations) {
        for (const size of selectedBatchSizes) {
          push(resolveSdxlDimensions(preset, orient, size));
        }
      }
    }
    return jobs;
  };

  // Flux counterpart of buildSdxlBatchJobs. Flux presets have no ratio/size
  // "native bucket" hard requirement the way SDXL does, but the (ratio ×
  // orientation × size) cross-product shape is identical: 1:1 collapses
  // orientation (one job per selected size); non-square ratios cross-product
  // each selected orientation with each selected size.
  const buildFluxBatchJobs = (): BatchJob[] => {
    const jobs: BatchJob[] = [];
    const seen = new Set<string>();
    const push = (dims: { width: number; height: number }) => {
      const key = `${dims.width}x${dims.height}`;
      if (seen.has(key)) return;
      seen.add(key);
      jobs.push({ width: dims.width, height: dims.height });
    };
    for (const ratio of selectedFluxBatchRatios) {
      const preset = FLUX_PRESETS.find(p => p.ratio === ratio);
      if (!preset) continue;
      if (preset.isSquare) {
        for (const size of selectedFluxBatchSizes) {
          push(resolveFluxDimensions(preset, 'square', size));
        }
        continue;
      }
      for (const orient of selectedFluxBatchOrientations) {
        for (const size of selectedFluxBatchSizes) {
          push(resolveFluxDimensions(preset, orient, size));
        }
      }
    }
    return jobs;
  };

  // SD1.5 counterpart. 1:1 emits 1 job per selected size (S/M/L). Non-square
  // ratios only have an M spec, so they emit 1 job per selected orientation
  // regardless of what sizes are checked.
  const buildSd15BatchJobs = (): BatchJob[] => {
    const jobs: BatchJob[] = [];
    const seen = new Set<string>();
    const push = (dims: { width: number; height: number }) => {
      const key = `${dims.width}x${dims.height}`;
      if (seen.has(key)) return;
      seen.add(key);
      jobs.push({ width: dims.width, height: dims.height });
    };
    for (const ratio of selectedSd15BatchRatios) {
      const preset = SD15_PRESETS.find(p => p.ratio === ratio);
      if (!preset) continue;
      if (preset.isSquare) {
        for (const size of selectedSd15BatchSizes) {
          if (preset.sizes[size]) {
            push(resolveSd15Dimensions(preset, 'square', size));
          }
        }
        continue;
      }
      for (const orient of selectedSd15BatchOrientations) {
        push(resolveSd15Dimensions(preset, orient, 'M'));
      }
    }
    return jobs;
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 110,
      padding: '20px'
    }}>
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '420px',
          borderRadius: '20px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          textAlign: 'left',
          border: '2px solid var(--pop-blue)',
          background: 'var(--panel-bg)',
          // Paired with the batch button's `view-transition-name: batch-morph`
          // in ControlPanel: the button drops the name while the modal is up,
          // so the browser interpolates the button rect → this modal rect on
          // open (and reverses on close). Wrapped in `document.startViewTransition`
          // by openBatchModal / closeBatchModal in App.tsx.
          viewTransitionName: 'batch-morph',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <Layers color="var(--pop-blue)" size={20} />
            <span>{t.batchModal.title}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Segmented mode tabs. Switching the tab changes which form fields
            render, which in turn changes the modal's height. Wrap the state
            update in a View Transition so the same-name `batch-morph`
            element (the outer modal panel) is size-interpolated by the
            browser instead of jump-cutting between two heights. */}
        <div style={{ display: 'flex', gap: '8px', background: 'var(--panel-bg-sunk)', borderRadius: '12px', padding: '4px' }}>
          {([['count', t.batchModal.tabCount], ['size', t.batchModal.tabSize], ['model', t.batchModal.tabModel]] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                if (batchMode === mode) return; // no-op click on the already-active tab
                const apply = () => setBatchMode(mode);
                const start = (document as unknown as { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
                if (typeof start === 'function') start.call(document, apply);
                else apply();
              }}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '9px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 800,
                fontSize: '13px',
                background: batchMode === mode ? 'var(--pop-blue)' : 'transparent',
                color: batchMode === mode ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {batchMode === 'count' ? (
          <>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
              {t.batchModal.countDescription}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '40px', fontWeight: 800, color: 'var(--pop-blue)', lineHeight: 1 }}>
                {batchCount}<span style={{ fontSize: '16px', color: 'var(--text-secondary)', marginLeft: '4px' }}>{t.batchModal.countUnitLabel}</span>
              </span>
              <input
                type="range"
                min={2}
                max={10}
                step={1}
                value={batchCount}
                onChange={(e) => setBatchCount(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>{t.batchModal.countRangeLabel(2)}</span>
                <span>{t.batchModal.countRangeLabel(10)}</span>
              </div>
            </div>
          </>
        ) : batchMode === 'size' ? (
          modelTypeFilter === 'sdxl' ? (() => {
            const sdxlJobs = buildSdxlBatchJobs();
            return (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                  {t.batchModal.sizeSdxlDescription}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{t.controlPanel.aspectRatioLabel}:</span>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {SDXL_PRESETS.map((preset) => {
                        const active = selectedBatchRatios.has(preset.ratio);
                        return (
                          <button
                            key={preset.ratio}
                            type="button"
                            onClick={() => toggleInSet(setSelectedBatchRatios, preset.ratio)}
                            className="scale-hover"
                            style={{
                              padding: '8px 12px',
                              borderRadius: '10px',
                              border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                              background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                              color: active ? '#fff' : 'var(--text-secondary)',
                              fontWeight: 800,
                              cursor: 'pointer',
                              fontSize: '13px',
                            }}
                            title={preset.ratioIsBucket ? t.controlPanel.sdxlNativeRatioTitle : ''}
                          >
                            {preset.label}{preset.ratioIsBucket ? ' ⭐' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{t.controlPanel.orientationLabel}:</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(['landscape', 'portrait'] as const).map((o) => {
                        const active = selectedBatchOrientations.has(o);
                        return (
                          <button
                            key={o}
                            type="button"
                            onClick={() => toggleInSet(setSelectedBatchOrientations, o)}
                            className="scale-hover"
                            style={{
                              flex: 1,
                              padding: '10px',
                              borderRadius: '10px',
                              border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                              background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                              color: active ? '#fff' : 'var(--text-secondary)',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            {o === 'landscape' ? t.controlPanel.orientationLandscape : t.controlPanel.orientationPortrait}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{t.controlPanel.sizeLabel}:</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {SDXL_SIZES.map((s) => {
                        const active = selectedBatchSizes.has(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleInSet(setSelectedBatchSizes, s)}
                            className="scale-hover"
                            style={{
                              flex: 1,
                              padding: '10px',
                              borderRadius: '10px',
                              border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                              background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                              color: active ? '#fff' : 'var(--text-secondary)',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', color: 'var(--pop-blue)' }}>
                    {t.batchModal.jobCountLabel(sdxlJobs.length)}
                  </div>
                </div>
              </>
            );
          })() : modelTypeFilter === 'flux' ? (() => {
            const fluxJobs = buildFluxBatchJobs();
            return (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                  {t.batchModal.sizeFluxDescription}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{t.controlPanel.aspectRatioLabel}:</span>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {FLUX_PRESETS.map((preset) => {
                        const active = selectedFluxBatchRatios.has(preset.ratio);
                        return (
                          <button
                            key={preset.ratio}
                            type="button"
                            onClick={() => toggleInSet(setSelectedFluxBatchRatios, preset.ratio)}
                            className="scale-hover"
                            style={{
                              padding: '8px 12px',
                              borderRadius: '10px',
                              border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                              background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                              color: active ? '#fff' : 'var(--text-secondary)',
                              fontWeight: 800,
                              cursor: 'pointer',
                              fontSize: '13px',
                            }}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{t.controlPanel.orientationLabel}:</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(['landscape', 'portrait'] as const).map((o) => {
                        const active = selectedFluxBatchOrientations.has(o);
                        return (
                          <button
                            key={o}
                            type="button"
                            onClick={() => toggleInSet<SdxlOrientation>(setSelectedFluxBatchOrientations, o)}
                            className="scale-hover"
                            style={{
                              flex: 1,
                              padding: '10px',
                              borderRadius: '10px',
                              border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                              background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                              color: active ? '#fff' : 'var(--text-secondary)',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            {o === 'landscape' ? t.controlPanel.orientationLandscape : t.controlPanel.orientationPortrait}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{t.controlPanel.sizeLabel}:</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {FLUX_SIZES.map((s) => {
                        const active = selectedFluxBatchSizes.has(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleInSet(setSelectedFluxBatchSizes, s)}
                            className="scale-hover"
                            style={{
                              flex: 1,
                              padding: '10px',
                              borderRadius: '10px',
                              border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                              background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                              color: active ? '#fff' : 'var(--text-secondary)',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', color: 'var(--pop-blue)' }}>
                    {t.batchModal.jobCountLabel(fluxJobs.length)}
                  </div>
                </div>
              </>
            );
          })() : (() => {
            const sd15Jobs = buildSd15BatchJobs();
            return (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                  {t.batchModal.sizeSd15Description}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{t.controlPanel.aspectRatioLabel}:</span>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {SD15_PRESETS.map((preset) => {
                        const active = selectedSd15BatchRatios.has(preset.ratio);
                        return (
                          <button
                            key={preset.ratio}
                            type="button"
                            onClick={() => toggleInSet(setSelectedSd15BatchRatios, preset.ratio)}
                            className="scale-hover"
                            style={{
                              padding: '8px 12px',
                              borderRadius: '10px',
                              border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                              background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                              color: active ? '#fff' : 'var(--text-secondary)',
                              fontWeight: 800,
                              cursor: 'pointer',
                              fontSize: '13px',
                            }}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{t.controlPanel.orientationLabel}:</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(['landscape', 'portrait'] as const).map((o) => {
                        const active = selectedSd15BatchOrientations.has(o);
                        return (
                          <button
                            key={o}
                            type="button"
                            onClick={() => toggleInSet(setSelectedSd15BatchOrientations, o)}
                            className="scale-hover"
                            style={{
                              flex: 1,
                              padding: '10px',
                              borderRadius: '10px',
                              border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                              background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                              color: active ? '#fff' : 'var(--text-secondary)',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            {o === 'landscape' ? t.controlPanel.orientationLandscape : t.controlPanel.orientationPortrait}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{t.batchModal.sd15SizeLabel}</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {SDXL_SIZES.map((s) => {
                        const active = selectedSd15BatchSizes.has(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleInSet(setSelectedSd15BatchSizes, s)}
                            className="scale-hover"
                            style={{
                              flex: 1,
                              padding: '10px',
                              borderRadius: '10px',
                              border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                              background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                              color: active ? '#fff' : 'var(--text-secondary)',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', color: 'var(--pop-blue)' }}>
                    {t.batchModal.jobCountLabel(sd15Jobs.length)}
                  </div>
                </div>
              </>
            );
          })()
        ) : (
          <>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
              {t.batchModal.modelDescription(width, height)}
            </p>
            {(() => { const modelsInBatchScope = sdModels.filter((m) => m.type === modelTypeFilter); return modelsInBatchScope.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '40px', fontWeight: 800, color: 'var(--pop-blue)', lineHeight: 1 }}>
                    {selectedBatchModels.size}<span style={{ fontSize: '16px', color: 'var(--text-secondary)', marginLeft: '4px' }}>{t.batchModal.modelCountSuffix(modelsInBatchScope.length)}</span>
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedBatchModels(new Set(modelsInBatchScope.map((m) => m.title)))}
                    className="scale-hover"
                    style={{ padding: '4px 12px', borderRadius: '8px', border: '1px solid var(--pop-blue)', background: 'var(--panel-bg)', color: 'var(--pop-blue)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {t.gallery.selectAll}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedBatchModels(new Set())}
                    className="scale-hover"
                    style={{ padding: '4px 12px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {t.gallery.selectNone}
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto', background: 'var(--panel-bg-sunk)', borderRadius: '10px', padding: '8px' }}>
                  {modelsInBatchScope.map((m, i) => {
                    const isSelected = selectedBatchModels.has(m.title);
                    return (
                      <button
                        key={m.title}
                        type="button"
                        onClick={() => toggleBatchModel(m.title)}
                        className="scale-hover"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 8px',
                          borderRadius: '8px',
                          border: 'none',
                          background: isSelected ? 'rgba(51, 154, 240, 0.12)' : 'transparent',
                          color: isSelected ? 'var(--pop-blue)' : 'var(--text-secondary)',
                          fontSize: '12px',
                          fontWeight: isSelected ? 700 : 500,
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                        }}
                      >
                        {isSelected ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                        <span style={{ color: 'var(--text-muted)', fontWeight: 700, minWidth: '20px', flexShrink: 0 }}>{i + 1}.</span>
                        <span style={{ wordBreak: 'break-all', flex: 1 }}>{m.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', color: 'var(--pop-orange)', background: 'var(--warning-bg)', borderRadius: '10px', padding: '14px' }}>
                {sdModels.length === 0
                  ? t.batchModal.noModelsFetched
                  : t.batchModal.noModelsOfType(getArchLabel(modelTypeFilter))}
              </div>
            ); })()}
          </>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            onClick={onClose}
            className="scale-hover"
            style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-secondary)', fontWeight: '800', cursor: 'pointer' }}
          >
            {t.batchModal.cancelButton}
          </button>
          {(() => {
            const sizeJobs = batchMode === 'size'
              ? (modelTypeFilter === 'flux' ? buildFluxBatchJobs()
                 : modelTypeFilter === 'sdxl' ? buildSdxlBatchJobs()
                 : buildSd15BatchJobs())
              : [];
            const sizeModeInvalid = sizeJobs.length === 0;
            return (
              <button
                type="button"
                disabled={
                  (batchMode === 'size' && sizeModeInvalid) ||
                  (batchMode === 'model' && (sdModels.filter((m) => m.type === modelTypeFilter).length === 0 || selectedBatchModels.size === 0))
                }
                onClick={() => {
                  const jobs: BatchJob[] = batchMode === 'count'
                    ? Array(batchCount).fill({ width, height })
                    : batchMode === 'size'
                      ? sizeJobs
                      : sdModels.filter(m => selectedBatchModels.has(m.title)).map(m => ({ width, height, model: m.title }));
                  onStartBatch(jobs);
                }}
                className="btn-neon"
                style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: '800', cursor: 'pointer' }}
              >
                {batchMode === 'count'
                  ? t.batchModal.generateCountButton(batchCount)
                  : batchMode === 'size'
                    ? t.batchModal.generateSizeButton(sizeJobs.length)
                    : t.batchModal.generateModelButton(selectedBatchModels.size)}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
