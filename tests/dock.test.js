// dock.js: where a panel lives, and how it moves.
//
// None of these reaches into the module's privates. They pass a tree in and
// read an answer out, or they call the thing a button calls and read the
// message it sent to the app -- which is why the split that produced this file
// did not change one of them.
//
// The tree functions find things by what the nodes *hold* rather than by their
// names -- the column with the spaces list is the sidebar -- so the factory
// deliberately does not name them the way the old hardcoded version did.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  COLLAPSED, COLLAPSED_MAX, RAIL_MAX, RIGHT,
  find, parentOf, destinations, hostBlockFor, placeOf, narrowSidebar,
  minimise, moveTo,
} from "../mods/personal-cockpit/kit/dock.js";
import { host, reset } from "./support/host/herdr.js";
import { tree, panelBlock, rightColumn } from "./support/factories.js";

beforeEach(() => reset());

// ---- walking the tree -----------------------------------------------------

test("find reaches a node at any depth", () => {
  const t = tree({ sidebar: [panelBlock("pulls")] });
  assert.equal(find(t, "root"), t);
  assert.equal(find(t, "pulls").id, "pulls");
  assert.equal(find(t, "tabs").id, "tabs");
});

test("find answers null for what is not there, and for nothing at all", () => {
  assert.equal(find(tree(), "nope"), null);
  assert.equal(find(null, "pulls"), null);
  assert.equal(find(undefined, "pulls"), null);
});

test("parentOf answers the node holding it", () => {
  const t = tree({ sidebar: [panelBlock("pulls")] });
  assert.equal(parentOf(t, "pulls").id, "sidebar");
  assert.equal(parentOf(t, "sidebar").id, "root");
});

test("the root has no parent, and neither has a stranger", () => {
  const t = tree();
  assert.equal(parentOf(t, "root"), null);
  assert.equal(parentOf(t, "nope"), null);
  assert.equal(parentOf(null, "x"), null);
});

// ---- where a panel can live -----------------------------------------------

test("the sidebar is the column holding the spaces list, whatever it is called", () => {
  // The tasks panel's old version hardcoded "sidebar-lists" and broke when a
  // layout renamed it.
  const t = tree();
  assert.equal(destinations(t).sidebar.id, "sidebar");
});

test("the work area is the row holding the tab block", () => {
  assert.equal(destinations(tree()).work.id, "work");
});

test("the right column is found by the id the panels agree on", () => {
  const t = tree({ right: rightColumn() });
  assert.equal(destinations(t).right.id, RIGHT);
  assert.equal(destinations(tree()).right, null);
});

test("a layout shaped differently answers null, and the move button hides", () => {
  const stranger = { id: "root", type: "row", children: [{ id: "a", type: "block" }] };
  const where = destinations(stranger);
  assert.equal(where.sidebar, null);
  assert.equal(where.work, null);
  assert.equal(where.right, null);
});

// ---- which block is this copy ---------------------------------------------

test("two blocks running one mod are told apart by props.kind", () => {
  const t = tree({ sidebar: [panelBlock("pulls"), panelBlock("issues")] });
  assert.equal(hostBlockFor(t, "pulls").id, "pulls");
  assert.equal(hostBlockFor(t, "issues").id, "issues");
});

test("an explicit node wins over the kind", () => {
  // For a layout that would rather say it outright.
  const t = tree({ sidebar: [panelBlock("pulls", { id: "my-own-id" })] });
  assert.equal(hostBlockFor(t, "pulls", "my-own-id").id, "my-own-id");
});

test("no block for this kind is null, not a guess", () => {
  assert.equal(hostBlockFor(tree(), "routines"), null);
  assert.equal(hostBlockFor(tree({ sidebar: [panelBlock("pulls")] }), "team"), null);
  assert.equal(hostBlockFor(tree(), "pulls", "missing-id"), null);
});

// ---- which column it sits in now ------------------------------------------

