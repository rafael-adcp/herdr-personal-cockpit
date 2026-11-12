// kit.js: the chrome a panel draws.
//
// These assert that each piece builds, not what it looks like. What a row looks
// like is the app's business and changes when the design does; that building
// one does not throw is what `herdr-app check` can only answer for the single
// panel it renders, and never with a row in it.
//
// The decisions are tested elsewhere, which is the shape of the split:
// dock.test.js for which column a panel is in, checks.test.js for what a
// rollup state means.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WIDE, CELL,
  action, badge, button, spinner, rail, header, sectionHead, cell, checkGlyph, row, shell,
} from "../mods/personal-cockpit/kit/kit.js";
import { RAIL_MAX } from "../mods/personal-cockpit/kit/dock.js";
import { theme } from "./support/host/herdr.js";
import { handlerOf, countOf } from "./support/element.js";

const t = theme();

/** The `cx` a click handler gets. All it is ever asked to do is stop a press. */
const press = () => ({ stopped: 0, stop_propagation() { this.stopped++; } });

// ---- the pieces -----------------------------------------------------------

test("the accent pill builds, with and without a colour of its own", () => {
  assert.doesNotThrow(() => badge(t, "3"));
  assert.doesNotThrow(() => badge(t, 3));
  assert.doesNotThrow(() => badge(t, "3", "ansi1"));
});

test("a primary button builds", () => {
  assert.doesNotThrow(() => button(t, "id", "Choose repository", () => {}));
});

test("the spinner builds at any size", () => {
  assert.doesNotThrow(() => spinner(t));
  assert.doesNotThrow(() => spinner(t, 11));
  assert.doesNotThrow(() => spinner(t, 20));
});

test("the glyph cell is a fixed width, so second lines line up", () => {
  assert.equal(typeof CELL, "number");
  assert.ok(CELL > 0);
  assert.doesNotThrow(() => cell());
});

test("a group title builds, with a count of none as readily as of many", () => {
  assert.doesNotThrow(() => sectionHead(t, "Needs you", 2));
  assert.doesNotThrow(() => sectionHead(t, "Queue", 0));
});

test("the check glyph builds for every state, including the absences", () => {
  for (const state of ["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED", "NONE", null, undefined, "QUEUED"]) {
    assert.doesNotThrow(() => checkGlyph(t, state), String(state));
  }
});

test("the rail builds, with and without a count", () => {
  assert.doesNotThrow(() => rail(t, "mods/personal-cockpit/icons/pulls.svg", 0));
  assert.doesNotThrow(() => rail(t, "mods/personal-cockpit/icons/pulls.svg", 7));
});

// ---- the row --------------------------------------------------------------

test("a row builds with and without each optional part", () => {
  const base = { id: "r", title: "A title", age: "3d", selected: false, wide: true, onClick: () => {} };
  assert.doesNotThrow(() => row(t, base));
  assert.doesNotThrow(() => row(t, { ...base, glyph: checkGlyph(t, "SUCCESS") }));
  assert.doesNotThrow(() => row(t, { ...base, tag: "draft" }));
  assert.doesNotThrow(() => row(t, { ...base, tooltip: "more\nlines" }));
  assert.doesNotThrow(() => row(t, { ...base, second: [badge(t, "x")] }));
  assert.doesNotThrow(() => row(t, { ...base, wide: false, selected: true }));
  assert.doesNotThrow(() => row(t, { ...base, wide: false, second: [badge(t, "x")] }));
  assert.doesNotThrow(() => row(t, { ...base, second: [] }));
  assert.doesNotThrow(() => row(t, { ...base, action: badge(t, "x") }));
  assert.doesNotThrow(() => row(t, { ...base, wide: false, action: badge(t, "x") }));
});

test("a row's own button is a press on it and not on the row", () => {
  // The drawer's snooze sits on a row that opens something. Without this,
  // putting a row off would also open the page it is about.
  let pressed = 0;
  const opened = () => assert.fail("the row was opened by a press on its button");
  const el = row(t, {
    id: "r",
    title: "A title",
    age: "3d",
    wide: true,
    onClick: opened,
    action: action(t, "r-snooze", "Not today", "mods/personal-cockpit/icons/snooze.svg", () => pressed++),
  });

  // The row's own handler is wired first, so the button's is the second.
  const context = press();
  handlerOf(el, "on_click", 1)({}, context);
  assert.equal(pressed, 1);
  assert.equal(context.stopped, 1);
});

// ---- the header bar -------------------------------------------------------

test("the header builds with each of the three things it can say", () => {
  const base = { id: "pulls", title: "My pull requests", onRefresh: () => {} };
  assert.doesNotThrow(() => header(t, { ...base, trouble: "No gh", troubleTip: "Install it" }));
  assert.doesNotThrow(() => header(t, { ...base, attention: 2 }));
  assert.doesNotThrow(() => header(t, { ...base, count: 7 }));
  assert.doesNotThrow(() => header(t, { ...base, note: "acme/tasks", noteTip: "Watching acme/tasks" }));
  assert.doesNotThrow(() => header(t, base), "with nothing but a title");
});

