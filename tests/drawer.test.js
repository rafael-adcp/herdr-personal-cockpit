// drawer.js: the floating "Needs you" drawer.
//
// It loads nothing. Every row on it was published by a panel that already
// fetched and already judged, so what is testable here is the drawing: when it
// shows at all, which side the peek strip goes on, what it does when something
// else is already using that edge, and that a row leads where it says.
//
// The round trip -- a panel loads, publishes, and the drawer draws what it
// published -- is at the bottom. That one is the whole design in a test: if it
// passes, the drawer cannot be telling you something no panel believes.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Drawer } from "../mods/personal-cockpit/screens/drawer.js";
import { List } from "../mods/personal-cockpit/screens/list.js";
import { shareKey } from "../mods/personal-cockpit/kit/urgent.js";
import { host, reset } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { gh } from "./support/gh.js";
import { callsOf, handlerOf, textOf } from "./support/element.js";
import { panelBlock, placedAt, prNode, rightColumn, rollup, checkRun, tree, urgentRow } from "./support/factories.js";

const view = {};

const drawer = () => new Drawer(view, cx());

const publish = (panel, rows) => host.shared.set(shareKey(panel), rows);

/** Every `id` the drawn tree asks for, in tree order: the root first, then its
 *  children depth-first. Index 1 is therefore the first thing inside the root,
 *  which is how "the strip comes first" is asserted without reaching into the
 *  element double. */
const ids = (el) => callsOf(el, "id").map(([id]) => id);

/** Nothing drawn at all: a zero-sized element, carrying no text. */
function assertDrawsNothing(el) {
  assert.deepEqual(callsOf(el, "size"), [[0]], "expected a zero-sized element");
  assert.deepEqual(textOf(el), []);
}

beforeEach(() => {
  reset();
  host.layout = tree({ sidebar: [panelBlock("pulls")] });
  // Hovered by default, because most of what is worth asserting is in the body
  // and the body is only drawn while the pointer is on it. The closed state has
  // its own tests below.
  host.placement = placedAt("right", { hovered: true });
  localStorage.clear();
});

// ---- when it shows at all -------------------------------------------------

test("no panel has published anything, so there is nothing on the edge", () => {
  assertDrawsNothing(drawer().render());
});

test("every panel published an empty list, and the edge still stays clean", () => {
  // The good case. A drawer you put things into has a reason to open while
  // empty; this one has none, so being up to date looks like nothing at all.
  for (const panel of ["pulls", "team", "issues", "routines"]) publish(panel, []);
  assertDrawsNothing(drawer().render());
});

test("one row is enough to bring it out", () => {
  publish("pulls", [urgentRow()]);
  const el = drawer().render();
  assert.ok(textOf(el).includes("Tidy the header"));
  assert.ok(textOf(el).includes("lint failing"));
});

test("junk in a shared key is ignored rather than drawn", () => {
  // Shared state is persisted, so a value written by an older copy of the mod
  // outlives it -- and `shared` hands back whatever is there.
  publish("pulls", "not a list");
  publish("team", { rows: [] });
  publish("issues", null);
  publish("routines", [urgentRow({ key: "routines:0-x", verb: "config", title: "routine 1", url: null })]);
  const el = drawer().render();
  assert.deepEqual(textOf(el).includes("routine 1"), true);
});

test("persisted Team rows alone never show the drawer and are not deleted", () => {
  const rows = [urgentRow({ key: "team:a#2", verb: "review", title: "theirs" })];
  publish("team", rows);
  const before = new Map(host.shared);
  for (const place of [null, placedAt("top"), placedAt("left"), placedAt("right", { hovered: true })]) {
    host.placement = place;
    assertDrawsNothing(drawer().render());
  }
  assert.deepEqual(host.shared, before, "Team's published state must stay intact");
});

test("Team refreshes do not change the drawer's count, visible rows or overflow", () => {
  publish("pulls", [urgentRow()]);
  const current = drawer();
  const before = textOf(current.render());
  publish("team", Array.from({ length: 12 }, (_v, i) => urgentRow({
    key: `team:a#${i}`, verb: "review", title: `team pr ${i}`, at: 1,
  })));
  assert.deepEqual(textOf(current.render()), before);
  assert.equal(current.rows().length, 1);
});

// ---- what it draws --------------------------------------------------------

