// The panel chrome every list in this mod shares: the header bar, the narrow
// rail, the row, and the pieces those are built from.
//
// This file is the whole point of the mod being one folder. Both panels drew
// their own copy of all of it, word for word, down to the comments -- and then
// drifted: two `ago()` with different output, two ways to dock, a timestamp
// that was relative on one side and a wall clock on the other.
//
// Nothing here talks to Herdr. Every one of these takes a theme and some data
// and returns an element, so each decision behind them -- which column a panel
// is in, whether a build is red -- is already made by the time it arrives:
// dock.js decides the first, checks.js the second.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { RED, RUNNING } from "./checks.js";

// Below this the row drops to one line: there is no room for a second.
export const WIDE = 220;

// ---- pieces ---------------------------------------------------------------

/** The accent pill both panels use for a count that wants attention. */
export const badge = (t, text, color = t.blocked) =>
  div()
    .flex_none()
    .px(5)
    .rounded(4)
    .bg(color + "26")
    .text_size(10)
    .font_semibold()
    .text_color(color)
    .child(String(text));

/** A primary button for the setup and empty states. */
export const button = (t, id, label, onClick) =>
  div()
    .id(id)
    .flex_none()
    .h(26)
    .px(10)
    .flex()
    .items_center()
    .rounded(6)
    .bg(t.solid)
    .text_color(t.solid_foreground)
    .text_size(11.5)
    .cursor_pointer()
    .hover((s) => s.bg(t.accent))
    .on_click(onClick)
    .child(label);

/** A header-bar icon button. */
const action = (t, id, tip, icon, onClick) =>
  div()
    .id(id)
    .flex_none()
    .text_color(t.dim)
    .hover((s) => s.text_color(t.foreground))
    .tooltip(tip)
    .on_click((e, cx) => {
      // The bar these sit on is itself the minimise button, so without this a
      // press on refresh would also fold the panel it just refreshed.
      cx.stop_propagation();
      onClick(e, cx);
    })
    .child(svg(icon).size(13));

export const spinner = (t, size = 13) =>
  svg("mods/workspace-chrome/spinner.svg").size(size).flex_none().text_color(t.working).spin(900);

/** The rail: no room for rows, so carry only the one number that would make
 *  someone widen the sidebar again. */
export function rail(t, icon, attention) {
  const children = [svg(icon).size(15).flex_none().text_color(attention ? t.blocked : t.dim)];
  if (attention > 0) children.push(badge(t, attention).px(4));
  return v_flex().pt(14).gap(5).flex_none().items_center().children(children);
}

/** The header bar: title, then one of trouble / attention / a plain count, then
 *  refresh, dock and minimise. The bar itself minimises too -- see below. */
export function header(t, o) {
  // The title shrinks and truncates rather than holding its width: "Team's
  // pull requests" beside a `2 needs you` pill is wider than a 268px sidebar,
  // and the pill is the half of that worth keeping.
  const left = [
    div().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.dim).tooltip(o.title).child(o.title),
  ];
  if (o.trouble) {
    left.push(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.blocked).tooltip(o.troubleTip ?? o.trouble).child(o.trouble));
  } else if (o.attention > 0) {
    left.push(badge(t, `${o.attention} needs you`));
  } else if (o.count) {
    left.push(div().flex_none().text_size(10).text_color(t.muted).child(String(o.count)));
  }
  // Nothing else goes on this line. What a panel is watching -- the login, the
  // query, the repo -- rides in the refresh icon's tooltip, which list.js
  // builds as `stamp`: the title is already giving way to the number beside it,
  // and a third thing would be giving way to both.

  const actions = [];
  // First, because it is the one thing here that makes something rather than
  // looks at something. Its own glyph, not the bare plus the expand button
  // uses: a collapsed panel shows both at once.
  if (o.onNew) {
    actions.push(action(t, `${o.id}-new`, o.newTip, "mods/personal-cockpit/icons/new-task.svg", (_e, cx) => o.onNew(cx)));
  }
  actions.push(
    o.busy ? spinner(t) : action(t, `${o.id}-refresh`, o.stamp, "mods/personal-cockpit/icons/refresh.svg", (_e, cx) => o.onRefresh(cx)),
  );
  if (o.onConfigure) {
    actions.push(action(t, `${o.id}-configure`, o.configureTip ?? "Settings", "mods/personal-cockpit/icons/settings.svg", (_e, cx) => o.onConfigure(cx)));
  }
  if (o.onBrowse) {
    actions.push(action(t, `${o.id}-browser`, o.browseTip, "mods/personal-cockpit/icons/browse.svg", (_e, cx) => o.onBrowse(cx)));
  }
  if (o.place) {
    const here = o.place === "right";
    actions.push(
      action(
        t,
        `${o.id}-move`,
        here ? "Move to the left sidebar" : "Move to the right column",
        `mods/personal-cockpit/icons/dock-${here ? "left" : "right"}.svg`,
        () => o.onMove(here ? "sidebar" : "right"),
      ),
    );
  }
  if (o.host) {
    actions.push(
      action(
        t,
        `${o.id}-minimise`,
        o.collapsed ? "Expand" : "Minimise",
        `mods/personal-cockpit/icons/${o.collapsed ? "plus" : "minus"}.svg`,
        () => o.onMinimise(),
      ),
    );
  }

  // The whole bar folds the panel, not only the 13px glyph at the end of it:
  // the title, the count and the empty space between them are all the same
  // press. A stack of panels is something you open and shut all day, and a
  // strip this wide is a target you don't have to aim at. The glyph stays --
  // it is the part that says which way the next press goes.
  //
  // Only when there is a block to resize. A pane or an overlay has no height
  // of its own to give back, and a bar that looks pressable and isn't is worse
  // than a plain one.
  const foldable = Boolean(o.host && o.onMinimise);

  return h_flex()
    .id(`${o.id}-header`)
    .px(16)
    .h(41)
    .pt(14)
    .pb(5)
    .flex_none()
    .gap(6)
    .items_center()
    .justify_between()
    .when(foldable, (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click(() => o.onMinimise()),
    )
    .child(h_flex().flex_1().min_w(0).gap(6).items_center().children(left))
    .child(h_flex().flex_none().gap(8).items_center().children(actions));
}

