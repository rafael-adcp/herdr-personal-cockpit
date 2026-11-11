// Where a panel lives, and how it moves.
//
// The layout tree, the places a panel can sit in, and the two things that
// change where it is: `minimise`, which resizes the block the panel is in, and
// `moveTo`, which lifts that block out of one column and into the other.
//
// Nothing here draws. It reads the tree Herdr hands out, decides, and sends a
// command back -- which is why this file imports from `herdr` and nothing from
// the toolkit, and kit.js is exactly the other way round.

import { layout, run, shared, setShared } from "herdr";

// Minimised: the header bar and nothing else (1px top border + a 41px header).
export const COLLAPSED = 42;
// Anything this short counts as minimised, however it got that way -- dragging
// the divider to a sliver means the same thing as pressing the button.
export const COLLAPSED_MAX = 60;
// Narrower than this and a panel draws the rail instead of rows.
export const RAIL_MAX = 160;

// The right-hand column of panels: a stack like the sidebar's, not one block
// filling the side. Shared with the other panels that can move there, so the
// id is a convention between them, not this mod's own. It stays in the tree
// while empty and hides instead, which is what keeps its dragged width.
export const RIGHT = "right-lists";
const RIGHT_WIDTH = 380;

// ---- the layout tree ------------------------------------------------------

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export function parentOf(node, id) {
  for (const child of node?.children ?? []) {
    if (child.id === id) return node;
    const found = parentOf(child, id);
    if (found) return found;
  }
  return null;
}

const holdingIn = (tree, test) => {
  const walk = (node) => {
    for (const child of node?.children ?? []) {
      if (test(child)) return node;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(tree);
};

// Where a panel can live, found by what the nodes hold rather than by their
// names: the column with the spaces list is the sidebar, the row with the tab
// block is the work area the right column goes in. A layout shaped differently
// returns null and the move button stays hidden -- which beats the tasks
// panel's old version, that hardcoded "sidebar-lists" and broke if a layout
// renamed it.
export function destinations(tree) {
  return {
    sidebar: holdingIn(tree, (n) => n.content?.mod === "spaces"),
    work: holdingIn(tree, (n) => n.content?.tab),
    right: find(tree, RIGHT),
  };
}

// The layout block showing this copy. Two blocks now run the same mod, so the
// mod name alone no longer identifies one: the `kind` prop is what tells them
// apart. An explicit `props.node` still wins, for a layout that would rather
// say it outright.
export function hostBlockFor(tree, kind, node) {
  if (node) return find(tree, node);
  const walk = (n) => {
    if (n?.content?.props?.kind === kind) return n;
    for (const child of n?.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(tree);
}

// Which column the block sits in now, or null when this copy is a pane or an
// overlay and there is nothing to move.
export function placeOf(tree, host) {
  if (!host) return null;
  const { sidebar, work, right } = destinations(tree);
  const owner = parentOf(tree, host.id);
  if (!owner) return null;
  if (owner === sidebar) return "sidebar";
  if (owner === right) return "right";
  // Somewhere else in the layout: it can still move, as long as both ends exist.
  return sidebar && work ? "elsewhere" : null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows
// it too. Same rule the spaces and agents mods use.
export const narrowSidebar = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < RAIL_MAX;

// ---- resize and dock ------------------------------------------------------

// Minimise to the header bar rather than hiding the block: a hidden block
// leaves nothing on screen to click to bring it back.
export function minimise(host, collapsed, key) {
  if (collapsed) {
    const remembered = shared(key);
    if (typeof remembered === "number" && remembered > COLLAPSED_MAX) {
      run("layout.resize", { id: host.id, px: remembered });
    } else {
      // Never dragged, so give back the flexible share it started as.
      run("layout.resize", { id: host.id, weight: 1 });
    }
    return;
  }
  const px = host.size?.px;
  if (typeof px === "number" && px > COLLAPSED_MAX) setShared(key, px);
  run("layout.resize", { id: host.id, px: COLLAPSED });
}

// Move the block between the sidebar column and the right column. Each side
// keeps the size it had there, so going back and forth doesn't reset it. Only a
// layout the person owns accepts this: Herdr refuses structural edits to its
// own, which is why the button hides when there is nowhere to go.
export function moveTo(host, side) {
  const tree = JSON.parse(JSON.stringify(layout()));
  const { sidebar, work } = destinations(tree);
  const owner = parentOf(tree, host.id);
  if (!owner || !sidebar || !work) return;
  const at = owner.children.findIndex((c) => c.id === host.id);
  if (at < 0) return;
  const [block] = owner.children.splice(at, 1);
  // A panel in a stack: the same shape on either side, so moving it is only a
  // change of column, never a change of what it is.
  block.size = { weight: 1 };
  block.min = COLLAPSED;
  delete block.max;
  // Arriving hidden or collapsed would read as "it vanished".
  delete block.hidden;

  if (side === "right") {
    let column = find(tree, RIGHT);
    if (!column) {
      column = { id: RIGHT, type: "column", size: { px: RIGHT_WIDTH }, min: 300, max: 640, children: [] };
      work.children.push(column);
    }
    column.children.push(block);
    delete column.hidden;
  } else {
    sidebar.children.push(block);
  }

  // An empty column hides rather than goes: it keeps the width it was dragged
  // to, and the panel that moves back next lands in the same place.
  const column = find(tree, RIGHT);
  if (column) column.hidden = column.children.length === 0;
  run("layout.set", { layout: tree });
}
