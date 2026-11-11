// Demo mode, and the made-up world tools/demo.mjs writes.
//
// github.js answers every `gh` call from a file in the Herdr home, so that a
// screenshot of a full panel is the same picture twice and the window works
// with no login and no network. The panels do not know: the queries go out, the
// answers come back, and each panel's own judgement runs on them for real.
//
// Which makes this file two tests in one. That demo mode works at all -- no
// process is spawned, and a call the file does not cover fails loudly rather
// than quietly. And that the demo world still answers every panel: a route
// matches on a word of a query, so a query that changes stops matching, and
// without this the first anybody would know is an empty sandbox.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { demo } from "../tools/demo.mjs";
import * as github from "../mods/personal-cockpit/kit/github.js";
import * as issues from "../mods/personal-cockpit/panels/issues.js";
import * as pulls from "../mods/personal-cockpit/panels/pulls.js";
import * as routines from "../mods/personal-cockpit/panels/routines.js";
import * as team from "../mods/personal-cockpit/panels/team.js";
import { groups, merge } from "../mods/personal-cockpit/kit/urgent.js";
import { host, reset } from "./support/host/herdr.js";
import { gh } from "./support/gh.js";

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "tools");
const HOME = "/herdr";
const MOD = `${HOME}/mods/personal-cockpit`;
const TASKS = "acme/tasks";

/** Put the demo world in this home, as the sandbox script does. */
function sandbox(now = Date.parse("2026-03-01T12:00:00Z")) {
  host.files.set(`${HOME}/personal-cockpit-demo.json`, JSON.stringify(demo(now)));
  host.files.set(`${MOD}/routines.yml`, readFileSync(join(TOOLS, "demo", "routines.yml"), "utf8"));
  host.files.set(`${MOD}/team.yml`, readFileSync(join(TOOLS, "demo", "team.yml"), "utf8"));
}

/** The nodes a route carries, for shaping directly. */
const routeFor = (match) => demo().routes.find((r) => r.match === match);

beforeEach(() => {
  reset();
  // Nothing should reach this. Every route that answers is in the demo file, so
  // any call that gets here is one demo mode failed to cover.
  gh([]);
  localStorage.clear();
});

// ---- demo mode ------------------------------------------------------------

test("a home with no demo file goes to the real gh", async () => {
  gh([["pullRequests", { data: { viewer: { login: "rafael", pullRequests: { totalCount: 0, nodes: [] } } } }]]);
  await pulls.load();
  assert.ok(
    host.exec.some((call) => call.args[0] === "--version"),
    "the real gh was never looked for",
  );
});

test("with a demo file, no process is spawned at all", async () => {
  // Not even the `gh --version` probe: the machine demo mode is for is one
  // with no gh on it, and looking for one there would fail the load.
  sandbox();
  await pulls.load();
  assert.deepEqual(host.exec, []);
});

test("a call the demo file does not cover fails loudly", async () => {
  // Rather than returning empty, which would draw a convincing blank.
  host.files.set(`${HOME}/personal-cockpit-demo.json`, JSON.stringify({ routes: [] }));
  await assert.rejects(() => pulls.load(), /demo mode: no route/);
});

test("a demo file that does not parse is ignored, not treated as an outage", async () => {
  // Half-saved, or edited by hand into something that is not JSON. The panel
  // should say whatever gh says, not invent a GitHub problem.
  host.files.set(`${HOME}/personal-cockpit-demo.json`, "{ not json");
  gh([["pullRequests", { data: { viewer: { login: "rafael", pullRequests: { totalCount: 0, nodes: [] } } } }]]);
  const { items } = await pulls.load();
  assert.deepEqual(items, []);
  assert.ok(host.exec.length > 0, "it should have fallen through to the real gh");
});

test("a file with no routes array is ignored too", async () => {
  host.files.set(`${HOME}/personal-cockpit-demo.json`, JSON.stringify({ note: "nothing here" }));
  gh([["pullRequests", { data: { viewer: { login: "rafael", pullRequests: { totalCount: 0, nodes: [] } } } }]]);
  await pulls.load();
  assert.ok(host.exec.length > 0);
});

test("the repo picker's suggestions come from the demo world as well", async () => {
  // Its own route, after the pull requests one: that query also contains
  // `nameWithOwner`, and the first matching route wins.
  sandbox();
  const found = await github.repoList();
  assert.deepEqual(
    found.map((r) => r.nameWithOwner),
    [TASKS, "acme/app", "acme/web"],
  );
  assert.deepEqual(host.exec, []);
});

