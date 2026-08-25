// Time slot helpers (Asia/Kolkata timezone, hardcoded)
// Slot 0 = 06:00 AM, Slot 17 = 11:00 PM (23:00)

export const START_HOUR = 6;
export const TOTAL_SLOTS = 18; // 6:00 AM to 11:00 PM (23:00)

export function getSlotStartHour(slotIndex: number): number {
  return START_HOUR + slotIndex;
}

export function getSlotTimeRange(slotIndex: number, format24: boolean = false): string {
  const startHour = getSlotStartHour(slotIndex);
  const endHour = startHour + 1;

  if (format24) {
    const pad = (h: number) => String(h).padStart(2, '0');
    return `${pad(startHour)}:00 - ${pad(endHour)}:00`;
  }

  const format12 = (h: number) => {
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(hour12).padStart(2, '0')}:00 ${period}`;
  };

  return `${format12(startHour)} - ${format12(endHour)}`;
}

export function getKolkataDateString(date: Date = new Date()): string {
  // Returns 'YYYY-MM-DD' in Asia/Kolkata
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

export function getKolkataNow(now: Date = new Date()) {
  const dateStr = getKolkataDateString(now);
  
  // Calculate current hour in Kolkata
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  });
  const hour = parseInt(hourFormatter.format(now), 10);
  const slotIdx = hour - START_HOUR;

  return {
    dateStr,
    hour,
    slotIdx,
  };
}

export function getSlotStartUtc(dateStr: string, slotIndex: number): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const startHour = getSlotStartHour(slotIndex);
  
  // Kolkata is UTC+5:30
  const localUtcTimestamp = Date.UTC(y, m - 1, d, startHour, 0, 0);
  const kolkataOffsetMs = 5.5 * 60 * 60 * 1000;
  return localUtcTimestamp - kolkataOffsetMs;
}

export function canBookSlot(dateStr: string, slotIndex: number, now: Date = new Date()): boolean {
  if (slotIndex < 0 || slotIndex >= TOTAL_SLOTS) {
    return false;
  }

  const slotStartUtc = getSlotStartUtc(dateStr, slotIndex);
  const nowMs = now.getTime();
  
  // Check if slot starts in less than 5 minutes (or is in the past)
  const fiveMinutesMs = 5 * 60 * 1000;
  return (slotStartUtc - nowMs) > fiveMinutesMs;
}

export function getDaysArray(advanceDays: number, now: Date = new Date()): string[] {
  const days: string[] = [];
  const startStr = getKolkataDateString(now);
  const [y, m, d] = startStr.split('-').map(Number);
  
  // Start from today
  for (let i = 0; i <= advanceDays; i++) {
    // Generate dates incrementing days
    // Working in local Kolkata dates:
    const nextDate = new Date(Date.UTC(y, m - 1, d + i));
    const nextYear = nextDate.getUTCFullYear();
    const nextMonth = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
    const nextDay = String(nextDate.getUTCDate()).padStart(2, '0');
    days.push(`${nextYear}-${nextMonth}-${nextDay}`);
  }
  return days;
}
