// The order the drawer reads in.
//
// urgent.js holds one decision -- which of four kinds of "your move" to put in
// front of you first -- and two functions that apply it. It imports nothing, so
// there is nothing to stand up here: the tests are the decision, written down.

import { test } from "node:test";
import assert from "node:assert/strict";

import { SNOOZED, VERBS, awake, groups, merge, morning, withSnooze } from "../mods/personal-cockpit/kit/urgent.js";

const row = (verb, key, at = 0) => ({ key, verb, title: key, reason: "because", url: null, at });

const keys = (rows) => rows.map((r) => r.key);

const NOON = Date.parse("2026-03-02T12:00:00Z");

test("the verbs are distinct, and named", () => {
  const ids = VERBS.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length, `collision in ${ids.join(", ")}`);
  for (const [id, label] of VERBS) {
    assert.ok(id.length > 0);
    assert.ok(label.length > 0);
  }
});

test("merge puts the verbs in the order VERBS lists them", () => {
  // Handed to it backwards, and one list per panel, as the drawer does.
  const merged = merge([[row("config", "c")], [row("decide", "d")], [row("review", "r")], [row("fix", "f")]]);
  assert.deepEqual(keys(merged), ["f", "r", "d", "c"]);
});

test("inside a verb the longest wait comes first", () => {
  // The opposite of how the panels sort their own lists, on purpose: this is a
  // list you are nagged by, and the forgotten row is the one that sat still.
  const merged = merge([[row("fix", "recent", 3000), row("fix", "old", 1000), row("fix", "middle", 2000)]]);
  assert.deepEqual(keys(merged), ["old", "middle", "recent"]);
});

test("an unknown age goes last in its verb rather than first", () => {
  // `at: 0` is "no idea how long", which sorts as the longest wait of all if
  // you let it, and would park the least-known row at the top for good.
  const merged = merge([[row("fix", "unknown", 0), row("fix", "known", 5000)]]);
  assert.deepEqual(keys(merged), ["known", "unknown"]);
});

test("the verb order wins over the wait", () => {
  const merged = merge([[row("review", "fresh-review", 9000)], [row("fix", "ancient-fix", 1)]]);
  assert.deepEqual(keys(merged), ["ancient-fix", "fresh-review"]);
});

test("a panel that has nothing to say contributes nothing", () => {
  assert.deepEqual(merge([[], [], [], []]), []);
  assert.deepEqual(merge([]), []);
});

test("a row with no key is dropped rather than drawn", () => {
  // A panel mid-refresh can publish a partly-built list, and a row with no key
  // reaches the element tree as an id of `undefined` -- shared with every other
  // one like it.
  const merged = merge([[row("fix", "good"), null, undefined, { verb: "fix", title: "keyless" }]]);
  assert.deepEqual(keys(merged), ["good"]);
});

test("a verb nobody recognises sorts last instead of throwing", () => {
  // The drawer and the panels are one mod and ship together, so this cannot
  // happen from a version skew -- but shared state is persisted, so rows
  // written by an older copy of the mod outlive it.
  const merged = merge([[row("sideways", "odd"), row("config", "known")]]);
  assert.deepEqual(keys(merged), ["known", "odd"]);
});

test("groups buckets by verb, in VERBS order, keeping merge's order inside", () => {
  const merged = merge([
    [row("fix", "f-old", 1000), row("fix", "f-new", 2000)],
    [row("decide", "d")],
  ]);
  const got = groups(merged);
  assert.deepEqual(
    got.map((g) => [g.id, g.label, keys(g.rows)]),
    [
      ["fix", "Fix", ["f-old", "f-new"]],
      ["decide", "Decide", ["d"]],
    ],
  );
});

test("groups leaves out a verb with no rows rather than drawing an empty heading", () => {
  assert.deepEqual(groups([]), []);
  assert.deepEqual(
    groups(merge([[row("review", "r")]])).map((g) => g.id),
    ["review"],
  );
});

test("groups keeps every row it was given", () => {
  const merged = merge([[row("fix", "a"), row("review", "b"), row("decide", "c"), row("config", "d")]]);
  const total = groups(merged).reduce((n, g) => n + g.rows.length, 0);
  assert.equal(total, merged.length);
});

