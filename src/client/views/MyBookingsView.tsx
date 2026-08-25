import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSlotStartUtc, getSlotTimeRange } from '../../shared/slots';
import { Button, Card, Empty, Loading, SectionTitle, Tag } from '../components/ui';

type ClientBooking = {
  id: string;
  itemId: string;
  slotDate: string;
  slotIndex: number;
  status: 'pending' | 'approved' | 'declined' | 'cancelled' | 'no_show';
  note: string | null;
  declineReason: string | null;
  createdAt: number;
  itemName: string;
};

function statusTag(status: ClientBooking['status']) {
  switch (status) {
    case 'approved':
      return <Tag tone="free">Approved</Tag>;
    case 'pending':
      return <Tag tone="requested">Waiting on rep</Tag>;
    case 'declined':
      return <Tag tone="taken">Declined</Tag>;
    case 'no_show':
      return <Tag tone="taken">No-show</Tag>;
    default:
      return <Tag>Cancelled</Tag>;
  }
}

/** "Sat 30 Aug" — short enough for a phone, unambiguous enough for a booking. */
function prettyDate(slotDate: string): string {
  const [y, m, d] = slotDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export default function MyBookingsView() {
  const queryClient = useQueryClient();

  const { data: list, isLoading } = useQuery<ClientBooking[]>({
    queryKey: ['my-bookings'],
    queryFn: async () => {
      const res = await fetch('/api/bookings/my-bookings');
      if (!res.ok) throw new Error('Bookings fetch error');
      return res.json();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/bookings/${id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Could not cancel that booking.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (err: Error) => window.alert(err.message),
  });

  if (isLoading) return <Loading label="Loading your bookings" />;

  if (!list || list.length === 0) {
    return (
      <Empty title="No bookings yet">
        Pick an item on the Book screen and claim an hour. Approved slots show up here.
      </Empty>
    );
  }

  const upcoming = list.filter(
    (b) =>
      getSlotStartUtc(b.slotDate, b.slotIndex) > Date.now() &&
      b.status !== 'cancelled' &&
      b.status !== 'declined'
  );
  const past = list.filter((b) => !upcoming.includes(b));

  return (
    <div className="space-y-7">
      <section>
        <SectionTitle>Upcoming</SectionTitle>
        {upcoming.length === 0 ? (
          <p className="rounded-lg border border-dashed border-rule px-4 py-5 text-sm text-muted-foreground">
            Nothing booked ahead. The Book screen shows what is free.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {upcoming.map((b) => (
              <Card key={b.id} className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-base font-semibold leading-tight">
                      {b.itemName}
                    </h3>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {prettyDate(b.slotDate)} · {getSlotTimeRange(b.slotIndex, true)}
                    </p>
                  </div>
                  {statusTag(b.status)}
                </div>

                {b.note && (
                  <p className="mt-2 border-l-2 border-rule pl-2 text-xs italic leading-relaxed text-muted-foreground">
                    {b.note}
                  </p>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => cancelMutation.mutate(b.id)}
                  disabled={cancelMutation.isPending}
                >
                  Cancel booking
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Earlier</SectionTitle>
        <Card className="divide-y divide-border overflow-hidden">
          {past.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            past.map((b) => (
              <div key={b.id} className="flex items-start justify-between gap-3 px-3.5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium leading-tight">{b.itemName}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {prettyDate(b.slotDate)} · {getSlotTimeRange(b.slotIndex, true)}
                  </p>
                  {b.declineReason && b.status === 'declined' && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{b.declineReason}</p>
                  )}
                </div>
                <div className="flex-none">{statusTag(b.status)}</div>
              </div>
            ))
          )}
        </Card>
      </section>
    </div>
  );
}
