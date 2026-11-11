// "Watch which repository?" -- the dialog behind the panel's gear.
//
// It opens as this same mod with `kind: "repo-picker"`, which is why the mod is
// one folder: a second mod folder just to draw a dialog would mean a second
// copy of everything it shares with the panel.
//
// A typed `owner/name` is always accepted. The suggestions are a convenience
// and can be wrong or empty -- a work repo often lives on an org, or on another
// GitHub account entirely, and `gh repo list` only knows the one that is
// signed in right now. Never let them become the only way through.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import { repoList } from "../kit/github.js";
import { choose, forget, recent, looksLikeRepo } from "../kit/config.js";
import { button } from "../kit/kit.js";

const DEBOUNCE = 350;
const SHOWN = 8;

export class Picker {
  constructor(view, cx) {
    const p = props() ?? {};
    this.view = view;
    this.panel = p.panel ?? "issues";
    this.overlay = p.overlay;
    this.current = p.current ?? null;
    this.text = this.current ?? "";
    this.suggestions = [];
    this.looking = false;
    // Whose repos were last asked for. `undefined` until the first lookup goes
    // out, because `null` is already a real value here -- "nothing typed before
    // a slash", meaning the signed-in account's own.
    this.owner = undefined;

    this.input = InputState.new({ value: this.text, placeholder: "owner/name" });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => {
      this.text = this.input.value();
      this.schedule(cx);
      cx.notify();
    });
    this.input.on("submit", () => this.save(this.text));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    // The overlay animates in; the first focus can land before it exists.
    cx.timer.after(600, () => this.input.focus());

    this.handle = cx.focus_handle();
    this.look(cx);
  }

  // One lookup per pause in typing, not one per keystroke: each is a `gh`
  // process.
  schedule(cx) {
    this.pending = (this.pending ?? 0) + 1;
    const mine = this.pending;
    cx.timer.after(DEBOUNCE, (cx) => {
      if (mine === this.pending) this.look(cx);
    });
  }

  look(cx) {
    // Only the owner half decides whose repos to list, so typing the name part
    // does not start a new lookup.
    const owner = this.text.includes("/") ? this.text.split("/")[0].trim() : null;
    // Asked about, not answered usefully, is still asked about. An org this
    // login cannot list -- or a typo -- comes back empty, and guarding on
    // `this.suggestions.length` instead let that case through: every pause in
    // typing spawned another `gh repo list`, which is the one thing `schedule`
    // above exists to prevent. The cost is that a lookup lost to a dropped
    // connection is not retried, and suggestions are a nicety: the field below
    // takes a typed `owner/name` either way.
    if (owner === this.owner) return;
    this.owner = owner;
    this.looking = true;
    cx.spawn(async (cx) => {
      const found = await repoList(owner);
      if (owner === this.owner) {
        this.suggestions = found.map((r) => r.nameWithOwner).filter(Boolean);
        this.looking = false;
        cx.notify();
      }
    });
  }

  matches() {
    const typed = this.text.trim().toLowerCase();
    const seen = new Set(recent(this.panel));
    const pool = this.suggestions.filter((r) => !seen.has(r));
    if (!typed) return pool.slice(0, SHOWN);
    return pool.filter((r) => r.toLowerCase().includes(typed)).slice(0, SHOWN);
  }

  save(repo) {
    if (!choose(this.panel, repo)) return;
    closeOverlay(this.overlay);
  }

  key(e, cx) {
    if (e.key === "escape") {
      closeOverlay(this.overlay);
      cx.stop_propagation();
    }
  }

  // A row in either list. `onForget` adds the × that drops a remembered repo.
  option(t, id, repo, onForget) {
    const el = h_flex()
      .id(id)
      .px(10)
      .h(28)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.save(repo))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(repo))
      .when(repo === this.current, (e) => e.child(div().flex_none().text_size(10).text_color(t.dim).child("current")));
    if (!onForget) return el;
    return el.child(
      div()
        .id(`${id}-forget`)
        .flex_none()
        .px(4)
        .text_size(11)
        .text_color(t.dim)
        .tooltip("Forget this one")
        .hover((s) => s.text_color(t.foreground))
        .on_click((e, cx) => {
          cx.stop_propagation();
          onForget();
          cx.notify();
        })
        .child("✕"),
    );
  }

  render() {
    const t = theme();
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const remembered = recent(this.panel);
    const suggested = this.matches();
    const valid = looksLikeRepo(this.text);

    const body = v_flex()
      .id("cockpit-picker")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .w_full()
      .min_h(0)
      .p(18)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .child(div().flex_1().text_size(15).font_semibold().child("Watch which repository?"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(label("Repository"))
      .child(
        Input.new(this.input)
          .h(36)
          .px(10)
          .rounded(9)
          .border_1()
          .border_color(this.inputFocused ? t.accent : t.input)
          .bg(t.background)
          .text_size(12.8)
          .text_color(t.foreground),
      )
      .child(
        div()
          .pt(6)
          .text_size(11.5)
          .text_color(t.dim)
          .child("A repo whose open issues are your queue. Its own account or an org — anything the signed-in gh can read."),
      );

    if (remembered.length) {
      body.child(label("Recent"));
      body.child(
        v_flex()
          .gap(1)
          .children(
            remembered.map((repo, i) =>
              this.option(t, `cockpit-recent-${i}`, repo, () => forget(this.panel, repo)),
            ),
          ),
      );
    }

    if (suggested.length || this.looking) {
      body.child(label(this.owner ? `On ${this.owner}` : "Yours"));
      body.child(
        this.looking && !suggested.length
          ? div().px(10).py(4).text_size(11.5).text_color(t.dim).child("Looking…")
          : v_flex().gap(1).children(suggested.map((repo, i) => this.option(t, `cockpit-found-${i}`, repo, null))),
      );
    }

    const cancel = h_flex()
      .id("cockpit-picker-cancel")
      .h(32)
      .px(14)
      .items_center()
      .rounded(8)
      .border_1()
      .border_color(t.input)
      .bg(t.raised)
      .text_color(t.foreground)
      .text_size(12.5)
      .font_medium()
      .cursor_pointer()
      .hover((s) => s.opacity(0.88))
      .on_click(() => closeOverlay(this.overlay))
      .child("Cancel");

    const save = button(t, "cockpit-picker-save", "Watch it", () => this.save(this.text))
      .h(32)
      .px(14)
      .rounded(8)
      .text_size(12.5)
      .font_medium();

    return body.child(
      h_flex()
        .pt(20)
        .gap(8)
        .justify_end()
        .child(cancel)
        .child(valid ? save : save.opacity(0.45)),
    );
  }
}
