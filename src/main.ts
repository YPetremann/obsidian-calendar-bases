import type { App, HoverLinkSource } from "obsidian";

import { Plugin } from "obsidian";

import { CalendarView, CalendarViewType } from "./calendar-view";

function getHoverLinkSource(app: App): Record<string, HoverLinkSource> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (app.workspace as any).hoverLinkSources;
}

export default class ObsidianCalendarPlugin extends Plugin {
  onload() {
    getHoverLinkSource(this.app)["bases"] = {
      display: "Calendar Bases",
      defaultMod: false,
    };

    this.registerBasesView(CalendarViewType, {
      name: "Calendar",
      icon: "lucide-calendar",
      factory: (controller, el) => new CalendarView(controller, el),
      options: () => CalendarView.getViewOptions(),
    });
  }

  onunload() {
    delete getHoverLinkSource(this.app)["bases"];
  }
}
