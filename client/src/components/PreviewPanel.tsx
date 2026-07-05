import { Image as ImageIcon, Cloud, Folder, Trash2, Sparkles, CheckCircle2, AlertTriangle, Star } from 'lucide-react';
import type { GenerationData } from '../App';

export type GenStatus = 'idle' | 'enhancing' | 'generating' | 'saving' | 'success' | 'error';

// Bottom-right "favorite" button overlaid on the preview image.
function FavoriteButton({
  isFavorite,
  onClick,
  size = 34,
}: {
  isFavorite: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: number;
}) {
  const iconSize = Math.round(size * 0.5);
  return (
    <button
      type="button"
      onClick={onClick}
      title={isFavorite ? 'お気に入りを解除' : 'お気に入りに追加'}
      className="scale-hover"
      style={{
        position: 'absolute',
        bottom: '8px',
        right: '8px',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)'
      }}
    >
      {isFavorite
        ? <Star size={iconSize} fill="#ffd43b" stroke="#ffd43b" />
        : <Star size={iconSize} />}
    </button>
  );
}

interface PreviewPanelProps {
  currentGeneration: GenerationData | null;
  morphSourceKey: string | null;
  lightboxUrl: string | null;
  genStatus: GenStatus;
  loadingStep: number;
  errorStep: number | null;
  sdProgress: { progress: number; etaRelative: number } | null;
  elapsedSeconds: number;
  batchProgress: { current: number; total: number } | null;
  cancelling: boolean;
  formatDuration: (totalSeconds: number) => string;
  onOpenLightbox: (url: string, sourceKey: string) => void;
  onToggleFavorite: (item: GenerationData) => void;
  onLoadIntoForm: (item: GenerationData) => void;
  onRequestDelete: (ids: string[]) => void;
  itemKey: (item: GenerationData) => string;
  onCancel: () => void;
}

