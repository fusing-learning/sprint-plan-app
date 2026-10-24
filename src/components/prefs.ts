import * as React from 'react';

export type Theme = 'light' | 'dark';

// The theme lives on <html class="dark">, set before first paint by the script in index.html
// (saved choice, else the system setting). Every useTheme() reads the same class, so the
// header toggle and the toaster stay in sync.
const themeListeners = new Set<() => void>();
const readTheme = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

function setTheme(theme: Theme) {
  // Switch instantly: without this, every transition-colors element fades through mixed colours.
  const root = document.documentElement;
  root.classList.add('theme-switching');
  root.classList.toggle('dark', theme === 'dark');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  try {
    localStorage.setItem('sf.theme', JSON.stringify(theme));
  } catch {
    /* per-viewer convenience only */
  }
  themeListeners.forEach((l) => l());
}

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  return [React.useSyncExternalStore(subscribeTheme, readTheme), setTheme];
}
