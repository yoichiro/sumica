import type { GenStatus } from './PreviewPanel';

// Small inline badge that appears in the Preview tab label whenever a generation
// is in flight, so users watching the History Gallery still see that work is
// running. Renders nothing when idle so it doesn't take space at rest.
interface GenerationBadgeProps {
  genStatus: GenStatus;
  batchProgress: { current: number; total: number } | null;
}

// Active generation states — anything that isn't 'idle', 'success', or 'error'
// counts as "in flight" for the badge's purposes. Success/error are shown by
// other UI (the process tracker card + toasts), so the tab-label badge only
// needs to signal "still working."
function isActive(status: GenStatus): boolean {
  return status === 'enhancing' || status === 'generating' || status === 'saving';
}

export function GenerationBadge({ genStatus, batchProgress }: GenerationBadgeProps) {
  if (!isActive(genStatus)) return null;
  const counter = batchProgress ? ` ${batchProgress.current}/${batchProgress.total}` : '';
  return (
    <span
      role="status"
      aria-label={batchProgress
        ? `画像 ${batchProgress.current}/${batchProgress.total} 生成中`
        : '生成中'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        marginLeft: '6px',
        padding: '1px 6px',
        borderRadius: '10px',
        background: 'var(--pop-blue)',
        color: '#fff',
        fontSize: '11px',
        fontWeight: 800,
        lineHeight: 1.4,
        verticalAlign: 'middle',
      }}
    >
      ⚡️{counter}
    </span>
  );
}
