import type { BasesEntry, BasesPropertyId } from "obsidian";

import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { exclusiveEnd, formatEventDate, getEventTiming, resolveCalendarEntries } from "./calendar-events";

const entry = { file: { path: "Event.md" } } as BasesEntry;
const value = (propertyId: BasesPropertyId, day: number, hasTime = false, hour = 0) => ({
  propertyId,
  date: new Date(2026, 9, day, hour),
  hasTime,
});

test("accepts an alternative alone and ignores entries without a start", () => {
  const start = value("note.start time", 14, true, 10);
  equal(resolveCalendarEntries(entry, [start], [])[0].start, start);
  deepEqual(resolveCalendarEntries(entry, [], [value("note.end", 15)]), []);
});

test("prefers datetime independently for start and end, including midnight", () => {
  const start = value("note.start time", 14, true);
  const end = value("note.end time", 15, true);
  const events = resolveCalendarEntries(entry, [value("note.start", 13), start], [end, value("note.end", 16)]);
  equal(events.length, 1);
  equal(events[0].start, start);
  equal(events[0].end, end);
});

for (const hasTime of [false, true]) {
  test(`builds outer and inner ranges for ${hasTime ? "datetimes" : "dates"}`, () => {
    const early = value("note.start", 12, hasTime);
    const late = value("note.start alt", 13, hasTime);
    const short = value("note.end", 14, hasTime);
    const long = value("note.end alt", 15, hasTime);
    const events = resolveCalendarEntries(entry, [late, early], [short, long]);
    deepEqual(
      events.map((event) => [event.start, event.end]),
      [
        [early, long],
        [late, short],
      ],
    );
    equal(new Set(events.map((event) => event.id)).size, 2);
  });
}

test("reuses a single boundary when only the other boundary conflicts", () => {
  const start = value("note.start", 12);
  const events = resolveCalendarEntries(entry, [start], [value("note.end", 14), value("note.end alt", 15)]);
  equal(events.length, 2);
  equal(events[1].start, start);
});

test("deduplicates the same property, not distinct properties with equal values", () => {
  const start = value("note.start", 12);
  equal(resolveCalendarEntries(entry, [start, start], []).length, 1);
  equal(resolveCalendarEntries(entry, [start, value("note.start alt", 12)], []).length, 2);
});

test("keeps date ends inclusive and datetime ends exact", () => {
  equal(exclusiveEnd(value("note.end", 14)).getDate(), 15);
  equal(exclusiveEnd(value("note.end", 14, true, 12)).getHours(), 12);
  equal(exclusiveEnd(value("note.end", 14, true, 12)).getDate(), 14);
});

test("discards reversed ranges but permits same-day dates", () => {
  equal(resolveCalendarEntries(entry, [value("note.start", 15)], [value("note.end", 14)]).length, 0);
  equal(resolveCalendarEntries(entry, [value("note.start", 14)], [value("note.end", 14)]).length, 1);
});

test("writes date and datetime formats without losing midnight or precision", () => {
  const date = new Date(2026, 9, 14, 0, 0, 7, 123);
  equal(formatEventDate(date, false), "2026-10-14");
  equal(formatEventDate(date, true), "2026-10-14T00:00:07.123");
});

for (const hasTime of [false, true]) {
  test(`defaults a midnight ${hasTime ? "datetime" : "date"} start to one full day`, () => {
    const start = value("note.start", 14, hasTime);
    const timing = getEventTiming({ id: "event", entry, start });
    equal(timing.allDay, true);
    deepEqual(timing.start, new Date(2026, 9, 14));
    deepEqual(timing.end, new Date(2026, 9, 15));
    deepEqual(start.date, new Date(2026, 9, 14));
  });
}

test("normalizes date-only boundaries to midnight without changing the source values", () => {
  const start = value("note.start", 14, false, 10);
  const end = value("note.end", 14, false, 16);
  const timing = getEventTiming({ id: "event", entry, start, end });
  equal(timing.allDay, true);
  deepEqual(timing.start, new Date(2026, 9, 14));
  deepEqual(timing.end, new Date(2026, 9, 15));
  equal(start.date.getHours(), 10);
  equal(end.date.getHours(), 16);
});

test("treats explicit datetime midnight boundaries as an all-day range", () => {
  const timing = getEventTiming({
    id: "event",
    entry,
    start: value("note.start", 14, true),
    end: value("note.end", 16, true),
  });
  equal(timing.allDay, true);
  deepEqual(timing.end, new Date(2026, 9, 16));
});

test("uses a timed range when either normalized boundary is not midnight", () => {
  for (const [start, end] of [
    [value("note.start", 14), value("note.end", 14, true, 10)],
    [value("note.start", 14, true, 10), value("note.end", 14)],
    [value("note.start", 14, true, 10), value("note.end", 15, true)],
  ]) {
    const timing = getEventTiming({ id: "event", entry, start, end });
    equal(timing.allDay, false);
    deepEqual(timing.end, exclusiveEnd(end));
  }
});

test("defaults timed events to one hour, including across midnight", () => {
  const start = value("note.start", 14, true, 23);
  start.date.setMinutes(30);
  const timing = getEventTiming({ id: "event", entry, start });
  equal(timing.allDay, false);
  deepEqual(timing.end, new Date(2026, 9, 15, 0, 30));
});

test("does not mistake seconds or milliseconds after midnight for all-day events", () => {
  for (const date of [new Date(2026, 9, 14, 0, 0, 1), new Date(2026, 9, 14, 0, 0, 0, 1)]) {
    const start = { propertyId: "note.start" as BasesPropertyId, date, hasTime: true };
    const timing = getEventTiming({ id: "event", entry, start });
    equal(timing.allDay, false);
    equal(timing.end.getTime() - timing.start.getTime(), 60 * 60 * 1000);
    const withEnd = getEventTiming({ id: "event", entry, start: value("note.start", 14), end: start });
    equal(withEnd.allDay, false);
  }
});
