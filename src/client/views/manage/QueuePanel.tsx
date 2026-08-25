import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSlotTimeRange } from '../../../shared/slots';
import { Button, Card, Empty, Loading, Notice, Pips, inputClass } from '../../components/ui';
import { prettyDate, type QueueItem } from './types';

export default function QueuePanel() {
  const queryClient = useQueryClient();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [conflict, setConflict] = useState('');

  const { data: queue, isLoading } = useQuery<QueueItem[]>({
    queryKey: ['queue'],
    queryFn: async () => {
      const res = await fetch('/api/bookings/manage/queue');
      if (!res.ok) throw new Error('Queue fetch error');
      return res.json();
    },
  });

  const decide = useMutation({
    mutationFn: async (payload: { bookingId: string; decision: 'approved' | 'declined'; declineReason?: string }) => {
      const res = await fetch('/api/bookings/manage/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Could not record that decision.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      setDecliningId(null);
      setDeclineReason('');
      setConflict('');
    },
    onError: (err: Error) => {
      // The queue page went stale — refresh it in place rather than toasting.
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      setConflict(err.message);
    },
  });

  if (isLoading) return <Loading label="Loading requests" />;

  if (!queue || queue.length === 0) {
    return <Empty title="Queue is clear">Nothing waiting on you. New requests land here.</Empty>;
  }

  return (
    <div className="space-y-2.5">
      {conflict && <Notice tone="taken">{conflict}</Notice>}

      {queue.map((req) => (
        <Card key={req.id} className="p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-display text-base font-semibold leading-tight">
                {req.itemName}
              </h3>
              <p className="mt-0.5 text-sm leading-tight">
                {req.requesterName}
                {req.requesterRoom && (
                  <span className="text-muted-foreground"> · Room {req.requesterRoom}</span>
                )}
              </p>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {prettyDate(req.slotDate)} · {getSlotTimeRange(req.slotIndex, true)}
              </p>
            </div>

            <div className="flex-none text-right">
              <Pips free={req.availableCount} total={req.capacity} />
              <p className="mt-1 font-mono text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                {req.availableCount} left
              </p>
              {req.pendingCount > 1 && (
                <p className="font-mono text-[0.7rem] text-accent">
                  {req.pendingCount - 1} also asked
                </p>
              )}
            </div>
          </div>

          {req.note && (
            <p className="mt-2 border-l-2 border-rule pl-2 text-xs italic leading-relaxed text-muted-foreground">
              {req.note}
            </p>
          )}

          {decliningId === req.id ? (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="mb-1 block font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  Why are you declining?
                </span>
                <input
                  autoFocus
                  type="text"
                  placeholder="e.g. Racquet has a broken string"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  className={inputClass}
                />
              </label>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  className="flex-1"
                  disabled={!declineReason.trim() || decide.isPending}
                  onClick={() =>
                    decide.mutate({ bookingId: req.id, decision: 'declined', declineReason })
                  }
                >
                  Decline
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDecliningId(null)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ bookingId: req.id, decision: 'approved' })}
              >
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setDecliningId(req.id);
                  setDeclineReason('');
                }}
              >
                Decline
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