test("a panel in the sidebar says sidebar", () => {
  const t = tree({ sidebar: [panelBlock("pulls")] });
  assert.equal(placeOf(t, find(t, "pulls")), "sidebar");
});

test("a panel in the right column says right", () => {
  const t = tree({ right: rightColumn([panelBlock("pulls")]) });
  assert.equal(placeOf(t, find(t, "pulls")), "right");
});

test("a panel somewhere else can still move, as long as both ends exist", () => {
  const t = tree();
  find(t, "work").children.push(panelBlock("pulls"));
  assert.equal(placeOf(t, find(t, "pulls")), "elsewhere");
});

test("a pane or an overlay has no column, so there is nothing to move", () => {
  const t = tree({ sidebar: [panelBlock("pulls")] });
  assert.equal(placeOf(t, null), null);
  assert.equal(placeOf(t, { id: "not-in-the-tree" }), null);
});

test("elsewhere needs somewhere to go: no sidebar means no move", () => {
  const orphan = {
    id: "root",
    type: "row",
    children: [{ id: "work", type: "row", children: [{ id: "tabs", content: { tab: true } }, panelBlock("pulls")] }],
  };
  assert.equal(placeOf(orphan, find(orphan, "pulls")), null);
});

// ---- the rail -------------------------------------------------------------

test("the sidebar's rail goes by its width, not a flag", () => {
  // Dragging its edge narrow means the same thing as pressing the button.
  host.layout = tree({ sidebarPx: RAIL_MAX - 1 });
  assert.equal(narrowSidebar(), true);
  host.layout = tree({ sidebarPx: RAIL_MAX });
  assert.equal(narrowSidebar(), false);
  host.layout = tree({ sidebarPx: 400 });
  assert.equal(narrowSidebar(), false);
});

test("a sidebar with no pinned width is not narrow", () => {
  host.layout = tree();
  assert.equal(narrowSidebar(), false);
});

// ---- minimise -------------------------------------------------------------

const KEY = "cockpit.pulls.height";

test("minimising resizes to the header bar and remembers the height", () => {
  minimise({ id: "pulls", size: { px: 300 } }, false, KEY);
  assert.deepEqual(host.run, [{ name: "layout.resize", props: { id: "pulls", px: COLLAPSED } }]);
  assert.equal(host.shared.get(KEY), 300);
});

test("reopening gives back the height it was dragged to", () => {
  host.shared.set(KEY, 300);
  minimise({ id: "pulls", size: { px: COLLAPSED } }, true, KEY);
  assert.deepEqual(host.run, [{ name: "layout.resize", props: { id: "pulls", px: 300 } }]);
});

test("a panel never dragged reopens as the flexible share it started as", () => {
  minimise({ id: "pulls", size: { px: COLLAPSED } }, true, KEY);
  assert.deepEqual(host.run, [{ name: "layout.resize", props: { id: "pulls", weight: 1 } }]);
});

test("a remembered height that is itself collapsed is not given back", () => {
  // Otherwise reopening would reopen to nothing, and the panel would look stuck.
  host.shared.set(KEY, COLLAPSED_MAX);
  minimise({ id: "pulls" }, true, KEY);
  assert.deepEqual(host.run, [{ name: "layout.resize", props: { id: "pulls", weight: 1 } }]);
});

test("a collapsed height is not remembered as the open one", () => {
  minimise({ id: "pulls", size: { px: COLLAPSED_MAX } }, false, KEY);
  assert.equal(host.shared.has(KEY), false);
  assert.deepEqual(host.run, [{ name: "layout.resize", props: { id: "pulls", px: COLLAPSED } }]);
});

test("a panel with a flexible height minimises without remembering one", () => {
  minimise({ id: "pulls", size: { weight: 1 } }, false, KEY);
  assert.equal(host.shared.has(KEY), false);
  assert.deepEqual(host.run, [{ name: "layout.resize", props: { id: "pulls", px: COLLAPSED } }]);
});

test("a minimised panel is shorter than the threshold that counts as minimised", () => {
  // Dragging to a sliver has to mean the same thing as pressing the button.
  assert.ok(COLLAPSED < COLLAPSED_MAX);
});

