import * as React from 'react';

/** Per-browser UI preferences kept in localStorage. Losing them only resets the view. */
function useLocalPref<T extends string>(key: string, read: () => T): [T, (v: T) => void] {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* fall through to the default */
    }
    return read();
  });
  const set = React.useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* per-viewer convenience only */
      }
    },
    [key],
  );
  return [value, set];
}

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

export type PlanView = 'ledger' | 'board';

export function usePlanView(): [PlanView, (v: PlanView) => void] {
  const [view, setView] = useLocalPref<PlanView>('sf.view', () => 'ledger');
  return [view === 'board' ? 'board' : 'ledger', setView];
}
