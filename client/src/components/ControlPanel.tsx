import type { Dispatch, SetStateAction, FormEvent } from 'react';
import { Sparkles, RotateCw, Layers, X } from 'lucide-react';
import { t } from '../i18n';
import {
  SDXL_PRESETS,
  SDXL_SIZES,
  SD15_PRESETS,
  type SdxlRatio,
  type SdxlSize,
  type SdxlOrientation,
  type Sd15Ratio,
  type SdModel,
  type SdLora,
} from './presets';
import RankingPanel from './RankingPanel';
import type { RankingRollup, RankedRecipe } from '../utils/rankingAnalysis';

// The entire left-column form: prompt, model picker, sampler/scheduler, resolution
// picker (arch-specific), Hires.fix, LoRA, Refiner/VAE (SDXL), Seed, and the
// Generate/Batch buttons. Props are numerous — App.tsx owns all the state, this
// component is purely presentational.
export interface ControlPanelProps {
  prompt: string;
  setPrompt: (v: string) => void;

  loading: boolean;

  modelTypeFilter: 'sd15' | 'sdxl';
  setModelTypeFilter: (v: 'sd15' | 'sdxl') => void;
  selectedModel: string;
  setSelectedModel: (v: string) => void;
  sdModels: SdModel[];

  selectedSampler: string;
  setSelectedSampler: (v: string) => void;
  sdSamplers: string[];
  selectedScheduler: string;
  setSelectedScheduler: (v: string) => void;
  sdSchedulers: string[];

  // Resolution picker state — SDXL side
  selectedRatio: SdxlRatio;
  handleRatioChange: (r: SdxlRatio) => void;
  selectedOrientation: SdxlOrientation;
  setSelectedOrientation: (v: SdxlOrientation) => void;
  selectedSize: SdxlSize;
  setSelectedSize: (v: SdxlSize) => void;

  // Resolution picker state — SD1.5 side
  selectedSd15Ratio: Sd15Ratio;
  handleSd15RatioChange: (r: Sd15Ratio) => void;
  selectedSd15Orientation: SdxlOrientation;
  setSelectedSd15Orientation: (v: SdxlOrientation) => void;
  selectedSd15Size: SdxlSize;
  setSelectedSd15Size: (v: SdxlSize) => void;

  width: number;
  height: number;

  steps: number;
  setSteps: (v: number) => void;
  cfgScale: number;
  setCfgScale: (v: number) => void;

  hiresFixEnabled: boolean;
  setHiresFixEnabled: (v: boolean) => void;
  selectedUpscaler: string;
  setSelectedUpscaler: (v: string) => void;
  sdUpscalers: string[];
  hiresScale: number;
  setHiresScale: (v: number) => void;
  hiresSteps: number;
  setHiresSteps: (v: number) => void;
  hiresDenoising: number;
  setHiresDenoising: (v: number) => void;

  sdLoras: SdLora[];
  selectedLoras: { name: string; weight: number }[];
  addLora: (name: string) => void;
  removeLora: (name: string) => void;
  setLoraWeight: (name: string, w: number) => void;

  // SDXL-only extras
  selectedRefiner: string;
  setSelectedRefiner: Dispatch<SetStateAction<string>>;
  refinerSwitchAt: number;
  setRefinerSwitchAt: (v: number) => void;
  selectedVae: string;
  setSelectedVae: Dispatch<SetStateAction<string>>;
  sdVaes: string[];

  seedLocked: boolean;
  setSeedLocked: (v: boolean) => void;
  seedValue: number;
  setSeedValue: (v: number) => void;

  onGenerate: (e: FormEvent<HTMLFormElement>) => void;
  onOpenBatchModal: () => void;
  // True while the batch modal is mounted. Used to switch the batch button's
  // `view-transition-name` off so the modal panel (which also carries the
  // same name) doesn't collide with it during the View Transition — the API
  // requires each transition name to be unique per snapshot.
  batchModalOpen: boolean;

  // Which sub-view this panel shows: the normal generation form, or the
  // favorite-recipe ranking list. Owned by App.tsx (state lives there, per
  // the project's convention); this component just renders per the value.
  activeTab: 'form' | 'ranking';
  onTabChange: (tab: 'form' | 'ranking') => void;
  rollups: RankingRollup[];
  onApplyRecipe: (recipe: RankedRecipe) => void;
}

