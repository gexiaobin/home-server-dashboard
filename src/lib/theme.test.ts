// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, getStoredTheme, storeTheme, THEME_STORAGE_KEY } from './theme';

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
  document.querySelector('meta[name="theme-color"]')?.remove();
});

describe('theme preferences', () => {
  it('defaults to dark and persists a light preference', () => {
    expect(getStoredTheme()).toBe('dark');

    storeTheme('light');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(getStoredTheme()).toBe('light');
  });

  it('applies the theme to the document and browser chrome color', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);

    applyTheme('light');

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(meta.content).toBe('#f3f5f6');
  });
});
