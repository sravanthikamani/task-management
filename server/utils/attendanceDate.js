const APP_TIMEZONE = 'Asia/Kolkata';
const APP_UTC_OFFSET_MINUTES = 330;

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export const getAppDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = dateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
};

export const getAppDayRange = (value = new Date()) => {
  const dateKey = getAppDateKey(value);
  const [year, month, day] = dateKey.split('-').map((part) => Number(part));

  if (!dateKey || !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    const start = new Date(value);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, dateKey: getAppDateKey(start) };
  }

  const startUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - (APP_UTC_OFFSET_MINUTES * 60 * 1000);
  const start = new Date(startUtcMs);
  const end = new Date(startUtcMs + (24 * 60 * 60 * 1000));

  return { start, end, dateKey };
};

export const getAppDateAtHourMinute = (baseDate = new Date(), hour = 0, minute = 0) => {
  const dateKey = getAppDateKey(baseDate);
  const [year, month, day] = dateKey.split('-').map((part) => Number(part));

  if (!dateKey || !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    const fallback = new Date(baseDate);
    fallback.setHours(hour, minute, 0, 0);
    return fallback;
  }

  const safeHour = Math.min(23, Math.max(0, Number(hour) || 0));
  const safeMinute = Math.min(59, Math.max(0, Number(minute) || 0));
  const utcMs = Date.UTC(year, month - 1, day, safeHour, safeMinute, 0, 0) - (APP_UTC_OFFSET_MINUTES * 60 * 1000);
  return new Date(utcMs);
};
