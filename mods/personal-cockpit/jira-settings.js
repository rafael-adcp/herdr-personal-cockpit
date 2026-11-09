import { div } from "gpui-kit";
import { h_flex, v_flex, Textarea, TextareaState } from "gpui-base";
import { closeOverlay, props, run, theme, writeTextFile } from "herdr";
import { openFile } from "./conf.js";
import { button as cockpitButton } from "./kit.js";
import { configOf, DEFAULT_JQL } from "./jira-model.js";
import { configPath, executeQuery } from "./jira-query.js";

export class QuerySettings {
  constructor(_view, cx) {
    const p = props() ?? {};
    this.overlay = p.overlay;
    this.config = p.config ?? {};
    this.expected = p.expected ?? null;
    this.error = null;
    this.busy = false;
    this.cancelled = false;
    this.focused = true;
    this.handle = cx.focus_handle();
    this.input = TextareaState.new({ value: this.config.jql ?? DEFAULT_JQL, placeholder: "Enter a Jira JQL query", rows: 5 });
    this.input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
  }

  save(cx) {
    if (this.busy) return;
    const jql = this.input.value().trim();
    try { configOf({ ...this.config, jql }); } catch (e) {
      this.error = String(e.message); cx.notify(); return;
    }
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let writing = false;
      try {
        // Validate the real JQL and account permissions before replacing the
        // current query. Invalid JQL never replaces a working configuration.
        await executeQuery(this.config, jql);
        if (this.cancelled) return;
        writing = true;
        await writeTextFile(configPath(), JSON.stringify({ ...this.config, jql }, null, 2) + "\n", this.expected);
        run("personal-cockpit.jira-refresh");
        closeOverlay(this.overlay);
      } catch (e) {
        this.error = writing ? "Configuration changed on disk or could not be saved. Reopen this dialog before trying again." : String(e?.message ?? e);
      } finally {
        this.busy = false; cx.notify();
      }
    });
  }

  close() { this.cancelled = true; }

  cancel() { this.close(); closeOverlay(this.overlay); }

  openFile(cx) {
    cx.spawn(async (cx) => {
      try {
        const result = await openFile("jira.config.json");
        if (result.code !== 0) throw new Error(`Open ${configPath()} manually.`);
      } catch (e) { this.error = String(e?.message ?? e); cx.notify(); }
    });
  }

  render() {
    const t = theme();
    const button = (id, label, onClick, primary = false) => cockpitButton(t, id, label, (_e, cx) => onClick(cx))
      .h(32).px(12).rounded(8).text_size(12)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.bg(primary ? t.accent : t.hover));
    return v_flex().id("jira-query-settings").w_full().p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => {
        if (e.key === "escape") { this.cancel(); cx.stop_propagation(); }
      })
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(15).font_semibold().child("Customize Jira query"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(11.5).text_color(t.muted).child("JQL · any Jira search your account can access"))
      .child(Textarea.new(this.input).id("jira-query-input").h(132).px(10).py(8).rounded(9).border_1()
        .border_color(this.focused ? t.accent : t.input).bg(t.background).text_color(t.foreground).text_size(12.5))
      .child(div().text_size(11.5).text_color(t.dim)
        .child("To match a team board, paste its saved filter JQL and include its assignee, sprint and quick filters as needed. A board URL alone does not reveal those filters."))
      .child(div().text_size(11).text_color(t.dim).child("Save runs a read-only Jira search first. Other settings, including the Node path and login, are preserved."))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).justify_between().items_center()
        .child(button("jira-query-file", "Advanced config…", (cx) => this.openFile(cx))))
      .child(h_flex().gap(8).justify_end()
        .child(button("jira-query-cancel", "Cancel", () => this.cancel()))
        .child(button("jira-query-save", this.busy ? "Checking query…" : "Save & refresh", (cx) => this.save(cx), true)
          .when(this.busy, (el) => el.opacity(0.5))));
  }
}
