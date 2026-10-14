import type { EventApi, EventClickArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { BasesEntry, BasesPropertyId, Value } from "obsidian";
import type React from "react";
import type { CalendarEntry } from "./calendar-events";
import type { CalendarSettings } from "./calendar-options";

import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import multiMonthPlugin from "@fullcalendar/multimonth";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { DateValue, parsePropertyId } from "obsidian";
import { useCallback, useEffect, useRef } from "react";

import { getEventTiming, readEventAppearance } from "./calendar-events";
import { getCalendarOptions } from "./calendar-options";
import { useApp } from "./hooks";

export interface CalendarHandle {
  updateSize(): void;
}

interface CalendarReactViewProps {
  entries: CalendarEntry[];
  settings: CalendarSettings;
  weekStartDay: number;
  properties: BasesPropertyId[];
  eventTypeProperty: BasesPropertyId | null;
  eventColorProperty: BasesPropertyId | null;
  onEntryClick: (entry: BasesEntry, isModEvent: boolean) => void;
  onEntryContextMenu: (evt: React.MouseEvent, entry: BasesEntry) => void;
  onEventDrop?: (entry: CalendarEntry, newStart: Date, newEnd?: Date) => Promise<void>;
  calendarHandleRef?: React.RefObject<CalendarHandle | null>;
}

const PropertyValue: React.FC<{ value: Value }> = ({ value }) => {
  const app = useApp();
  const elementRef = useCallback(
    (node: HTMLElement | null) => {
      if (!node || !app) return;

      node.replaceChildren();
      if (!(value instanceof DateValue)) {
        value.renderTo(node, app.renderContext);
        return;
      }

      if ("date" in value && value.date instanceof Date) {
        const options: Intl.DateTimeFormatOptions = {
          year: "numeric",
          month: "short",
          day: "numeric",
        };
        if ("time" in value && value.time) {
          options.hour = "2-digit";
          options.minute = "2-digit";
        }
        node.textContent = value.date.toLocaleDateString(undefined, options);
      }
    },
    [value, app],
  );

  return <span ref={elementRef} />;
};

export const CalendarReactView: React.FC<CalendarReactViewProps> = ({
  entries,
  settings,
  weekStartDay,
  properties,
  eventTypeProperty,
  eventColorProperty,
  onEntryClick,
  onEntryContextMenu,
  onEventDrop,
  calendarHandleRef,
}) => {
  const app = useApp();
  const calendarRef = useRef<FullCalendar>(null);
  // Shared hover parent so Page Preview can manage popover lifecycle —
  // when a new popover opens, the old one on the same parent is dismissed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hoverParentRef = useRef<{ hoverPopover: any }>({ hoverPopover: null });

  // Expose updateSize to the parent view for resize/tab-switch handling
  useEffect(() => {
    if (calendarHandleRef) {
      (calendarHandleRef as React.RefObject<CalendarHandle | null>).current = {
        updateSize: () => calendarRef.current?.getApi().updateSize(),
      };
    }
    return () => {
      if (calendarHandleRef) {
        (calendarHandleRef as React.RefObject<CalendarHandle | null>).current = null;
      }
    };
  }, [calendarHandleRef]);

  const events = entries.map((calEntry) => {
    return {
      id: calEntry.id,
      title: calEntry.entry.file.basename,
      ...getEventTiming(calEntry),
      ...readEventAppearance(calEntry.entry, eventTypeProperty, eventColorProperty),
      editable:
        parsePropertyId(calEntry.start.propertyId).type === "note" &&
        (!calEntry.end || parsePropertyId(calEntry.end.propertyId).type === "note"),
      extendedProps: {
        entry: calEntry.entry,
        calendarEntry: calEntry,
      },
    };
  });

  const handleEventClick = useCallback(
    (clickInfo: EventClickArg) => {
      const target = clickInfo.jsEvent.target as HTMLElement;
      const entry = clickInfo.event.extendedProps.entry as BasesEntry;
      const isModEvent = clickInfo.jsEvent.ctrlKey || clickInfo.jsEvent.metaKey;

      // Let interactive elements inside the event handle the click instead of opening the note
      const clickedTag = target.closest("a.tag");
      if (clickedTag) {
        return;
      }

      const clickedLink = target.closest(".internal-link") as HTMLElement | null;
      if (clickedLink) {
        return;
      }

      const clickedExternal = target.closest("a.external-link") as HTMLAnchorElement | undefined;
      if (clickedExternal?.href) {
        return;
      }

      // Default: open the event's note
      clickInfo.jsEvent.preventDefault();
      onEntryClick(entry, isModEvent);
    },
    [onEntryClick],
  );

  // Track contextmenu listeners per element to prevent duplicates across hover cycles
  const contextMenuListenersRef = useRef(new WeakMap<HTMLElement, (evt: Event) => void>());

  const handleEventMouseEnter = useCallback(
    (mouseEnterInfo: { event: EventApi; el: HTMLElement; jsEvent: MouseEvent }) => {
      const entry = mouseEnterInfo.event.extendedProps.entry as BasesEntry;
      const el = mouseEnterInfo.el;

      if (app) {
        app.workspace.trigger("hover-link", {
          event: mouseEnterInfo.jsEvent,
          source: "bases",
          hoverParent: hoverParentRef.current,
          targetEl: el,
          linktext: entry.file.path,
        });
      }

      // Remove previous contextmenu listener if one exists (prevents duplicates)
      const prevHandler = contextMenuListenersRef.current.get(el);
      if (prevHandler) {
        el.removeEventListener("contextmenu", prevHandler);
      }

      const contextMenuHandler = (evt: Event) => {
        evt.preventDefault();
        const syntheticEvent = {
          nativeEvent: evt as MouseEvent,
          currentTarget: el,
          target: evt.target as HTMLElement,
          preventDefault: () => evt.preventDefault(),
          stopPropagation: () => evt.stopPropagation(),
        } as unknown as React.MouseEvent;
        onEntryContextMenu(syntheticEvent, entry);
      };
      contextMenuListenersRef.current.set(el, contextMenuHandler);
      el.addEventListener("contextmenu", contextMenuHandler);
    },
    [app, onEntryContextMenu],
  );

  const handleEventDrop = useCallback(
    async (dropInfo: EventDropArg) => {
      if (!onEventDrop) {
        dropInfo.revert();
        return;
      }

      const entry = dropInfo.event.extendedProps.calendarEntry as CalendarEntry;
      const newStart = dropInfo.event.start;
      const newEnd = dropInfo.event.end;

      if (!newStart) {
        dropInfo.revert();
        return;
      }

      let actualEndDate: Date | undefined;
      if (entry.end) {
        if (newEnd) {
          actualEndDate = new Date(newEnd);
          if (!entry.end.hasTime) actualEndDate.setDate(actualEndDate.getDate() - 1);
        } else {
          actualEndDate = new Date(newStart);
        }
      }

      try {
        await onEventDrop(entry, newStart, actualEndDate);
      } catch {
        dropInfo.revert();
      }
    },
    [onEventDrop],
  );

  const hasNonEmptyValue = useCallback((value: Value): boolean => {
    if (!value?.isTruthy()) return false;
    const str = value.toString();
    return Boolean(str && str.trim().length > 0);
  }, []);

  const renderEventContent = useCallback(
    (eventInfo: EventContentArg) => {
      if (!app) return null;

      const entry = eventInfo.event.extendedProps.entry as BasesEntry;
      const validProperties: { propertyId: BasesPropertyId; value: Value }[] = [];
      for (const prop of properties) {
        const value = tryGetValue(entry, prop);
        if (value && hasNonEmptyValue(value)) {
          validProperties.push({ propertyId: prop, value });
        }
      }

      if (validProperties.length > 0) {
        const firstProperty = validProperties[0];
        const remainingProperties = validProperties.slice(1);

        return (
          <div className="bases-calendar-event-content">
            <div className="bases-calendar-event-title">
              <PropertyValue value={firstProperty.value} />
            </div>
            {remainingProperties.length > 0 && (
              <div className="bases-calendar-event-properties">
                {remainingProperties.map(({ propertyId: prop, value }) => (
                  <div key={prop} className="bases-calendar-event-property">
                    <span className="bases-calendar-event-property-value">
                      <PropertyValue value={value} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      } else {
        // Fallback to file basename if no properties
        return (
          <div className="bases-calendar-event-content">
            <div className="bases-calendar-event-title">{entry.file.basename}</div>
          </div>
        );
      }
    },
    [properties, app, hasNonEmptyValue],
  );

  return (
    <FullCalendar
      key={JSON.stringify(settings)}
      ref={calendarRef}
      plugins={[dayGridPlugin, interactionPlugin, timeGridPlugin, listPlugin, multiMonthPlugin]}
      {...getCalendarOptions(settings)}
      firstDay={weekStartDay}
      headerToolbar={{
        left: "prevYear,prev",
        center: "title",
        right: "today,next,nextYear",
      }}
      buttonText={{
        today: "Today",
      }}
      navLinks={false}
      events={events}
      eventBackgroundColor="var(--background-secondary)"
      eventBorderColor="var(--background-secondary)"
      eventContent={renderEventContent}
      eventClick={handleEventClick}
      eventMouseEnter={handleEventMouseEnter}
      eventDrop={(info) => void handleEventDrop(info)}
      height="auto"
      fixedWeekCount={true}
      fixedMirrorParent={document.body ?? undefined}
      eventDurationEditable={false}
      eventAllow={(dropInfo, event) => {
        if (!event) return false;
        const entry = event.extendedProps.calendarEntry as CalendarEntry;
        return dropInfo.allDay === getEventTiming(entry).allDay;
      }}
    />
  );
};

function tryGetValue(entry: BasesEntry, propId: BasesPropertyId): Value | null {
  try {
    return entry.getValue(propId);
  } catch {
    return null;
  }
}
