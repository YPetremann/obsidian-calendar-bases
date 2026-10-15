import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { getCalendarOptions, readCalendarSettings } from "./calendar-options";

for (const [startHour, endHour, expectedEnd] of [
  [6, 22, 23],
  [22, 22, 23],
  [0, 0, 1],
  [23, 23, 24],
  [22, 10, 23],
]) {
  test(`includes the final hour for startHour=${startHour} and endHour=${endHour}`, () => {
    const values: Record<string, unknown> = { view: "day", startHour, endHour };
    const settings = readCalendarSettings({ get: (key) => values[key] });
    const options = getCalendarOptions(settings);
    deepEqual(options.slotMinTime, { hours: startHour });
    deepEqual(options.slotMaxTime, { hours: expectedEnd });
    equal(settings.endHour, expectedEnd - 1);
  });
}

test("includes hour 22 by default", () => {
  const settings = readCalendarSettings({ get: () => undefined });
  equal(settings.endHour, 22);
  deepEqual(getCalendarOptions(settings).slotMaxTime, { hours: 23 });
});