export function ControlPanel(p: ControlPanelProps) {
  return (
    <section className="glass-panel" style={{
      padding: '24px',
      display: 'flex',
      flexDirection: 'column',
      borderRadius: '20px',
      overflow: 'hidden',
      height: '100%'
    }}>
      {/* Segmented form/ranking tabs. Same visual pattern as the batch modal's
          own mode tabs (view-transition-wrapped switch lives in App.tsx's
          switchControlTab, since this panel doesn't own the state). */}
      <div style={{ display: 'flex', gap: '8px', background: 'var(--panel-bg-sunk)', borderRadius: '12px', padding: '4px', marginBottom: '16px', flexShrink: 0 }}>
        {([['form', t.controlPanel.tabForm], ['ranking', t.controlPanel.tabRanking]] as const).map(([tabKey, label]) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => p.onTabChange(tabKey)}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '9px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: '13px',
              background: p.activeTab === tabKey ? 'var(--pop-blue)' : 'transparent',
              color: p.activeTab === tabKey ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {p.activeTab === 'ranking' ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <RankingPanel rollups={p.rollups} sdModels={p.sdModels} onApplyRecipe={p.onApplyRecipe} />
        </div>
      ) : (
      <form onSubmit={p.onGenerate} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <div style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'grid',
          gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: '20px',
          paddingRight: '6px',
          marginBottom: '16px'
        }}>
          {/* PROMPT AREA */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left', flex: 1, minHeight: 0 }}>
            <label style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-secondary)' }}>
              {t.controlPanel.promptLabel}
            </label>
            <textarea
              className="input-field"
              placeholder={t.controlPanel.promptPlaceholder}
              value={p.prompt}
              onChange={(e) => p.setPrompt(e.target.value)}
              style={{ flex: 1, minHeight: 0, resize: 'none', lineHeight: '1.4', borderRadius: '12px' }}
              required
              disabled={p.loading}
            />
          </div>

          {/* ADVANCED PARAMETERS */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '18px',
            background: 'var(--panel-bg-sunk)',
            borderRadius: '14px',
            border: '2px solid var(--panel-border)',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto'
          }}>
            {/* Stable Diffusion Model Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.modelLabel}</label>
              <div style={{ display: 'flex', gap: '6px', background: 'var(--panel-bg-sunk)', borderRadius: '10px', padding: '3px' }}>
                {(['sd15', 'sdxl'] as const).map((modelType) => (
                  <button
                    key={modelType}
                    type="button"
                    onClick={() => p.setModelTypeFilter(modelType)}
                    disabled={p.loading}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: '7px',
                      border: 'none',
                      cursor: p.loading ? 'default' : 'pointer',
                      fontWeight: 800,
                      fontSize: '12px',
                      background: p.modelTypeFilter === modelType ? 'var(--pop-blue)' : 'transparent',
                      color: p.modelTypeFilter === modelType ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    {modelType === 'sd15' ? 'SD' : 'SDXL'}
                  </button>
                ))}
              </div>
              {(() => {
                const modelsInScope = p.sdModels.filter((m) => m.type === p.modelTypeFilter);
                return modelsInScope.length > 0 ? (
                  <select
                    className="input-field"
                    value={p.selectedModel}
                    onChange={(e) => p.setSelectedModel(e.target.value)}
                    disabled={p.loading}
                    style={{ borderRadius: '8px' }}
                  >
                    {modelsInScope.map((m) => (
                      <option key={m.title} value={m.title}>{m.title}</option>
                    ))}
                  </select>
                ) : (
                  <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                    <option>{p.sdModels.length === 0 ? t.controlPanel.modelsUnavailable : p.modelTypeFilter === 'sdxl' ? t.controlPanel.noSdxlModelsFound : t.controlPanel.noSd15ModelsFound}</option>
                  </select>
                );
              })()}
            </div>

            {/* Sampler + Schedule Type */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left', gridColumn: p.sdSchedulers.length > 0 ? 'auto' : '1 / -1' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.samplerLabel}</label>
                {p.sdSamplers.length > 0 ? (
                  <select
                    className="input-field"
                    value={p.selectedSampler}
                    onChange={(e) => p.setSelectedSampler(e.target.value)}
                    disabled={p.loading}
                    style={{ borderRadius: '8px' }}
                  >
                    {p.sdSamplers.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                    <option>{t.controlPanel.samplersUnavailable}</option>
                  </select>
                )}
              </div>

              {p.sdSchedulers.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.schedulerLabel}</label>
                  <select
                    className="input-field"
                    value={p.selectedScheduler}
                    onChange={(e) => p.setSelectedScheduler(e.target.value)}
                    disabled={p.loading}
                    style={{ borderRadius: '8px' }}
                  >
                    {p.sdSchedulers.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Size Picker — SDXL or SD1.5 variant */}
            {p.modelTypeFilter === 'sdxl' ? (() => {
              const currentPreset = SDXL_PRESETS.find(pp => pp.ratio === p.selectedRatio) ?? SDXL_PRESETS[0];
              const isSquare = currentPreset.isSquare;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.aspectRatioLabel}</label>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {SDXL_PRESETS.map((preset) => {
                        const active = p.selectedRatio === preset.ratio;
                        return (
                          <button
                            key={preset.ratio}
                            type="button"
                            onClick={() => p.handleRatioChange(preset.ratio)}
                            disabled={p.loading}
                            className="scale-hover"
                            style={{
                              padding: '8px 12px',
                              borderRadius: '8px',
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

                  <div style={{ display: 'grid', gridTemplateColumns: isSquare ? '1fr' : '1fr 1fr', gap: '8px' }}>
                    {!isSquare && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.orientationLabel}</label>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {(['landscape', 'portrait'] as const).map((o) => {
                            const active = p.selectedOrientation === o;
                            return (
                              <button
                                key={o}
                                type="button"
                                onClick={() => p.setSelectedOrientation(o)}
                                disabled={p.loading}
                                className="scale-hover"
                                style={{
                                  flex: 1,
                                  padding: '8px',
                                  borderRadius: '8px',
                                  border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                                  background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                                  color: active ? '#fff' : 'var(--text-secondary)',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                }}
                              >
                                {o === 'landscape' ? t.controlPanel.orientationLandscape : t.controlPanel.orientationPortrait}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.sizeLabel}</label>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {SDXL_SIZES.map((s) => {
                          const active = p.selectedSize === s;
                          const spec = currentPreset.sizes[s];
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => p.setSelectedSize(s)}
                              disabled={p.loading}
                              className="scale-hover"
                              style={{
                                flex: 1,
                                padding: '8px',
                                borderRadius: '8px',
                                border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                                background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                                color: active ? '#fff' : 'var(--text-secondary)',
                                fontWeight: 800,
                                cursor: 'pointer',
                                fontSize: '13px',
                              }}
                              title={spec.isSdxlBucket ? t.controlPanel.sdxlBucketSizeTitle : ''}
                            >
                              {s}{spec.isSdxlBucket ? ' ⭐' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 700, textAlign: 'center' }}>
                    → {p.width} × {p.height} px ({((p.width * p.height) / 1_000_000).toFixed(2)} MP)
                  </div>
                </div>
              );
            })() : (() => {
              const currentSd15Preset = SD15_PRESETS.find(pp => pp.ratio === p.selectedSd15Ratio) ?? SD15_PRESETS[0];
              const isSquare = currentSd15Preset.isSquare;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.aspectRatioLabel}</label>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {SD15_PRESETS.map((preset) => {
                        const active = p.selectedSd15Ratio === preset.ratio;
                        return (
                          <button
                            key={preset.ratio}
                            type="button"
                            onClick={() => p.handleSd15RatioChange(preset.ratio)}
                            disabled={p.loading}
                            className="scale-hover"
                            style={{
                              padding: '8px 12px',
                              borderRadius: '8px',
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

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                    {!isSquare && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.orientationLabel}</label>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {(['landscape', 'portrait'] as const).map((o) => {
                            const active = p.selectedSd15Orientation === o;
                            return (
                              <button
                                key={o}
                                type="button"
                                onClick={() => p.setSelectedSd15Orientation(o)}
                                disabled={p.loading}
                                className="scale-hover"
                                style={{
                                  flex: 1,
                                  padding: '8px',
                                  borderRadius: '8px',
                                  border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                                  background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                                  color: active ? '#fff' : 'var(--text-secondary)',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                }}
                              >
                                {o === 'landscape' ? t.controlPanel.orientationLandscape : t.controlPanel.orientationPortrait}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {isSquare && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.sizeLabel}</label>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {SDXL_SIZES.map((s) => {
                            const active = p.selectedSd15Size === s;
                            const spec = currentSd15Preset.sizes[s];
                            if (!spec) return null;
                            return (
                              <button
                                key={s}
                                type="button"
                                onClick={() => p.setSelectedSd15Size(s)}
                                disabled={p.loading}
                                className="scale-hover"
                                style={{
                                  flex: 1,
                                  padding: '8px',
                                  borderRadius: '8px',
                                  border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                                  background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                                  color: active ? '#fff' : 'var(--text-secondary)',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                }}
                              >
                                {s}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 700, textAlign: 'center' }}>
                    → {p.width} × {p.height} px ({((p.width * p.height) / 1_000_000).toFixed(2)} MP)
                  </div>
                </div>
              );
            })()}

            {/* Steps */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                <span>{t.controlPanel.stepsLabel}</span>
                <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{p.steps}</span>
              </div>
              <input
                type="range"
                min="10"
                max="50"
                value={p.steps}
                onChange={(e) => p.setSteps(parseInt(e.target.value))}
                disabled={p.loading}
              />
            </div>

            {/* CFG Scale */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                <span>{t.controlPanel.cfgLabel}</span>
                <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{p.cfgScale}</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                step="0.5"
                value={p.cfgScale}
                onChange={(e) => p.setCfgScale(parseFloat(e.target.value))}
                disabled={p.loading}
              />
            </div>

            {/* Hires.fix */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: p.loading ? 'default' : 'pointer', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                <input
                  type="checkbox"
                  checked={p.hiresFixEnabled}
                  onChange={(e) => p.setHiresFixEnabled(e.target.checked)}
                  disabled={p.loading}
                />
                {t.controlPanel.hiresEnabledLabel}
              </label>
              {p.hiresFixEnabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingLeft: '4px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.upscalerLabel}</label>
                    {p.sdUpscalers.length > 0 ? (
                      <select
                        className="input-field"
                        value={p.selectedUpscaler}
                        onChange={(e) => p.setSelectedUpscaler(e.target.value)}
                        disabled={p.loading}
                        style={{ borderRadius: '8px' }}
                      >
                        <option value="">{t.controlPanel.upscalerDefaultOption}</option>
                        {p.sdUpscalers.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    ) : (
                      <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                        <option>{t.controlPanel.upscalersUnavailable}</option>
                      </select>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                      <span>{t.controlPanel.hiresScaleLabel}</span>
                      <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{p.hiresScale.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="2"
                      step="0.1"
                      value={p.hiresScale}
                      onChange={(e) => p.setHiresScale(parseFloat(e.target.value))}
                      disabled={p.loading}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                      <span>{t.controlPanel.hiresStepsLabel}</span>
                      <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{p.hiresSteps === 0 ? t.controlPanel.hiresStepsSameAsSteps : p.hiresSteps}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={p.hiresSteps}
                      onChange={(e) => p.setHiresSteps(parseInt(e.target.value))}
                      disabled={p.loading}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                      <span>Denoising strength</span>
                      <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{p.hiresDenoising.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={p.hiresDenoising}
                      onChange={(e) => p.setHiresDenoising(parseFloat(e.target.value))}
                      disabled={p.loading}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* LoRA */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>{t.controlPanel.loraLabel}</label>
              {p.sdLoras.length > 0 ? (
                <select
                  className="input-field"
                  value=""
                  onChange={(e) => p.addLora(e.target.value)}
                  disabled={p.loading}
                  style={{ borderRadius: '8px' }}
                >
                  <option value="">{t.controlPanel.loraAddOption}</option>
                  {p.sdLoras.filter((l) => !p.selectedLoras.some((sl) => sl.name === l.name)).map((l) => {
                    const mismatched = l.type !== 'unknown' && l.type !== p.modelTypeFilter;
                    return (
                      <option key={l.name} value={l.name}>
                        {l.name}{mismatched ? t.controlPanel.loraTypeMismatch(l.type === 'sdxl' ? 'SDXL' : 'SD1.5') : ''}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                  <option>{t.controlPanel.lorasUnavailable}</option>
                </select>
              )}
              {p.selectedLoras.map((l) => (
                <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--panel-bg)', border: '2px solid var(--panel-border)', borderRadius: '8px', padding: '6px 8px' }}>
                  <span style={{ flex: 1, fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.name}>{l.name}</span>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={l.weight}
                    onChange={(e) => p.setLoraWeight(l.name, parseFloat(e.target.value))}
                    disabled={p.loading}
                    style={{ width: '90px' }}
                  />
                  <span style={{ fontSize: '11px', fontWeight: '800', color: 'var(--pop-blue)', width: '30px', textAlign: 'right' }}>{l.weight.toFixed(2)}</span>
                  <button type="button" onClick={() => p.removeLora(l.name)} disabled={p.loading} title={t.controlPanel.removeLoraTitle} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* SDXL-only extras: Refiner + VAE */}
            {p.modelTypeFilter === 'sdxl' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                    {t.controlPanel.refinerLabel} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t.controlPanel.optionalSuffix}</span>
                  </label>
                  <select
                    className="input-field"
                    value={p.selectedRefiner}
                    onChange={(e) => p.setSelectedRefiner(e.target.value)}
                    disabled={p.loading}
                    style={{ borderRadius: '8px' }}
                  >
                    <option value="">{t.controlPanel.refinerNoneOption}</option>
                    {p.sdModels.filter((m) => m.type === 'sdxl').map((m) => (
                      <option key={m.title} value={m.title}>{m.title}</option>
                    ))}
                  </select>
                  {p.selectedRefiner && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                        <span>{t.controlPanel.refinerSwitchLabel}</span>
                        <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{p.refinerSwitchAt.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={p.refinerSwitchAt}
                        onChange={(e) => p.setRefinerSwitchAt(parseFloat(e.target.value))}
                        disabled={p.loading}
                      />
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {t.controlPanel.refinerSwitchDescription(Math.round(p.refinerSwitchAt * 100))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                    VAE <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t.controlPanel.optionalSuffix}</span>
                  </label>
                  <select
                    className="input-field"
                    value={p.selectedVae}
                    onChange={(e) => p.setSelectedVae(e.target.value)}
                    disabled={p.loading}
                    style={{ borderRadius: '8px' }}
                  >
                    <option value="">{t.controlPanel.vaeAutomaticOption}</option>
                    {p.sdVaes.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* Seed */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: p.loading ? 'default' : 'pointer', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                <input
                  type="checkbox"
                  checked={p.seedLocked}
                  onChange={(e) => p.setSeedLocked(e.target.checked)}
                  disabled={p.loading}
                />
                {t.controlPanel.seedLockLabel}
              </label>
              {p.seedLocked && (
                <input
                  type="number"
                  className="input-field"
                  min={0}
                  step={1}
                  value={p.seedValue}
                  onChange={(e) => p.setSeedValue(parseInt(e.target.value) || 0)}
                  disabled={p.loading}
                  style={{ borderRadius: '8px' }}
                />
              )}
            </div>
          </div>
        </div>

        {/* GENERATE BUTTONS */}
        <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
          <button
            type="submit"
            className="btn-neon"
            disabled={p.loading || !p.prompt.trim()}
            style={{
              flex: 1,
              padding: '16px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              fontSize: '17px',
              whiteSpace: 'nowrap',
              minWidth: 0
            }}
          >
            {p.loading ? (
              <>
                <RotateCw size={20} className="animate-spin-custom" />
                <span>{t.controlPanel.generateButtonLoading}</span>
              </>
            ) : (
              <>
                <Sparkles size={20} />
                <span>{t.controlPanel.generateButton}</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={p.onOpenBatchModal}
            disabled={p.loading || !p.prompt.trim()}
            className="scale-hover"
            title={t.controlPanel.batchButtonTitle}
            aria-label={t.controlPanel.batchButtonTitle}
            style={{
              flexShrink: 0,
              padding: '16px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--panel-bg)',
              color: 'var(--pop-blue)',
              border: '2px solid var(--pop-blue)',
              cursor: (p.loading || !p.prompt.trim()) ? 'not-allowed' : 'pointer',
              opacity: (p.loading || !p.prompt.trim()) ? 0.5 : 1,
              // Share the `view-transition-name` with the modal panel so the
              // browser interpolates the button rect → modal rect on open (and
              // reverses on close). Drop the name while the modal is open so
              // both instances never carry it simultaneously.
              viewTransitionName: p.batchModalOpen ? undefined : 'batch-morph',
            }}
          >
            <Layers size={22} />
          </button>
        </div>
      </form>
      )}
    </section>
  );
}
