// What wants something from you, across all four panels.
//
// Every panel already judges its own list -- a red build, a review asked for, a
// task parked on a decision -- and already counts the result for the `N needs
// you` pill in its header. `urgent(items)` is that same judgement with the rows
// kept instead of only counted, which is what lets the drawer draw them and
// leaves `attention` as a `length` rather than a second opinion.
//
// This file imports nothing. All it holds is the order of the verbs, and that
// is a fact about whose move it is rather than about any one panel -- which is
// also why it cannot live in any of them.

/**
 * Where a panel leaves its rows for the drawer to read.
 *
 * The drawer is another copy of this mod and cannot see a panel's `items`, so
 * the alternative would be four more `gh` calls of its own on their own clock
 * -- twice the traffic, and two lists that can disagree. Instead each panel
 * publishes what it already judged, and the drawer only ever draws. It cannot
 * be wrong about a panel, because it is showing that panel's own answer.
 *
 * Same shape as config.js's keys, and persisted the same way: the drawer has
 * last night's rows to draw the moment the window opens, before any poll.
 */
export const shareKey = (panel) => `cockpit.${panel}.urgent`;

/**
 * The verbs, most pressing first.
 *
 * The order is the whole reason the drawer earns its place. Each panel can
 * already say "3 need you" about its own list, but none of them can say which
 * of the four lists to look at first, because none of them can see the others.
 * So: your own work stuck, then somebody stuck on you, then the queue waiting
 * on a decision, then a file of ours that is wrong.
 */
export const VERBS = [
  ["fix", "Fix"],
  ["review", "Review"],
  ["decide", "Decide"],
  ["config", "Configure"],
];

const ORDER = new Map(VERBS.map(([id], i) => [id, i]));

/** A row the drawer can draw, as a panel's `urgent` returns it. Not enforced
 *  anywhere but the role test -- it is a plain object on purpose, so a panel
 *  builds one without importing anything from here.
 *
 *  `key`    unique across panels: every panel prefixes its own name.
 *  `verb`   one of VERBS.
 *  `title`  what it is.
 *  `reason` why it wants you, in a word or three.
 *  `url`    where a click lands, or null for something with no page.
 *  `at`     ms, when it last moved; 0 when unknown.
 */

/**
 * Every panel's rows as one list.
 *
 * Within a verb the longest wait comes first, which is the opposite of how the
 * panels themselves sort. They are lists you read, so newest-first is right
 * there. This is a list you are nagged by, and the row most likely to have been
 * forgotten is the one that has sat still the longest.
 *
 * An unknown `at` of 0 would win that sort outright, so it goes last instead:
 * "no idea how long" is not evidence of a long wait.
 */
export function merge(lists) {
  const rows = lists.flat().filter((row) => row && typeof row.key === "string");
  return rows.sort(
    (a, b) =>
      (ORDER.get(a.verb) ?? VERBS.length) - (ORDER.get(b.verb) ?? VERBS.length) ||
      (a.at || Infinity) - (b.at || Infinity),
  );
}

/** The same rows bucketed for drawing: one group per verb that has any, in
 *  VERBS order, each group keeping the order `merge` put its rows in. */
export function groups(rows) {
  return VERBS.map(([id, label]) => ({ id, label, rows: rows.filter((r) => r.verb === id) })).filter(
    (group) => group.rows.length,
  );
}