test("the header builds with each button, and with none of them", () => {
  const base = { id: "pulls", title: "My pull requests", onRefresh: () => {} };
  assert.doesNotThrow(() => header(t, { ...base, onNew: () => {}, newTip: "New task" }));
  assert.doesNotThrow(() => header(t, { ...base, onConfigure: () => {}, configureTip: "Open team.yml" }));
  assert.doesNotThrow(() => header(t, { ...base, onConfigure: () => {} }), "configure with no tip of its own");
  assert.doesNotThrow(() => header(t, { ...base, place: "sidebar", onMove: () => {} }));
  assert.doesNotThrow(() => header(t, { ...base, place: "right", onMove: () => {} }));
  assert.doesNotThrow(() => header(t, { ...base, host: { id: "pulls" }, onMinimise: () => {} }));
  assert.doesNotThrow(() => header(t, { ...base, host: { id: "pulls" }, collapsed: true, onMinimise: () => {} }));
  assert.doesNotThrow(() => header(t, { ...base, busy: true }), "the refresh glyph becomes a spinner");
});

test("the header builds with everything at once", () => {
  assert.doesNotThrow(() =>
    header(t, {
      id: "issues",
      title: "Kraken Tasks",
      attention: 3,
      place: "sidebar",
      host: { id: "issues" },
      collapsed: false,
      busy: false,
      stamp: "updated 2m ago",
      newTip: "New task in acme/tasks",
      configureTip: "Choose a repository",
      onRefresh: () => {},
      onNew: () => {},
      onConfigure: () => {},
      onMove: () => {},
      onMinimise: () => {},
    }),
  );
});

// ---- the shell ------------------------------------------------------------

test("the shell builds around a panel", () => {
  assert.doesNotThrow(() =>
    shell(t, {
      id: "pulls",
      handle: { focus: () => {} },
      body: [],
      onSize: () => {},
      onKey: () => {},
    }),
  );
});

test("the shell builds around a body of pieces", () => {
  assert.doesNotThrow(() =>
    shell(t, {
      id: "pulls",
      handle: { focus: () => {} },
      body: [
        header(t, { id: "pulls", title: "My pull requests", onRefresh: () => {} }),
        sectionHead(t, "Needs you", 1),
        row(t, { id: "r", title: "A change", age: "3d", wide: true, onClick: () => {} }),
      ],
      onSize: () => {},
      onKey: () => {},
    }),
  );
});

// ---- the one measurement that spans both files ---------------------------

test("a panel drops to the rail before it drops to one line", () => {
  // WIDE is kit's -- it is about the row -- and RAIL_MAX is dock's, because it
  // is about the sidebar's width. The order between them still has to hold, so
  // this is the one test that reads from both.
  assert.ok(RAIL_MAX < WIDE);
});

// ---- the header bar is itself the button --------------------------------

test("the whole header bar folds the panel, not only the glyph", () => {
  // A stack of panels is something you open and shut all day, and a 41px strip
  // the width of the sidebar is a target you don't have to aim at.
  let folded = 0;
  const bar = header(t, {
    id: "pulls",
    title: "My pull requests",
    host: { id: "pulls" },
    onRefresh: () => {},
    onMinimise: () => void folded++,
  });

  handlerOf(bar, "on_click")(null, press());
  assert.equal(folded, 1);
});

test("a bar with no block to resize is not pressable", () => {
  // A pane or an overlay has no height of its own to give back, and a bar that
  // looks pressable and isn't is worse than a plain one.
  const noHost = header(t, { id: "pulls", title: "t", onRefresh: () => {}, onMinimise: () => {} });
  assert.equal(countOf(noHost, "cursor_pointer"), 0);

  const noHandler = header(t, { id: "pulls", title: "t", host: { id: "pulls" }, onRefresh: () => {} });
  assert.equal(countOf(noHandler, "cursor_pointer"), 0);
});

test("an icon on the bar stops the press, so refresh does not also fold", () => {
  // GPUI hands a click to every handler on its path. Without this, pressing
  // refresh would fold the panel it had just refreshed.
  let refreshed = 0;
  let folded = 0;
  const bar = header(t, {
    id: "pulls",
    title: "My pull requests",
    host: { id: "pulls" },
    onRefresh: () => void refreshed++,
    onMinimise: () => void folded++,
  });

  // The bar's own handler is the first; the icons' are below it.
  const icon = handlerOf(bar, "on_click", 1);
  const cx = press();
  icon(null, cx);

  assert.equal(cx.stopped, 1, "the icon let the press reach the bar");
  assert.equal(refreshed, 1);
  assert.equal(folded, 0, "refreshing folded the panel");
});
