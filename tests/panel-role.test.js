// The panel role.
//
// Five modules -- pulls, issues, routines, team and jira -- are interchangeable
// to list.js, which imports all five and treats whichever it was given as
// `this.source`. That makes them players of one role, so this is one set of
// tests run against every one of them: the shared role test, rather than five
// copies that drift.
//
// The contract is read off list.js's own use of `source`, not invented here.
// What it reaches for unguarded is required; what it reaches for behind
// `if (source.x)` is optional, and only has to be the right type when present.
//
// This is the file that makes a refactor safe. Split kit.js, move a panel into
// a subfolder, rename a private helper -- if all four still answer the same
// messages with the same kinds of answer, list.js cannot tell the difference,
// and neither can the app.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as pulls from "../mods/personal-cockpit/panels/pulls.js";
import * as issues from "../mods/personal-cockpit/panels/issues.js";
import * as routines from "../mods/personal-cockpit/panels/routines.js";
import * as team from "../mods/personal-cockpit/panels/team.js";
import * as jira from "../mods/personal-cockpit/jira/jira.js";
import { VERBS } from "../mods/personal-cockpit/kit/urgent.js";
import { label, minutesAgo, prNode, reviewRequest, teamPrNode } from "./support/factories.js";

const PANELS = [
  ["pulls", pulls],
  ["issues", issues],
  ["routines", routines],
  ["team", team],
  ["jira", jira],
];

// One item per player that wants something from you, which is the one thing the
// role cannot describe generically: what counts as urgent *is* each panel's own
// opinion. So the role test keeps a specimen of each, and asserts the same
// things about all four.
//
// These are the shapes the panels pass internally, not GitHub's -- `urgent` is
// a pure function of a loaded list, and for two of the panels that list never
// looked like a GitHub payload.
//
// Jira has none, and that is its answer rather than a gap: a ticket assigned to
// you is a list you read, not a move that is stuck on you, so `urgent` is
// empty whatever it is given. The specimen tests skip it; the ones that hold
// for an empty answer still run.
const NEEDY = {
  // A conflicting pull request of yours: cannot land, and the move is yours.
  pulls: [pulls.shape(prNode({ mergeable: "CONFLICTING" }))],
  // Somebody else's, with your review asked for.
  team: [team.shape(teamPrNode({ reviewRequests: { nodes: [reviewRequest("me")] } }), "me", ["alice"])],
  // A task parked on a decision: `slim`'s shape, labels as {name, color}.
  issues: [
    {
      number: 41,
      title: "Prune merged branches",
      url: "https://github.com/acme/tasks/issues/41",
      comments: 0,
      updated_at: minutesAgo(45),
      labels: [label("needs-decision")],
    },
  ],
  // A routine whose open task is parked on one: `slim`'s shape here keeps
  // labels as bare names.
  routines: [
    {
      key: "0-Nightly sweep",
      title: "Nightly sweep",
      state: "open",
      def: { title: "Nightly sweep" },
      error: null,
      url: "https://github.com/acme/tasks/issues/42",
      open: { number: 42, labels: ["awaiting-merge"], created_at: minutesAgo(90) },
    },
  ],
};

const VERB_IDS = new Set(VERBS.map(([id]) => id));

// Used by list.js without asking whether it is there.
const REQUIRED = {
  panel: "string",
  title: "string",
  icon: "string",
  loading: "string",
  empty: "string",
  needsRepo: "boolean",
  refreshMs: "number",
  load: "function",
  sections: "function",
  attention: "function",
  urgent: "function",
  rowOf: "function",
};

// Reached for behind a guard: a panel may answer or not, but a half-answer --
// a `configure` that is a string, say -- would break the copy that has one.
const OPTIONAL = {
  stampNote: "function",
  footnote: "function",
  // What Jira brought with it. Each is how a source says it differs, in place
  // of a branch on its name in list.js.
  heightKey: "string",
  keepsLastGood: "boolean",
  focusOnPress: "boolean",
  commands: "object",
  browse: "function",
  browseTip: "string",
  configure: "function",
  configureTip: "string",
  act: "function",
  cached: "function",
  save: "function",
  newUrl: "function",
  newLabel: "string",
};

/** The role, as one assertion. A module either plays it or it does not. */
export function assertPanelRole(mod, name) {
  for (const [member, type] of Object.entries(REQUIRED)) {
    assert.equal(typeof mod[member], type, `${name}.${member} must be a ${type}`);
  }
  for (const [member, type] of Object.entries(OPTIONAL)) {
    if (mod[member] !== undefined) {
      assert.equal(typeof mod[member], type, `${name}.${member} must be a ${type} when present`);
    }
  }
  for (const member of ["panel", "title", "icon", "loading", "empty"]) {
    assert.ok(mod[member].length > 0, `${name}.${member} must not be empty`);
  }
  assert.ok(mod.refreshMs > 0, `${name}.refreshMs must be a positive number of ms`);
}

