import type { BasesAllOptions, BasesEntry, BasesPropertyId, BasesViewConfig, QueryController } from "obsidian";
import type { Root } from "react-dom/client";
import type { CalendarHandle } from "./CalendarReactView";
import type { CalendarEntry, EventDate } from "./calendar-events";
import type { I18nAdapter } from "./lang/i18n";

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
  static getViewOptions(config: BasesViewConfig, t: I18nAdapter["t"]): BasesAllOptions[] {
    return [
      {
        displayName: t("config.view"),
        key: "view",
        type: "dropdown",
        default: "month",
        options: {
          day: t("config.day"),
          days: t("config.days"),
          week: t("config.week"),
          weeks: t("config.weeks"),
          month: t("config.month"),
          months: t("config.months"),
          year: t("config.year"),
        },
      },
      {
        // this view is always two columns that cut the day in two halves
        // This is composed of two timeGridDay placed side by side
        displayName: t("config.settings", { name: t("config.day") }),
        type: "group",
        shouldHide: () => config.get("view") !== "day",
        items: [
          {
            displayName: t("config.startHour"),
            type: "slider",
            key: "startHour",
            min: 0,
            max: 23,
            default: 6,
          },
          {
            displayName: t("config.endHour"),
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
        displayName: t("config.settings", { name: t("config.days") }),
        type: "group",
        shouldHide: () => config.get("view") !== "days",
        items: [
          {
            // whether we use timeGrid instead of dayGrid
            displayName: t("config.withTime"),
            type: "toggle",
            key: "withTime",
          },
          {
            displayName: t("config.count"),
            type: "slider",
            key: "count",
            min: 1,
            max: 14,
            default: 3,
          },
          {
            displayName: t("config.startHour"),
            type: "slider",
            key: "startHour",
            min: 0,
            max: 23,
            default: 6,
            shouldHide: () => !config.get("withTime"),
          },
          {
            displayName: t("config.endHour"),
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
        displayName: t("config.settings", { name: t("config.week") }),
        type: "group",
        shouldHide: () => config.get("view") !== "week",
        items: [
          {
            displayName: t("config.showWeekend"),
            type: "toggle",
            key: "showWeekends",
          },
        ],
      },
      {
        // this view display days side by side using the timeGrid or dayGrid layout
        // this is aligned to week start
        // count select number of weeks to display
        displayName: t("config.settings", { name: t("config.weeks") }),
        type: "group",
        shouldHide: () => config.get("view") !== "weeks",
        items: [
          {
            // whether we use timeGrid instead of dayGrid
            displayName: t("config.withTime"),
            type: "toggle",
            key: "withTime",
          },
          {
            displayName: t("config.count"),
            type: "slider",
            key: "count",
            min: 1,
            max: 4,
            default: 1,
          },
          {
            displayName: t("config.showWeekend"),
            type: "toggle",
            key: "showWeekends",
          },
          {
            displayName: t("config.startHour"),
            type: "slider",
            key: "startHour",
            min: 0,
            max: 23,
            default: 6,
            shouldHide: () => !config.get("withTime"),
          },
          {
            displayName: t("config.endHour"),
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
        displayName: t("config.settings", { name: t("config.month") }),
        type: "group",
        shouldHide: () => config.get("view") !== "month",
        items: [
          {
            displayName: t("config.showWeekend"),
            type: "toggle",
            key: "showWeekends",
          },
        ],
      },
      {
        // this view display days side by side using the timeGrid or dayGrid layout
        // count permit to display multiples of the layout (eg: 3 days or 2 weeks)
        // if week or month is selected, it display from start of the week or month respectively
        displayName: t("config.settings", { name: t("config.months") }),
        type: "group",
        shouldHide: () => config.get("view") !== "months",
        items: [
          {
            // whether we use timeGrid instead of dayGrid
            displayName: t("config.withTime"),
            type: "toggle",
            key: "withTime",
          },
          {
            displayName: t("config.count"),
            type: "slider",
            key: "count",
            min: 1,
            max: 12,
            default: 1,
          },
          {
            displayName: t("config.showWeekend"),
            type: "toggle",
            key: "showWeekends",
          },
        ],
      },
      {
        displayName: t("config.settings", { name: t("config.year") }),
        type: "group",
        shouldHide: () => config.get("view") !== "year",
        items: [
          {
            displayName: t("config.layout"),
            type: "dropdown",
            key: "layout",
            options: {
              grid: t("config.layout.grid"), // this view use multiMonthYear view, it tries to fit all years months based on available space aspect ratio
              continuous: t("config.layout.continuous"), // this view use the multiMonthYear view with multiMonthMaxColumns=1
              vertical: t("config.layout.vertical"), // custom view where each column is a month and days are laid out vertically
              horizontal: t("config.layout.horizontal"), // custom view where each line is a month and days are laid out horizontally
            },
          },
          {
            displayName: t("config.alignWeeks"),
            type: "toggle",
            key: "alignWeeks",
            shouldHide: () => !["vertical", "horizontal"].includes(config.get("layout") as string),
          },
        ],
      },
      {
        displayName: t("config.properties"),
        type: "group",
        items: [
          {
            displayName: t("property.startEvent"),
            type: "property",
            key: "startEvent",
            placeholder: t("Property"),
            default: "start date",
          },
          {
            displayName: t("property.startEventAlt"),
            type: "property",
            key: "startEventAlt",
            placeholder: t("Property"),
            default: "start time",
          },
          {
            displayName: t("property.endEvent"),
            type: "property",
            key: "endEvent",
            placeholder: t("Property"),
            default: "end date",
          },
          {
            displayName: t("property.endEventAlt"),
            type: "property",
            key: "endEventAlt",
            placeholder: t("Property"),
            default: "end time",
          },
          {
            displayName: t("property.eventType"),
            type: "property",
            key: "eventType",
            placeholder: t("Property"),
            default: "type",
          },
          {
            displayName: t("property.eventColor"),
            type: "property",
            key: "eventColor",
            placeholder: t("Property"),
            default: "color",
          },
        ],
      },
    ];
  }
}
