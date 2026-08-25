import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSlotTimeRange, getDaysArray } from '../../shared/slots';
import { Check, Clock, Slash, X } from 'lucide-react';
import { Button, Notice, Pips, inputClass } from './ui';

type CellStatus =
  | 'available'
  | 'full'
  | 'blackout'
  | 'past'
  | 'requested_by_me'
  | 'approved_for_me'
  | 'restricted_hours';

type GridCell = {
  slotIndex: number;
  status: CellStatus;
  capacity: number;
  bookedCount: number;
  availableCount: number;
  blackoutReason: string | null;
  bookingId: string | null;
};

type AvailabilityResponse = {
  item: {
    id: string;
    name: string;
    description: string;
    quantity: number;
    requiresApproval: boolean;
    maxSlotsPerBooking: number;
    earliestSlot: number;
    latestSlot: number;
    advanceDays: number;
  };
  grid: GridCell[];
};

/** 24h start hour only — the grid is a column of times, so they must line up. */
function slotStartLabel(slotIndex: number): string {
  return getSlotTimeRange(slotIndex, true).split(' - ')[0];
}

function slotEndLabel(slotIndex: number): string {
  return getSlotTimeRange(slotIndex, true).split(' - ')[1];
}

export default function AvailabilityGrid({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient();
  const days = getDaysArray(7);
  const [selectedDate, setSelectedDate] = useState(days[0]);
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const { data, isLoading, error } = useQuery<AvailabilityResponse>({
    queryKey: ['availability', itemId, selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/bookings/availability/${itemId}?date=${selectedDate}`);
      if (!res.ok) throw new Error('Failed to fetch availability');
      return res.json();
    },
  });

  const bookingMutation = useMutation({
    mutationFn: async (payload: { itemId: string; slotDate: string; slotIndices: number[]; note?: string }) => {
      const res = await fetch('/api/bookings/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error || 'Could not submit the request.');
      }
      return (await res.json()) as { status?: string };
    },
    onSuccess: (resData) => {
      queryClient.invalidateQueries({ queryKey: ['availability', itemId, selectedDate] });
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      setSelectedSlots([]);
      setNote('');
      // The toast uses the same verb as the button that produced it.
      setSuccessMessage(resData.status === 'approved' ? 'Booked.' : 'Requested. Your rep will decide shortly.');
      setTimeout(() => setSuccessMessage(''), 6000);
    },
    onError: (err: Error) => {
      // A conflict means the grid on screen is stale, so refresh it rather than
      // leaving the resident looking at a slot that no longer exists.
      queryClient.invalidateQueries({ queryKey: ['availability', itemId, selectedDate] });
      setErrorMessage(err.message);
      setTimeout(() => setErrorMessage(''), 8000);
    },
  });

  if (isLoading) {
    return (
      <p className="py-12 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Loading availability
      </p>
    );
  }

  if (error || !data) {
    return <Notice tone="taken">Could not load availability. Check your connection and try again.</Notice>;
  }

  const { item, grid } = data;

  const handleCellClick = (cell: GridCell) => {
    const slotIndex = cell.slotIndex;

    if (selectedSlots.includes(slotIndex)) {
      setSelectedSlots(selectedSlots.filter((s) => s !== slotIndex));
      return;
    }
    if (cell.status !== 'available') return;
    if (selectedSlots.length === 0) {
      setSelectedSlots([slotIndex]);
      return;
    }

    const sorted = [...selectedSlots].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const atLimit = selectedSlots.length >= item.maxSlotsPerBooking;

    // Slots must be consecutive; anything else starts a fresh selection.
    if ((slotIndex === min - 1 || slotIndex === max + 1) && !atLimit) {
      setSelectedSlots([...selectedSlots, slotIndex].sort((a, b) => a - b));
    } else {
      setSelectedSlots([slotIndex]);
    }
  };

  const cellStyles = (cell: GridCell, isSelected: boolean): string => {
    const base =
      'relative flex min-h-[4rem] flex-col justify-between rounded-lg border px-2 py-2 text-left transition-colors';

    if (isSelected) {
      return `${base} border-transparent bg-accent text-accent-foreground`;
    }

    switch (cell.status) {
      case 'approved_for_me':
        return `${base} border-transparent bg-primary text-primary-foreground`;
      case 'requested_by_me':
        return `${base} border-dashed border-requested-border bg-requested-bg text-requested`;
      case 'available':
        return `${base} cursor-pointer border-border bg-card text-foreground hover:border-foreground hover:bg-secondary`;
      case 'full':
        return `${base} hatch-taken cursor-not-allowed border-taken-border bg-taken-bg text-taken`;
      case 'blackout':
        return `${base} hatch-blackout cursor-not-allowed border-blackout-border bg-blackout-bg text-blackout`;
      default:
        return `${base} cursor-not-allowed border-border bg-secondary/50 text-muted-foreground/60`;
    }
  };

  const sorted = [...selectedSlots].sort((a, b) => a - b);
  const selectedRange =
    sorted.length > 0 ? `${slotStartLabel(sorted[0])}–${slotEndLabel(sorted[sorted.length - 1])}` : '';
  const openHours = `${slotStartLabel(item.earliestSlot)}–${slotEndLabel(item.latestSlot)}`;

  return (
    <div className="space-y-4">
      {/* Day rail — snap-scrolls on a phone, so seven days cost one row, not seven. */}
      <div className="-mx-1 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-none">
        {days.map((date) => {
          const isSelected = selectedDate === date;
          const [yr, mo, dy] = date.split('-');
          const dateObj = new Date(Date.UTC(Number(yr), Number(mo) - 1, Number(dy)));
          const dayName = dateObj.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
          const dayNum = dateObj.toLocaleDateString('en-IN', { day: 'numeric', timeZone: 'UTC' });

          return (
            <button
              key={date}
              onClick={() => {
                setSelectedDate(date);
                setSelectedSlots([]);
              }}
              aria-pressed={isSelected}
              className={`flex min-w-[3.4rem] flex-none snap-start flex-col items-center rounded-lg border px-2 py-1.5 transition-colors ${
                isSelected
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-secondary'
              }`}
            >
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em]">{dayName}</span>
              <span className="font-mono text-lg font-semibold leading-tight">{dayNum}</span>
            </button>
          );
        })}
      </div>

      <div className="label-micro flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Open {openHours}</span>
        <span aria-hidden className="text-rule">/</span>
        <span className="inline-flex items-center gap-1.5">
          <Pips free={item.quantity} total={item.quantity} /> all {item.quantity} free
        </span>
      </div>

      {/* Eighteen slots as three columns: a whole day in roughly one screen. */}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
        {grid.map((cell) => {
          const isSelected = selectedSlots.includes(cell.slotIndex);
          const interactive = cell.status === 'available' || isSelected;

          return (
            <button
              key={cell.slotIndex}
              onClick={() => handleCellClick(cell)}
              disabled={!interactive}
              aria-pressed={isSelected}
              title={cell.status === 'blackout' ? cell.blackoutReason ?? 'Blocked' : undefined}
              className={cellStyles(cell, isSelected)}
            >
              <span className="font-mono text-[0.95rem] font-semibold leading-none tracking-tight">
                {slotStartLabel(cell.slotIndex)}
              </span>

              <span className="mt-1.5 flex items-center gap-1 text-[0.7rem] leading-none">
                {isSelected ? (
                  <>
                    <Check className="h-3 w-3" strokeWidth={3} />
                    <span className="font-mono uppercase tracking-[0.08em]">Picked</span>
                  </>
                ) : cell.status === 'available' ? (
                  <Pips free={cell.availableCount} total={cell.capacity} />
                ) : cell.status === 'approved_for_me' ? (
                  <>
                    <Check className="h-3 w-3" strokeWidth={3} />
                    <span className="font-mono uppercase tracking-[0.08em]">Yours</span>
                  </>
                ) : cell.status === 'requested_by_me' ? (
                  <>
                    <Clock className="h-3 w-3" />
                    <span className="font-mono uppercase tracking-[0.08em]">Asked</span>
                  </>
                ) : cell.status === 'full' ? (
                  <>
                    <X className="h-3 w-3" strokeWidth={3} />
                    <span className="font-mono uppercase tracking-[0.08em]">Full</span>
                  </>
                ) : cell.status === 'blackout' ? (
                  <>
                    <Slash className="h-3 w-3" />
                    <span className="font-mono uppercase tracking-[0.08em]">Shut</span>
                  </>
                ) : (
                  <span className="font-mono uppercase tracking-[0.08em]">
                    {cell.status === 'past' ? 'Gone' : 'Closed'}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {successMessage && <Notice tone="free">{successMessage}</Notice>}
      {errorMessage && <Notice tone="taken">{errorMessage}</Notice>}

      {/*
        On a phone the confirm step rides at the bottom of the viewport, in the
        thumb zone, instead of sitting below a grid you have to scroll past.
      */}
      {selectedSlots.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-card/95 px-3 pt-3 pb-safe backdrop-blur lg:static lg:rounded-lg lg:border lg:p-4 lg:backdrop-blur-none">
          <div className="mx-auto max-w-5xl space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-mono text-sm font-semibold">
                {selectedRange}
                <span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">
                  {sorted.length} hr{sorted.length > 1 ? 's' : ''}
                </span>
              </p>
              <p className="label-micro">up to {item.maxSlotsPerBooking} in a row</p>
            </div>

            <label className="block">
              <span className="sr-only">Note for your sports rep</span>
              <input
                type="text"
                placeholder="Note for your rep — e.g. singles match with Ameya"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inputClass}
              />
            </label>

            <div className="flex gap-2">
              <Button
                size="lg"
                variant="primary"
                className="flex-1"
                onClick={() =>
                  bookingMutation.mutate({
                    itemId: item.id,
                    slotDate: selectedDate,
                    slotIndices: sorted,
                    note: note.trim() || undefined,
                  })
                }
                disabled={bookingMutation.isPending}
              >
                {bookingMutation.isPending ? 'Sending…' : item.requiresApproval ? 'Request slot' : 'Book slot'}
              </Button>
              <Button size="lg" variant="outline" onClick={() => setSelectedSlots([])}>
                Clear
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
