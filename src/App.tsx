import * as React from 'react';
import type { Sprint } from '@/domain/types';
import { useUi } from '@/state/react';
import { cn } from '@/lib/utils';
import { Board } from './components/board/Board';
import { CapacityPanel } from './components/capacity/CapacityPanel';
import { CloseSprintDialog, SprintDialog } from './components/dialogs/SprintDialogs';
import { DataDialog, TeamDialog } from './components/dialogs/TeamAndDataDialogs';
import { TicketDialog } from './components/dialogs/TicketDialog';
import { HistoryView } from './components/history/HistoryView';
import { MainHeader } from './components/layout/MainHeader';
import { Sidebar } from './components/layout/Sidebar';
import { Dialog, DialogTitle } from './components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';

export default function App() {
  const ui = useUi();
  const [sprintDialog, setSprintDialog] = React.useState<{ sprint: Sprint | null } | null>(null);
  const [closing, setClosing] = React.useState<Sprint | null>(null);
  const [teamOpen, setTeamOpen] = React.useState(false);
  const [dataOpen, setDataOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [capacityOpen, setCapacityOpen] = React.useState(false);

  const capacity = <CapacityPanel onEditSprint={(sprint) => setSprintDialog({ sprint })} onCreateSprint={() => setSprintDialog({ sprint: null })} />;

  return (
    <div className="flex h-screen bg-background">
      {/* Left sidebar (desktop) */}
      <aside className={cn('hidden w-[236px] shrink-0 lg:block', ui.sidebarCollapsed && 'lg:hidden')}>
        <Sidebar onTeam={() => setTeamOpen(true)} onData={() => setDataOpen(true)} />
      </aside>

      {/* Inset main panel */}
      <div className={cn('min-w-0 flex-1 p-1.5 sm:p-2', !ui.sidebarCollapsed && 'lg:pl-0')}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <MainHeader
            onCreateSprint={() => setSprintDialog({ sprint: null })}
            onEditSprint={(sprint) => setSprintDialog({ sprint })}
            onCloseSprint={setClosing}
            onOpenMenu={() => setMenuOpen(true)}
            onOpenCapacity={() => setCapacityOpen(true)}
          />
          <div className="flex min-h-0 flex-1">
            <main className="min-w-0 flex-1" aria-label={ui.mode === 'history' ? 'Sprint history' : 'Planning board'}>
              {ui.mode === 'history' ? (
                <div className="h-full overflow-y-auto scrollbar-thin">
                  <HistoryView />
                </div>
              ) : (
                <Board />
              )}
            </main>
            <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l scrollbar-thin lg:block xl:w-[320px]" aria-label="Sprint capacity">
              {capacity}
            </aside>
          </div>
        </div>
      </div>

      {/* Narrow screens: sidebar and capacity drawers */}
      <Drawer open={menuOpen} onOpenChange={setMenuOpen} side="left" title="Menu">
        <Sidebar onTeam={() => setTeamOpen(true)} onData={() => setDataOpen(true)} onNavigate={() => setMenuOpen(false)} showCollapse={false} />
      </Drawer>
      <Drawer open={capacityOpen} onOpenChange={setCapacityOpen} side="right" title="Capacity">
        <div className="h-full overflow-y-auto">{capacity}</div>
      </Drawer>

      <TicketDialog />
      <SprintDialog open={!!sprintDialog} sprint={sprintDialog?.sprint ?? null} onOpenChange={(o) => !o && setSprintDialog(null)} />
      <CloseSprintDialog sprint={closing} onOpenChange={(o) => !o && setClosing(null)} />
      <TeamDialog open={teamOpen} onOpenChange={setTeamOpen} />
      <DataDialog open={dataOpen} onOpenChange={setDataOpen} />
    </div>
  );
}

function Drawer({ open, onOpenChange, side, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; side: 'left' | 'right'; title: string; children: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/30 data-[state=open]:animate-fade-in lg:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-y-0 z-50 flex w-[min(320px,88vw)] flex-col shadow-pop lg:hidden',
            side === 'left' ? 'left-0 bg-background' : 'right-0 bg-surface data-[state=open]:animate-slide-in-right',
          )}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
