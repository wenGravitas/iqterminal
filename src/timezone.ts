export const TIMEZONE_STORAGE_KEY = 'basis.market-pulse.timezone.v1';
export const TIMEZONE_EVENT = 'basis-market-timezone-change';
export type TimezonePreference = 'local' | 'UTC';
let sessionPreference: TimezonePreference | null = null;

export function parseTimezonePreference(value: unknown): TimezonePreference | null {
  return value === 'local' || value === 'UTC' ? value : null;
}

export function detectLocalTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) {
      new Intl.DateTimeFormat('en-GB', { timeZone: zone });
      return zone;
    }
  } catch { /* Use UTC when the runtime cannot provide an IANA zone. */ }
  return 'UTC';
}

export function resolveTimezone(preference: unknown, localZone = detectLocalTimezone()): string {
  if (preference === 'UTC') return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: localZone });
    return localZone;
  } catch { return 'UTC'; }
}

export function loadTimezonePreference(getItem?: (key: string) => string | null): TimezonePreference {
  try {
    const saved = getItem ? getItem(TIMEZONE_STORAGE_KEY) : localStorage.getItem(TIMEZONE_STORAGE_KEY);
    return parseTimezonePreference(saved) ?? 'local';
  } catch { return 'local'; }
}

export function getTimezonePreference(): TimezonePreference {
  return sessionPreference ?? loadTimezonePreference();
}

export function saveTimezonePreference(preference: TimezonePreference, setItem?: (key: string, value: string) => void): boolean {
  try {
    if (setItem) setItem(TIMEZONE_STORAGE_KEY, preference);
    else localStorage.setItem(TIMEZONE_STORAGE_KEY, preference);
    return true;
  } catch { return false; }
}

export function setTimezonePreference(preference: TimezonePreference): boolean {
  sessionPreference = preference;
  const saved = saveTimezonePreference(preference);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TIMEZONE_EVENT, { detail: { preference, zone: getDisplayTimezone() } }));
  }
  return saved;
}

export function getDisplayTimezone(): string {
  return resolveTimezone(getTimezonePreference());
}

export function formatClockTime(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(epochMs);
}

export function formatDateTime(epochMs: number, timezone: string, includeSeconds = false): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', ...(includeSeconds ? { second: '2-digit' as const } : {}), hourCycle: 'h23',
  }).format(epochMs);
}

export function formatZoneOffset(epochMs: number, timezone: string): string {
  const value = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, timeZoneName: 'longOffset' })
    .formatToParts(epochMs)
    .find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
  if (value === 'GMT' || value === 'GMT+00:00' || value === 'UTC') return 'UTC+00:00';
  return value.replace(/^GMT/, 'UTC').replace('-', '−');
}

export function formatCompactZoneLabel(epochMs: number, preference: TimezonePreference, timezone: string): string {
  if (preference === 'UTC') return 'UTC';
  const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(epochMs)
    .find(part => part.type === 'timeZoneName')?.value;
  if (name && !/^(?:GMT|UTC)(?:[+-]\d{1,2}(?::\d{2})?)?$/.test(name)) return name;
  const offset = formatZoneOffset(epochMs, timezone);
  return offset === 'UTC+00:00' ? 'UTC' : offset.replace(/:00$/, '');
}

export function formatCalendarDate(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(epochMs);
}

export function formatTickerTime(epochMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(epochMs);
  const time = parts.filter(part => part.type !== 'literal').map(part => part.value).join(':');
  return `${time}.${String(new Date(epochMs).getUTCMilliseconds()).padStart(3, '0')}`;
}

export function formatZoneDate(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short' }).format(epochMs);
}

export function timezoneName(preference: TimezonePreference, timezone: string): string {
  return preference === 'UTC' ? 'UTC' : `Local · ${timezone}`;
}

