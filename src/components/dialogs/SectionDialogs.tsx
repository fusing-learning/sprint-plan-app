import * as React from 'react';
import { Check } from 'lucide-react';
import type { Section, SectionColor } from '@/domain/types';
import { report, useData, useStore } from '@/state/react';
import { sortedSections } from '@/state/selectors';
import { cn } from '@/lib/utils';
import { SECTION_COLORS, SectionGlyph } from '../meta';
import { Button } from '../ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const COLORS = Object.keys(SECTION_COLORS) as SectionColor[];

export function SectionDialog({ open, section, onOpenChange }: { open: boolean; section: Section | null; onOpenChange: (o: boolean) => void }) {
  const store = useStore();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [color, setColor] = React.useState<SectionColor>('slate');

  React.useEffect(() => {
    if (!open) return;
    setName(section?.name ?? '');
    setDescription(section?.description ?? '');
    setColor(section?.color ?? 'slate');
  }, [open, section]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = section ? store.updateSection(section.id, { name, description, color }) : store.createSection({ name, description, color });
    if (report(result, section ? 'Section updated' : 'Section created')) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{section ? 'Edit section' : 'New priority section'}</DialogTitle>
            <DialogDescription>Sections are planning priority buckets, ordered from the top of the board down.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-4">
            <Field label="Name" htmlFor="section-name">
              <Input id="section-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Customer Escalations" autoFocus />
            </Field>
            <Field label="Description" htmlFor="section-desc">
              <Input id="section-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional guidance for this bucket" />
            </Field>
            <Field label="Color">
              <div className="flex gap-2" role="radiogroup" aria-label="Section color">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={color === c}
                    aria-label={c}
                    onClick={() => setColor(c)}
                    className={cn('flex size-7 items-center justify-center rounded-full ring-offset-2 transition', SECTION_COLORS[c].dot, color === c && 'ring-2 ring-slate-400')}
                  >
                    {color === c && <Check className="size-3.5 text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{section ? 'Save' : 'Create section'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteSectionDialog({ section, onOpenChange }: { section: Section | null; onOpenChange: (o: boolean) => void }) {
  const data = useData();
  const store = useStore();
  const [target, setTarget] = React.useState<string>('');
  const projects = section ? data.projects.filter((p) => p.sectionId === section.id) : [];
  const others = sortedSections(data).filter((s) => s.id !== section?.id);

  React.useEffect(() => {
    if (section) setTarget(others[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section?.id]);

  const remove = () => {
    if (!section) return;
    const result = store.deleteSection(section.id, projects.length ? target : undefined);
    if (report(result, projects.length ? `Moved ${projects.length} project(s) and deleted section` : 'Section deleted')) onOpenChange(false);
  };

  return (
    <Dialog open={!!section} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{section?.name}”?</DialogTitle>
          <DialogDescription>
            {projects.length
              ? `This section contains ${projects.length} project${projects.length === 1 ? '' : 's'}. Choose where to move them before the section is deleted.`
              : 'This section is empty. Deleting it cannot be undone.'}
          </DialogDescription>
        </DialogHeader>
        {projects.length > 0 && (
          <DialogBody className="space-y-3 pb-4">
            {others.length === 0 ? (
              <p className="rounded-md bg-amber-50 dark:bg-amber-500/10 p-3 text-[13px] text-amber-800 dark:text-amber-300">Create another section first — projects need somewhere to go.</p>
            ) : (
              <Field label="Move projects to">
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger aria-label="Target section">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {others.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="inline-flex items-center gap-2">
                          <SectionGlyph section={s} className="size-3" />
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <ul className="max-h-32 space-y-1 overflow-y-auto text-[12.5px] text-muted-foreground">
              {projects.map((p) => (
                <li key={p.id}>• {p.name}</li>
              ))}
            </ul>
          </DialogBody>
        )}
        <DialogFooter className={projects.length ? '' : 'mt-2'}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={projects.length > 0 && !target}>
            {projects.length ? 'Move projects & delete' : 'Delete section'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
