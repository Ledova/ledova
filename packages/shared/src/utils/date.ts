const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

export function formatDate(dateString: string | null | undefined, fallback: string = 'Never'): string {
  if (!dateString) return fallback;
  try {
    return new Date(dateString).toLocaleDateString('en-AU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...(CALENDAR_DATE.test(dateString) ? { timeZone: 'UTC' } : {}),
    });
  } catch {
    return dateString;
  }
}

export function formatShortDate(dateString: string | null | undefined, fallback: string = 'Never'): string {
  if (!dateString) return fallback;
  const at = new Date(dateString);
  if (Number.isNaN(at.getTime())) return dateString;
  return CALENDAR_DATE.test(dateString)
    ? `${at.getUTCDate()} ${SHORT_MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`
    : `${at.getDate()} ${SHORT_MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

export function formatDateTime(dateString: string | null | undefined, fallback: string = 'Never'): string {
  if (!dateString) return fallback;
  if (CALENDAR_DATE.test(dateString)) return formatDate(dateString, fallback);
  const at = new Date(dateString);
  if (Number.isNaN(at.getTime())) return dateString;
  const hours = at.getHours();
  const time = `${hours % 12 || 12}:${String(at.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`;
  return `${formatShortDate(dateString)}, ${time}`;
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