test("it reads the included panels and leaves Team out of the rows and total", () => {
  publish("pulls", [urgentRow({ key: "pulls:a#1", title: "mine" })]);
  publish("team", [urgentRow({ key: "team:a#2", verb: "review", title: "theirs", reason: "robin" })]);
  publish("issues", [urgentRow({ key: "issues:3", verb: "decide", title: "a task", reason: "needs-decision" })]);
  publish("routines", [urgentRow({ key: "routines:0-x", verb: "config", title: "routine 1", reason: "no title", url: null })]);

  const text = textOf(drawer().render());
  for (const label of ["Fix", "Decide", "Configure"]) {
    assert.ok(text.includes(label), `no ${label} heading`);
  }
  for (const title of ["mine", "a task", "routine 1"]) {
    assert.ok(text.includes(title), `no ${title} row`);
  }
  // The total, next to the drawer's own title.
  assert.equal(text[0], "Needs you");
  assert.equal(text[1], "3");
  assert.equal(text.includes("theirs"), false);
  assert.equal(text.includes("Review"), false);

  host.placement = placedAt("right", { hovered: false });
  assert.deepEqual(textOf(drawer().render()), ["3"]);
});

test("the verbs are headed in urgent.js's order, whatever order the panels published in", () => {
  publish("routines", [urgentRow({ key: "routines:0-x", verb: "config", title: "c", url: null })]);
  publish("issues", [urgentRow({ key: "issues:3", verb: "decide", title: "d" })]);
  publish("pulls", [urgentRow({ key: "pulls:a#1", verb: "fix", title: "f" })]);

  const text = textOf(drawer().render());
  const order = ["Fix", "Decide", "Configure"].map((label) => text.indexOf(label));
  assert.deepEqual([...order].sort((a, b) => a - b), order, `headings came out as ${text.join(" ")}`);
});

test("past nine rows the rest are counted, not drawn", () => {
  // The drawer hangs over the work area: a list as tall as the window is in
  // the way rather than within reach.
  publish(
    "pulls",
    Array.from({ length: 13 }, (_v, i) => urgentRow({ key: `pulls:a#${i}`, title: `pr ${i}`, at: 1000 + i })),
  );
  const text = textOf(drawer().render());
  assert.ok(text.includes("+4 more"));
  // Dropped from the end, so the longest waits are the ones kept.
  assert.ok(text.includes("pr 0"));
  assert.equal(text.includes("pr 12"), false);
});

test("a row leads to its page, and one with no page is not pressable", () => {
  publish("pulls", [urgentRow({ at: 2 })]);
  publish("routines", [urgentRow({ key: "routines:0-x", verb: "config", title: "routine 1", url: null, at: 1 })]);

  const el = drawer().render();
  // One handler, not two: the url-less row wires no click at all, which is how
  // it avoids looking pressable.
  const clicks = callsOf(el, "on_click");
  assert.equal(clicks.length, 1);

  const context = cx();
  handlerOf(el, "on_click")({}, context);
  assert.deepEqual(context.opened, ["https://github.com/acme/app/pull/7"]);
});

// ---- closed, and open ----------------------------------------------------

test("closed, not one row is drawn", () => {
  // `peek` is not measured in exactly the pixels the strip is drawn at -- on a
  // 1280-wide window it left about 75 showing against a 44 px strip -- and what
  // came through the difference was the right-hand edge of the body: a column
  // of ages beside the count, with no rows to belong to.
  publish("pulls", [urgentRow()]);
  host.placement = placedAt("right", { hovered: false });

  const text = textOf(drawer().render());
  assert.equal(text.includes("Tidy the header"), false, "a row was drawn while closed");
  assert.equal(text.includes("Fix"), false, "a heading was drawn while closed");
  assert.equal(text.includes("Needs you"), false);
  // The count is the whole of what the peek is for.
  assert.deepEqual(text, ["1"]);
});

test("closed, the body's width is still held", () => {
  // So the block keeps the size Herdr slides out. Only its contents wait for
  // the pointer; an element that shrank to the strip would have nothing to
  // slide.
  publish("pulls", [urgentRow()]);
  host.placement = placedAt("right", { hovered: false });

  const widths = callsOf(drawer().render(), "w").map(([px]) => px);
  assert.ok(widths.includes(320), `expected the 320px body, got ${widths.join(", ")}`);
  assert.ok(widths.includes(44), `expected the 44px strip, got ${widths.join(", ")}`);
});

test("the pointer arriving is what fills it in", () => {
  publish("pulls", [urgentRow()]);
  host.placement = placedAt("right", { hovered: true });
  assert.ok(textOf(drawer().render()).includes("Tidy the header"));
});

// ---- the edge it hangs from ----------------------------------------------

