// "Needs you": selected panels' urgent rows, on the window's edge.
//
// The four panels live in the sidebar and divide its height between them, so
// anything new there is taken from the other three -- and all four leave the
// screen together the moment the sidebar is folded or a terminal is maximised.
// A floating block is the one surface that costs the panels nothing and
// survives them going away: Herdr hangs it off an edge, leaves `peek` pixels
// showing, slides it out under the pointer, and remembers where it was dragged.
// All of that is the app's; what is here is only which rows and when to show.
//
// It shows no information the panels do not. What it adds is the one thing none
// of them can: each panel can say "3 need you" about its own list, but only
// something looking across panels can say which to deal with first. urgent.js
// holds that order.
//
// Nothing is loaded here. The panels publish what they already judged (see
// urgent.js), so this screen cannot disagree with them, cannot cost a `gh`
// call, and cannot go stale on its own clock.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { placement, shared, theme } from "herdr";
import { agoShort } from "../kit/github.js";
import { CELL, badge, row, sectionHead } from "../kit/kit.js";
import { SOURCES } from "./list.js";
import { groups, merge, shareKey } from "../kit/urgent.js";

export const ICON = "mods/personal-cockpit/icons/urgent.svg";

// What the layout leaves showing. `peek` in layouts/cockpit.json is the same
// number by hand: the strip has to be exactly it, or the count sits half off
// the screen.
const EDGE = 44;
const WIDTH = 320;

// Rows before "+N more". The drawer hangs over the work area, and a list as
// tall as the window is in the way rather than within reach. The rows it drops
// are the shortest waits, since merge() put the longest first.
const SHOWN = 9;

// There is one rule about when to draw, and it is the whole of it: something is
// waiting, or it is not.
//
// An earlier version also stepped aside for a panel docked in `right-lists` and
// for Herdr's files and changes panel, on the grounds that a drawer over a
// panel is worse than no drawer. It is not. Hiding takes away the one thing
// that would let somebody move it out of the way -- the strip they would drag
// -- and it takes it away silently, so what they see is the drawer being
// broken. Dock three panels to the right and it vanished for good.
//
// Overlapping is the lesser harm, and it is the one with a way out: the strip
// is 44 px on an edge, and dragging it to the other one takes a second and is
// remembered.

export class Drawer {
  constructor(view, cx) {
    this.view = view;
    // Nothing to keep: every render reads the panels' published rows. The
    // handle is only so that a `pane.go` onto this block has somewhere to land.
    this.handle = cx.focus_handle();
  }

  /** Included panels' published rows as one ordered list. Team stays in its
   *  own panel, not this drawer or its count. Filter before reading shared
   *  state so persisted Team rows are excluded even before its next poll. */
  rows() {
    return merge(
      Object.values(SOURCES)
        .filter((source) => source.panel !== "team")
        .map((source) => {
          const saved = shared(shareKey(source.panel));
          return Array.isArray(saved) ? saved : [];
        }),
    );
  }

  /** The peek: the one number that would make somebody open it. Deliberately
   *  the same icon-over-badge the panels' own rail draws, at the same 15px --
   *  a folded panel and this are the same promise, so they look alike. */
  strip(t, total) {
    return v_flex()
      .id("cockpit-urgent-peek")
      .w(EDGE)
      .flex_none()
      .pt(12)
      .gap(5)
      .items_center()
      .child(svg(ICON).size(15).flex_none().text_color(t.blocked))
      .child(badge(t, total).px(4));
  }

