// Jira is a Cockpit screen. Only its data/authentication path differs from the
// GitHub lists; all panel chrome and layout operations come from kit/dock.
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { layout, nextCommand, openOverlay, props, readTextFile, theme } from "herdr";
import { DEFAULT_JQL, sections } from "./jira-model.js";
import { COLLAPSED_MAX, RAIL_MAX, hostBlockFor, minimise, moveTo, placeOf } from "../kit/dock.js";
import { button, cell, header, rail, row, sectionHead, shell } from "../kit/kit.js";
import { configPath, executeQuery } from "./jira-query.js";

const INTERVAL = 180000;
// Keep the existing saved height when migrating from the standalone panel.
const HEIGHT_KEY = "jira-tickets.height";

export class Jira {
  constructor(_view, cx) {
    this.pendingRefresh = false;
    this.items = [];
    this.data = null;
    this.error = null;
    this.stale = null;
    this.busy = false;
    this.at = 0;
    this.selectedKey = null;
    this.width = 380;
    this.handle = cx.focus_handle();
    this.refresh(cx);
    cx.timer.every(INTERVAL, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (command === "refresh" || command === "jira-refresh") this.requestRefresh(cx);
        else if (command === "jira-configure") this.configure(cx);
        else if (command === "jira-move-left") this.move("sidebar");
        else if (command === "jira-move-right") this.move("right");
        cx.notify();
      }
    });
  }

  requestRefresh(cx) {
    if (this.busy) this.pendingRefresh = true;
    else this.refresh(cx);
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const configText = await readTextFile(configPath());
        const config = configText ? JSON.parse(configText) : {};
        const data = await executeQuery(config);
        this.items = data.items;
        this.data = data;
        this.at = Math.max(0, this.ordered().findIndex((item) => item.key === this.selectedKey));
        this.error = null;
        this.stale = null;
      } catch (e) {
        const error = { kind: e?.kind ?? "error", message: String(e?.message ?? e) };
        // A failed refresh never clears a known-good list, including an empty one.
        if (this.data) this.stale = error;
        else this.error = error;
      } finally {
        this.busy = false;
        cx.notify();
        if (this.pendingRefresh) { this.pendingRefresh = false; this.refresh(cx); }
      }
    });
  }

  ordered() { return sections(this.items).flatMap((group) => group.items); }

  open(item, cx) { if (item?.url) cx.open_url(item.url); }

  configure(cx) {
    cx.spawn(async (cx) => {
      try {
        const expected = await readTextFile(configPath());
        const config = expected ? JSON.parse(expected) : {};
        openOverlay({ mod: "personal-cockpit", kind: "dialog", width: 680, props: { kind: "jira-settings", config, expected } });
      } catch (e) {
        const error = { kind: "setup", message: String(e?.message ?? e) };
        if (this.data) this.stale = error;
        else this.error = error;
        cx.notify();
      }
    });
  }

  toggle(host, collapsed) { minimise(host, collapsed, HEIGHT_KEY); }

  host() { return hostBlockFor(layout(), "jira", props()?.node); }

  move(side) {
    const host = this.host();
    if (placeOf(layout(), host)) moveTo(host, side);
  }

  render(cx) {
    const t = theme();
    const host = this.host();
    const collapsed = Boolean(host && (host.size?.px ?? Infinity) <= COLLAPSED_MAX);
    const railed = this.width < RAIL_MAX;
    const ordered = this.ordered();
    const selected = ordered[this.at];
    const trouble = this.stale ?? this.error;
    const stamp = this.data ? `${this.data.jql}\nLast updated: ${new Date(this.data.at).toLocaleString()}` : "Refresh assigned Jira tickets";
    const body = [railed ? rail(t, "mods/personal-cockpit/icons/issues.svg", 0) : header(t, {
      id: "jira",
      title: "My Jira tickets",
      count: this.data ? this.items.length : 0,
      trouble: trouble ? (this.data ? "stale" : trouble.kind) : null,
      troubleTip: trouble?.message,
      stamp,
      busy: this.busy,
      host,
      collapsed,
      place: placeOf(layout(), host),
      onRefresh: (cx) => this.requestRefresh(cx),
      onConfigure: (cx) => this.configure(cx),
      configureTip: "Customize Jira query · c",
      onBrowse: this.data ? (cx) => cx.open_url(this.data.url) : null,
      browseTip: "Open this search in Jira · o",
      onMove: (side) => this.move(side),
      onMinimise: () => this.toggle(host, collapsed),
    })];
    if (!railed && !collapsed) {
      if (this.error) {
        body.push(v_flex().px(16).pb(10).gap(8).child(div().text_size(12).text_color(t.muted).child(this.error.message))
          .child(button(t, "jira-retry", "Try again", (_e, cx) => this.refresh(cx))));
      } else if (!this.data) {
        body.push(div().px(16).text_size(12).text_color(t.dim).child("Loading Jira tickets…"));
      } else {
        const rows = [];
        for (const group of sections(this.items)) {
          rows.push(sectionHead(t, group.label, group.items.length));
          for (const item of group.items) {
            const color = item.category === "indeterminate" ? t.working : item.category === "done" ? t.done : t.dim;
            const priorityColor = /highest|critical|blocker|\bP[12]\b/i.test(item.priority) ? t.blocked : t.dim;
            rows.push(row(t, {
              id: `jira-${item.key}`, title: item.title, age: "", wide: true,
              glyph: cell().text_color(color).child("●"), selected: item === selected,
              tooltip: `${item.key} · ${item.title}\n${item.status} · ${item.priority}\n${item.project} · ${item.type}\nUpdated: ${item.updated ?? "unknown"}`,
              onClick: (_e, cx) => { this.at = ordered.indexOf(item); this.selectedKey = item.key; this.open(item, cx); cx.notify(); },
              second: [
                div().flex_none().text_color(t.muted).child(item.key),
                div().flex_1().min_w(0).truncate().text_color(color).child(item.status),
                ...(this.width >= 300 ? [div().flex_none().text_color(priorityColor).child(item.priority)] : []),
              ],
            }));
          }
        }
        if (!rows.length) rows.push(div().px(10).py(6).text_size(12).text_color(t.dim).child("No tickets match this query."));
        body.push(v_flex().id("jira-list").flex_1().min_h(0).px(6).gap(1).overflow_y_scrollbar().children(rows));
        const footnote = this.stale ? "Couldn't refresh · showing the last successful list" :
          `${this.items.length} tickets · ${this.data.jql === DEFAULT_JQL ? "Assigned to me" : "Custom JQL"}`;
        body.push(div().flex_none().px(16).pb(6).truncate().text_size(10).text_color(this.stale ? t.blocked : t.dim)
          .tooltip(this.stale?.message ?? stamp).child(footnote));
      }
    }
    return shell(t, {
      id: "jira-root", handle: this.handle, body,
      onSize: (size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } },
      onKey: (e, cx) => {
        if (e.key === "r") this.requestRefresh(cx);
        else if (e.key === "c") this.configure(cx);
        else if (e.key === "o" && this.data) cx.open_url(this.data.url);
        else if (e.key === "down" && ordered.length) this.at = (this.at + 1) % ordered.length;
        else if (e.key === "up" && ordered.length) this.at = (this.at + ordered.length - 1) % ordered.length;
        else if (e.key === "enter") this.open(selected, cx);
        else return;
        this.selectedKey = ordered[this.at]?.key ?? null;
        cx.stop_propagation(); cx.notify();
      },
    }).on_mouse_down("left", () => this.handle.focus());
  }
}