// ---- not today -------------------------------------------------------------

test("a snooze lasts until the morning, not for a fixed stretch of hours", () => {
  // The point of a wall-clock hour: "not today" has to end when the day does,
  // or something put off at 11pm comes back in the small hours.
  for (const hour of [0, 3, 7, 9, 13, 20, 23]) {
    const now = new Date(2026, 2, 2, hour, 30, 0, 0).getTime();
    const until = morning(now);
    const when = new Date(until);
    assert.ok(until > now, `${hour}:30 snoozed to the past`);
    assert.equal(when.getHours(), 8, `${hour}:30 woke at ${when.getHours()}`);
    assert.equal(when.getMinutes(), 0);
    // Tomorrow morning at the latest, so nothing can hide for a week.
    assert.ok(until - now <= 24 * 3600_000, `${hour}:30 slept longer than a day`);
  }
});

test("before the morning hour it is this morning, after it is the next", () => {
  const sevenish = new Date(2026, 2, 2, 7, 0, 0, 0).getTime();
  const nineish = new Date(2026, 2, 2, 9, 0, 0, 0).getTime();
  assert.equal(morning(sevenish), new Date(2026, 2, 2, 8, 0, 0, 0).getTime());
  assert.equal(morning(nineish), new Date(2026, 2, 3, 8, 0, 0, 0).getTime());
});

test("the hour it means by morning is an argument, so this is not about 8", () => {
  const now = new Date(2026, 2, 2, 12, 0, 0, 0).getTime();
  assert.equal(morning(now, 17), new Date(2026, 2, 2, 17, 0, 0, 0).getTime());
});

test("a snoozed row is not drawn, and the rest of the list is untouched", () => {
  const rows = [row("fix", "a"), row("fix", "b")];
  assert.deepEqual(keys(awake(rows, { a: NOON + 3600_000 }, NOON)), ["b"]);
  assert.deepEqual(keys(awake(rows, {}, NOON)), ["a", "b"]);
});

test("a snooze that has run out is over, with nothing having to sweep it", () => {
  const rows = [row("fix", "a")];
  assert.deepEqual(keys(awake(rows, { a: NOON - 1 }, NOON)), ["a"]);
  assert.deepEqual(keys(awake(rows, { a: NOON }, NOON)), ["a"], "the moment it is due, it is back");
});

test("junk in the snooze map hides nothing", () => {
  // Shared state is persisted, so this map outlives the copy of the mod that
  // wrote it. A row wrongly hidden is work nobody is being told about, so
  // anything that is not a time in the future counts as awake.
  const rows = [row("fix", "a")];
  for (const junk of [null, undefined, "a", 42, ["a"], { a: "later" }, { a: null }, { a: true }, { a: 0 }, { a: -1 }]) {
    assert.deepEqual(keys(awake(rows, junk, NOON)), ["a"], JSON.stringify(junk) ?? "undefined");
  }
});

test("putting a row off keeps the others and drops what has already woken", () => {
  const next = withSnooze({ old: NOON - 1, kept: NOON + 3600_000 }, "new", NOON + 7200_000, NOON);
  assert.deepEqual(next, { kept: NOON + 3600_000, new: NOON + 7200_000 });
});

test("putting the same row off again moves its morning rather than adding one", () => {
  const once = withSnooze({}, "a", NOON + 3600_000, NOON);
  const twice = withSnooze(once, "a", NOON + 7200_000, NOON);
  assert.deepEqual(twice, { a: NOON + 7200_000 });
});

test("a snooze map made from junk is still a map", () => {
  for (const junk of [null, "nonsense", 42, ["a"], { a: "later" }]) {
    const next = withSnooze(junk, "a", NOON + 1, NOON);
    assert.deepEqual(next, { a: NOON + 1 }, JSON.stringify(junk) ?? "undefined");
  }
});

test("the snooze map has one key for every panel's rows", () => {
  // The drawer is the only thing that reads it and reads all of them at once,
  // so one key is one read -- and it is persisted the way the repo picks are,
  // which is what makes it per machine.
  assert.equal(SNOOZED, "cockpit.snoozed");
});
