// checks.js: what a commit's check rollup means.
//
// Two predicates, and the whole point of them is that there is one definition
// each. Both pull request panels ask the same two questions, and while they
// were two mod folders they drifted -- so the truth table is written out in
// full rather than sampled.

import { test } from "node:test";
import assert from "node:assert/strict";

import { RED, RUNNING } from "../mods/personal-cockpit/kit/checks.js";

// Every state GitHub's statusCheckRollup can be in, plus the absences a panel
// has to survive.
const STATES = [
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "PENDING",
  "EXPECTED",
  "NONE",
  null,
  undefined,
  "",
];

test("only a failure and an error are red", () => {
  for (const state of STATES) {
    const expected = state === "FAILURE" || state === "ERROR";
    assert.equal(RED(state), expected, String(state));
  }
});

test("only pending and expected are running", () => {
  for (const state of STATES) {
    const expected = state === "PENDING" || state === "EXPECTED";
    assert.equal(RUNNING(state), expected, String(state));
  }
});

test("no state is both red and running", () => {
  // The row asks both and draws one glyph: a state answering yes twice would
  // make which one it got depend on the order they are asked in.
  for (const state of STATES) {
    assert.equal(RED(state) && RUNNING(state), false, String(state));
  }
});

test("a success is neither, and so is a commit with no checks", () => {
  for (const state of ["SUCCESS", "NONE", null]) {
    assert.equal(RED(state), false, String(state));
    assert.equal(RUNNING(state), false, String(state));
  }
});

test("an unknown state is treated as neither rather than as a failure", () => {
  // GitHub adding a state must not turn every row red.
  for (const state of ["QUEUED", "SKIPPED", "NEUTRAL", "whatever"]) {
    assert.equal(RED(state), false, state);
    assert.equal(RUNNING(state), false, state);
  }
});
