import type { RefObject } from 'react';
import { Info, Download, CheckCircle2, Circle, Star, ChevronLeft, ChevronRight, Maximize, Minimize, Shuffle, Play, Pause, Eye, X, Video, Film, Image as ImageIcon } from 'lucide-react';
import type { GenerationParams } from '../firebase';
import { t } from '../i18n';

// Lightbox needs to look up the currently-shown gallery item to render the
// select-toggle, favorite button, and metadata info panel. When the lightbox
// shows the preview tab's current generation (not a gallery item), lightboxIndex
// is -1 and those overlays hide themselves.
interface GalleryItem extends Partial<GenerationParams> {
  id?: string;
  isFavorite?: boolean;
  // Video mode fields (see GenerationData in App.tsx / GenerationRecord in
  // firebase.ts). Absent mediaType is treated as 'image'.
  mediaType?: 'image' | 'video';
  parentId?: string;
  videoUrl?: string;
  posterUrl?: string;
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
  randomMode: boolean;
  onToggleRandom: () => void;
  slideshowPlaying: boolean;
  onToggleSlideshow: () => void;
  // Current slideshow tick interval in ms, cycled through presets by
  // right-clicking the Slideshow toggle. Rendered as a small badge on the
  // toggle button so the user always knows the current pace at a glance.
  slideshowIntervalMs: number;
  onCycleSlideshowInterval: () => void;
  // Slideshow advance for the video branch. When slideshowPlaying is true and
  // the current item is a video, App wants the next-item transition to happen
  // when the video finishes playing rather than after a fixed timer. Undefined
  // outside slideshow so the video can honor its normal loop attribute.
  onSlideshowVideoEnded?: () => void;
  onOpenInPreview: () => void;
  // True while a generation is running (enhancing / generating / saving) —
  // the open-in-preview button is disabled in that window because sending
  // a history image to the preview would clobber the live progress UI.
  openInPreviewDisabled: boolean;
  onClose: () => void;
  onDownload: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  // Video mode integration
  onOpenVideoForm: () => void;
  onOpenChildVideos: (parentId: string) => void;
  onOpenParentImage: (parentId: string) => void;
  childVideoCount: number; // pre-computed by App.tsx for the current lightbox item
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
  randomMode,
  onToggleRandom,
  slideshowPlaying,
  onToggleSlideshow,
  slideshowIntervalMs,
  onCycleSlideshowInterval,
  onSlideshowVideoEnded,
  onOpenInPreview,
  openInPreviewDisabled,
  onClose,
  onDownload,
  isFullscreen,
  onToggleFullscreen,
  onOpenVideoForm,
  onOpenChildVideos,
  onOpenParentImage,
  childVideoCount,
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
      {meta && (meta.mediaType ?? 'image') === 'video' ? (
        <video
          src={meta.videoUrl ?? url}
          poster={meta.posterUrl}
          controls
          playsInline
          // Slideshow advances by video end, so we suppress the loop
          // attribute during slideshow so `ended` actually fires. When the
          // slideshow is off the video loops as usual so the user can
          // linger on a single clip.
          loop={!onSlideshowVideoEnded}
          autoPlay
          onEnded={onSlideshowVideoEnded}
          onClick={(e) => e.stopPropagation()}
          style={{ width: '100%', height: '100%', objectFit: 'contain', viewTransitionName: 'lightbox-morph' }}
        />
      ) : (
        <img
          src={url}
          alt={t.lightbox.imageAlt}
          onClick={(e) => e.stopPropagation()}
          style={{ width: '100%', height: '100%', objectFit: 'contain', viewTransitionName: 'lightbox-morph' }}
        />
      )}
      {/* L-shaped toolbar: a horizontal top row (Close anchors the right-hand
          corner, with item-agnostic controls extending leftward) plus a
          vertical column dropping from beneath Close (item-specific actions
          on the currently displayed entry). The two lists share the top-right
          corner but never overlap — vertical column starts at top:72 (=
          20 + 44 + 8) so it sits one row-slot below the horizontal strip.
          Each button drops its own position/top/right and lets the flex
          container place it. */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        display: 'flex',
        flexDirection: 'row',
        gap: '8px',
      }}>
      {meta && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleInfo(); }}
          title={showInfo ? t.lightbox.infoHideTooltip : t.lightbox.infoShowTooltip}
          aria-pressed={showInfo}
          className="scale-hover"
          style={{
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
      {/* Slideshow toggle: when ON, advances (via nextSlideshowIndex) every
          slideshowIntervalMs. Whether the advance is sequential or random
          depends on the shared randomMode flag above. Same disabled gate as
          the random toggle. Right-clicking the button cycles through interval
          presets (5s → 10s → 15s → 30s → 60s → 5s); the current pace is shown as a
          small badge on the bottom-right so the user always sees the value
          without hovering for a tooltip. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleSlideshow(); }}
        onContextMenu={(e) => {
          // preventDefault suppresses the browser's native context menu so the
          // right-click can be repurposed for interval cycling. stopPropagation
          // keeps it from bubbling to the backdrop close handler on <div>.
          e.preventDefault();
          e.stopPropagation();
          if (lightboxIndex < 0 || displayedHistory.length < 2) return;
          onCycleSlideshowInterval();
        }}
        disabled={lightboxIndex < 0 || displayedHistory.length < 2}
        title={
          slideshowPlaying
            ? `${t.lightbox.slideshowStopTooltip} · ${t.lightbox.slideshowCycleIntervalHint}`
            : `${t.lightbox.slideshowStartTooltip(Math.round(slideshowIntervalMs / 1000))} · ${t.lightbox.slideshowCycleIntervalHint}`
        }
        aria-pressed={slideshowPlaying}
        className={(lightboxIndex < 0 || displayedHistory.length < 2) ? '' : 'scale-hover'}
        style={{
          position: 'relative',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: 'none',
          background: slideshowPlaying ? 'var(--pop-blue)' : 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: (lightboxIndex < 0 || displayedHistory.length < 2) ? 'not-allowed' : 'pointer',
          opacity: (lightboxIndex < 0 || displayedHistory.length < 2) ? 0.35 : 1,
        }}
      >
        {slideshowPlaying ? <Pause size={20} /> : <Play size={20} />}
        {/* Countdown ring: an SVG overlay traces the button's circumference as
            a stroke that shrinks over the current slideshowIntervalMs, giving
            a visual "time remaining until next auto-advance" cue. The SVG is
            keyed on both `lightboxIndex` and `slideshowIntervalMs` so it
            remounts (and the CSS animation restarts from 0) on every tick,
            every manual ← / → nav, and every interval cycle. Only rendered
            while the slideshow is active and the disabled gate is clear.
            SUPPRESSED on video items because the advance timing is governed
            by the video's own `ended` event, not the interval — animating a
            countdown that has no bearing on the actual switch would mislead. */}
        {slideshowPlaying && lightboxIndex >= 0 && displayedHistory.length >= 2 && (meta?.mediaType ?? 'image') !== 'video' && (
          <svg
            key={`${lightboxIndex}-${slideshowIntervalMs}`}
            aria-hidden="true"
            width="44"
            height="44"
            viewBox="0 0 44 44"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              pointerEvents: 'none',
              // Rotate so the stroke starts at 12 o'clock instead of 3
              // o'clock — matches conventional countdown-ring iconography.
              transform: 'rotate(-90deg)',
            }}
          >
            <circle
              className="sumica-slideshow-countdown-ring"
              cx="22"
              cy="22"
              r="20"
              fill="none"
              stroke="rgba(255, 255, 255, 0.9)"
              strokeWidth="2.5"
              strokeLinecap="round"
              // 2πr = 2π·20 ≈ 125.66; matches the keyframe's `to` value in
              // index.css so the animation empties exactly one full ring.
              strokeDasharray="125.66"
              strokeDashoffset="0"
              style={{
                animation: `sumica-slideshow-countdown ${slideshowIntervalMs}ms linear forwards`,
              }}
            />
          </svg>
        )}
        {/* Interval badge, bottom-right. Positioned outside the icon glyph so
            the Play/Pause visual stays intact; sized small enough to read but
            not compete for attention. Rendered even when disabled — a dim
            preview is still useful context.
            HIDDEN on video items because the slideshow advances on the
            video's own `ended` event, not on this interval — showing "30s"
            beside a Play button that ignores the interval would mislead the
            user into expecting a hard cutover 30 seconds in. */}
        {(meta?.mediaType ?? 'image') !== 'video' && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              bottom: '-2px',
              right: '-2px',
              minWidth: '18px',
              height: '14px',
              padding: '0 3px',
              borderRadius: '7px',
              background: 'rgba(0, 0, 0, 0.72)',
              color: '#fff',
              fontSize: '9px',
              fontWeight: 800,
              letterSpacing: 0.3,
              lineHeight: '14px',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(255, 255, 255, 0.35)',
            }}
          >
            {Math.round(slideshowIntervalMs / 1000)}s
          </span>
        )}
      </button>
      {/* Random-mode toggle: when ON, both manual ← / → and the slideshow
          timer pick a random next image (excluding the current one). Same
          disabled gate as before (needs at least 2 gallery-backed candidates). */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleRandom(); }}
        disabled={lightboxIndex < 0 || displayedHistory.length < 2}
        title={randomMode ? t.lightbox.randomModeToggleOnTooltip : t.lightbox.randomModeToggleOffTooltip}
        aria-pressed={randomMode}
        className={(lightboxIndex < 0 || displayedHistory.length < 2) ? '' : 'scale-hover'}
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: 'none',
          background: randomMode ? 'var(--pop-blue)' : 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: (lightboxIndex < 0 || displayedHistory.length < 2) ? 'not-allowed' : 'pointer',
          opacity: (lightboxIndex < 0 || displayedHistory.length < 2) ? 0.35 : 1,
        }}
      >
        <Shuffle size={20} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onNavigate(-1); }}
        disabled={lightboxIndex <= 0}
        title={t.lightbox.prevTooltip}
        className={lightboxIndex <= 0 ? '' : 'scale-hover'}
        style={{
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
      </div>
      {/* Vertical right column: item-specific actions dropping from beneath
          Close. top:72 = 20 (row top) + 44 (row height) + 8 (gap) so the
          column starts one row-slot below the horizontal strip and never
          overlaps its rightmost button. */}
      <div style={{
        position: 'absolute',
        top: '72px',
        right: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
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
      {/* Open-in-preview: send the currently displayed gallery item to the
          Preview tab, then close the lightbox. Hidden when the lightbox is
          showing the preview tab's own current generation (lightboxIndex < 0)
          — there's nothing to "send back" in that case. */}
      {lightboxIndex >= 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenInPreview(); }}
          disabled={openInPreviewDisabled}
          title={t.lightbox.openInPreviewTooltip}
          className={openInPreviewDisabled ? '' : 'scale-hover'}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255, 255, 255, 0.15)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: openInPreviewDisabled ? 'not-allowed' : 'pointer',
            opacity: openInPreviewDisabled ? 0.35 : 1,
          }}
        >
          <Eye size={20} />
        </button>
      )}
      {/* Download button — save the currently displayed image to disk with a
          human-readable JST timestamp filename. One-shot action, so no
          toggled/pressed styling. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDownload(); }}
        title={t.lightbox.downloadTooltip}
        className="scale-hover"
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <Download size={22} />
      </button>
      {/* Video mode: image side. 🎬 opens the image-to-video form seeded with
          the current image. Hidden when the current item is itself a video —
          the Parent-image button below takes its column slot instead. */}
      {meta && (meta.mediaType ?? 'image') !== 'video' && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenVideoForm(); }}
          title={t.lightbox.imageToVideoTooltip}
          className="scale-hover"
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255, 255, 255, 0.15)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Video size={22} />
        </button>
      )}
      {/* Video mode: video side. 🖼️ jumps back to the source image that this
          video was generated from (disabled when the source has since been
          deleted or is otherwise unknown). Mutually exclusive with the
          image-side Video button above — occupies the same column slot. */}
      {meta && (meta.mediaType ?? 'image') === 'video' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (meta.parentId) onOpenParentImage(meta.parentId);
          }}
          disabled={!meta.parentId}
          title={meta.parentId ? t.lightbox.viewParentImageTooltip : t.lightbox.viewParentImageDisabledTooltip}
          className="scale-hover"
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            border: 'none',
            background: meta.parentId ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            color: meta.parentId ? '#fff' : 'rgba(255, 255, 255, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: meta.parentId ? 'pointer' : 'default',
          }}
        >
          <ImageIcon size={22} />
        </button>
      )}
      {/* 📼 opens the list of videos already generated from this image
          (disabled when there are none yet). Image-side only. */}
      {meta && (meta.mediaType ?? 'image') !== 'video' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (childVideoCount > 0 && meta.id) onOpenChildVideos(meta.id);
          }}
          disabled={childVideoCount === 0}
          title={childVideoCount > 0
            ? t.lightbox.viewChildVideosTooltip(childVideoCount)
            : t.lightbox.viewChildVideosDisabledTooltip}
          className="scale-hover"
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            border: 'none',
            background: childVideoCount > 0 ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            color: childVideoCount > 0 ? '#fff' : 'rgba(255, 255, 255, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: childVideoCount > 0 ? 'pointer' : 'default',
          }}
        >
          <Film size={22} />
        </button>
      )}
      </div>
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
