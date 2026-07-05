import { Sparkles, Cloud, Folder, LogIn } from 'lucide-react';
import { isFirebaseConfigured, signInWithGoogle, signOutUser, type AuthUser } from '../firebase';

export interface HealthStatus {
  lmStudio: { connected: boolean; model: string | null; error: string | null };
  stableDiffusion: { connected: boolean; error: string | null };
}

// Top-right connection indicator for a single upstream service.
// checking → muted pulsing dot, connected → green (with optional model name), else → red.
function ServiceStatusBadge({ label, checking, connected, detail }: {
  label: string;
  checking: boolean;
  connected: boolean;
  detail?: string | null;
}) {
  const color = checking ? 'var(--text-muted)' : connected ? 'var(--pop-green)' : 'var(--danger)';
  // Long model names would blow out the status bar, so cap the shown detail at ~20 chars;
  // full value stays on hover via the title attribute.
  const shownDetail = detail && detail.length > 20 ? `${detail.slice(0, 20)}...` : detail;
  const text = checking
    ? `${label} 確認中…`
    : connected
      ? `${label} 接続中${shownDetail ? ` (${shownDetail})` : ''}`
      : `${label} 未接続`;
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: '6px', color, fontWeight: '700' }}
      title={connected && detail ? detail : undefined}
    >
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color,
        boxShadow: connected && !checking ? `0 0 6px ${color}` : 'none',
        animation: checking ? 'pulse 1.2s ease-in-out infinite' : 'none',
      }}></span>
      <span>{text}</span>
    </div>
  );
}

interface AppHeaderProps {
  user: AuthUser | null;
  cloudActive: boolean;
  health: HealthStatus | null;
  healthChecking: boolean;
  onSignInError: (message: string) => void;
}

export function AppHeader({ user, cloudActive, health, healthChecking, onSignInError }: AppHeaderProps) {
  return (
    <header className="glass-panel" style={{
      margin: '20px',
      padding: '16px 24px',
      borderRadius: '18px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      background: 'var(--panel-bg)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--pop-blue) 0%, var(--pop-teal) 100%)',
          width: '42px',
          height: '42px',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(51, 154, 240, 0.25)'
        }}>
          <Sparkles size={22} color="#fff" />
        </div>
        <div style={{ textAlign: 'left' }}>
          <h1 style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '0.2px', margin: 0, background: 'linear-gradient(135deg, var(--pop-blue) 30%, var(--pop-teal) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Sumica AI Studio 🎨⚡️
          </h1>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase', letterSpacing: '1.5px', marginTop: '1px', fontWeight: '700' }}>
            Creative Image Lab
          </span>
        </div>
      </div>

      {/* STATUS BAR & SETTINGS BUTTON */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', background: 'var(--panel-bg-sunk)', padding: '8px 16px', borderRadius: '30px', border: '2px solid var(--panel-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
          {/* Storage mode + account */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: cloudActive ? 'var(--pop-green)' : 'var(--text-secondary)', fontWeight: '700' }}>
            {cloudActive ? (<><Cloud size={14} /><span>クラウド保存 ☁️</span></>) : (<><Folder size={14} /><span>ローカル保存 📁</span></>)}
          </div>

          {isFirebaseConfigured && (
            <>
              <div style={{ width: '2px', height: '12px', background: 'var(--panel-border)' }}></div>
              {user ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {user.photoURL && (
                    <img src={user.photoURL} alt="" referrerPolicy="no-referrer" style={{ width: 22, height: 22, borderRadius: '50%' }} />
                  )}
                  <span style={{ fontWeight: 700, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.displayName ?? 'ユーザー'}</span>
                  <button onClick={() => { signOutUser(); }} className="scale-hover" style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>ログアウト</button>
                </div>
              ) : (
                <button
                  onClick={() => { signInWithGoogle().catch((e) => onSignInError(`サインインに失敗しました: ${e.message}`)); }}
                  className="scale-hover"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', borderRadius: '20px', padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                >
                  <LogIn size={14} /> Googleでログイン
                </button>
              )}
            </>
          )}

          <div style={{ width: '2px', height: '12px', background: 'var(--panel-border)' }}></div>

          {/* LM Studio Status (live health check) */}
          <ServiceStatusBadge
            label="LM Studio"
            checking={healthChecking && !health}
            connected={!!health?.lmStudio.connected}
            detail={health?.lmStudio.model}
          />

          <div style={{ width: '2px', height: '12px', background: 'var(--panel-border)' }}></div>

          {/* Stable Diffusion Status (live health check) */}
          <ServiceStatusBadge
            label="SD"
            checking={healthChecking && !health}
            connected={!!health?.stableDiffusion.connected}
          />
        </div>
      </div>
    </header>
  );
}
