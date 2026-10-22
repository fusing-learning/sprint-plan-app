import * as React from 'react';
import { format, parseISO } from 'date-fns';
import { PROJECT_LIFECYCLE_LABEL, type Project, type ProjectLifecycle } from '@/domain/types';
import { report, useData, useStore } from '@/state/react';
import { sortedSections } from '@/state/selectors';
import { SectionGlyph } from '../meta';
import { Button } from '../ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, Input, Textarea } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface Props {
  open: boolean;
  project: Project | null;
  defaultSectionId?: string;
  onOpenChange: (o: boolean) => void;
  onCreated?: (p: Project) => void;
}

export function ProjectDialog({ open, project, defaultSectionId, onOpenChange, onCreated }: Props) {
  const data = useData();
  const store = useStore();
  const sections = sortedSections(data);
  const [form, setForm] = React.useState({
    name: '',
    description: '',
    sectionId: '',
    lifecycle: 'active' as ProjectLifecycle,
    targetDate: '',
    owner: '',
  });

  React.useEffect(() => {
    if (!open) return;
    setForm({
      name: project?.name ?? '',
      description: project?.description ?? '',
      sectionId: project?.sectionId ?? defaultSectionId ?? sections[0]?.id ?? '',
      lifecycle: project?.lifecycle ?? 'active',
      targetDate: project?.targetDate ?? '',
      owner: project?.owner ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      description: form.description.trim(),
      sectionId: form.sectionId,
      lifecycle: form.lifecycle,
      targetDate: form.targetDate || null,
      owner: form.owner.trim(),
    };
    if (project) {
      if (report(store.updateProject(project.id, payload), 'Project saved')) onOpenChange(false);
    } else {
      const result = store.createProject(payload);
      if (report(result, 'Project created')) {
        onCreated?.(result.value);
        onOpenChange(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{project ? 'Edit project' : 'New project'}</DialogTitle>
            <DialogDescription>Priority (section) and lifecycle are independent — a P0 project can be On Hold.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-4">
            <Field label="Project name" htmlFor="project-name">
              <Input id="project-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Checkout Redesign" autoFocus className="h-9 text-[14px] font-medium" />
            </Field>
            <Field label="Short description" htmlFor="project-desc">
              <Textarea id="project-desc" value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="Why this project matters and what done looks like" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priority section">
                <Select value={form.sectionId} onValueChange={(v) => set('sectionId', v)}>
                  <SelectTrigger aria-label="Priority section">
                    <SelectValue placeholder="Choose section" />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => (
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
              <Field label="Lifecycle status">
                <Select value={form.lifecycle} onValueChange={(v) => set('lifecycle', v as ProjectLifecycle)}>
                  <SelectTrigger aria-label="Lifecycle status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROJECT_LIFECYCLE_LABEL) as ProjectLifecycle[]).map((l) => (
                      <SelectItem key={l} value={l}>
                        {PROJECT_LIFECYCLE_LABEL[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Target delivery date (optional)" htmlFor="project-target">
                <Input id="project-target" type="date" value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} />
              </Field>
              <Field label="Project owner (optional)" htmlFor="project-owner">
                <Input id="project-owner" value={form.owner} onChange={(e) => set('owner', e.target.value)} placeholder="e.g. PM" list="owner-suggestions" />
                <datalist id="owner-suggestions">
                  {data.members.map((m) => (
                    <option key={m.id} value={m.name} />
                  ))}
                </datalist>
              </Field>
            </div>
            {project && (
              <p className="text-[11.5px] text-muted-foreground">
                Created {format(parseISO(project.createdAt), 'd MMM yyyy, HH:mm')} · Updated {format(parseISO(project.updatedAt), 'd MMM yyyy, HH:mm')}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{project ? 'Save project' : 'Create project'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
