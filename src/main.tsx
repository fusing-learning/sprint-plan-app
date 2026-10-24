import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import '@fontsource-variable/inter';
import './index.css';
import App from './App';
import { DexiePlanningRepository } from './data/dexieRepository';
import { PlanningStore } from './state/planningStore';
import { StoreProvider, UiProvider, useStoreState } from './state/react';
import { ConfirmProvider } from './components/ui/confirm';
import { TooltipProvider } from './components/ui/misc';
import { useTheme } from './components/prefs';
import { toast } from 'sonner';

const store = new PlanningStore(new DexiePlanningRepository(), undefined, (e) => {
  console.error(e);
  toast.error('Could not save to local storage', { description: e instanceof Error ? e.message : String(e) });
});
void store.init();
// Ask the browser not to evict local data under storage pressure (best effort).
void navigator.storage?.persist?.().catch(() => undefined);

// Exposed for debugging and smoke tests only.
(window as unknown as { __sprintflow?: PlanningStore }).__sprintflow = store;

function Root() {
  const state = useStoreState();
  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-[13px] text-muted-foreground">
        <span className="mr-2 size-4 animate-spin rounded-full border-2 border-slate-300 dark:border-slate-600 border-t-primary" />
        Loading your workspace…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border bg-surface p-6 text-center shadow-card">
          <h1 className="text-[15px] font-semibold">SprintFlow couldn’t open its local database</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">{state.error}</p>
          <p className="mt-2 text-[12.5px] text-muted-foreground">Private browsing modes or blocked site data can prevent IndexedDB from working. Your existing data has not been deleted.</p>
        </div>
      </div>
    );
  }
  return (
    <UiProvider>
      <App />
    </UiProvider>
  );
}

function ThemedToaster() {
  const [theme] = useTheme();
  return <Toaster theme={theme} position="bottom-left" richColors closeButton toastOptions={{ className: 'text-[13px]' }} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider store={store}>
      <TooltipProvider delayDuration={350} skipDelayDuration={100}>
        <ConfirmProvider>
          <Root />
          <ThemedToaster />
        </ConfirmProvider>
      </TooltipProvider>
    </StoreProvider>
  </React.StrictMode>,
);
