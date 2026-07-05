import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'success';
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast-item ${toast.type}`}>
          <div style={{
            color: toast.type === 'error' ? 'var(--danger)' : 'var(--success)',
            display: 'flex',
            alignItems: 'center',
            marginTop: '2px',
            flexShrink: 0
          }}>
            {toast.type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          </div>
          <div className="toast-message">{toast.message}</div>
          <button
            onClick={() => onRemove(toast.id)}
            className="toast-close-btn"
            title="閉じる"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
