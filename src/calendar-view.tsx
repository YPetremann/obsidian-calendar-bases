import type { BasesAllOptions, BasesEntry, BasesPropertyId, BasesViewConfig, QueryController } from "obsidian";
import type { Root } from "react-dom/client";
import type { CalendarHandle } from "./CalendarReactView";

import { BasesView, DateValue, Menu, parsePropertyId } from "obsidian";
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CalendarReactView } from "./CalendarReactView";
import { AppContext } from "./context";

export const CalendarViewType = "calendar";

interface CalendarEntry {
  entry: BasesEntry;
  startDate: Date;
  endDate?: Date;
}

export class CalendarView extends BasesView {
  type = CalendarViewType;
  scrollEl: HTMLElement;
  containerEl: HTMLElement;
  root: Root | null = null;
  calendarHandleRef = React.createRef<CalendarHandle | null>();

  // Internal rendering data
  private entries: CalendarEntry[] = [];
  private startDateProp: BasesPropertyId | null = null;
  private endDateProp: BasesPropertyId | null = null;
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
    this.startDateProp = this.config.getAsPropertyId("startDate");
    this.endDateProp = this.config.getAsPropertyId("endDate");
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
    if (!this.data || !this.startDateProp) {
      this.root?.unmount();
      this.root = null;
      this.containerEl.empty();
      this.containerEl.createDiv("bases-calendar-empty").textContent =
        "Configure a start date property to display entries";
      return;
    }

    this.entries = [];
    for (const entry of this.data.data) {
      const startDate = this.extractDate(entry, this.startDateProp);
      if (startDate) {
        const endDate = this.endDateProp ? (this.extractDate(entry, this.endDateProp) ?? undefined) : undefined;
        this.entries.push({
          entry,
          startDate,
          endDate,
        });
      }
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
            weekStartDay={this.weekStartDay}
            properties={this.config.getOrder() || []}
            onEntryClick={(entry, isModEvent) => {
              void this.app.workspace.openLinkText(entry.file.path, "", isModEvent);
            }}
            onEntryContextMenu={(evt, entry) => {
              evt.preventDefault();
              this.showEntryContextMenu(evt.nativeEvent, entry);
            }}
            onEventDrop={(entry, newStart, newEnd) => this.updateEntryDates(entry, newStart, newEnd)}
            editable={this.isEditable()}
            calendarHandleRef={this.calendarHandleRef}
          />
        </AppContext.Provider>
      </StrictMode>,
    );
  }

  private isEditable(): boolean {
    if (!this.startDateProp) return false;
    const startDateProperty = parsePropertyId(this.startDateProp);
    if (startDateProperty.type !== "note") return false;

    if (!this.endDateProp) return true;
    const endDateProperty = parsePropertyId(this.endDateProp);
    if (endDateProperty.type !== "note") return false;

    return true;
  }

  private extractDate(entry: BasesEntry, propId: BasesPropertyId): Date | null {
    try {
      const value = entry.getValue(propId);
      if (!value) return null;
      if (!(value instanceof DateValue)) return null;
      // Private API
      if ("date" in value && value.date && value.date instanceof Date) {
        return value.date;
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

  private async updateEntryDates(entry: BasesEntry, newStart: Date, newEnd?: Date): Promise<void> {
    if (!this.startDateProp) return;

    const file = entry.file;
    const startPropName = this.startDateProp;
    const endPropName = this.endDateProp;

    const extractedStartProp = startPropName.startsWith("note.") ? startPropName.slice(5) : null;

    const extractedEndProp = endPropName?.startsWith("note.") ? endPropName.slice(5) : null;

    const shouldUpdate = extractedStartProp !== null && (!this.endDateProp || extractedEndProp !== null);

    if (!shouldUpdate) {
      return;
    }

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const formatDate = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };

      frontmatter[extractedStartProp] = formatDate(newStart);
      if (this.endDateProp && newEnd && extractedEndProp) {
        frontmatter[extractedEndProp] = formatDate(newEnd);
      }
    });
  }

  public setEphemeralState(state: unknown): void {
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
          list: "List",
        },
      },
      {
        // this view is always two columns that cut the day in two halves
        // This is composed of two timeGridDay placed side by side
        displayName: "Day settings",
        type: "group",
        shouldHide: ()=>config.get("view") !== "day",
        items: [
          {
            displayName: "Start hour",
            type: "slider",
            key: "startHour",
            min: 0,
            max: 23,
            default: 6,
          },
          {
            displayName: "End hour",
            type: "slider",
            key: "endHour",
            min: 0,
            max: 23,
            default: 22,
          }
        ],
      },
      {
        // this view display days side by side using the timeGrid or dayGrid layout
        // count select number of days to display
        displayName: "Days settings",
        type: "group",
        shouldHide: ()=>config.get("view") !== "days",
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
            shouldHide: ()=>!config.get("withTime"),
          },
          {
            displayName: "End hour",
            type: "slider",
            key: "endHour",
            min: 0,
            max: 23,
            default: 22,
            shouldHide: ()=>!config.get("withTime"),
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
        shouldHide: ()=>config.get("view") !== "week",
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
        shouldHide: ()=>config.get("view") !== "weeks",
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
            shouldHide: ()=>!config.get("withTime"),
          },
          {
            displayName: "End hour",
            type: "slider",
            key: "endHour",
            min: 0,
            max: 23,
            default: 22,
            shouldHide: ()=>!config.get("withTime"),
          },
        ],
      },
      {
        // this is a dayGridMonth view
        displayName: "Month settings",
        type: "group",
        shouldHide: ()=>config.get("view") !== "month",
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
        shouldHide: ()=>config.get("view") !== "months",
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
            default: 1,
          },
          {
            displayName: "Show weekends",
            type: "toggle",
            key: "showWeekends",
          },
          {
            // whether we use timeGrid instead of dayGrid
            displayName: "With time",
            type: "toggle",
            key: "withTime",
          },
          {
            displayName: "Start hour",
            type: "slider",
            key: "startHour",
            min: 0,
            max: 23,
            default: 6,
            shouldHide: ()=>!config.get("withTime"),
          },
          {
            displayName: "End hour",
            type: "slider",
            key: "endHour",
            min: 0,
            max: 23,
            default: 22,
            shouldHide: ()=>!config.get("withTime"),
          },
        ],
      },
      {
        displayName: "Year settings",
        type: "group",
        shouldHide: ()=>config.get("view") !== "year",
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
            shouldHide: ()=>!["vertical","horizontal"].includes(config.get("layout") as string),
          }
        ],
      },
      {
        displayName: "Properties",
        type: "group",
        items: [
          {
            displayName: "Start date",
            type: "property",
            key: "startDate",
            placeholder: "Property",
          },
          {
            displayName: "End date (optional)",
            type: "property",
            key: "endDate",
            placeholder: "Property",
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