export function PreviewPanel({
  currentGeneration,
  morphSourceKey,
  lightboxUrl,
  genStatus,
  loadingStep,
  errorStep,
  sdProgress,
  elapsedSeconds,
  batchProgress,
  cancelling,
  formatDuration,
  onOpenLightbox,
  onToggleFavorite,
  onLoadIntoForm,
  onRequestDelete,
  itemKey,
  onCancel,
}: PreviewPanelProps) {
  return (
    <>
      {/* GENERATION PREVIEW STAGE */}
      <div className="glass-panel" style={{
        padding: '24px',
        borderRadius: '20px',
        minHeight: '380px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {currentGeneration ? (
          <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 1.2fr', gap: '24px', alignItems: 'start' }}>
            {/* Image Frame — hugs the image and centers within its grid track */}
            <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '2px solid var(--panel-border-hover)', boxShadow: '0 8px 24px rgba(0,0,0,0.06)', justifySelf: 'center', maxWidth: '100%', minHeight: 0 }}>
              <img
                src={currentGeneration.imageUrl}
                alt="Generated output"
                onClick={() => onOpenLightbox(currentGeneration.imageUrl, '__preview__')}
                style={{ maxWidth: '100%', maxHeight: '48vh', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block', cursor: 'pointer', viewTransitionName: (morphSourceKey === '__preview__' && !lightboxUrl) ? 'lightbox-morph' : undefined }}
              />
              <FavoriteButton
                size={34}
                isFavorite={!!currentGeneration.isFavorite}
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(currentGeneration); }}
              />
              <div style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                background: 'rgba(255,255,255,0.92)',
                backdropFilter: 'blur(4px)',
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                border: '1.5px solid var(--panel-border-hover)',
                color: 'var(--text-primary)'
              }}>
                {currentGeneration.backendMode === 'firebase' ? (
                  <>
                    <Cloud size={12} color="var(--pop-blue)" />
                    <span style={{ color: 'var(--pop-blue)' }}>クラウド保存 ☁️</span>
                  </>
                ) : (
                  <>
                    <Folder size={12} color="var(--pop-orange)" />
                    <span style={{ color: 'var(--pop-orange)' }}>ローカル保存 📁</span>
                  </>
                )}
              </div>
            </div>

            {/* Prompt Info column: fixed toolbar on top, scrollable detail below */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left', maxHeight: '48vh', minHeight: 0 }}>
              {/* Toolbar — always visible */}
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => onLoadIntoForm(currentGeneration)}
                  className="scale-hover"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: 'rgba(51, 154, 240, 0.08)', border: '2px solid rgba(51, 154, 240, 0.2)', color: 'var(--pop-blue)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
                >
                  ♻️ フォームにロード
                </button>
                <button
                  type="button"
                  onClick={() => onRequestDelete([itemKey(currentGeneration)])}
                  className="scale-hover"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: 'rgba(255, 107, 107, 0.08)', border: '2px solid rgba(255, 107, 107, 0.25)', color: 'var(--danger)', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
                >
                  <Trash2 size={15} /> 削除
                </button>
              </div>
              {/* Scrollable detail */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', minHeight: 0, paddingRight: '4px' }}>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>元プロンプト</span>
                <p style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px', color: 'var(--text-primary)', lineHeight: '1.4' }}>{currentGeneration.originalPrompt}</p>
              </div>

              <div style={{ borderTop: '2px solid var(--panel-border)', paddingTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                <div>
                  <span>解像度: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.width}x{currentGeneration.height}</strong>
                </div>
                <div>
                  <span>ステップ: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.steps}</strong>
                </div>
                <div>
                  <span>CFG: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.cfgScale}</strong>
                </div>
                {currentGeneration.model && (
                  <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                    <span>モデル: </span>
                    <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.model}</strong>
                  </div>
                )}
                {currentGeneration.seed !== undefined && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span>Seed: </span>
                    <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{currentGeneration.seed}</strong>
                  </div>
                )}
                {currentGeneration.sampler && (
                  <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                    <span>サンプラー: </span>
                    <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.sampler}</strong>
                  </div>
                )}
                {currentGeneration.scheduler && (
                  <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                    <span>スケジュール: </span>
                    <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.scheduler}</strong>
                  </div>
                )}
                {currentGeneration.loras && currentGeneration.loras.length > 0 && (
                  <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                    <span>LoRA: </span>
                    <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.loras.map((l) => `${l.name} (${l.weight})`).join(', ')}</strong>
                  </div>
                )}
                {currentGeneration.enableHr && (
                  <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                    <span>Hires.fix: </span>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      ON ({(currentGeneration.hrScale ?? 2).toFixed(1)}x{currentGeneration.hrUpscaler ? `, ${currentGeneration.hrUpscaler}` : ''})
                    </strong>
                  </div>
                )}
                {currentGeneration.refiner && (
                  <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                    <span>Refiner: </span>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      {currentGeneration.refiner} (switch at {(currentGeneration.refinerSwitchAt ?? 0.8).toFixed(2)})
                    </strong>
                  </div>
                )}
                {currentGeneration.vae && (
                  <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                    <span>VAE: </span>
                    <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.vae}</strong>
                  </div>
                )}
              </div>

              {currentGeneration.enhancedPrompt !== currentGeneration.originalPrompt && (
                <div>
                  <span style={{ fontSize: '11px', color: 'var(--pop-blue)', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700' }}>
                    <Sparkles size={11} /> 拡張プロンプト (ポジティブ)
                  </span>
                  <p style={{ fontSize: '12.5px', marginTop: '4px', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: '1.4', background: 'var(--info-bg)', padding: '10px', borderRadius: '8px', border: '2px solid var(--info-border)', wordBreak: 'break-all' }}>
                    {currentGeneration.enhancedPrompt}
                  </p>
                </div>
              )}

              {currentGeneration.negativePrompt && (
                <div>
                  <span style={{ fontSize: '11px', color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700' }}>
                    ❌ ネガティブプロンプト
                  </span>
                  <p style={{ fontSize: '12px', marginTop: '4px', color: 'var(--text-secondary)', lineHeight: '1.4', background: 'var(--negative-bg)', padding: '10px', borderRadius: '8px', border: '2px solid var(--negative-border)', wordBreak: 'break-all' }}>
                    {currentGeneration.negativePrompt}
                  </p>
                </div>
              )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--text-secondary)', padding: '30px 0' }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'rgba(51, 154, 240, 0.05)',
              border: '2px dashed rgba(51, 154, 240, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--pop-blue)'
            }}>
              <ImageIcon size={28} />
            </div>
            <div>
              <h3 style={{ color: 'var(--text-primary)', fontSize: '16px', marginBottom: '4px', fontWeight: '800' }}>生成された画像のプレビュー 🖼️</h3>
              <p style={{ fontSize: '13px', maxWidth: '300px', margin: '0 auto', lineHeight: '1.4' }}>
                画像を生成すると、ここにプレビューが表示されます。
              </p>
            </div>
          </div>
        )}
      </div>

      {/* PROCESS TRACKER STAGE */}
      {genStatus !== 'idle' && (
        <div className="glass-panel" style={{
          padding: '20px 24px',
          borderRadius: '20px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          border: genStatus === 'error' ? '2.5px solid var(--danger)' : '2px solid var(--panel-border)',
          boxShadow: genStatus === 'error' ? '0 8px 20px rgba(255, 107, 107, 0.08)' : 'var(--shadow-soft)',
          background: genStatus === 'error' ? 'var(--danger-panel-bg)' : 'var(--panel-bg)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '24px' }}>
            {/* Spinner/Status Icon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ position: 'relative', width: '48px', height: '48px', flexShrink: 0 }}>
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  border: '3px solid rgba(51, 154, 240, 0.15)',
                  borderRadius: '50%'
                }}></div>
                {genStatus !== 'error' && genStatus !== 'success' ? (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    border: '3px solid transparent',
                    borderTopColor: 'var(--pop-blue)',
                    borderRightColor: 'var(--pop-teal)',
                    borderRadius: '50%',
                  }} className="animate-spin-custom"></div>
                ) : genStatus === 'error' ? (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    border: '3px solid var(--danger)',
                    borderRadius: '50%',
                  }}></div>
                ) : (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    border: '3px solid var(--success)',
                    borderRadius: '50%',
                  }}></div>
                )}
                {genStatus === 'success' ? (
                  <CheckCircle2 style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--success)' }} size={18} />
                ) : genStatus === 'error' ? (
                  <AlertTriangle style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--danger)' }} size={18} />
                ) : (
                  <Sparkles style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--pop-blue)' }} className="animate-bounce-custom" size={18} />
                )}
              </div>

              <div style={{ textAlign: 'left' }}>
                <span style={{ fontSize: '14px', fontWeight: '800', display: 'block', color: genStatus === 'error' ? 'var(--danger)' : genStatus === 'success' ? 'var(--success)' : 'var(--text-primary)' }}>
                  {genStatus === 'error' ? '生成処理エラー ❌' : genStatus === 'success' ? '生成完了！ 🎉' : '画像生成パイプライン進行中... ⚡️'}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {genStatus === 'error' ? '処理の途中でエラーが発生しました' : genStatus === 'success' ? 'すべての処理が正常に完了しました' : 'バックエンドでタスクを実行しています'}
                </span>
              </div>

              {/* Stop button — sits right next to the "画像生成パイプライン進行中" status text. */}
              {genStatus === 'generating' && (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={cancelling}
                  className="scale-hover"
                  style={{ padding: '8px 16px', borderRadius: '10px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-secondary)', fontWeight: '800', fontSize: '12px', cursor: cancelling ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
                >
                  {cancelling ? '生成を止めています...' : '生成を止める'}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              {/* Elapsed/remaining time — sits right next to (to the left of) the
                  steps sequence. Both this row and the stop button above render
                  only during 'generating', so the steps row's own height never
                  changes when a generation starts/stops. */}
              {genStatus === 'generating' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  <span>
                    経過{formatDuration(elapsedSeconds)}
                    {sdProgress && sdProgress.etaRelative > 0 ? ` / 残り約${formatDuration(sdProgress.etaRelative)}` : ''}
                  </span>
                  {sdProgress && (
                    <div style={{ width: '80px', height: '4px', borderRadius: '2px', background: 'var(--panel-border)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(100, Math.max(0, sdProgress.progress * 100))}%`,
                        height: '100%',
                        background: 'var(--pop-blue)',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  )}
                </div>
              )}

            {/* Steps Horizontally */}
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: (genStatus === 'error' && errorStep === 1) ? 'var(--danger)' : loadingStep >= 1 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: '700' }}>
                <div style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: (genStatus === 'error' && errorStep === 1) ? 'var(--danger)' : loadingStep > 1 || genStatus === 'success' ? 'var(--success)' : loadingStep === 1 ? 'var(--pop-blue)' : 'none',
                  border: '1.5px solid ' + (((genStatus === 'error' && errorStep === 1) ? 'var(--danger)' : loadingStep >= 1 || genStatus === 'success') ? 'transparent' : 'var(--text-muted)'),
                  color: (loadingStep >= 1 || genStatus === 'success' || (genStatus === 'error' && errorStep === 1)) ? '#fff' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px',
                  fontWeight: 'bold'
                }}>
                  {(genStatus === 'error' && errorStep === 1) ? '✗' : loadingStep > 1 || genStatus === 'success' ? '✓' : '1'}
                </div>
                <span className={genStatus === 'enhancing' ? 'processing-shimmer' : undefined}>プロンプト拡張</span>
              </div>

              <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>➔</span>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: (genStatus === 'error' && errorStep === 2) ? 'var(--danger)' : loadingStep >= 2 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: '700' }}>
                <div style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: (genStatus === 'error' && errorStep === 2) ? 'var(--danger)' : loadingStep > 2 || genStatus === 'success' ? 'var(--success)' : loadingStep === 2 ? 'var(--pop-teal)' : 'none',
                  border: '1.5px solid ' + (((genStatus === 'error' && errorStep === 2) ? 'var(--danger)' : loadingStep >= 2 || genStatus === 'success') ? 'transparent' : 'var(--text-muted)'),
                  color: (loadingStep >= 2 || genStatus === 'success' || (genStatus === 'error' && errorStep === 2)) ? '#fff' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px',
                  fontWeight: 'bold'
                }}>
                  {(genStatus === 'error' && errorStep === 2) ? '✗' : loadingStep > 2 || genStatus === 'success' ? '✓' : '2'}
                </div>
                <span className={genStatus === 'generating' ? 'processing-shimmer' : undefined}>画像生成{batchProgress ? ` (${batchProgress.current}/${batchProgress.total})` : ''}</span>
              </div>

              <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>➔</span>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: (genStatus === 'error' && errorStep === 3) ? 'var(--danger)' : (loadingStep >= 3 || genStatus === 'success') ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: '700' }}>
                <div style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: (genStatus === 'error' && errorStep === 3) ? 'var(--danger)' : genStatus === 'success' ? 'var(--success)' : loadingStep === 3 ? 'var(--pop-orange)' : 'none',
                  border: '1.5px solid ' + (((genStatus === 'error' && errorStep === 3) ? 'var(--danger)' : loadingStep === 3 || genStatus === 'success') ? 'transparent' : 'var(--text-muted)'),
                  color: (loadingStep === 3 || genStatus === 'success' || (genStatus === 'error' && errorStep === 3)) ? '#fff' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px',
                  fontWeight: 'bold'
                }}>
                  {(genStatus === 'error' && errorStep === 3) ? '✗' : genStatus === 'success' ? '✓' : '3'}
                </div>
                <span>保存完了</span>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
