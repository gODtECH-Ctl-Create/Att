const SCHOOL_TIME_ZONE =
  process.env.NEXT_PUBLIC_SCHOOL_TIME_ZONE || "Africa/Lagos";

const schoolTimeFormatter = new Intl.DateTimeFormat("en-NG", {
  timeZone: SCHOOL_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

const schoolDateFormatter = new Intl.DateTimeFormat("en-NG", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function getSchoolDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatSchoolTime(iso?: string) {
  if (!iso) return "—";
  return schoolTimeFormatter.format(new Date(iso));
}

export function formatSchoolDate(dateKey: string) {
  return schoolDateFormatter.format(new Date(`${dateKey}T00:00:00Z`));
}