// ---- moving between columns -----------------------------------------------

/** The layout the app was handed, or null if it was never asked to set one. */
const handed = () => host.run.find((call) => call.name === "layout.set")?.props?.layout ?? null;

test("moving right creates the column the first time", () => {
  host.layout = tree({ sidebar: [panelBlock("pulls")] });
  moveTo({ id: "pulls" }, "right");

  const next = handed();
  assert.ok(next, "the app was never handed a layout");
  const column = find(next, RIGHT);
  assert.ok(column, "no right column was made");
  assert.deepEqual(column.children.map((c) => c.id), ["pulls"]);
  assert.equal(find(next, "sidebar").children.some((c) => c.id === "pulls"), false);
});

test("moving right puts the column in the work area, beside the tabs", () => {
  host.layout = tree({ sidebar: [panelBlock("pulls")] });
  moveTo({ id: "pulls" }, "right");
  assert.ok(find(handed(), "work").children.some((c) => c.id === RIGHT));
});

test("moving back to the sidebar leaves the column in place but hidden", () => {
  // An empty column hides rather than goes, so it keeps its dragged width and
  // the next panel to move lands in the same place.
  host.layout = tree({ right: rightColumn([panelBlock("pulls")]) });
  moveTo({ id: "pulls" }, "sidebar");

  const next = handed();
  assert.deepEqual(find(next, "sidebar").children.map((c) => c.id), ["spaces", "pulls"]);
  const column = find(next, RIGHT);
  assert.equal(column.children.length, 0);
  assert.equal(column.hidden, true);
  assert.deepEqual(column.size, { px: 380 });
});

test("a column that still holds something stays shown", () => {
  host.layout = tree({ right: rightColumn([panelBlock("pulls"), panelBlock("team")]) });
  moveTo({ id: "pulls" }, "sidebar");
  assert.equal(find(handed(), RIGHT).hidden, false);
});

test("a moved panel arrives as a flexible block, never hidden or pinned shut", () => {
  // Arriving hidden or collapsed would read as "it vanished".
  host.layout = tree({ sidebar: [panelBlock("pulls", { size: { px: 500 }, max: 600, hidden: true })] });
  moveTo({ id: "pulls" }, "right");

  const moved = find(handed(), "pulls");
  assert.deepEqual(moved.size, { weight: 1 });
  assert.equal(moved.min, COLLAPSED);
  assert.equal("max" in moved, false);
  assert.equal("hidden" in moved, false);
});

test("the layout the app is handed is a copy, not the one it gave out", () => {
  // Herdr's own tree must not be mutated in place.
  const original = tree({ sidebar: [panelBlock("pulls")] });
  host.layout = original;
  moveTo({ id: "pulls" }, "right");
  assert.ok(find(original, "sidebar").children.some((c) => c.id === "pulls"), "the live tree was edited");
  assert.equal(find(original, RIGHT), null);
});

test("with nowhere to move, nothing is sent", () => {
  // Herdr refuses structural edits to its own layouts, which is why the button
  // hides when there is nowhere to go.
  host.layout = { id: "root", type: "row", children: [panelBlock("pulls")] };
  moveTo({ id: "pulls" }, "right");
  assert.deepEqual(host.run, []);
});

test("a block that is not in the tree moves nothing", () => {
  host.layout = tree({ sidebar: [panelBlock("pulls")] });
  moveTo({ id: "not-there" }, "right");
  assert.deepEqual(host.run, []);
});

// ---- it draws nothing -----------------------------------------------------

test("dock.js sends commands and never an element", () => {
  // The split's whole claim. `minimise` and `moveTo` return nothing; what they
  // do is visible only in the messages above.
  host.layout = tree({ sidebar: [panelBlock("pulls")] });
  assert.equal(minimise({ id: "pulls", size: { px: 300 } }, false, KEY), undefined);
  assert.equal(moveTo({ id: "pulls" }, "right"), undefined);
});
