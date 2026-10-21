const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function utcToday(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function sydneyToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function addCalendarDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function addCalendarYears(day: string, years: number): string {
  const moment = new Date(`${day}T00:00:00Z`);
  moment.setUTCFullYear(moment.getUTCFullYear() + years);
  return moment.toISOString().slice(0, 10);
}

export function formatDate(
  dateString: string | null | undefined,
  fallback: string = 'Never',
  locale: string = 'en-AU',
): string {
  if (!dateString) return fallback;
  try {
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...(CALENDAR_DATE.test(dateString) ? { timeZone: 'UTC' } : {}),
    });
  } catch {
    return dateString;
  }
}

export function formatTime(
  dateString: string | null | undefined,
  fallback: string = 'Never',
  locale: string = 'en-AU',
): string {
  if (!dateString) return fallback;
  try {
    return new Date(dateString).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return dateString;
  }
}

export function formatDateTime(
  dateString: string | null | undefined,
  fallback: string = 'Never',
  locale: string = 'en-AU',
): string {
  if (!dateString) return fallback;
  if (CALENDAR_DATE.test(dateString)) return formatDate(dateString, fallback, locale);
  try {
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString;
  }
}

export function formatSyncAge(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function parseDateString(dateString: string): Date | undefined {
  if (!dateString) return undefined;
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

export function formatDateToString(date: Date | undefined): string {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
