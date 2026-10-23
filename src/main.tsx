import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import '@fontsource-variable/inter';
import './index.css';
import App from './App';
import { DexiePlanningRepository } from './data/dexieRepository';
import { HttpPlanningRepository } from './data/httpRepository';
import { WriteConflictError } from './data/repository';
import { PlanningStore } from './state/planningStore';
import { StoreProvider, UiProvider, useStoreState } from './state/react';
import { ConfirmProvider } from './components/ui/confirm';
import { TooltipProvider } from './components/ui/misc';
import { toast } from 'sonner';

// The SprintFlow server (`npm start`) marks the page it serves; otherwise data stays in this browser.
const shared = !!document.querySelector('meta[name="sprintflow-mode"][content="shared"]') || import.meta.env.VITE_SHARED === '1';

const store = new PlanningStore(shared ? new HttpPlanningRepository() : new DexiePlanningRepository(), undefined, (e) => {
  console.error(e);
  if (e instanceof WriteConflictError) {
    toast.error('Someone else changed the plan at the same moment', {
      description: 'Your last change was not saved. The latest plan is loaded — please make the change again.',
      duration: 8000,
    });
  } else {
    toast.error(shared ? 'Could not save to the shared workspace' : 'Could not save to local storage', {
      description: e instanceof Error ? e.message : String(e),
    });
  }
});
void store.init();
// Ask the browser not to evict local data under storage pressure (best effort).
if (!shared) void navigator.storage?.persist?.().catch(() => undefined);

// Exposed for debugging and smoke tests only.
(window as unknown as { __sprintflow?: PlanningStore }).__sprintflow = store;

function Root() {
  const state = useStoreState();
  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-[13px] text-muted-foreground">
        <span className="mr-2 size-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        Loading your workspace…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border bg-surface p-6 text-center shadow-card">
          <h1 className="text-[15px] font-semibold">{shared ? 'SprintFlow couldn’t reach the shared workspace' : 'SprintFlow couldn’t open its local database'}</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">{state.error}</p>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {shared
              ? 'Check that the SprintFlow server is running and this computer is on the same network, then reload the page.'
              : 'Private browsing modes or blocked site data can prevent IndexedDB from working. Your existing data has not been deleted.'}
          </p>
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider store={store}>
      <TooltipProvider delayDuration={350} skipDelayDuration={100}>
        <ConfirmProvider>
          <Root />
          <Toaster position="bottom-left" richColors closeButton toastOptions={{ className: 'text-[13px]' }} />
        </ConfirmProvider>
      </TooltipProvider>
    </StoreProvider>
  </React.StrictMode>,
);
