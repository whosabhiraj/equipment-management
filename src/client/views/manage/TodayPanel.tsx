import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSlotTimeRange } from '../../../shared/slots';
import { Button, Card, Empty, Loading, Tag } from '../../components/ui';
import type { TodayItem } from './types';

/** What the rep actually looks at while handing equipment over the counter. */
export default function TodayPanel() {
  const queryClient = useQueryClient();

  const { data: list, isLoading } = useQuery<TodayItem[]>({
    queryKey: ['today'],
    queryFn: async () => {
      const res = await fetch('/api/bookings/manage/today');
      if (!res.ok) throw new Error('Today fetch error');
      return res.json();
    },
  });

  const noShow = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/bookings/${id}/no-show`, { method: 'POST' });
      if (!res.ok) throw new Error('Could not mark that as a no-show.');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['today'] }),
  });

  if (isLoading) return <Loading label="Loading today" />;

  if (!list || list.length === 0) {
    return <Empty title="Nothing out today">Approved bookings for today appear here in time order.</Empty>;
  }

  return (
    <Card className="divide-y divide-border overflow-hidden">
      {list.map((t) => (
        <div key={t.id} className="flex items-center gap-3 px-3.5 py-3">
          <span className="w-[3.25rem] flex-none font-mono text-sm font-semibold tabular-nums">
            {getSlotTimeRange(t.slotIndex, true).split(' - ')[0]}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{t.itemName}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {t.userName}
              {t.roomNo && ` · Room ${t.roomNo}`}
            </p>
            {t.note && <p className="truncate text-xs italic text-muted-foreground">{t.note}</p>}
          </div>

          <div className="flex-none">
            {t.status === 'no_show' ? (
              <Tag tone="taken">No-show</Tag>
            ) : (
              <Button variant="outline" size="sm" onClick={() => noShow.mutate(t.id)}>
                No-show
              </Button>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}
