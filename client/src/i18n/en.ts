import type { ja } from './ja';

export const en: typeof ja = {
  header: {
    title: 'Sumica AI Studio 🎨⚡️',
    subtitle: 'Creative Image Lab',
    cloudSaving: 'Cloud storage ☁️',
    localSaving: 'Local storage 📁',
    userLabel: 'User',
    signOut: 'Sign out',
    signIn: 'Sign in with Google',
    signInFailed: (msg) => `Sign-in failed: ${msg}`,
    serviceChecking: (label) => `${label} checking…`,
    serviceConnected: (label, detail) =>
      `${label} connected${detail ? ` (${detail})` : ''}`,
    serviceDisconnected: (label) => `${label} not connected`,
    lmStudioLabel: 'LM Studio',
    sdLabel: 'SD',
    notifyEnable: 'Enable notifications',
    notifyDisable: 'Disable notifications',
  },
};
