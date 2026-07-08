import { Trash2 } from 'lucide-react';
import { t } from '../i18n';

interface DeleteConfirmModalProps {
  open: boolean;
  targetCount: number;
  deleting: boolean;
  exiting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmModal({ open, targetCount, deleting, exiting, onCancel, onConfirm }: DeleteConfirmModalProps) {
  if (!open) return null;
  return (
    <div className={`dialog-overlay${exiting ? ' exiting' : ''}`} style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 120,
      padding: '20px'
    }}>
      <div className={`glass-panel dialog-panel${exiting ? ' exiting' : ''}`} style={{
        width: '100%',
        maxWidth: '420px',
        borderRadius: '20px',
        padding: '28px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        textAlign: 'center',
        border: '2px solid var(--danger)',
        background: 'var(--panel-bg)'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(255, 107, 107, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trash2 size={26} color="var(--danger)" />
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
            {t.deleteConfirm.title}
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
            {t.deleteConfirm.message(targetCount)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="scale-hover"
            style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-secondary)', fontWeight: '800', cursor: 'pointer' }}
          >
            {t.deleteConfirm.cancelButton}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="scale-hover"
            style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: 'var(--danger)', color: '#fff', fontWeight: '800', cursor: deleting ? 'wait' : 'pointer', opacity: deleting ? 0.7 : 1 }}
          >
            {deleting ? t.deleteConfirm.deleting : t.deleteConfirm.confirmButton}
          </button>
        </div>
      </div>
    </div>
  );
}
