import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Notice, inputClass } from './ui';

type ImportItem = {
  email: string;
  name: string;
  roomNo: string;
};

type ConflictItem = ImportItem & {
  existingName: string;
  existingRoom: string;
};

type PreviewResponse = {
  adds: ImportItem[];
  skips: ImportItem[];
  conflicts: ConflictItem[];
  errors: { email: string; name: string; roomNo: string; error: string }[];
};

const PLACEHOLDER = `ameya.sharma@college.edu, Ameya Sharma, 203-A
rhea.nair@college.edu, Rhea Nair, 110-B`;

export default function PeopleImporter({ onSuccess }: { onSuccess: (count: number) => void }) {
  const queryClient = useQueryClient();
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const previewMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch('/api/users/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: text }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Could not read that list.');
      }
      return (await res.json()) as PreviewResponse;
    },
    onSuccess: (data) => {
      setPreview(data);
      setErrorMsg('');
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const confirmMutation = useMutation({
    mutationFn: async (items: ImportItem[]) => {
      const res = await fetch('/api/users/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Could not add those people.');
      }
      return (await res.json()) as { count: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      setPreview(null);
      setCsvText('');
      onSuccess(data.count);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const toImport = preview
    ? [...preview.adds, ...preview.conflicts.map((c) => ({ email: c.email, name: c.name, roomNo: c.roomNo }))]
    : [];

  return (
    <Card className="space-y-3 p-3.5">
      <h3 className="font-display text-base font-semibold">Add several people</h3>

      {!preview ? (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Paste one person per line as{' '}
            <code className="rounded bg-secondary px-1 py-0.5 font-mono">email, name, room</code>. A
            header row is skipped automatically.
          </p>

          <label className="block">
            <span className="sr-only">Paste people to add</span>
            <textarea
              rows={4}
              placeholder={PLACEHOLDER}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className={`${inputClass} resize-y font-mono text-xs`}
            />
          </label>

          {errorMsg && <Notice tone="taken">{errorMsg}</Notice>}

          <Button
            className="w-full"
            disabled={previewMutation.isPending || !csvText.trim()}
            onClick={() => previewMutation.mutate(csvText)}
          >
            {previewMutation.isPending ? 'Reading…' : 'Check the list'}
          </Button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { n: preview.adds.length, label: 'new', cls: 'border-free-border bg-free-bg text-free' },
              { n: preview.skips.length, label: 'already in', cls: 'border-border bg-secondary text-muted-foreground' },
              { n: preview.conflicts.length, label: 'changed', cls: 'border-requested-border bg-requested-bg text-requested' },
            ].map((s) => (
              <div key={s.label} className={`rounded-lg border px-2 py-2 ${s.cls}`}>
                <div className="font-mono text-xl font-semibold leading-none">{s.n}</div>
                <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-wide">{s.label}</div>
              </div>
            ))}
          </div>

          {preview.errors.length > 0 && (
            <div className="rounded-lg border border-danger-border bg-danger-bg p-2.5">
              <p className="font-mono text-xs font-semibold uppercase tracking-wide text-danger">
                {preview.errors.length} line{preview.errors.length > 1 ? 's' : ''} could not be read
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-xs text-danger/85">
                {preview.errors.map((err, i) => (
                  <li key={i}>
                    {err.email ? `"${err.email}"` : 'empty line'} — {err.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.conflicts.length > 0 && (
            <div className="rounded-lg border border-requested-border bg-requested-bg p-2.5">
              <p className="font-mono text-xs font-semibold uppercase tracking-wide text-requested">
                These details will be overwritten
              </p>
              <div className="mt-1 max-h-28 space-y-1 overflow-y-auto font-mono text-xs scrollbar-none">
                {preview.conflicts.map((c, i) => (
                  <div key={i}>
                    <span className="text-muted-foreground">{c.email}</span>{' '}
                    {c.existingName} ({c.existingRoom}) →{' '}
                    <strong className="font-semibold">
                      {c.name} ({c.roomNo})
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.adds.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                New people
              </p>
              <div className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-background p-2 font-mono text-xs scrollbar-none">
                {preview.adds.map((a, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="truncate">{a.email}</span>
                    <span className="flex-none text-muted-foreground">
                      {a.name} ({a.roomNo})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {errorMsg && <Notice tone="taken">{errorMsg}</Notice>}

          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={confirmMutation.isPending || toImport.length === 0}
              onClick={() => confirmMutation.mutate(toImport)}
            >
              {confirmMutation.isPending ? 'Adding…' : `Add ${toImport.length} to the hostel`}
            </Button>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Back
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
