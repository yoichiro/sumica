import { ja } from './ja';
import { en } from './en';

export type Locale = 'ja' | 'en';

// Resolve the UI locale once at module load. Priority: URL query ?hl=ja/en
// override, then navigator.language starting with "ja" → ja, otherwise en.
// Invalid hl values (e.g. ?hl=fr) fall through to navigator.language, so
// a mistyped URL never breaks the app.
export function resolveLocale(): Locale {
  const hl = new URLSearchParams(window.location.search).get('hl');
  if (hl === 'ja') return 'ja';
  if (hl === 'en') return 'en';
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export const locale: Locale = resolveLocale();
export const t = locale === 'ja' ? ja : en;

// Set the HTML lang attribute so browser spell-check, screen readers, and
// CSS :lang() selectors align with the actual UI language.
if (typeof document !== 'undefined') {
  document.documentElement.lang = locale;
}
