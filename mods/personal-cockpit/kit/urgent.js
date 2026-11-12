// What wants something from you, across the panels and the terminals.
//
// Every panel already judges its own list -- a red build, a review asked for, a
// task parked on a decision -- and already counts the result for the `N needs
// you` pill in its header. `urgent(items)` is that same judgement with the rows
// kept instead of only counted, which is what lets the drawer draw them and
// leaves `attention` as a `length` rather than a second opinion. The blocked
// agents are the one set of rows no panel publishes, and agents.js says why.
//
// This file imports nothing. What it holds is the order of the verbs and the
// arithmetic of a snooze: both are facts about whose move it is rather than
// about any one panel, which is also why neither can live in one.

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
 * of the lists to look at first, because none of them can see the others. So:
 * an agent of yours standing still, then your own work stuck, then somebody
 * stuck on you, then the queue waiting on a decision, then a file of ours that
 * is wrong.
 *
 * Answer is first because it is the only one whose cost is still being paid.
 * A red build is already broken and will be just as broken in an hour; an agent
 * parked on a question is a machine idling and work not happening, and every
 * minute it waits is spent rather than merely late.
 */
export const VERBS = [
  ["answer", "Answer"],
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
 *  `go`     `{ name, args }` for a row that is not a page but a command the app
 *           runs -- a blocked agent is in a terminal, not on the web. Read only
 *           when there is no `url`, and absent on every published row: the
 *           panels all have pages, and this is live rather than persisted.
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

// ---- not today ------------------------------------------------------------
//
// The drawer's promise is that an empty edge means nothing is waiting. A pull
// request you cannot touch until Monday breaks it: the strip stays lit for
// three days over a row you have already decided about, and a drawer that is
// always lit is not a signal. So a row can be put off.
//
// Only the drawer goes quiet. The panels publish every urgent row as they
// always did and their own `N needs you` pills still count them, which is
// where to look for something you put off and now want back.

/** Where the drawer leaves what you have put off: `{ key: until }`, in ms.
 *
 *  One key for every panel's rows rather than one per panel, because the drawer
 *  is the only thing that reads it and reads all of them at once. Persisted the
 *  way the repo picks are, so it is per machine: the laptop you snoozed
 *  something on is the one that stays quiet about it. */
export const SNOOZED = "cockpit.snoozed";

/** When a morning starts, for a snooze that means "not today". */
const MORNING = 8;

/** The next 8am after `now`, local.
 *
 *  A wall-clock hour rather than a duration, so "not today" ends when the day
 *  does instead of eight hours after whenever the button was pressed -- snooze
 *  something at 11pm and it is back for the morning, not for the small hours.
 *  Long enough to clear a day, short enough that nothing can hide for a week. */
export function morning(now, hour = MORNING) {
  const day = new Date(now);
  const at = (over) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + over, hour, 0, 0, 0).getTime();
  return at(0) > now ? at(0) : at(1);
}

/** The rows that are not asleep, for the drawer to draw and count. */
export function awake(rows, snoozed, now) {
  const until = asleep(snoozed);
  return rows.filter((row) => !(until[row.key] > now));
}

/** `snoozed` with `key` asleep until `at`, and everything already past dropped
 *  -- which is how the map cannot grow without bound and needs nothing to come
 *  along and sweep it. */
export function withSnooze(snoozed, key, at, now) {
  const next = {};
  for (const [k, when] of Object.entries(asleep(snoozed))) if (when > now) next[k] = when;
  next[key] = at;
  return next;
}

/** The map, with anything that is not a time ignored. Shared state is
 *  persisted, so this outlives the copy of the mod that wrote it and can be
 *  anything at all by the time it is read back. */
function asleep(snoozed) {
  if (!snoozed || typeof snoozed !== "object" || Array.isArray(snoozed)) return {};
  const until = {};
  for (const [key, when] of Object.entries(snoozed)) if (typeof when === "number" && when > 0) until[key] = when;
  return until;
}