test("on the right edge the body opens inward and the strip stays on the edge", () => {
  publish("pulls", [urgentRow()]);
  host.placement = placedAt("right", { hovered: true });
  assert.deepEqual(ids(drawer().render()).slice(0, 2), ["cockpit-urgent", "cockpit-urgent-body"]);
});

test("dragged to the left edge, the strip and the body swap", () => {
  // Herdr lets the drawer be dragged to either side and remembers it, so both
  // ways have to be drawn -- the peek is whichever side is against the edge.
  publish("pulls", [urgentRow()]);
  host.placement = placedAt("left", { hovered: true });
  assert.deepEqual(ids(drawer().render()).slice(0, 2), ["cockpit-urgent", "cockpit-urgent-peek"]);
});

test("on the top or bottom edge there is no strip, because there is no peek", () => {
  // `peek` is for the side edges only: on top or bottom Herdr shows the whole
  // block, so a strip would stand in front of nothing.
  publish("pulls", [urgentRow()]);
  for (const edge of ["top", "bottom"]) {
    host.placement = placedAt(edge);
    const drawn = ids(drawer().render());
    assert.equal(drawn[0], "cockpit-urgent-body", edge);
    assert.equal(drawn.includes("cockpit-urgent-peek"), false, edge);
  }
});

test("in an ordinary block it fills the block and draws no strip", () => {
  // A layout is free to put this screen in the tree instead of floating it.
  publish("pulls", [urgentRow()]);
  host.placement = null;
  const el = drawer().render();
  assert.equal(ids(el)[0], "cockpit-urgent-body");
  assert.equal(ids(el).includes("cockpit-urgent-peek"), false);
  assert.ok(callsOf(el, "size_full").length > 0, "an ordinary block should be filled");
});

// ---- what is behind it does not decide ------------------------------------

// There is one rule about when to draw: something is waiting, or it is not.
//
// An earlier version also stepped aside for a panel docked in the right column
// and for Herdr's files and changes panel. Docking three panels to the right
// made the drawer vanish for good, with nothing on screen to say why and
// nothing left to drag -- hiding removed the very affordance that would have
// moved it out of the way. These are that lesson, written down.

test("a panel docked in the right column does not hide it", () => {
  publish("pulls", [urgentRow()]);
  host.layout = tree({ sidebar: [], right: rightColumn([panelBlock("pulls")]) });
  assert.ok(textOf(drawer().render()).includes("Tidy the header"));
});

test("Herdr's own files and changes panel does not hide it either", () => {
  // The one most worth not hiding for: a diff is exactly when a review you
  // have been asked for is worth knowing about.
  publish("pulls", [urgentRow()]);
  host.layout = tree({ sidebar: [panelBlock("pulls")], right: { id: "panel", type: "column", children: [] } });
  assert.ok(textOf(drawer().render()).includes("Tidy the header"));
});

test("it draws with no layout at all", () => {
  // It stopped reading the tree when that rule went. Nothing about where the
  // drawer draws depends on what else is in the window any more.
  publish("pulls", [urgentRow()]);
  host.layout = null;
  assert.ok(textOf(drawer().render()).includes("Tidy the header"));
});

// ---- the round trip ------------------------------------------------------

test("a panel loads, publishes, and the drawer draws what it published", async () => {
  // The design, in one test. The drawer never calls `gh` and never judges a
  // pull request: it shows the panel's own answer, so the two cannot disagree.
  host.props = { kind: "pulls" };
  const failing = prNode({
    number: 42,
    title: "Teach the installer to copy a subfolder",
    url: "https://github.com/acme/app/pull/42",
    commits: rollup("FAILURE", [checkRun("lint", "FAILURE")]),
  });
  gh([["pullRequests", { data: { viewer: { login: "rafael", pullRequests: { totalCount: 1, nodes: [failing] } } } }]]);

  const context = cx({ spawn: "run" });
  new List(view, context);
  await context.settle();

  assert.deepEqual(host.shared.get(shareKey("pulls")), [
    {
      key: "pulls:acme/app#42",
      verb: "fix",
      title: "Teach the installer to copy a subfolder",
      reason: "lint failing",
      url: "https://github.com/acme/app/pull/42",
      at: Date.parse(failing.updatedAt),
    },
  ]);

  host.props = { kind: "urgent" };
  const text = textOf(drawer().render());
  assert.ok(text.includes("Teach the installer to copy a subfolder"));
  assert.ok(text.includes("lint failing"));
  assert.ok(text.includes("Fix"));
});
