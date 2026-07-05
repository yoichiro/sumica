import type { MutableRefObject } from 'react';
import { Star, Cloud, Folder, CheckCircle2, Circle } from 'lucide-react';
import type { GenerationData } from '../App';

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
  galleryClickTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  galleryClickDelayMs: number;
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
  galleryClickTimerRef,
  galleryClickDelayMs,
}: HistoryGalleryProps) {
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
                  onClick={() => {
                    if (galleryClickTimerRef.current !== null) {
                      clearTimeout(galleryClickTimerRef.current);
                    }
                    const url = item.imageUrl;
                    const key = itemKey(item);
                    galleryClickTimerRef.current = setTimeout(() => {
                      galleryClickTimerRef.current = null;
                      onOpenLightbox(url, key);
                    }, galleryClickDelayMs);
                  }}
                  onDoubleClick={() => {
                    if (galleryClickTimerRef.current !== null) {
                      clearTimeout(galleryClickTimerRef.current);
                      galleryClickTimerRef.current = null;
                    }
                    onOpenInPreview(item);
                  }}
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', display: 'block', backgroundColor: 'var(--panel-bg-sunk)', cursor: 'pointer', viewTransitionName: (morphSourceKey === itemKey(item) && !lightboxUrl) ? 'lightbox-morph' : undefined }}
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                />
                <SelectButton
                  size={26}
                  isSelected={selectedIds.has(itemKey(item))}
                  onClick={(e) => { e.stopPropagation(); onToggleSelected(itemKey(item)); }}
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

              <div style={{ padding: '10px', textAlign: 'left', background: 'var(--panel-bg)' }}>
                <p style={{
                  fontSize: '12px',
                  fontWeight: '700',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  margin: 0,
                  color: 'var(--text-primary)'
                }}>
                  {item.originalPrompt}
                </p>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  {new Date(item.timestamp).toLocaleDateString()}
                </span>
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
