import { useRef } from 'react';
import { Star, Cloud, Folder, CheckCircle2, Circle } from 'lucide-react';
import type { GenerationData } from '../App';
import { buildCaptionInfo, type CaptionInfoData } from './captionFields';
import { computeRangeSelectionAdd } from './rangeSelection';

// Bottom-right selection toggle overlaid on a gallery tile.
function SelectButton({
  isSelected,
  onClick,
  size = 26,
}: {
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: number;
}) {
  const iconSize = Math.round(size * 0.5);
  return (
    <button
      type="button"
      onClick={onClick}
      title={isSelected ? '選択を解除' : '選択'}
      className="scale-hover"
      style={{
        position: 'absolute',
        bottom: '8px',
        right: '8px',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        border: isSelected ? '2px solid #fff' : 'none',
        background: isSelected ? 'var(--pop-blue)' : 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: isSelected ? '0 0 0 3px rgba(51, 154, 240, 0.35)' : '0 2px 6px rgba(0,0,0,0.25)'
      }}
    >
      {isSelected ? <CheckCircle2 size={iconSize} /> : <Circle size={iconSize} />}
    </button>
  );
}

// Bottom-right "favorite" button overlaid on a gallery tile.
function FavoriteButton({
  isFavorite,
  onClick,
  size = 26,
  stackedAbove = 0,
}: {
  isFavorite: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: number;
  stackedAbove?: number;
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
        bottom: stackedAbove > 0 ? `${8 + stackedAbove + 8}px` : '8px',
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

function CaptionInfo({ info }: { info: CaptionInfoData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {/* Row 1: model (ellipsis) + date (right, small muted). Date moved here
          from Row 2 so Row 2 can give the size string full width and stop
          truncating on narrow tiles. */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '6px',
      }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
          flex: 1,
        }}>
          {info.model}
        </div>
        <span style={{
          fontSize: '10px',
          color: 'var(--text-muted)',
          flexShrink: 0,
        }}>
          {info.date}
        </span>
      </div>
      {/* Row 2: size on the left, Hires/LoRA presence badges on the right.
          Badges live in an inner flex group with a negative marginLeft on the
          second badge so ⚡ and 🎭 read as a paired set instead of being
          spaced like separate items. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '6px',
        minWidth: 0,
      }}>
        <span style={{
          fontSize: '11px',
          fontWeight: 500,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {info.size}
        </span>
        {/* Badges: `gap` cannot tighten these beyond a certain point because
            emoji glyphs carry their own horizontal padding inside the bounding
            box. Use a negative marginLeft on the second badge to visually pull
            it against the first. */}
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {info.hasHires && (
            <span title="Hires.fix 適用" style={{ fontSize: '12px' }}>⚡</span>
          )}
          {info.hasLora && (
            <span
              title="LoRA 適用"
              style={{ fontSize: '12px', marginLeft: info.hasHires ? '-4px' : 0 }}
            >🎭</span>
          )}
        </div>
      </div>
    </div>
  );
}

interface HistoryGalleryProps {
  historyLength: number;
  displayedHistory: GenerationData[];
  filterDate: string;
  onSetFilterDate: (v: string) => void;
  favoritesOnly: boolean;
  onSetFavoritesOnly: (v: boolean | ((prev: boolean) => boolean)) => void;
  selectedIds: Set<string>;
  onSetSelectedIds: (v: Set<string>) => void;
  itemKey: (item: GenerationData) => string;
  onToggleSelected: (id: string) => void;
  onToggleFavorite: (item: GenerationData) => void;
  onRequestDelete: (ids: string[]) => void;
  onOpenLightbox: (url: string, sourceKey: string) => void;
  onOpenInPreview: (item: GenerationData) => void;
  morphSourceKey: string | null;
  lightboxUrl: string | null;
}

