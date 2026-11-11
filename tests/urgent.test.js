// The order the drawer reads in.
//
// urgent.js holds one decision -- which of four kinds of "your move" to put in
// front of you first -- and two functions that apply it. It imports nothing, so
// there is nothing to stand up here: the tests are the decision, written down.

import { test } from "node:test";
import assert from "node:assert/strict";

import { VERBS, groups, merge } from "../mods/personal-cockpit/kit/urgent.js";

const row = (verb, key, at = 0) => ({ key, verb, title: key, reason: "because", url: null, at });

const keys = (rows) => rows.map((r) => r.key);

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
