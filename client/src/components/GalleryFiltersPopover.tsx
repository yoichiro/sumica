import { useEffect, useRef, useState } from 'react';
import { Filter } from 'lucide-react';
import { t } from '../i18n';
import type { GalleryFilters } from './galleryFilters';
import { countActiveFilters } from './galleryFilters';

// Toggle button + popover for the gallery-side filter surface added in the
// 2026-07-15 filter-expansion pass. Renders a Filter icon button next to the
// existing date + favorites controls; opening it exposes an arch radio group
// and two native selects (model, sampler). Auto-hides fields whose distinct
// value set has <= 1 entries, since filtering by an axis with a single option
// is not useful.
export interface GalleryFiltersPopoverProps {
  filters: GalleryFilters;
  onSetFilters: (filters: GalleryFilters) => void;
  availableModels: string[];
  availableSamplers: string[];
}

export function GalleryFiltersPopover({
  filters,
  onSetFilters,
  availableModels,
  availableSamplers,
}: GalleryFiltersPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const active = countActiveFilters(filters);

  const showModel = availableModels.length > 1;
  const showSampler = availableSamplers.length > 1;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const clear = () => onSetFilters({ arch: null, model: null, sampler: null });

  const archOptions: { value: GalleryFilters['arch']; label: string }[] = [
    { value: null, label: t.gallery.filters.archAll },
    { value: 'sdxl', label: 'SDXL' },
    { value: 'sd15', label: 'SD1.5' },
  ];

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="scale-hover"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 10px',
          borderRadius: '8px',
          border: active > 0 ? 'none' : '1.5px solid var(--panel-border)',
          background: active > 0 ? 'var(--pop-blue)' : 'transparent',
          color: active > 0 ? '#fff' : 'var(--text-secondary)',
          fontSize: '12px',
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        <Filter size={14} />
        {t.gallery.filters.buttonLabel}
        {active > 0 && t.gallery.filters.activeCountSuffix(active)}
      </button>
      {open && (
        <div
          role="dialog"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 100,
            minWidth: '280px',
            padding: '16px',
            borderRadius: '10px',
            border: '1px solid var(--panel-border)',
            background: 'var(--panel-bg)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              {t.gallery.filters.archLabel}
            </label>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {archOptions.map((opt) => (
                <label
                  key={String(opt.value)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', cursor: 'pointer' }}
                >
                  <input
                    type="radio"
                    checked={filters.arch === opt.value}
                    onChange={() => onSetFilters({ ...filters, arch: opt.value })}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          {showModel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                {t.gallery.filters.modelLabel}
              </label>
              <select
                className="input-field"
                value={filters.model ?? ''}
                onChange={(e) => onSetFilters({ ...filters, model: e.target.value || null })}
                style={{ borderRadius: '8px' }}
              >
                <option value="">{t.gallery.filters.modelAll}</option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}
          {showSampler && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                {t.gallery.filters.samplerLabel}
              </label>
              <select
                className="input-field"
                value={filters.sampler ?? ''}
                onChange={(e) => onSetFilters({ ...filters, sampler: e.target.value || null })}
                style={{ borderRadius: '8px' }}
              >
                <option value="">{t.gallery.filters.samplerAll}</option>
                {availableSamplers.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button
              type="button"
              onClick={clear}
              className="scale-hover"
              style={{
                padding: '5px 10px',
                borderRadius: '8px',
                border: '1.5px solid var(--panel-border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t.gallery.filters.clearButton}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: '5px 10px',
                borderRadius: '8px',
                border: 'none',
                background: 'var(--pop-blue)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t.gallery.filters.closeButton}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