export function HistoryGallery({
  historyLength,
  displayedHistory,
  filterDate,
  onSetFilterDate,
  favoritesOnly,
  onSetFavoritesOnly,
  selectedIds,
  onSetSelectedIds,
  itemKey,
  onToggleSelected,
  onToggleFavorite,
  onRequestDelete,
  onOpenLightbox,
  onOpenInPreview,
  morphSourceKey,
  lightboxUrl,
}: HistoryGalleryProps) {
  // Anchor for Shift+click range selection. Tracks the last checkbox the user
  // clicked (whether that click selected or deselected), so Shift+click on any
  // later tile can extend a contiguous range from it. Kept in a ref because
  // it does not need to trigger a re-render.
  const lastClickedIdRef = useRef<string | null>(null);

  const handleSelectClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const anchor = lastClickedIdRef.current;
    if (e.shiftKey && anchor && anchor !== id) {
      const ids = displayedHistory.map(itemKey);
      const next = computeRangeSelectionAdd(anchor, id, ids, selectedIds);
      if (next) {
        onSetSelectedIds(next);
      } else {
        // Either endpoint isn't in the current view — fall back to a plain toggle.
        onToggleSelected(id);
      }
    } else {
      onToggleSelected(id);
    }
    lastClickedIdRef.current = id;
  };

  return (
    <div style={{ flexShrink: 0 }}>
      {/* Toolbar: date filter + result count (left) / selection + delete (right).
          Sticks to the top of the surrounding scroll container so it stays
          visible while the image grid below scrolls. */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 1,
        marginBottom: '16px',
        padding: '8px 16px',
        background: 'var(--panel-bg)',
        border: '2px solid var(--panel-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-soft)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexDirection: 'row-reverse',
        gap: '12px',
        flexWrap: 'wrap',
        minHeight: '40px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', opacity: favoritesOnly ? 0.4 : 1 }}>
            📅
            <input
              type="date"
              className="input-field"
              value={filterDate}
              onChange={(e) => { if (e.target.value) onSetFilterDate(e.target.value); }}
              disabled={favoritesOnly}
              style={{ borderRadius: '8px', padding: '5px 8px', fontSize: '13px', width: 'auto' }}
            />
          </label>
          <button
            type="button"
            onClick={() => onSetFavoritesOnly((v) => !v)}
            title={favoritesOnly ? 'お気に入りのみの表示を解除' : 'お気に入りのみ表示'}
            className="scale-hover"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 10px',
              borderRadius: '8px',
              border: favoritesOnly ? 'none' : '1.5px solid var(--panel-border)',
              background: favoritesOnly ? 'var(--pop-blue)' : 'transparent',
              color: favoritesOnly ? '#fff' : 'var(--text-secondary)',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {favoritesOnly
              ? <Star size={14} fill="#ffd43b" stroke="#ffd43b" />
              : <Star size={14} />}
            お気に入りのみ
          </button>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>{displayedHistory.length}件</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: selectedIds.size > 0 ? 'var(--pop-blue)' : 'var(--text-muted)' }}>
            {selectedIds.size}件選択
          </span>
        {(() => {
          const allDisplayedSelected = displayedHistory.length > 0
            && displayedHistory.every((it) => selectedIds.has(itemKey(it)));
          const selectAllDisabled = displayedHistory.length === 0 || allDisplayedSelected;
          return (
            <button
              type="button"
              onClick={() => onSetSelectedIds(new Set(displayedHistory.map(itemKey)))}
              disabled={selectAllDisabled}
              className={selectAllDisabled ? '' : 'scale-hover'}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--pop-blue)',
                padding: '4px 8px',
                fontSize: '13px',
                fontWeight: 800,
                cursor: selectAllDisabled ? 'not-allowed' : 'pointer',
                opacity: selectAllDisabled ? 0.6 : 1
              }}
            >
              全選択
            </button>
          );
        })()}
        <button
          type="button"
          onClick={() => onSetSelectedIds(new Set())}
          disabled={selectedIds.size === 0}
          className={selectedIds.size === 0 ? '' : 'scale-hover'}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            padding: '4px 8px',
            fontSize: '13px',
            fontWeight: 800,
            cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
            opacity: selectedIds.size === 0 ? 0.6 : 1
          }}
        >
          全解除
        </button>
        <button
          type="button"
          onClick={() => onRequestDelete([...selectedIds])}
          disabled={selectedIds.size === 0}
          className={selectedIds.size === 0 ? '' : 'scale-hover'}
          style={{
            background: 'none',
            border: 'none',
            color: selectedIds.size === 0 ? 'var(--text-muted)' : 'var(--danger)',
            padding: '4px 8px',
            fontSize: '13px',
            fontWeight: 800,
            cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
            opacity: selectedIds.size === 0 ? 0.6 : 1
          }}
        >
          削除
        </button>
        </div>
      </div>
      {displayedHistory.length > 0 ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
          gap: '18px'
        }}>
          {displayedHistory.map((item) => (
            <div
              key={itemKey(item)}
              className="glass-panel scale-hover"
              style={{
                borderRadius: '12px',
                overflow: 'hidden',
                border: selectedIds.has(itemKey(item)) ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                boxShadow: selectedIds.has(itemKey(item)) ? '0 0 0 3px rgba(51, 154, 240, 0.25)' : 'none',
                position: 'relative'
              }}
            >
              <div style={{ position: 'relative' }}>
                <img
                  src={item.thumbnailUrl ?? item.imageUrl}
                  alt={item.originalPrompt}
                  onClick={() => onOpenLightbox(item.imageUrl, itemKey(item))}
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', display: 'block', backgroundColor: 'var(--panel-bg-sunk)', cursor: 'pointer', viewTransitionName: (morphSourceKey === itemKey(item) && !lightboxUrl) ? 'lightbox-morph' : undefined }}
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                />
                <SelectButton
                  size={26}
                  isSelected={selectedIds.has(itemKey(item))}
                  onClick={(e) => handleSelectClick(e, itemKey(item))}
                />
                <FavoriteButton
                  size={26}
                  stackedAbove={26}
                  isFavorite={!!item.isFavorite}
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(item); }}
                />
              </div>

              {/* Badge indicator */}
              <div style={{
                position: 'absolute',
                top: '6px',
                right: '6px',
                background: 'rgba(255,255,255,0.92)',
                padding: '4px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 6px rgba(0,0,0,0.05)'
              }}>
                {item.backendMode === 'firebase' ? (
                  <Cloud size={11} color="var(--pop-blue)" />
                ) : (
                  <Folder size={11} color="var(--pop-orange)" />
                )}
              </div>

              {/* Caption strip below the thumbnail — clicking here recalls the
                  image into the preview tab (the same action that used to be
                  triggered by double-clicking the thumbnail itself). Separating
                  it from the image gives the two actions distinct hit targets. */}
              <div
                onClick={() => onOpenInPreview(item)}
                title="プレビューに表示"
                style={{ padding: '10px', textAlign: 'left', background: 'var(--panel-bg)', cursor: 'pointer' }}
              >
                <CaptionInfo info={buildCaptionInfo(item)} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', borderRadius: '16px', background: 'var(--panel-bg)' }}>
          {historyLength === 0
            ? '生成履歴はありません。最初の画像を生成してみましょう！🎨⚡️'
            : '指定した日付の画像はありません 📅'}
        </div>
      )}
    </div>
  );
}
