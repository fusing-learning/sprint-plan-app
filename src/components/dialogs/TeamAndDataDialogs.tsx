import * as React from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Download, FileUp, HardDrive, RotateCcw, Trash2, UserPlus, X } from 'lucide-react';
import { parseBackup } from '@/domain/backup';
import type { AppData } from '@/domain/types';
import { report, useData, useStore, useUi } from '@/state/react';
import { sortedMembers } from '@/state/selectors';
import { Avatar } from '../meta';
import { Button } from '../ui/button';
import { useConfirm } from '../ui/confirm';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, Label } from '../ui/input';
import { Tooltip } from '../ui/misc';

export function TeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const data = useData();
  const store = useStore();
  const confirm = useConfirm();
  const members = sortedMembers(data);
  const [newName, setNewName] = React.useState('');

  const commitField = (id: string, field: 'name' | 'role', value: string, original: string) => {
    if (value.trim() === original) return;
    report(store.updateMember(id, { [field]: value }));
  };

  const remove = async (id: string, name: string) => {
    const assigned = data.tickets.filter((t) => t.assigneeId === id).length;
    const ok = await confirm({
      title: `Remove ${name} from the team?`,
      description: `${assigned} task${assigned === 1 ? '' : 's'} will become unassigned, releasing their capacity. Closed sprint history keeps their name.`,
      confirmLabel: 'Remove member',
      destructive: true,
    });
    if (ok) report(store.removeMember(id), `${name} removed`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Team settings</DialogTitle>
          <DialogDescription>Default capacity applies to every sprint (max 10 SP ≈ 10 person-days). Lower it for a single sprint in Edit sprint.</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-4">
          <div className="grid grid-cols-[28px_1fr_1fr_84px_28px] items-center gap-x-2 gap-y-2">
            <span />
            <Label>Name</Label>
            <Label>Role</Label>
            <Label className="text-right">Default SP</Label>
            <span />
            {members.map((m) => (
              <React.Fragment key={m.id}>
                <Avatar member={m} />
                <Input
                  defaultValue={m.name}
                  key={`${m.id}-name-${m.updatedAt}`}
                  aria-label={`Name for ${m.name}`}
                  onBlur={(e) => commitField(m.id, 'name', e.target.value, m.name)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <Input
                  defaultValue={m.role}
                  key={`${m.id}-role-${m.updatedAt}`}
                  aria-label={`Role for ${m.name}`}
                  onBlur={(e) => commitField(m.id, 'role', e.target.value, m.role)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step="any"
                  defaultValue={m.defaultCapacity}
                  key={`${m.id}-cap-${m.updatedAt}`}
                  aria-label={`Default capacity for ${m.name}`}
                  className="text-right tabular"
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v === m.defaultCapacity) return;
                    if (!report(store.updateMember(m.id, { defaultCapacity: v }))) e.target.value = String(m.defaultCapacity);
                  }}
                />
                <Tooltip content="Remove member">
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove ${m.name}`} onClick={() => remove(m.id, m.name)}>
                    <X />
                  </Button>
                </Tooltip>
              </React.Fragment>
            ))}
          </div>
          <form
            className="mt-4 flex items-center gap-2 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (report(store.addMember(newName), `${newName.trim()} added`)) setNewName('');
            }}
          >
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add a team member…" aria-label="New member name" />
            <Button type="submit" variant="secondary" disabled={!newName.trim()}>
              <UserPlus /> Add
            </Button>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DataDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const data = useData();
  const store = useStore();
  const ui = useUi();
  /** After the whole workspace is replaced, old filters would only hide things. */
  const freshView = () => {
    ui.resetFilters();
    ui.setFilters({ showArchived: false });
    ui.setSearch('');
    ui.setMode('active');
    onOpenChange(false);
  };
  const confirm = useConfirm();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = React.useState<string[] | null>(null);
  const [pending, setPending] = React.useState<{ data: AppData; exportedAt: string; fileName: string } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setImportErrors(null);
      setPending(null);
    }
  }, [open]);

  const exportJson = () => {
    const backup = store.exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sprintflow-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    report({ ok: true, value: undefined }, 'Backup downloaded');
  };

  const onFile = async (file: File) => {
    setImportErrors(null);
    setPending(null);
    const text = await file.text();
    const parsed = parseBackup(text);
    if (!parsed.ok) setImportErrors(parsed.errors);
    else setPending({ data: parsed.data, exportedAt: parsed.exportedAt, fileName: file.name });
  };

  const applyImport = async () => {
    if (!pending) return;
    const ok = await confirm({
      title: 'Replace all current data?',
      description: `Your current workspace (${data.projects.length} projects, ${data.tickets.length} tasks, ${data.sprints.length} sprints) will be replaced by the backup. Export first if you might need it.`,
      confirmLabel: 'Replace data',
      destructive: true,
    });
    if (ok && report(store.importData(pending.data), 'Backup imported')) freshView();
  };

  const loadDemo = async () => {
    const ok = await confirm({
      title: 'Load demo data?',
      description: 'Everything in this workspace — projects, tasks, sprints, history and team names — will be replaced with a sample workspace.',
      confirmLabel: 'Replace with demo',
      destructive: true,
    });
    if (ok && report(store.loadDemoData(), 'Demo data loaded')) freshView();
  };

  const clearAll = async () => {
    const ok = await confirm({
      title: 'Clear everything?',
      description: `All ${data.projects.length} projects, ${data.tickets.length} tasks and ${data.sprints.length} sprints (including history) will be deleted, and you’ll start with a fresh, empty Sprint 1. Your team and priority sections are kept. Export first if you might need it.`,
      confirmLabel: 'Clear everything',
      destructive: true,
    });
    if (ok && report(store.clearWorkspace(), 'Workspace cleared — fresh sprint ready')) freshView();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import / Export</DialogTitle>
          <DialogDescription>Back up your workspace as JSON, restore a backup, or start over.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 pb-4">
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-[12.5px] text-muted-foreground">
            <HardDrive className="mt-0.5 size-4 shrink-0" />
            <p>
              Data is saved automatically in this browser’s local storage (IndexedDB) on this device. It does <strong className="text-foreground">not</strong> sync across computers or browsers — use export/import to move it.
            </p>
          </div>

          <ActionRow icon={<Download />} title="Export all data" body={`${data.projects.length} projects · ${data.tickets.length} tasks · ${data.sprints.length} sprints`}>
            <Button variant="secondary" size="sm" onClick={exportJson}>
              Export JSON
            </Button>
          </ActionRow>

          <ActionRow icon={<FileUp />} title="Import backup" body="Validated before anything is replaced.">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = '';
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              Choose file…
            </Button>
          </ActionRow>

          {importErrors && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-800">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4" /> This file can’t be imported
              </div>
              <ul className="list-disc space-y-0.5 pl-5">
                {importErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {pending && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-[12.5px]">
              <div className="font-medium">{pending.fileName} is valid</div>
              <div className="mt-0.5 text-muted-foreground">
                Exported {format(new Date(pending.exportedAt), 'd MMM yyyy, HH:mm')} · {pending.data.projects.length} projects · {pending.data.tickets.length} tasks ·{' '}
                {pending.data.sprints.length} sprints · {pending.data.members.length} members
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={applyImport}>
                  Replace current data…
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="border-t pt-3" />
          <ActionRow icon={<Trash2 className="text-red-500" />} title="Clear everything" body="Delete all projects, tasks and sprints. Starts a fresh empty sprint.">
            <Button variant="destructive-ghost" size="sm" onClick={clearAll}>
              Clear…
            </Button>
          </ActionRow>
          <ActionRow icon={<RotateCcw />} title="Load demo data" body="Replace everything with a sample workspace to explore.">
            <Button variant="secondary" size="sm" onClick={loadDemo}>
              Load demo
            </Button>
          </ActionRow>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionRow({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="truncate text-[12px] text-muted-foreground">{body}</div>
      </div>
      {children}
    </div>
  );
}