  /** One row, drawn by the same `row` the four panels draw: a dot, the title,
   *  the age, and the reason on the second line where a panel puts its
   *  signals. The reason is the panel's own first pressing fact, so a row here
   *  and the same row in its panel never say different things. */
  line(t, r) {
    return row(t, {
      id: `urgent-${r.key}`,
      glyph: div().w(CELL).flex_none().text_center().text_color(t.blocked).child("●"),
      title: r.title,
      age: agoShort(r.at),
      tooltip: [r.title, r.reason, r.url ?? "nothing to open: fix it where it is configured"].join("\n"),
      // The drawer is wider than the rail threshold, so the second line is
      // always drawn -- which is the only reason the reason is worth carrying.
      wide: true,
      onClick: r.url ? (_e, cx) => cx.open_url(r.url) : null,
      second: [div().flex_none().text_color(t.dim).child(r.reason)],
    });
  }

  body(t, rows) {
    const shown = rows.slice(0, SHOWN);
    const hidden = rows.length - shown.length;

    // Collected and handed over in one `children`, the way list.js builds its
    // body. `child` in a loop works too -- picker.js does it, so the builder
    // mutates rather than returning a copy -- but a list of children reads as
    // the list it is, and the groups below are built the same way.
    const body = [
      // The same sizes and colours as a panel header's left half, so the drawer
      // reads as one of them rather than as something else.
      h_flex()
        .px(16)
        .pt(12)
        .pb(2)
        .gap(6)
        .items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.dim).child("Needs you"))
        .child(badge(t, rows.length)),
    ];

    for (const group of groups(shown)) {
      body.push(sectionHead(t, group.label, group.rows.length));
      body.push(v_flex().px(6).gap(1).children(group.rows.map((r) => this.line(t, r))));
    }

    // Plain text, not a control: there is nowhere for it to lead that is not
    // the panel the row came from, and those are a key away.
    if (hidden > 0) {
      body.push(div().px(16).pt(6).text_size(10).text_color(t.dim).child(`+${hidden} more`));
    }

    return v_flex()
      .id("cockpit-urgent-body")
      .w(WIDTH)
      .flex_none()
      .pb(8)
      // Drawn rather than left to the app: a floating block sits over whatever
      // is behind it, and over a terminal these rows would be unreadable.
      .bg(t.chrome)
      .border(1)
      .border_color(t.border)
      .rounded(8)
      .text_size(13)
      .track_focus(this.handle)
      .children(body);
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const place = placement();

    // Nothing waiting, nothing drawn -- not even the strip. A drawer you put
    // things into has a reason to open while empty; this one has none, so the
    // edge stays clean and the reward for being up to date is seeing nothing.
    // The cost is that it cannot be found when there is nothing in it, which is
    // what RECIPE.md's "Watch out" is for.
    if (!rows.length) return div().size(0);

    // Not floating: a layout put this screen in an ordinary block, where there
    // is no edge to hang from and a peek strip would lead nowhere.
    if (!place) return this.body(t, rows).size_full();
    // On the top or bottom edge Herdr shows the whole block -- `peek` is for
    // the sides only -- so there is nothing for a strip to stand in front of.
    if (!place.vertical) return this.body(t, rows);

    // Closed, the rows are not drawn at all.
    //
    // `peek` is not measured in exactly the pixels the strip is drawn at: on a
    // 1280-wide window it left about 75 showing against a 44 px strip, and what
    // filled the difference was the right-hand edge of the body -- a lone
    // column of ages leaking out beside the count. Drawing nothing there means
    // whatever extra shows is blank.
    //
    // The width is still held, so the block keeps the size Herdr slides out;
    // only its contents wait for the pointer. `hovered` is what that pointer is
    // reported as, and a peek drawer being open is what it means.
    const body = place.hovered ? this.body(t, rows) : div().w(WIDTH).flex_none();

    // The peek is whichever side is against the edge: the strip goes there and
    // the body opens inward. Both ways are drawn because both can happen --
    // Herdr lets the drawer be dragged to either side and remembers it.
    const strip = this.strip(t, rows.length);
    return place.edge === "left"
      ? h_flex().id("cockpit-urgent").items_start().child(strip).child(body)
      : h_flex().id("cockpit-urgent").items_start().child(body).child(strip);
  }
}
