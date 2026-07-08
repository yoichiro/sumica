import type { RefObject } from 'react';
import { Info, CheckCircle2, Circle, Star, ChevronLeft, ChevronRight, Maximize, Minimize, X } from 'lucide-react';
import type { GenerationParams } from '../firebase';
import { t } from '../i18n';

// Lightbox needs to look up the currently-shown gallery item to render the
// select-toggle, favorite button, and metadata info panel. When the lightbox
// shows the preview tab's current generation (not a gallery item), lightboxIndex
// is -1 and those overlays hide themselves.
interface GalleryItem extends Partial<GenerationParams> {
  isFavorite?: boolean;
}

interface LightboxProps {
  url: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
  meta: GalleryItem | null;
  showInfo: boolean;
  onToggleInfo: () => void;
  lightboxIndex: number;
  displayedHistory: GalleryItem[];
  isItemSelected: (index: number) => boolean;
  onToggleSelect: (index: number) => void;
  onToggleFavorite: (index: number) => void;
  onNavigate: (delta: number) => void;
  onClose: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function Lightbox({
  url,
  containerRef,
  meta,
  showInfo,
  onToggleInfo,
  lightboxIndex,
  displayedHistory,
  isItemSelected,
  onToggleSelect,
  onToggleFavorite,
  onNavigate,
  onClose,
  isFullscreen,
  onToggleFullscreen,
}: LightboxProps) {
  if (!url) return null;

  return (
    <div
      ref={containerRef}
      onClick={() => onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '24px'
      }}
    >
      <img
        src={url}
        alt={t.lightbox.imageAlt}
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', height: '100%', objectFit: 'contain', viewTransitionName: 'lightbox-morph' }}
      />
      {meta && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleInfo(); }}
          title={showInfo ? t.lightbox.infoHideTooltip : t.lightbox.infoShowTooltip}
          aria-pressed={showInfo}
          className="scale-hover"
          style={{
            position: 'absolute',
            top: '20px',
            right: '332px',
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            border: 'none',
            background: showInfo ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.15)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: showInfo ? '0 0 0 2px rgba(255, 255, 255, 0.35)' : 'none'
          }}
        >
          <Info size={22} />
        </button>
      )}
      {/* Selection toggle: only available when the lightbox shows a gallery item
          (not the preview tab's current generation, whose key is '__preview__' and
          not present in displayedHistory). Mirrors the click-to-select behavior on
          the gallery tile so a user can flip through images and mark deletion
          candidates without leaving the lightbox. */}
      {lightboxIndex >= 0 && (() => {
        const selected = isItemSelected(lightboxIndex);
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleSelect(lightboxIndex); }}
            title={selected ? t.lightbox.deselectTooltip : t.lightbox.selectTooltip}
            className="scale-hover"
            style={{
              position: 'absolute',
              top: '20px',
              right: '228px',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: selected ? '2px solid #fff' : 'none',
              background: selected ? 'var(--pop-blue)' : 'rgba(255, 255, 255, 0.15)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: selected ? '0 0 0 3px rgba(51, 154, 240, 0.35)' : 'none'
            }}
          >
            {selected ? <CheckCircle2 size={22} /> : <Circle size={22} />}
          </button>
        );
      })()}
      {lightboxIndex >= 0 && (() => {
        const fav = !!displayedHistory[lightboxIndex]?.isFavorite;
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(lightboxIndex); }}
            title={fav ? t.lightbox.favoriteRemoveTooltip : t.lightbox.favoriteAddTooltip}
            className="scale-hover"
            style={{
              position: 'absolute',
              top: '20px',
              right: '280px',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: fav ? '2px solid #fff' : 'none',
              background: fav ? '#ffd43b' : 'rgba(255, 255, 255, 0.15)',
              color: fav ? '#1a1a1a' : '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: fav ? '0 0 0 3px rgba(255, 212, 59, 0.35)' : 'none'
            }}
          >
            {fav
              ? <Star size={22} fill="#1a1a1a" stroke="#1a1a1a" />
              : <Star size={22} />}
          </button>
        );
      })()}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onNavigate(-1); }}
        disabled={lightboxIndex <= 0}
        title={t.lightbox.prevTooltip}
        className={lightboxIndex <= 0 ? '' : 'scale-hover'}
        style={{
          position: 'absolute',
          top: '20px',
          right: '176px',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: lightboxIndex <= 0 ? 'not-allowed' : 'pointer',
          opacity: lightboxIndex <= 0 ? 0.35 : 1
        }}
      >
        <ChevronLeft size={22} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onNavigate(1); }}
        disabled={lightboxIndex < 0 || lightboxIndex >= displayedHistory.length - 1}
        title={t.lightbox.nextTooltip}
        className={(lightboxIndex < 0 || lightboxIndex >= displayedHistory.length - 1) ? '' : 'scale-hover'}
        style={{
          position: 'absolute',
          top: '20px',
          right: '124px',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: (lightboxIndex < 0 || lightboxIndex >= displayedHistory.length - 1) ? 'not-allowed' : 'pointer',
          opacity: (lightboxIndex < 0 || lightboxIndex >= displayedHistory.length - 1) ? 0.35 : 1
        }}
      >
        <ChevronRight size={22} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}
        title={isFullscreen ? t.lightbox.fullscreenExitTooltip : t.lightbox.fullscreenEnterTooltip}
        className="scale-hover"
        style={{
          position: 'absolute',
          top: '20px',
          right: '72px',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer'
        }}
      >
        {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title={t.lightbox.closeTooltip}
        className="scale-hover"
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer'
        }}
      >
        <X size={22} />
      </button>
      {meta && (() => {
        const m = meta;
        const hasHr = m.enableHr === true;
        const hasLoras = Array.isArray(m.loras) && m.loras.length > 0;
        const hasRefiner = typeof m.refiner === 'string' && m.refiner.length > 0;
        const hasVae = typeof m.vae === 'string' && m.vae.length > 0 && m.vae !== 'Automatic';
        return (
          <div
            role="region"
            aria-label={t.lightbox.infoPanelAriaLabel}
            aria-hidden={!showInfo}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: '16px 24px',
              background: 'rgba(0, 0, 0, 0.55)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              color: '#f1f3f5',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              maxHeight: '40vh',
              overflowY: 'auto',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px 20px',
              fontSize: '13px',
              lineHeight: 1.5,
              transform: showInfo ? 'translateY(0)' : 'translateY(100%)',
              opacity: showInfo ? 1 : 0,
              pointerEvents: showInfo ? 'auto' : 'none',
              transition: 'transform 0.2s ease, opacity 0.2s ease'
            }}
          >
            <span><span style={{ opacity: 0.7 }}>{t.lightbox.infoPanel.dimensions}:</span> <strong>{m.width}×{m.height}</strong></span>
            {m.model && <span><span style={{ opacity: 0.7 }}>{t.lightbox.infoPanel.model}:</span> <strong>{m.model}</strong></span>}
            {m.seed !== undefined && <span><span style={{ opacity: 0.7 }}>{t.lightbox.infoPanel.seed}:</span> <strong style={{ fontFamily: 'monospace' }}>{m.seed}</strong></span>}
            {m.sampler && <span><span style={{ opacity: 0.7 }}>{t.lightbox.infoPanel.sampler}:</span> <strong>{m.sampler}</strong></span>}
            <span><span style={{ opacity: 0.7 }}>{t.lightbox.infoPanel.steps}:</span> <strong>{m.steps}</strong></span>
            <span><span style={{ opacity: 0.7 }}>{t.lightbox.infoPanel.cfg}:</span> <strong>{m.cfgScale}</strong></span>
            {hasHr && (
              <span>
                <span style={{ opacity: 0.7 }}>{t.lightbox.infoPanel.hires}:</span>{' '}
                <strong>ON ({(m.hrScale ?? 2).toFixed(1)}×{m.hrUpscaler ? `, ${m.hrUpscaler}` : ''})</strong>
              </span>
            )}
            {hasLoras && (
              <span>
                <span style={{ opacity: 0.7 }}>{t.lightbox.infoPanel.lora}:</span>{' '}
                <strong>{(m.loras || []).map((l) => `${l.name} (${l.weight})`).join(', ')}</strong>
              </span>
            )}
            {hasRefiner && (
              <span>
                <span style={{ opacity: 0.7 }}>{t.lightbox.infoPanel.refiner}:</span>{' '}
                <strong>{m.refiner} (switch @ {(m.refinerSwitchAt ?? 0.8).toFixed(2)})</strong>
              </span>
            )}
            {hasVae && <span><span style={{ opacity: 0.7 }}>{t.lightbox.infoPanel.vae}:</span> <strong>{m.vae}</strong></span>}
          </div>
        );
      })()}
    </div>
  );
}
