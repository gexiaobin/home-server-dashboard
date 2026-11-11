export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'dashboard-theme';

const THEME_COLORS: Record<Theme, string> = {
  dark: '#090b0d',
  light: '#f3f5f6',
};

export function getStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function storeTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The selected theme still applies to this tab when browser storage is unavailable.
  }
}
