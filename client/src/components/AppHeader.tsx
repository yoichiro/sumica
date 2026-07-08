import { Sparkles, Cloud, Folder, LogIn, Bell, BellOff } from 'lucide-react';
import { isFirebaseConfigured, signInWithGoogle, signOutUser, type AuthUser } from '../firebase';
import { t } from '../i18n';

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
    ? t.header.serviceChecking(label)
    : connected
      ? t.header.serviceConnected(label, shownDetail ?? undefined)
      : t.header.serviceDisconnected(label);
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
  notificationsEnabled: boolean;
  onToggleNotifications: () => void;
}

export function AppHeader({ user, cloudActive, health, healthChecking, onSignInError, notificationsEnabled, onToggleNotifications }: AppHeaderProps) {
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
            {t.header.title}
          </h1>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase', letterSpacing: '1.5px', marginTop: '1px', fontWeight: '700' }}>
            {t.header.subtitle}
          </span>
        </div>
      </div>

      {/* STATUS BAR & SETTINGS BUTTON */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* OS notification opt-in toggle. Clicking flips the preference; if the
            browser hasn't been asked for permission yet, the parent handler
            will trigger the request dialog. */}
        <button
          type="button"
          onClick={onToggleNotifications}
          title={notificationsEnabled ? t.header.notifyDisable : t.header.notifyEnable}
          className="scale-hover"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            border: '2px solid var(--panel-border)',
            background: notificationsEnabled ? 'var(--pop-blue)' : 'var(--panel-bg)',
            color: notificationsEnabled ? '#fff' : 'var(--text-secondary)',
            cursor: 'pointer',
            boxShadow: notificationsEnabled ? '0 2px 8px rgba(51, 154, 240, 0.3)' : 'none',
          }}
        >
          {notificationsEnabled ? <Bell size={16} /> : <BellOff size={16} />}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', background: 'var(--panel-bg-sunk)', padding: '8px 16px', borderRadius: '30px', border: '2px solid var(--panel-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
          {/* Storage mode + account */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: cloudActive ? 'var(--pop-green)' : 'var(--text-secondary)', fontWeight: '700' }}>
            {cloudActive ? (<><Cloud size={14} /><span>{t.header.cloudSaving}</span></>) : (<><Folder size={14} /><span>{t.header.localSaving}</span></>)}
          </div>

          {isFirebaseConfigured && (
            <>
              <div style={{ width: '2px', height: '12px', background: 'var(--panel-border)' }}></div>
              {user ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {user.photoURL && (
                    <img src={user.photoURL} alt="" referrerPolicy="no-referrer" style={{ width: 22, height: 22, borderRadius: '50%' }} />
                  )}
                  <span style={{ fontWeight: 700, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.displayName ?? t.header.userLabel}</span>
                  <button onClick={() => { signOutUser(); }} className="scale-hover" style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>{t.header.signOut}</button>
                </div>
              ) : (
                <button
                  onClick={() => { signInWithGoogle().catch((e) => onSignInError(t.header.signInFailed(e.message))); }}
                  className="scale-hover"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', borderRadius: '20px', padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                >
                  <LogIn size={14} /> {t.header.signIn}
                </button>
              )}
            </>
          )}

          <div style={{ width: '2px', height: '12px', background: 'var(--panel-border)' }}></div>

          {/* LM Studio Status (live health check) */}
          <ServiceStatusBadge
            label={t.header.lmStudioLabel}
            checking={healthChecking && !health}
            connected={!!health?.lmStudio.connected}
            detail={health?.lmStudio.model}
          />

          <div style={{ width: '2px', height: '12px', background: 'var(--panel-border)' }}></div>

          {/* Stable Diffusion Status (live health check) */}
          <ServiceStatusBadge
            label={t.header.sdLabel}
            checking={healthChecking && !health}
            connected={!!health?.stableDiffusion.connected}
          />
        </div>
      </div>
    </header>
  );
}
