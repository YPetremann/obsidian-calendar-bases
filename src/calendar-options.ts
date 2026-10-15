import type { CalendarOptions } from "@fullcalendar/core";

export type CalendarViewMode = "day" | "days" | "week" | "weeks" | "month" | "months" | "year" | "list";
export type YearLayout = "grid" | "continuous" | "vertical" | "horizontal";

export interface CalendarSettings {
  view: CalendarViewMode;
  count: number;
  withTime: boolean;
  showWeekends: boolean;
  startHour: number;
  endHour: number;
  layout: YearLayout;
  alignWeeks: boolean;
}

export function readCalendarSettings(config: { get(key: string): unknown }): CalendarSettings {
  const selectedView = config.get("view");
  const view: CalendarViewMode =
    typeof selectedView === "string" &&
    ["day", "days", "week", "weeks", "month", "months", "year", "list"].includes(selectedView)
      ? (selectedView as CalendarViewMode)
      : "month";
  const numberOption = (key: string, fallback: number, min: number, max: number): number => {
    const value = config.get(key);
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, Math.floor(value)))
      : fallback;
  };
  const startHour = numberOption("startHour", 6, 0, 23);
  const selectedLayout = config.get("layout");
  return {
    view,
    count: numberOption("count", view === "days" ? 3 : 1, 1, view === "days" ? 14 : view === "weeks" ? 4 : 12),
    withTime: config.get("withTime") === true,
    showWeekends: config.get("showWeekends") !== false,
    startHour,
    endHour: Math.max(startHour, numberOption("endHour", 22, 0, 23)),
    layout:
      typeof selectedLayout === "string" && ["grid", "continuous", "vertical", "horizontal"].includes(selectedLayout)
        ? (selectedLayout as YearLayout)
        : "grid",
    alignWeeks: config.get("alignWeeks") === true,
  };
}

export function getCalendarOptions(settings: CalendarSettings): CalendarOptions {
  const { view, count, withTime } = settings;
  return {
    initialView: "configured",
    weekends: settings.showWeekends,
    slotMinTime: { hours: settings.startHour },
    slotMaxTime: { hours: settings.endHour + 1 },
    multiMonthMaxColumns: settings.layout === "continuous" ? 1 : 3,
    views: {
      configured: {
        type:
          view === "year" || view === "months"
            ? "multiMonth"
            : view === "list"
              ? "list"
              : view === "day" || (withTime && (view === "days" || view === "weeks"))
                ? "timeGrid"
                : "dayGrid",
        duration:
          view === "year"
            ? { years: 1 }
            : view === "months"
              ? { months: count }
              : view === "month" || view === "list"
                ? { months: 1 }
                : view === "week" || view === "weeks"
                  ? { weeks: view === "week" ? 1 : count }
                  : { days: view === "day" ? 1 : count },
        dateAlignment:
          view === "year"
            ? "year"
            : view === "month" || view === "months" || view === "list"
              ? "month"
              : view === "week" || view === "weeks"
                ? "week"
                : "day",
      },
    },
  };
}
