import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSlotTimeRange } from '../../../shared/slots';
import { Button, Card, Empty, Field, Notice, SectionTitle, Tag, inputClass } from '../../components/ui';
import { prettyDate, type BlackoutItem, type DbItem } from './types';

export default function BlackoutsPanel() {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState('');
  const [slotDate, setSlotDate] = useState('');
  const [slotIndex, setSlotIndex] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const { data: list } = useQuery<BlackoutItem[]>({
    queryKey: ['blackouts'],
    queryFn: async () => {
      const res = await fetch('/api/bookings/manage/blackouts');
      if (!res.ok) throw new Error('Blackout fetch error');
      return res.json();
    },
  });

  const { data: items } = useQuery<DbItem[]>({
    queryKey: ['flat-items'],
    queryFn: async () => {
      const res = await fetch('/api/items');
      const cats = (await res.json()) as { id: string; items: DbItem[] }[];
      return cats.flatMap((c) => c.items.map((i) => ({ ...i, categoryId: c.id })));
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/bookings/manage/blackouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: itemId || undefined,
          slotDate,
          slotIndex: slotIndex === '' ? undefined : Number(slotIndex),
          reason,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Could not create the closure.');
      }
      return (await res.json()) as { conflictsCancelledCount: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['blackouts'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      setSlotDate('');
      setSlotIndex('');
      setItemId('');
      setReason('');
      setResult(
        data.conflictsCancelledCount > 0
          ? `Closed. ${data.conflictsCancelledCount} existing booking${data.conflictsCancelledCount > 1 ? 's were' : ' was'} cancelled and the residents notified.`
          : 'Closed. No bookings were affected.'
      );
    },
    onError: (err: Error) => setResult(err.message),
  });

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Close a slot</SectionTitle>

        <Card className="space-y-3 p-3.5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Closing a slot cancels every booking already in it and emails those residents.
            It cannot be undone from here.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What is closed">
              <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputClass}>
                <option value="">Everything</option>
                {items?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Date">
              <input
                type="date"
                value={slotDate}
                onChange={(e) => setSlotDate(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Hour">
              <select value={slotIndex} onChange={(e) => setSlotIndex(e.target.value)} className={inputClass}>
                <option value="">Whole day</option>
                {Array.from({ length: 18 }, (_, i) => (
                  <option key={i} value={i}>
                    {getSlotTimeRange(i, true)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Reason" hint="Residents see this.">
              <input
                type="text"
                placeholder="e.g. Court resurfacing"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          {result && <Notice tone={create.isError ? 'taken' : 'free'}>{result}</Notice>}

          <Button
            className="w-full"
            disabled={!slotDate || reason.trim().length < 3 || create.isPending}
            onClick={() => {
              setResult(null);
              create.mutate();
            }}
          >
            {create.isPending ? 'Closing…' : 'Close slot and cancel bookings'}
          </Button>
        </Card>
      </section>

      <section>
        <SectionTitle>Closed slots</SectionTitle>
        {!list || list.length === 0 ? (
          <Empty title="Nothing closed">Close a date or an hour above when the court or a set is out of action.</Empty>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {list.map((b) => (
              <div key={b.id} className="px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{prettyDate(b.slotDate)}</span>
                  <Tag>{b.slotIndex === null ? 'Whole day' : getSlotTimeRange(b.slotIndex, true)}</Tag>
                  <Tag tone={b.itemName ? 'neutral' : 'taken'}>{b.itemName ?? 'Everything'}</Tag>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{b.reason}</p>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