for (const [name, mod] of PANELS) {
  test(`${name} plays the panel role`, () => {
    assertPanelRole(mod, name);
  });

  test(`${name}.sections([]) is empty rather than four empty groups`, () => {
    // An empty list draws the panel's `empty` line, so a section with no items
    // in it would be a heading over nothing.
    assert.deepEqual(mod.sections([]), []);
  });

  test(`${name}.sections returns {label, items} groups`, () => {
    for (const section of mod.sections([])) {
      assert.equal(typeof section.label, "string");
      assert.ok(Array.isArray(section.items));
    }
  });

  test(`${name}.attention([]) is 0`, () => {
    const count = mod.attention([]);
    assert.equal(typeof count, "number");
    assert.equal(count, 0);
  });

  test(`${name}.urgent([]) is empty`, () => {
    assert.deepEqual(mod.urgent([]), []);
  });

  test(`${name}.attention is ${name}.urgent's length, not a second opinion`, () => {
    // The header pill and the drawer have to agree, and the only way to be sure
    // they do is for one of them to be derived from the other.
    const items = NEEDY[name] ?? [];
    if (NEEDY[name]) assert.ok(mod.urgent(items).length > 0, `the ${name} specimen should want something`);
    assert.equal(mod.attention(items), mod.urgent(items).length);
    assert.equal(mod.attention([]), mod.urgent([]).length);
  });

  test(`${name}.urgent rows are drawable`, () => {
    for (const row of mod.urgent(NEEDY[name])) {
      assert.ok(VERB_IDS.has(row.verb), `${name} returned the unknown verb ${row.verb}`);
      assert.equal(typeof row.title, "string");
      assert.ok(row.title.length > 0, `${name} returned a row with no title`);
      assert.equal(typeof row.reason, "string");
      assert.ok(row.reason.length > 0, `${name} returned a row with no reason`);
      assert.equal(typeof row.at, "number");
      // Null is allowed -- a broken routine has no page -- but undefined would
      // reach `cx.open_url` as a click that silently does nothing.
      assert.ok(row.url === null || typeof row.url === "string");
    }
  });

  test(`${name}.urgent keys name their own panel`, () => {
    // The drawer draws all four lists in one element tree, so a key shared
    // between two panels would be two rows with one id.
    for (const row of mod.urgent(NEEDY[name])) {
      assert.equal(typeof row.key, "string");
      assert.ok(row.key.startsWith(`${mod.panel}:`), `${row.key} should start with ${mod.panel}:`);
    }
  });

  test(`${name}.stampNote survives having no meta`, () => {
    // list.js calls it with whatever `load` returned, and a failed first load
    // leaves that null.
    assert.doesNotThrow(() => mod.stampNote(null, null));
    assert.doesNotThrow(() => mod.stampNote(undefined, undefined));
  });

  if (mod.footnote) {
    test(`${name}.footnote survives having no meta`, () => {
      assert.doesNotThrow(() => mod.footnote(null));
      assert.doesNotThrow(() => mod.footnote(undefined));
    });
  }
}

test("the panel keys are distinct", () => {
  // `panel` names the layout block, the remembered height in shared state and
  // the cache. Two panels sharing one would share a height and a cached list.
  const keys = PANELS.map(([, mod]) => mod.panel);
  assert.equal(new Set(keys).size, keys.length, `collision in ${keys.join(", ")}`);
});

test("only the panel that needs a repo asks for one", () => {
  // Not a style rule: `needsRepo` decides whether the panel blocks on a repo
  // pick, and a panel that asked for one it never uses would never load.
  assert.equal(issues.needsRepo, true);
  for (const [name, mod] of PANELS.filter(([n]) => n !== "issues")) {
    assert.equal(mod.needsRepo, false, `${name} should not need a repo`);
  }
});

test("a repo-less panel ships no cache, and the repo-keyed one does", () => {
  // The cache is keyed by repo, so a panel without one has nothing to key by.
  assert.equal(typeof issues.cached, "function");
  assert.equal(typeof issues.save, "function");
  for (const [name, mod] of PANELS.filter(([n]) => n !== "issues")) {
    assert.equal(mod.cached, undefined, `${name} should not cache`);
    assert.equal(mod.save, undefined, `${name} should not cache`);
  }
});

// ---- the contract is a real check -----------------------------------------

test("the role assertion rejects a module that does not play the role", () => {
  // Without this, every test above could be passing vacuously.
  const complete = { ...REQUIRED };
  for (const [member, type] of Object.entries(REQUIRED)) {
    complete[member] =
      type === "string" ? "x" : type === "number" ? 1 : type === "boolean" ? false : () => [];
  }
  assert.doesNotThrow(() => assertPanelRole(complete, "complete"));

  for (const member of Object.keys(REQUIRED)) {
    const missing = { ...complete };
    delete missing[member];
    assert.throws(() => assertPanelRole(missing, "missing"), new RegExp(`missing\\.${member}`), `dropping ${member} should fail the role`);
  }
});

test("the role assertion rejects an empty title and a zero interval", () => {
  const base = {
    panel: "x", title: "x", icon: "x", loading: "x", empty: "x",
    needsRepo: false, refreshMs: 1,
    load: () => {}, sections: () => [], attention: () => 0, urgent: () => [], rowOf: () => {},
  };
  assert.throws(() => assertPanelRole({ ...base, title: "" }, "m"), /title must not be empty/);
  assert.throws(() => assertPanelRole({ ...base, refreshMs: 0 }, "m"), /positive number of ms/);
  assert.throws(() => assertPanelRole({ ...base, configure: "not a function" }, "m"), /configure must be a function/);
});
