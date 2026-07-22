import { useEffect } from 'react';
import { Filter, X } from 'lucide-react';
import { t } from '../i18n';
import type { AspectRatioOption, GalleryFilters } from './galleryFilters';
import { countActiveFilters } from './galleryFilters';

// Gallery filter UI, split into two named exports so the parent can render the
// toggle button inside its toolbar row and the panel inline BELOW that row.
// The 2026-07-15 iteration originally shipped this as an overlay popover, but
// the workflow turned out to be exploratory (twist filters, watch grid update,
// repeat) — the popover covered the grid it was meant to reveal, so the panel
// now flows as a normal block that pushes the grid down when open. The button
// still carries the shared `view-transition-name: gallery-filter-morph` with
// the panel so the browser interpolates the button rect ↔ panel rect on
// open/close (App.tsx side wraps setState in startViewTransition + flushSync).

// ── Toggle button ──────────────────────────────────────────────────────

export interface GalleryFilterToggleButtonProps {
  filters: GalleryFilters;
  open: boolean;
  onToggle: (next: boolean) => void;
}

export function GalleryFilterToggleButton({ filters, open, onToggle }: GalleryFilterToggleButtonProps) {
  const active = countActiveFilters(filters);
  return (
    <button
      type="button"
      onClick={() => onToggle(!open)}
      className="scale-hover"
      style={{
        // The button itself is a transparent frame — its background/border
        // live on a sibling `<span>` below, which is what actually carries
        // the shared view-transition-name. Keeping the label off the morph
        // target stops the text from being interpolated (stretched) into the
        // panel rect during open/close.
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 10px',
        border: 'none',
        background: 'transparent',
        color: active > 0 ? '#fff' : 'var(--text-secondary)',
        fontSize: '12px',
        fontWeight: 800,
        cursor: 'pointer',
      }}
    >
      {/* Border-only frame: this is the sole element that morphs into the
          panel's outline. Absolute-positioned behind the content, drops the
          view-transition-name while the panel is open so both instances
          never carry it simultaneously. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          border: active > 0 ? 'none' : '1.5px solid var(--panel-border)',
          background: active > 0 ? 'var(--pop-blue)' : 'transparent',
          borderRadius: '8px',
          pointerEvents: 'none',
          viewTransitionName: open ? undefined : 'gallery-filter-morph',
        }}
      />
      <Filter size={14} style={{ position: 'relative' }} />
      <span style={{ position: 'relative' }}>{t.gallery.filters.buttonLabel}</span>
      {active > 0 && <span style={{ position: 'relative' }}>{t.gallery.filters.activeCountSuffix(active)}</span>}
    </button>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────

export interface GalleryFilterPanelProps {
  filters: GalleryFilters;
  onSetFilters: (filters: GalleryFilters) => void;
  availableModels: string[];
  availableSamplers: string[];
  availableAspectRatios: AspectRatioOption[];
  availableOrientations: Exclude<GalleryFilters['orientation'], null>[];
  onClose: () => void;
}

export function GalleryFilterPanel({
  filters,
  onSetFilters,
  availableModels,
  availableSamplers,
  availableAspectRatios,
  availableOrientations,
  onClose,
}: GalleryFilterPanelProps) {
  const showModel = availableModels.length > 1;
  const showSampler = availableSamplers.length > 1;
  const showAspectRatio = availableAspectRatios.length > 1;
  // Orientation only makes sense when the day has both landscape and portrait
  // records AND the user isn't restricting to 1:1 (which is inherently square).
  const showOrientation = availableOrientations.length > 1 && filters.aspectRatio !== '1:1';

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const clear = () => onSetFilters({ arch: null, model: null, sampler: null, aspectRatio: null, orientation: null });

  const archOptions: { value: GalleryFilters['arch']; label: string }[] = [
    { value: null, label: t.gallery.filters.archAll },
    { value: 'sdxl', label: 'SDXL' },
    { value: 'sd15', label: 'SD1.5' },
    { value: 'flux', label: t.controlPanel.archFluxLabel },
  ];

  return (
    <div
      role="region"
      aria-label={t.gallery.filters.buttonLabel}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '16px 24px',
        padding: '12px 16px',
        borderRadius: '10px',
        border: '1px solid var(--panel-border)',
        background: 'var(--panel-bg)',
        boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        // Paired with the toggle button's `view-transition-name`; the button
        // drops the name while the panel is up so the browser interpolates
        // the button rect ↔ this panel rect on open/close.
        viewTransitionName: 'gallery-filter-morph',
      }}
    >
      <FilterGroup label={t.gallery.filters.archLabel}>
        {archOptions.map((opt) => (
          <RadioOption
            key={String(opt.value)}
            checked={filters.arch === opt.value}
            onChange={() => onSetFilters({ ...filters, arch: opt.value })}
            label={opt.label}
          />
        ))}
      </FilterGroup>

      {showAspectRatio && (
        <FilterSelectGroup
          label={t.gallery.filters.aspectRatioLabel}
          value={filters.aspectRatio ?? ''}
          onChange={(v) => onSetFilters({ ...filters, aspectRatio: v || null })}
          allLabel={t.gallery.filters.aspectRatioAll}
          options={availableAspectRatios.map((a) => ({ value: a.ratio, label: a.label }))}
        />
      )}

      {showOrientation && (
        <FilterGroup label={t.gallery.filters.orientationLabel}>
          {[
            { value: null as GalleryFilters['orientation'], label: t.gallery.filters.orientationAll },
            { value: 'landscape' as const, label: t.gallery.filters.orientationLandscape },
            { value: 'portrait' as const, label: t.gallery.filters.orientationPortrait },
          ].map((opt) => (
            <RadioOption
              key={String(opt.value)}
              checked={filters.orientation === opt.value}
              onChange={() => onSetFilters({ ...filters, orientation: opt.value })}
              label={opt.label}
            />
          ))}
        </FilterGroup>
      )}

      {showModel && (
        <FilterSelectGroup
          label={t.gallery.filters.modelLabel}
          value={filters.model ?? ''}
          onChange={(v) => onSetFilters({ ...filters, model: v || null })}
          allLabel={t.gallery.filters.modelAll}
          options={availableModels}
        />
      )}

      {showSampler && (
        <FilterSelectGroup
          label={t.gallery.filters.samplerLabel}
          value={filters.sampler ?? ''}
          onChange={(v) => onSetFilters({ ...filters, sampler: v || null })}
          allLabel={t.gallery.filters.samplerAll}
          options={availableSamplers}
        />
      )}

      {/* Right-anchored cluster: Clear + X stay together and always slide to
          the far right (marginLeft: auto). Wrapping them in a single flex
          child means that when the panel flex-wraps to a narrow width, the
          pair wraps as one unit and the X button never ends up left-aligned
          on its own row. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
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
          onClick={onClose}
          title={t.gallery.filters.closeButton}
          aria-label={t.gallery.filters.closeButton}
          className="scale-hover"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Small internal presentational helpers ──────────────────────────────

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function RadioOption({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', cursor: 'pointer' }}>
      <input type="radio" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function FilterSelectGroup({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  allLabel: string;
  // Accepts either plain strings (value===label, used by model/sampler) or
  // { value, label } pairs when the display string differs from the filter
  // key (used by aspect ratio to show "4:3 (1024×768)").
  options: ReadonlyArray<string | { value: string; label: string }>;
}) {
  const normalized = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
      {/* Deliberately not using the .input-field class: that variant is tuned
          for large form inputs (padding: 12px 16px, font-size: 15px), which
          would tower over the neighbouring radio groups. Compact inline
          styles below match the radio-row height (~24px) so all filter axes
          sit on the same visual baseline. */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: '22px',
          padding: '0 6px',
          fontSize: '13px',
          lineHeight: '20px',
          fontFamily: 'inherit',
          color: 'var(--text-primary)',
          background: 'var(--input-bg)',
          border: '1.5px solid var(--panel-border)',
          borderRadius: '6px',
          maxWidth: '260px',
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        <option value="">{allLabel}</option>
        {normalized.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