// ---- the world still answers every panel ---------------------------------

test("your pull requests: one of every group the panel has", async () => {
  sandbox();
  const { items, meta } = await pulls.load();
  assert.equal(meta.login, "you");
  assert.deepEqual(
    pulls.sections(items).map((s) => s.label),
    ["Needs you", "Ready to merge", "Waiting", "Drafts"],
  );
  assert.equal(pulls.attention(items), 1);
  assert.equal(pulls.urgent(items)[0].reason, "lint failing");
});

test("the team's pull requests: three, grouped by whoever opened them", () => {
  // Shaped here rather than loaded, deliberately: `load` asks `viewer()` for
  // the login and that answer is cached for the life of the process, so a
  // `load` in this file would depend on which other test ran first.
  const nodes = routeFor("search(").json.data.search.nodes;
  const items = nodes.map((n) => team.shape(n, "you", ["robin", "sam"]));
  assert.deepEqual(
    team.sections(items).map((s) => s.label),
    ["robin", "sam"],
  );
  assert.equal(team.attention(items), 1, "one should be waiting on you");
  assert.equal(team.urgent(items)[0].reason, "robin");
});

test("the task queue: three open, one parked on a decision", async () => {
  sandbox();
  const { items } = await issues.load({ repo: TASKS });
  assert.equal(items.length, 3);
  assert.deepEqual(
    issues.sections(items).map((s) => s.label),
    ["Needs you", "Queue"],
  );
  assert.equal(issues.urgent(items)[0].reason, "needs-decision");
});

test("the routines: one queued, one ready, one paused, one broken", async () => {
  sandbox();
  const { items, meta } = await routines.load();
  assert.equal(meta.repo, TASKS);
  assert.deepEqual(
    routines.sections(items).map((s) => s.label),
    ["Needs you", "Ready", "Paused"],
  );
  // The deliberately invalid one, which is the only way to see that row.
  assert.equal(meta.problems.length, 1);
  assert.match(meta.problems[0], /no acceptance/);
});

test("the four of them together fill every verb the drawer has", async () => {
  // The reason the world is shaped the way it is: with all four panels loaded,
  // the drawer shows one of each kind of move, so a screenshot of it is a
  // picture of the whole thing rather than of one heading.
  sandbox();
  const teamItems = routeFor("search(").json.data.search.nodes.map((n) => team.shape(n, "you", ["robin", "sam"]));
  const rows = merge([
    pulls.urgent((await pulls.load()).items),
    team.urgent(teamItems),
    issues.urgent((await issues.load({ repo: TASKS })).items),
    routines.urgent((await routines.load()).items),
  ]);

  assert.deepEqual(
    groups(rows).map((g) => g.id),
    ["fix", "review", "decide", "config"],
  );
  for (const row of rows) {
    assert.ok(row.title.length > 0, `a row with no title: ${row.key}`);
    assert.ok(row.reason.length > 0, `a row with no reason: ${row.key}`);
  }
});

test("nothing in the demo world belongs to anybody", () => {
  // The rule in CONTRIBUTING.md, as a check. A sandbox screenshot is the
  // likeliest way a real repository name leaves a machine.
  //
  // The generated data and not the generator: what reaches a Herdr home is the
  // JSON, and a template in the source reads as a literal `${REPO}` here while
  // the thing it expands to is what would actually be on screen.
  const written = [
    JSON.stringify(demo()),
    readFileSync(join(TOOLS, "demo", "routines.yml"), "utf8"),
    readFileSync(join(TOOLS, "demo", "team.yml"), "utf8"),
  ].join("\n");

  const owners = [...written.matchAll(/github\.com\/([^/\s"'`]+)\//g)].map(([, owner]) => owner);
  assert.ok(owners.length > 0, "no URLs found at all -- has the demo data moved?");
  for (const owner of owners) {
    assert.equal(owner, "acme", `github.com/${owner}/ is not in the made-up world`);
  }

  // `owner/name` as the panels take it: a repo list entry, `coordination_repo`,
  // and the `org:` a watch query is scoped to.
  for (const [, repo] of written.matchAll(/"nameWithOwner":\s*"([^"]+)"/g)) {
    assert.match(repo, /^acme\//, `${repo} is not in the made-up world`);
  }
  for (const [, repo] of written.matchAll(/\b(?:coordination_repo:|org:)\s*([A-Za-z0-9._/-]+)/g)) {
    assert.match(repo, /^acme/, `${repo} is not in the made-up world`);
  }
});
