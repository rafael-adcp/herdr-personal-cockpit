// agents.js: the blocked agents, as drawer rows.
//
// This is the one source of drawer rows that no panel publishes, so the round
// trip the other four get in drawer.test.js does not exist here: `agents()` is
// the app's own live answer, and what is testable is the judgement made of it.
// Which agents earn a row, what the row says, where its press goes, and where
// its age comes from -- since an agent's own record carries no clock.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { GO, VERB, rows } from "../mods/personal-cockpit/kit/agents.js";
import { VERBS } from "../mods/personal-cockpit/kit/urgent.js";
import { host, reset } from "./support/host/herdr.js";
import { NOW, agentInfo, spaceWithTabs, tabInfo } from "./support/factories.js";

const keys = (list) => list.map((r) => r.key);

beforeEach(() => {
  reset();
});

test("with no agents there is nothing to answer", () => {
  assert.deepEqual(rows(), []);
});

test("an app that answers with nothing at all is not a crash", () => {
  // `agents()` and `spaces()` are live reads of the app's own state, and a mod
  // can be rendered before either has anything in it.
  host.agents = null;
  host.spaces = null;
  assert.deepEqual(rows(), []);
});

test("only a blocked agent is waiting on anybody", () => {
  // `working` is not waiting, `idle` is nothing, and `done` becomes `idle` the
  // moment somebody looks at it on any Herdr client -- a row that clears itself
  // for reasons outside this mod is a row that flickers.
  host.agents = [
    agentInfo({ address: "core/t1", status: "blocked" }),
    agentInfo({ address: "core/t2", status: "working" }),
    agentInfo({ address: "core/t3", status: "done" }),
    agentInfo({ address: "core/t4", status: "idle" }),
    agentInfo({ address: "core/t5", status: null }),
  ];
  assert.deepEqual(keys(rows()), ["agents:core/t1"]);
});

test("the agent you are looking at is left out", () => {
  // It is already in front of you, so it is the one row the drawer could never
  // be right about -- and focusing one is what takes it off the list.
  host.agents = [agentInfo({ address: "core/t1", focused: true }), agentInfo({ address: "core/t2" })];
  assert.deepEqual(keys(rows()), ["agents:core/t2"]);
});

test("a row is drawable, and its verb is one the drawer orders", () => {
  host.agents = [agentInfo()];
  const [row] = rows();
  assert.ok(
    VERBS.some(([id]) => id === row.verb),
    `${row.verb} is not a verb urgent.js knows`,
  );
  assert.equal(row.verb, VERB);
  assert.equal(typeof row.title, "string");
  assert.ok(row.title.length > 0);
  assert.equal(typeof row.reason, "string");
  assert.ok(row.reason.length > 0);
  assert.equal(typeof row.at, "number");
  // Null rather than undefined, which would reach `cx.open_url` as a click
  // that silently does nothing.
  assert.equal(row.url, null);
});

test("the keys name their own source, and one agent cannot be two rows", () => {
  // The drawer draws every list in one element tree, so a key shared with a
  // panel would be two rows with one id.
  host.agents = [agentInfo({ address: "core/t1" }), agentInfo({ address: "core/t2" })];
  const drawn = keys(rows());
  assert.deepEqual(drawn, ["agents:core/t1", "agents:core/t2"]);
  assert.equal(new Set(drawn).size, drawn.length);
});

test("a press focuses that terminal, wherever in the window it is", () => {
  host.agents = [agentInfo({ address: "core/t9" })];
  const [row] = rows();
  assert.deepEqual(row.go, { name: GO, args: { terminal: "core/t9" } });
  assert.equal(GO, "agent.focus");
});

// ---- what the row says ----------------------------------------------------

test("the tab's name is the title, because that is what the work is called", () => {
  host.agents = [agentInfo({ tab_name: "install the hook", title: "waiting for input" })];
  assert.equal(rows()[0].title, "install the hook");
});

test("a tab nobody named is called by its position, so the terminal's title wins", () => {
  host.agents = [agentInfo({ tab_name: "2", title: "reviewing the diff" })];
  assert.equal(rows()[0].title, "reviewing the diff");
});

test("with neither a name nor a title, the program is still something to call it", () => {
  host.agents = [agentInfo({ tab_name: "3", title: "" })];
  assert.equal(rows()[0].title, "Claude Code");
  host.agents = [agentInfo({ tab_name: "", title: "", program: null })];
  assert.equal(rows()[0].title, "An agent");
});

test("the reason says which agent is asking and where it is", () => {
  host.agents = [agentInfo({ space_name: "cockpit" })];
  assert.equal(rows()[0].reason, "Claude Code · cockpit");
});

test("a reason with nothing to put in it still says something", () => {
  host.agents = [agentInfo({ program: null, space_name: "" })];
  assert.equal(rows()[0].reason, "waiting on you");
});

// ---- the age ---------------------------------------------------------------

test("the age comes from the tab, since the agent's own record has no clock", () => {
  // `seq` orders agents but is not a time, and the drawer both sorts by how
  // long a row has waited and draws that age on it.
  host.agents = [agentInfo({ tab: "t-7" })];
  host.spaces = [spaceWithTabs([tabInfo({ id: "t-7", changed_at: NOW - 25 * 60_000 })])];
  assert.equal(rows()[0].at, NOW - 25 * 60_000);
});

test("an agent in another space finds its own tab", () => {
  host.agents = [agentInfo({ address: "core/t1", tab: "t-1" }), agentInfo({ address: "core/t2", tab: "t-2" })];
  host.spaces = [
    spaceWithTabs([tabInfo({ id: "t-1", changed_at: 1000 })], { id: "s1" }),
    spaceWithTabs([tabInfo({ id: "t-2", changed_at: 2000 })], { id: "s2", name: "work" }),
  ];
  assert.deepEqual(
    rows().map((r) => r.at),
    [1000, 2000],
  );
});

test("a tab nothing has happened in reports no time, and that is 0 rather than a throw", () => {
  // `changed_at` is null until something changes state after the app starts.
  // The drawer reads 0 as "no idea how long" and sorts it last in its verb.
  host.agents = [agentInfo({ tab: "t-1" })];
  host.spaces = [spaceWithTabs([tabInfo({ id: "t-1", changed_at: null })])];
  assert.equal(rows()[0].at, 0);

  host.spaces = [spaceWithTabs([])];
  assert.equal(rows()[0].at, 0);

  host.spaces = [{ id: "s1" }];
  assert.equal(rows()[0].at, 0);
});
