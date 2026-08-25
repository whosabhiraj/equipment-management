export type QueueItem = {
  id: string;
  itemId: string;
  slotDate: string;
  slotIndex: number;
  note: string | null;
  createdAt: number;
  itemName: string;
  requesterName: string;
  requesterRoom: string;
  capacity: number;
  approvedCount: number;
  pendingCount: number;
  availableCount: number;
};

export type TodayItem = {
  id: string;
  slotIndex: number;
  note: string | null;
  userName: string;
  roomNo: string | null;
  itemName: string;
  status: string;
};

export type BlackoutItem = {
  id: string;
  slotDate: string;
  slotIndex: number | null;
  reason: string;
  itemName: string | null;
};

export type AuditItem = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  metaJson: string | null;
  createdAt: number;
  actorName: string;
  actorEmail: string;
};

export type DbItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  quantity: number;
  active: boolean;
  requiresApproval: boolean;
  maxSlotsPerBooking: number;
  earliestSlot: number;
  latestSlot: number;
  advanceDays: number;
};

export type DbCategory = {
  id: string;
  name: string;
  sortOrder: number;
};

export type ManagedUser = {
  id: string;
  email: string;
  name: string;
  role: 'resident' | 'rep' | 'admin';
  roomNo: string | null;
  disabled: boolean;
};

/** "Sat 30 Aug" — short enough for a phone, unambiguous enough for a booking. */
export function prettyDate(slotDate: string): string {
  const [y, m, d] = slotDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
