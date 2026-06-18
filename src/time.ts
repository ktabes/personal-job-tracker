export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIsoDateInTimezone(timeZone: string): string {
  const parts = dateTimePartsInTimezone(new Date(), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateTimePartsInTimezone(date: Date, timeZone: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;

  if (!year || !month || !day || !hour) {
    throw new Error(`Unable to format date for timezone ${timeZone}`);
  }

  return { year, month, day, hour };
}
