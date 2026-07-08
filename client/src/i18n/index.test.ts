import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveLocale } from './index';

// Save/restore the mocked window.location and navigator across tests.
let originalLocation: Location;
let originalNavigator: Navigator;

function mockEnv(search: string, language: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, search },
  });
  Object.defineProperty(navigator, 'language', {
    configurable: true,
    value: language,
  });
}

describe('resolveLocale', () => {
  beforeEach(() => {
    originalLocation = window.location;
    originalNavigator = navigator;
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: originalNavigator.language,
    });
  });

  it('returns "ja" when URL has ?hl=ja', () => {
    mockEnv('?hl=ja', 'en-US');
    expect(resolveLocale()).toBe('ja');
  });

  it('returns "en" when URL has ?hl=en', () => {
    mockEnv('?hl=en', 'ja-JP');
    expect(resolveLocale()).toBe('en');
  });

  it('falls back to navigator.language when hl is invalid (e.g. ?hl=fr)', () => {
    mockEnv('?hl=fr', 'ja-JP');
    expect(resolveLocale()).toBe('ja');
  });

  it('returns "ja" when no URL param and navigator.language is "ja-JP"', () => {
    mockEnv('', 'ja-JP');
    expect(resolveLocale()).toBe('ja');
  });

  it('returns "ja" when no URL param and navigator.language is "ja"', () => {
    mockEnv('', 'ja');
    expect(resolveLocale()).toBe('ja');
  });

  it('returns "en" when no URL param and navigator.language is "en-US"', () => {
    mockEnv('', 'en-US');
    expect(resolveLocale()).toBe('en');
  });

  it('returns "en" fallback when navigator.language is unrelated (e.g. "fr-FR")', () => {
    mockEnv('', 'fr-FR');
    expect(resolveLocale()).toBe('en');
  });

  it('handles uppercase navigator.language ("JA-JP")', () => {
    mockEnv('', 'JA-JP');
    expect(resolveLocale()).toBe('ja');
  });
});
