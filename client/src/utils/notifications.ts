// Thin wrapper around the browser Notification API for the "画像生成が終わったら
// OS 通知を出す" feature. Kept as pure module-level functions so callers do not
// have to worry about feature detection or permission juggling.

const STORAGE_KEY = 'sumica:notifications-enabled';

export type NotificationSupport = {
  supported: boolean;
  permission: NotificationPermission | null;
};

export function getNotificationSupport(): NotificationSupport {
  if (typeof Notification === 'undefined') {
    return { supported: false, permission: null };
  }
  return { supported: true, permission: Notification.permission };
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  return await Notification.requestPermission();
}

// Load the user's opt-in preference from localStorage. Returns false when
// storage is unavailable or the preference was never set / was disabled.
export function loadNotificationPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveNotificationPreference(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage may be blocked (private mode etc.); silently ignore.
  }
}

// Fire a single OS notification. Silently no-ops when the API is missing or
// permission has not been granted; the caller can call unconditionally.
// Clicking the notification focuses the Sumica window/tab.
export function sendNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    const notification = new Notification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (err) {
    // Some browsers throw when creating notifications from a non-visible or
    // otherwise disallowed context; keep the failure silent.
    console.error('sendNotification failed:', err);
  }
}
