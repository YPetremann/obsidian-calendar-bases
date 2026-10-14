import type { EventInput } from "@fullcalendar/core";
import type { BasesEntry, BasesPropertyId } from "obsidian";

export interface EventDate {
  propertyId: BasesPropertyId;
  date: Date;
  hasTime: boolean;
}

export interface CalendarEntry {
  id: string;
  entry: BasesEntry;
  start: EventDate;
  end?: EventDate;
}

export function readEventAppearance(
  entry: BasesEntry,
  typeProperty: BasesPropertyId | null,
  colorProperty: BasesPropertyId | null,
): Pick<EventInput, "display" | "color"> {
  const readText = (property: BasesPropertyId | null): string | undefined => {
    if (!property) return undefined;
    try {
      return entry.getValue(property)?.toString().trim() || undefined;
    } catch {
      return undefined;
    }
  };
  const type = readText(typeProperty);
  const display = type && ["auto", "block", "list-item", "background"].includes(type) ? type : "auto";
  return { display, color: readText(colorProperty) };
}

function preferredDates(values: EventDate[]): EventDate[] {
  const distinct = values.filter(
    (value, index) => values.findIndex((other) => other.propertyId === value.propertyId) === index,
  );
  const timed = distinct.filter((value) => value.hasTime);
  return (timed.length ? timed : distinct).sort((first, second) => first.date.getTime() - second.date.getTime());
}

export function resolveCalendarEntries(entry: BasesEntry, starts: EventDate[], ends: EventDate[]): CalendarEntry[] {
  const preferredStarts = preferredDates(starts);
  const preferredEnds = preferredDates(ends);
  if (!preferredStarts.length) return [];

  const count = Math.max(preferredStarts.length, preferredEnds.length);
  return Array.from(
    { length: count },
    (_, index): CalendarEntry => ({
      id: `${entry.file.path}:${index === 0 ? "outer" : "inner"}`,
      entry,
      start: preferredStarts[index === 0 ? 0 : preferredStarts.length - 1],
      end: preferredEnds[index === 0 ? preferredEnds.length - 1 : 0],
    }),
  ).filter((event) => {
    const { start, end } = getEventTiming(event);
    return end.getTime() > start.getTime();
  });
}

export function exclusiveEnd(value: EventDate): Date {
  const end = new Date(value.date);
  if (!value.hasTime) {
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
  }
  return end;
}

export function getEventTiming(event: CalendarEntry): { start: Date; end: Date; allDay: boolean } {
  const start = new Date(event.start.date);
  if (!event.start.hasTime) start.setHours(0, 0, 0, 0);
  const explicitEnd = event.end ? exclusiveEnd(event.end) : undefined;
  const isMidnight = (date: Date) =>
    date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;
  const allDay = isMidnight(start) && (!explicitEnd || isMidnight(explicitEnd));
  let end = explicitEnd;
  if (!end) {
    end = new Date(start);
    if (allDay) end.setDate(end.getDate() + 1);
    else end.setTime(end.getTime() + 60 * 60 * 1000);
  }
  return { start, end, allDay };
}

export function formatEventDate(date: Date, hasTime: boolean): string {
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  if (!hasTime) return day;
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  const milliseconds = date.getMilliseconds() ? `.${String(date.getMilliseconds()).padStart(3, "0")}` : "";
  return `${day}T${time}${milliseconds}`;
}