/** A group title with its count. */
export function sectionHead(t, label, count) {
  return h_flex()
    .px(10)
    .pt(8)
    .pb(2)
    .gap(5)
    .items_center()
    .text_size(10)
    .font_semibold()
    .text_color(t.dim)
    .child(label)
    .child(div().text_color(t.muted).child(String(count)));
}

/** The glyph cell every row's first line starts with. Fixed at 11px so the
 *  second line's text lands under the title however the glyph is drawn. */
export const CELL = 11;
export const cell = () => div().w(CELL).flex_none();

/** The first cell of a pull request's row: a tick when the checks passed, a
 *  cross when they failed, the header's own spinner while they run, and a dot
 *  for a head commit with no checks at all -- which is not a failure. */
export function checkGlyph(t, state) {
  if (RUNNING(state)) return spinner(t, CELL);
  const red = RED(state);
  return cell()
    .text_center()
    .text_color(red ? t.ansi1 : state === "SUCCESS" ? t.ansi2 : t.dim)
    .child(red ? "✕" : state === "SUCCESS" ? "✓" : "·");
}

/** A two-line row: a glyph, a truncating title and an age; then, when there is
 *  room, a second line of whatever the panel wants to put there. */
export function row(t, o) {
  const line1 = h_flex()
    .gap(6)
    .items_center()
    .child(o.glyph)
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(o.title))
    .when(Boolean(o.tag), (el) => el.child(div().flex_none().text_size(9.5).text_color(t.dim).child(o.tag)))
    .child(div().flex_none().text_size(10).text_color(t.dim).child(o.age));

  const el = v_flex()
    .id(o.id)
    .px(10)
    .py(5)
    .gap(2)
    .rounded(6)
    .tooltip(o.tooltip)
    .when(Boolean(o.selected), (e) => e.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    // A row with nowhere to go says so by not looking pressable. Every panel
    // row has a URL, but the drawer draws a broken routine, which has no task
    // and so no page -- and a pointer that changes over something that does
    // nothing is the row promising something it cannot do.
    .when(Boolean(o.onClick), (e) => e.cursor_pointer().on_click(o.onClick))
    .child(line1);

  if (!o.wide || !o.second?.length) return el;
  return el.child(
    h_flex()
      .gap(6)
      .items_center()
      .text_size(10.5)
      .child(cell())
      .child(h_flex().flex_1().min_w(0).gap(5).items_center().truncate().children(o.second)),
  );
}

/** The panel shell: the root element, focus, size reporting and the keys both
 *  lists answer. The caller passes the body it wants inside. */
export function shell(t, o) {
  return v_flex()
    .id(o.id)
    .size_full()
    .min_h(0)
    .bg(t.chrome)
    .border_t(1)
    .border_color(t.border)
    .text_size(13)
    .track_focus(o.handle)
    .on_size_change((size, cx) => o.onSize(size, cx))
    .on_key_down((e, cx) => o.onKey(e, cx))
    .children(o.body);
}
