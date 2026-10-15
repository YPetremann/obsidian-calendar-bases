import type { App, HoverLinkSource } from "obsidian";
import type { I18nAdapter } from "./lang/i18n";

import { Plugin } from "obsidian";

import { CalendarView, CalendarViewType } from "./calendar-view";
import { initI18n } from "./lang/i18n";

function getHoverLinkSource(app: App): Record<string, HoverLinkSource> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (app.workspace as any).hoverLinkSources;
}

export default class ObsidianCalendarPlugin extends Plugin {
  i18n!: I18nAdapter;
  t!: I18nAdapter["t"];

  onload() {
    this.i18n = initI18n(this);
    this.t = this.i18n.t.bind(this.i18n);

    getHoverLinkSource(this.app)["bases"] = {
      display: "Calendar Bases",
      defaultMod: false,
    };

    this.registerBasesView(CalendarViewType, {
      name: "Calendar",
      icon: "lucide-calendar",
      factory: (controller, el) => new CalendarView(controller, el,this.t),
      options: (config)=>CalendarView.getViewOptions(config,this.t),
    });
  }

  onunload() {
    delete getHoverLinkSource(this.app)["bases"];
  }
}
