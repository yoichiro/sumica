import type { Dispatch, SetStateAction, FormEvent } from 'react';
import { Sparkles, RotateCw, Layers, X } from 'lucide-react';
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
              生成プロンプト (日本語または英語)
            </label>
            <textarea
              className="input-field"
              placeholder="生成したい画像の内容を入力してください... (例: 'サイバーパンクな都市、雨に濡れたネオン、未来的、シネマティック照明')"
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
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>モデル (Stable Diffusion)</label>
              <div style={{ display: 'flex', gap: '6px', background: 'var(--panel-bg-sunk)', borderRadius: '10px', padding: '3px' }}>
                {(['sd15', 'sdxl'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => p.setModelTypeFilter(t)}
                    disabled={p.loading}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: '7px',
                      border: 'none',
                      cursor: p.loading ? 'default' : 'pointer',
                      fontWeight: 800,
                      fontSize: '12px',
                      background: p.modelTypeFilter === t ? 'var(--pop-blue)' : 'transparent',
                      color: p.modelTypeFilter === t ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    {t === 'sd15' ? 'SD' : 'SDXL'}
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
                    <option>{p.sdModels.length === 0 ? 'モデル一覧を取得できません（SD未接続）' : p.modelTypeFilter === 'sdxl' ? 'SDXLモデルが見つかりません' : 'SD1.5モデルが見つかりません'}</option>
                  </select>
                );
              })()}
            </div>

            {/* Sampler + Schedule Type */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left', gridColumn: p.sdSchedulers.length > 0 ? 'auto' : '1 / -1' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>サンプラー (Sampler)</label>
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
                    <option>サンプラー一覧を取得できません（SD未接続）</option>
                  </select>
                )}
              </div>

              {p.sdSchedulers.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>スケジュール (Schedule Type)</label>
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
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>アスペクト比</label>
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
                            title={preset.ratioIsBucket ? 'SDXL純正の学習比率' : ''}
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
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>向き</label>
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
                                {o === 'landscape' ? '🖼️ 横' : '📱 縦'}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>サイズ</label>
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
                              title={spec.isSdxlBucket ? 'SDXL純正の学習バケットサイズ' : ''}
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
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>アスペクト比</label>
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
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>向き</label>
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
                                {o === 'landscape' ? '🖼️ 横' : '📱 縦'}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {isSquare && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>サイズ</label>
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
                <span>サンプリングステップ数 (Steps)</span>
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
                <span>プロンプト追従性 (CFG Scale)</span>
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
                Hires.fixを有効にする
              </label>
              {p.hiresFixEnabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingLeft: '4px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>アップスケーラー (Upscaler)</label>
                    {p.sdUpscalers.length > 0 ? (
                      <select
                        className="input-field"
                        value={p.selectedUpscaler}
                        onChange={(e) => p.setSelectedUpscaler(e.target.value)}
                        disabled={p.loading}
                        style={{ borderRadius: '8px' }}
                      >
                        <option value="">SDのデフォルトを使用</option>
                        {p.sdUpscalers.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    ) : (
                      <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                        <option>アップスケーラー一覧を取得できません（SD未接続）</option>
                      </select>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                      <span>アップスケール倍率</span>
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
                      <span>Hires用ステップ数 (0 = Stepsと同じ)</span>
                      <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{p.hiresSteps === 0 ? 'Stepsと同じ' : p.hiresSteps}</span>
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
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>LoRA (複数適用可)</label>
              {p.sdLoras.length > 0 ? (
                <select
                  className="input-field"
                  value=""
                  onChange={(e) => p.addLora(e.target.value)}
                  disabled={p.loading}
                  style={{ borderRadius: '8px' }}
                >
                  <option value="">＋ LoRAを追加…</option>
                  {p.sdLoras.filter((l) => !p.selectedLoras.some((sl) => sl.name === l.name)).map((l) => {
                    const mismatched = l.type !== 'unknown' && l.type !== p.modelTypeFilter;
                    return (
                      <option key={l.name} value={l.name}>
                        {l.name}{mismatched ? ` ⚠${l.type === 'sdxl' ? 'SDXL' : 'SD1.5'}用` : ''}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                  <option>LoRA一覧を取得できません（SD未接続）</option>
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
                  <button type="button" onClick={() => p.removeLora(l.name)} disabled={p.loading} title="このLoRAを外す" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}>
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
                    Refiner (仕上げモデル) <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— 任意</span>
                  </label>
                  <select
                    className="input-field"
                    value={p.selectedRefiner}
                    onChange={(e) => p.setSelectedRefiner(e.target.value)}
                    disabled={p.loading}
                    style={{ borderRadius: '8px' }}
                  >
                    <option value="">（使わない）</option>
                    {p.sdModels.filter((m) => m.type === 'sdxl').map((m) => (
                      <option key={m.title} value={m.title}>{m.title}</option>
                    ))}
                  </select>
                  {p.selectedRefiner && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                        <span>切替タイミング (Switch at)</span>
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
                        全体の {Math.round(p.refinerSwitchAt * 100)}% までベースモデル、以降Refinerで仕上げ
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                    VAE <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— 任意</span>
                  </label>
                  <select
                    className="input-field"
                    value={p.selectedVae}
                    onChange={(e) => p.setSelectedVae(e.target.value)}
                    disabled={p.loading}
                    style={{ borderRadius: '8px' }}
                  >
                    <option value="">Automatic（自動）</option>
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
                Seedを固定する
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
                <span>生成リクエストを実行中... ⚡️</span>
              </>
            ) : (
              <>
                <Sparkles size={20} />
                <span>画像を生成する 🎨⚡️</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={p.onOpenBatchModal}
            disabled={p.loading || !p.prompt.trim()}
            className="scale-hover"
            title="複数枚をまとめて生成"
            aria-label="複数枚をまとめて生成"
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
              opacity: (p.loading || !p.prompt.trim()) ? 0.5 : 1
            }}
          >
            <Layers size={22} />
          </button>
        </div>
      </form>
    </section>
  );
}
