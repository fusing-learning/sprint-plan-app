import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = React.useCallback<ConfirmFn>((options) => new Promise((resolve) => setState({ ...options, resolve })), []);

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!state} onOpenChange={(open) => !open && close(false)}>
        <DialogContent className="max-w-md" hideClose>
          {state && (
            <>
              <DialogHeader className="flex-row items-start gap-3 pr-5">
                {state.destructive && (
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                    <AlertTriangle className="size-4" />
                  </span>
                )}
                <div className="flex flex-col gap-1">
                  <DialogTitle>{state.title}</DialogTitle>
                  {state.description && <DialogDescription asChild><div>{state.description}</div></DialogDescription>}
                </div>
              </DialogHeader>
              <DialogFooter className="mt-2">
                <Button variant="secondary" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button variant={state.destructive ? 'destructive' : 'default'} onClick={() => close(true)} autoFocus>
                  {state.confirmLabel ?? 'Confirm'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = React.useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used inside ConfirmProvider');
  return fn;
}
