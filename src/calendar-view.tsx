import type { BasesAllOptions, BasesEntry, BasesPropertyId, BasesViewConfig, QueryController } from "obsidian";
import type { Root } from "react-dom/client";
import type { CalendarHandle } from "./CalendarReactView";
import type { CalendarEntry, EventDate } from "./calendar-events";

import { BasesView, DateValue, Menu, parsePropertyId } from "obsidian";
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CalendarReactView } from "./CalendarReactView";
import { formatEventDate, resolveCalendarEntries } from "./calendar-events";
import { readCalendarSettings } from "./calendar-options";
import { AppContext } from "./context";

export const CalendarViewType = "calendar";

export class CalendarView extends BasesView {
  type = CalendarViewType;
  scrollEl: HTMLElement;
  containerEl: HTMLElement;
  root: Root | null = null;
  calendarHandleRef = React.createRef<CalendarHandle | null>();

  // Internal rendering data
  private entries: CalendarEntry[] = [];
  private startEventProps: BasesPropertyId[] = [];
  private endEventProps: BasesPropertyId[] = [];
  private weekStartDay: number = 1;

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    this.scrollEl = scrollEl;
    this.containerEl = scrollEl.createDiv({
      cls: "bases-calendar-container is-loading",
      attr: { tabIndex: 0 },
    });
  }

  onload(): void {
    // React components will handle their own lifecycle
  }

  onunload() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.entries = [];
  }

  onResize(): void {
    // Tell FullCalendar to recalculate dimensions (e.g. after tab switch)
    this.calendarHandleRef.current?.updateSize();
  }

  public focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }

  public onDataUpdated(): void {
    this.containerEl.removeClass("is-loading");
    this.loadConfig();
    this.updateCalendar();
  }

  private loadConfig(): void {
    this.startEventProps = ["startEvent", "startEventAlt"]
      .map((key) => this.config.getAsPropertyId(key))
      .filter((property): property is BasesPropertyId => property !== null);
    this.endEventProps = ["endEvent", "endEventAlt"]
      .map((key) => this.config.getAsPropertyId(key))
      .filter((property): property is BasesPropertyId => property !== null);
    const weekStartDayValue = this.config.get("weekStartDay") as string;

    const dayNameToNumber: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };

    this.weekStartDay = weekStartDayValue ? (dayNameToNumber[weekStartDayValue] ?? 1) : 1; // Default to Monday
  }

  private updateCalendar(): void {
    if (!this.data || !this.startEventProps.length) {
      this.root?.unmount();
      this.root = null;
      this.containerEl.empty();
      this.containerEl.createDiv("bases-calendar-empty").textContent =
        "Configure a start date property to display entries";
      return;
    }

    this.entries = [];
    for (const entry of this.data.data) {
      const starts = this.startEventProps
        .map((property) => this.extractDate(entry, property))
        .filter((value): value is EventDate => value !== null);
      const ends = this.endEventProps
        .map((property) => this.extractDate(entry, property))
        .filter((value): value is EventDate => value !== null);
      this.entries.push(...resolveCalendarEntries(entry, starts, ends));
    }

    this.renderReactCalendar();
  }

  private renderReactCalendar(): void {
    if (!this.root) {
      this.root = createRoot(this.containerEl);
    }

    this.root.render(
      <StrictMode>
        <AppContext.Provider value={this.app}>
          <CalendarReactView
            entries={this.entries}
            settings={readCalendarSettings(this.config)}
            weekStartDay={this.weekStartDay}
            properties={this.config.getOrder() || []}
            eventTypeProperty={this.config.getAsPropertyId("eventType")}
            eventColorProperty={this.config.getAsPropertyId("eventColor")}
            onEntryClick={(entry, isModEvent) => {
              void this.app.workspace.openLinkText(entry.file.path, "", isModEvent);
            }}
            onEntryContextMenu={(evt, entry) => {
              evt.preventDefault();
              this.showEntryContextMenu(evt.nativeEvent, entry);
            }}
            onEventDrop={(entry, newStart, newEnd) => this.updateEntryDates(entry, newStart, newEnd)}
            calendarHandleRef={this.calendarHandleRef}
          />
        </AppContext.Provider>
      </StrictMode>,
    );
  }

  private extractDate(entry: BasesEntry, propId: BasesPropertyId): EventDate | null {
    try {
      const value = entry.getValue(propId);
      if (!value) return null;
      if (!(value instanceof DateValue)) return null;
      // Private API
      if ("date" in value && value.date instanceof Date && Number.isFinite(value.date.getTime())) {
        return {
          propertyId: propId,
          date: new Date(value.date),
          hasTime: "time" in value && Boolean(value.time),
        };
      }

      return null;
    } catch (error) {
      console.error(`Error extracting date for ${entry.file.name}:`, error);
      return null;
    }
  }

  private showEntryContextMenu(evt: MouseEvent, entry: BasesEntry): void {
    const file = entry.file;
    const menu = Menu.forEvent(evt);

    this.app.workspace.handleLinkContextMenu(menu, file.path, "");

    menu.addItem((item) =>
      item
        .setSection("danger")
        .setTitle("Delete file")
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(() => this.app.fileManager.promptForDeletion(file)),
    );
  }

  private async updateEntryDates(event: CalendarEntry, newStart: Date, newEnd?: Date): Promise<void> {
    const startProperty = parsePropertyId(event.start.propertyId);
    const endProperty = event.end ? parsePropertyId(event.end.propertyId) : null;
    if (startProperty.type !== "note" || (endProperty && endProperty.type !== "note")) {
      throw new Error("Calendar dates must be note properties to be edited");
    }

    await this.app.fileManager.processFrontMatter(event.entry.file, (frontmatter) => {
      frontmatter[startProperty.name] = formatEventDate(newStart, event.start.hasTime);
      if (event.end && endProperty?.type === "note" && newEnd) {
        frontmatter[endProperty.name] = formatEventDate(newEnd, event.end.hasTime);
      }
    });
  }

  public setEphemeralState(): void {
    // State management could be extended for React component
  }

  public getEphemeralState(): unknown {
    return {};
  }
  static getViewOptions(config: BasesViewConfig): BasesAllOptions[] {
    return [
      {
        displayName: "View",
        key: "view",
        type: "dropdown",
        default: "month",
        options: {
          day: "Day",
          days: "Days",
          week: "Week",
          weeks: "Weeks",
          month: "Month",
          months: "Months",
          year: "year",
        },
      },
      {
        // this view is always two columns that cut the day in two halves
        // This is composed of two timeGridDay placed side by side
        displayName: "Day settings",
        type: "group",
        shouldHide: () => config.get("view") !== "day",
        items: [
          {
            displayName: "Start day at",
            type: "slider",
            key: "startHour",
            min: 0,
            max: 23,
            default: 6,
          },
          {
            displayName: "End day at",
            type: "slider",
            key: "endHour",
            min: 0,
            max: 23,
            default: 22,
          },
        ],
      },
      {
        // this view display days side by side using the timeGrid or dayGrid layout
        // count select number of days to display
        displayName: "Days settings",
        type: "group",
        shouldHide: () => config.get("view") !== "days",
        items: [
          {
            // whether we use timeGrid instead of dayGrid
            displayName: "With time",
            type: "toggle",
            key: "withTime",
          },
          {
            displayName: "Count",
            type: "slider",
            key: "count",
            min: 1,
            max: 14,
            default: 3,
          },
          {
            displayName: "Start hour",
            type: "slider",
            key: "startHour",
            min: 0,
            max: 23,
            default: 6,
            shouldHide: () => !config.get("withTime"),
          },
          {
            displayName: "End hour",
            type: "slider",
            key: "endHour",
            min: 0,
            max: 23,
            default: 22,
            shouldHide: () => !config.get("withTime"),
          },
        ],
      },
      {
        // this view tries to fit all days based on available space aspect ratio, generally 2x(3-4) or (3-4)x2 grid
        // --- LUN      --- LUN MAR MER
        // MAR MER  or  JEU VEN SAM DIM
        // JEU VEN
        // SAM DIM
        displayName: "Week settings",
        type: "group",
        shouldHide: () => config.get("view") !== "week",
        items: [
          {
            displayName: "Show weekends",
            type: "toggle",
            key: "showWeekends",
          },
        ],
      },
      {
        // this view display days side by side using the timeGrid or dayGrid layout
        // this is aligned to week start
        // count select number of weeks to display
        displayName: "Weeks settings",
        type: "group",
        shouldHide: () => config.get("view") !== "weeks",
        items: [
          {
            // whether we use timeGrid instead of dayGrid
            displayName: "With time",
            type: "toggle",
            key: "withTime",
          },
          {
            displayName: "Count",
            type: "slider",
            key: "count",
            min: 1,
            max: 4,
            default: 1,
          },
          {
            displayName: "Show weekends",
            type: "toggle",
            key: "showWeekends",
          },
          {
            displayName: "Start hour",
            type: "slider",
            key: "startHour",
            min: 0,
            max: 23,
            default: 6,
            shouldHide: () => !config.get("withTime"),
          },
          {
            displayName: "End hour",
            type: "slider",
            key: "endHour",
            min: 0,
            max: 23,
            default: 22,
            shouldHide: () => !config.get("withTime"),
          },
        ],
      },
      {
        // this is a dayGridMonth view
        displayName: "Month settings",
        type: "group",
        shouldHide: () => config.get("view") !== "month",
        items: [
          {
            displayName: "Show weekends",
            type: "toggle",
            key: "showWeekends",
          },
        ],
      },
      {
        // this view display days side by side using the timeGrid or dayGrid layout
        // count permit to display multiples of the layout (eg: 3 days or 2 weeks)
        // if week or month is selected, it display from start of the week or month respectively
        displayName: "Months settings",
        type: "group",
        shouldHide: () => config.get("view") !== "months",
        items: [
          {
            // whether we use timeGrid instead of dayGrid
            displayName: "With time",
            type: "toggle",
            key: "withTime",
          },
          {
            displayName: "Count",
            type: "slider",
            key: "count",
            min: 1,
            max: 12,
            default: 1,
          },
          {
            displayName: "Show weekends",
            type: "toggle",
            key: "showWeekends",
          },
        ],
      },
      {
        displayName: "Year settings",
        type: "group",
        shouldHide: () => config.get("view") !== "year",
        items: [
          {
            displayName: "Layout",
            type: "dropdown",
            key: "layout",
            options: {
              grid: "Grid", // this view use multiMonthYear view, it tries to fit all years months based on available space aspect ratio
              continuous: "Scroll", // this view use the multiMonthYear view with multiMonthMaxColumns=1
              vertical: "Vertical", // custom view where each column is a month and days are laid out vertically
              horizontal: "Horizontal", // custom view where each line is a month and days are laid out horizontally
            },
          },
          {
            displayName: "alignWeeks",
            type: "toggle",
            key: "alignWeeks",
            shouldHide: () => !["vertical", "horizontal"].includes(config.get("layout") as string),
          },
        ],
      },
      {
        displayName: "Properties",
        type: "group",
        items: [
          {
            displayName: "Event Start",
            type: "property",
            key: "startEvent",
            placeholder: "Property",
            default: "start date",
          },
          {
            displayName: "Event Start (alternative)",
            type: "property",
            key: "startEventAlt",
            placeholder: "Property",
            default: "start time",
          },
          {
            displayName: "Event End",
            type: "property",
            key: "endEvent",
            placeholder: "Property",
            default: "end date",
          },
          {
            displayName: "Event End (alternative)",
            type: "property",
            key: "endEventAlt",
            placeholder: "Property",
            default: "end time",
          },
          {
            displayName: "Event Type",
            type: "property",
            key: "eventType",
            placeholder: "Property",
            default: "type",
          },
          {
            displayName: "Event Color",
            type: "property",
            key: "eventColor",
            placeholder: "Property",
            default: "color",
          },
        ],
      },
      {
        displayName: "Calendar options",
        type: "group",
        items: [
          {
            displayName: "Week starts on",
            type: "dropdown",
            key: "weekStartDay",
            default: "monday",
            options: {
              sunday: "Sunday",
              monday: "Monday",
              tuesday: "Tuesday",
              wednesday: "Wednesday",
              thursday: "Thursday",
              friday: "Friday",
              saturday: "Saturday",
            },
          },
        ],
      },
    ];
  }
}
