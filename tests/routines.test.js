// Routines.
//
// Three of the fields here are not a style preference: PROTOCOL.md §2 makes
// Goal, Acceptance and exactly one `project:<name>` mandatory, because a task
// with no project label is invisible to every conforming worker and one with an
// empty Goal stalls whoever claims it. The panel checks that when it reads the
// file, so a broken routine says so in its row rather than when ▶ is pressed.
//
// That makes this the file worth breaking on purpose: every requirement below
// has a test that fails if the check is removed.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  validate, markerOf, bodyFor, labelsFor, repoFrom,
  load, act, sections, attention, stampNote, footnote, rowOf,
} from "../mods/personal-cockpit/routines.js";
import { host, reset, theme } from "./support/host/herdr.js";
import { gh, apiCalls, fails } from "./support/gh.js";
import { issue, minutesAgo } from "./support/factories.js";

const FILE = "/herdr/mods/personal-cockpit/routines.yml";
const REPO = "acme/tasks";

/** A routine with everything §2 asks for. */
const routine = (over = {}) => ({
  title: "Prune merged branches",
  project: "chores",
  goal: "Delete branches already merged into main.",
  acceptance: "No merged branch older than a week remains.",
  ...over,
});

const yaml = (...lines) => lines.join("\n");

/** The file as someone would write it, for one routine. */
const fileFor = (r) =>
  yaml(
    "coordination_repo: " + REPO,
    "routines:",
    `  - title: ${r.title}`,
    `    project: ${r.project}`,
    `    goal: ${r.goal}`,
    `    acceptance: ${r.acceptance}`,
    ...(r.enabled === false ? ["    enabled: false"] : []),
    ...(r.priority ? [`    priority: ${r.priority}`] : []),
  );

beforeEach(() => reset());

// ---- PROTOCOL §2 ----------------------------------------------------------

test("a complete routine has nothing wrong with it", () => {
  assert.deepEqual(validate(routine(), 0, new Set()), []);
});

test("§2: a routine with no goal is reported", () => {
  assert.deepEqual(validate(routine({ goal: "" }), 0, new Set()), ['"Prune merged branches": no goal']);
});

test("§2: a routine with no acceptance is reported", () => {
  assert.deepEqual(validate(routine({ acceptance: "" }), 0, new Set()), ['"Prune merged branches": no acceptance']);
});

test("§2: a routine with no project is reported", () => {
  // Without it the task is invisible to every conforming worker.
  assert.deepEqual(validate(routine({ project: "" }), 0, new Set()), ['"Prune merged branches": no project']);
});

test("whitespace is not a value for any of the three", () => {
  for (const field of ["goal", "acceptance", "project"]) {
    const bad = validate(routine({ [field]: "   " }), 0, new Set());
    assert.equal(bad.length, 1, field);
    assert.match(bad[0], new RegExp(`no ${field}$`));
  }
});

test("a missing field and a null one read the same", () => {
  for (const value of [undefined, null]) {
    assert.equal(validate(routine({ goal: value }), 0, new Set()).length, 1);
  }
});

test("a routine with no title is named by its position", () => {
  const bad = validate({ project: "p", goal: "g", acceptance: "a" }, 2, new Set());
  assert.deepEqual(bad, ["routine 3: no title"]);
});

test("every missing field is reported at once, not just the first", () => {
  const bad = validate({}, 0, new Set());
  assert.equal(bad.length, 4);
  assert.match(bad.join(" "), /no title/);
  assert.match(bad.join(" "), /no project/);
  assert.match(bad.join(" "), /no goal/);
  assert.match(bad.join(" "), /no acceptance/);
});

test("the title is the identity, so a duplicate is reported", () => {
  // Two routines sharing one would each show the other's task as its own.
  const seen = new Set(["Prune merged branches"]);
  assert.deepEqual(validate(routine(), 1, seen), ['"Prune merged branches": duplicate title']);
});

test('a title containing "-->" is refused, because it would close the marker', () => {
  const bad = validate(routine({ title: 'Fix the a --> b case' }), 0, new Set());
  assert.deepEqual(bad, ['"Fix the a --> b case": a title cannot contain "-->"']);
});

// ---- the marker -----------------------------------------------------------

test("a body carries its routine's title, and reads back", () => {
  const r = routine();
  assert.deepEqual(markerOf(bodyFor(r)), { title: r.title });
});

test("a title with JSON punctuation in it survives the round trip", () => {
  // The marker is lazy up to the closing `-->`, so a `}` does not cut it short.
  for (const title of ['Fix the {a: 1} case', 'Handle "quotes"', "Drop a } brace", "100% of the time"]) {
    assert.deepEqual(markerOf(bodyFor(routine({ title }))), { title }, title);
  }
});

test("no marker, a broken one, or one without a title reads as none", () => {
  assert.equal(markerOf(""), null);
  assert.equal(markerOf(null), null);
  assert.equal(markerOf("### Goal\n\nnothing to do with routines"), null);
  assert.equal(markerOf("<!-- routine {not json} -->"), null);
  assert.equal(markerOf("<!-- routine {} -->"), null);
  assert.equal(markerOf("<!-- routine {\"title\": 7} -->"), null);
});

test("§2.1: the body uses the headings the issue form produces", () => {
  // Section detection keys on these, so they are a contract, not a style.
  const body = bodyFor(routine());
  assert.match(body, /^### Goal\n\nDelete branches already merged into main\./);
  assert.match(body, /### Acceptance\n\nNo merged branch older than a week remains\./);
});

test("notes are included only when written", () => {
  assert.equal(bodyFor(routine()).includes("### Notes"), false);
  assert.match(bodyFor(routine({ notes: "Careful with release branches." })), /### Notes\n\nCareful with release branches\./);
});

test("§1 and §2: a task is labelled kraken-task and exactly one project", () => {
  assert.deepEqual(labelsFor(routine()), ["kraken-task", "project:chores"]);
});

test("§5.2: a priority is passed through when the routine sets one", () => {
  assert.deepEqual(labelsFor(routine({ priority: "high" })), ["kraken-task", "project:chores", "priority:high"]);
  assert.deepEqual(labelsFor(routine({ priority: "" })), ["kraken-task", "project:chores"]);
});

// ---- reading the file -----------------------------------------------------

test("with no file at all, one row points at the gear", async () => {
  const { items, meta } = await load();
  assert.equal(items.length, 1);
  assert.equal(items[0].state, "invalid");
  assert.equal(items[0].key, "no-file");
  assert.equal(meta.repo, null);
});

test("with no queue to open tasks in, it says which two places can name one", async () => {
  host.files.set(FILE, yaml("routines:", "  - title: One", "    project: p", "    goal: g", "    acceptance: a"));
  const { items, meta } = await load();
  assert.deepEqual(items, []);
  assert.match(meta.problems.join(" "), /no queue: set `coordination_repo`/);
  assert.deepEqual(host.exec, []);
});

test("the queue falls back to the repo Kraken Tasks is watching", async () => {
  host.shared.set("cockpit.issues.repo", "acme/fallback");
  host.files.set(FILE, yaml("routines:", "  - title: One", "    project: p", "    goal: g", "    acceptance: a"));
  gh([["state=all", []]]);
  assert.equal((await load()).meta.repo, "acme/fallback");
});

test("coordination_repo wins over the Kraken Tasks pick", async () => {
  host.shared.set("cockpit.issues.repo", "acme/fallback");
  host.files.set(FILE, fileFor(routine()));
  gh([["state=all", []]]);
  assert.equal((await load()).meta.repo, REPO);
});

test("the fallback names the panel it falls back to, so the screen can watch it", () => {
  // Without that, a repo picked in Kraken Tasks reaches this panel only on its
  // own sixty-second clock -- which is a minute of nothing after the one action
  // offered as the way out of a 404.
  assert.equal(repoFrom, "issues");
});

// ---- a queue it cannot reach ----------------------------------------------

// The repo is resolved in here, from a file the screen does not read, and a
// failed request leaves no `meta` to carry it. So it goes out on the error --
// otherwise the panel can only name the repo it holds itself, which for this
// one is none, and says "No access to null".

test("a queue that 404s reports which repo was asked for", async () => {
  host.files.set(FILE, fileFor(routine()));
  gh([["state=all", fails("HTTP 404: Not Found")]]);

  await assert.rejects(load(), (e) => {
    assert.equal(e.kind, "not-found");
    assert.equal(e.repo, REPO);
    // The file named it outright, so no pick anywhere can change it.
    assert.equal(e.repoPanel, null);
    return true;
  });
});

test("a queue that 404s says which pick decides it, when a pick does", async () => {
  host.shared.set("cockpit.issues.repo", "acme/fallback");
  host.files.set(FILE, yaml("routines:", "  - title: One", "    project: p", "    goal: g", "    acceptance: a"));
  gh([["state=all", fails("HTTP 404: Not Found")]]);

  await assert.rejects(load(), (e) => {
    assert.equal(e.repo, "acme/fallback");
    assert.equal(e.repoPanel, "issues");
    return true;
  });
});

test("any other failure carries the repo too, not only a 404", async () => {
  // The panel only draws the repo for "no access", but the error is the one
  // place that knows it either way -- and a `kind` is gh's answer to parse, not
  // something to branch the reporting on here.
  host.files.set(FILE, fileFor(routine()));
  gh([["state=all", fails("could not resolve host")]]);

  await assert.rejects(load(), (e) => {
    assert.equal(e.kind, "error");
    assert.equal(e.repo, REPO);
    return true;
  });
});

test("a routine with nothing in the queue is ready", async () => {
  host.files.set(FILE, fileFor(routine()));
  gh([["state=all", []]]);
  const { items } = await load();
  assert.equal(items.length, 1);
  assert.equal(items[0].state, "ready");
  assert.equal(items[0].open, null);
});

test("a routine whose task is still open is not ready", async () => {
  // Two workers on one goal would deliver the same work twice.
  const r = routine();
  host.files.set(FILE, fileFor(r));
  gh([["state=all", [issue({ number: 5, state: "open", body: bodyFor(r) })]]]);
  const { items } = await load();
  assert.equal(items[0].state, "open");
  assert.equal(items[0].open.number, 5);
});

test("a routine whose last task was closed is ready again, and remembers it", async () => {
  const r = routine();
  host.files.set(FILE, fileFor(r));
  gh([["state=all", [issue({ number: 5, state: "closed", body: bodyFor(r) })]]]);
  const { items } = await load();
  assert.equal(items[0].state, "ready");
  assert.equal(items[0].latest.number, 5);
  assert.equal(items[0].open, null);
});

test("enabled: false is paused rather than ready", async () => {
  host.files.set(FILE, fileFor(routine({ enabled: false })));
  gh([["state=all", []]]);
  assert.equal((await load()).items[0].state, "paused");
});

test("an invalid routine is invalid even with nothing in the queue", async () => {
  host.files.set(FILE, yaml("coordination_repo: " + REPO, "routines:", "  - title: No goal here", "    project: p", "    acceptance: a"));
  gh([["state=all", []]]);
  const { items, meta } = await load();
  assert.equal(items[0].state, "invalid");
  assert.match(items[0].error, /no goal/);
  assert.match(meta.problems.join(" "), /no goal/);
});

test("another routine's task is not mistaken for this one's", async () => {
  const mine = routine({ title: "Mine" });
  const theirs = routine({ title: "Theirs" });
  host.files.set(
    FILE,
    yaml(
      "coordination_repo: " + REPO,
      "routines:",
      "  - title: Mine",
      "    project: p",
      "    goal: g",
      "    acceptance: a",
      "  - title: Theirs",
      "    project: p",
      "    goal: g",
      "    acceptance: a",
    ),
  );
  gh([["state=all", [issue({ number: 9, state: "open", body: bodyFor(theirs) })]]]);
  const { items } = await load();
  assert.equal(items.find((i) => i.title === "Mine").state, "ready");
  assert.equal(items.find((i) => i.title === "Theirs").state, "open");
});

test("an issue with no marker belongs to no routine", async () => {
  host.files.set(FILE, fileFor(routine()));
  gh([["state=all", [issue({ number: 3, state: "open", body: "opened by hand" })]]]);
  assert.equal((await load()).items[0].state, "ready");
});

test("pull requests in the queue are not tasks", async () => {
  const r = routine();
  host.files.set(FILE, fileFor(r));
  gh([["state=all", [{ ...issue({ number: 4, body: bodyFor(r) }), pull_request: { url: "x" } }]]]);
  assert.equal((await load()).items[0].state, "ready");
});

test("an answer that is not a list is an error, not an empty queue", async () => {
  // An empty queue puts every ▶ back, which is the one thing a wrong answer
  // here must not do.
  host.files.set(FILE, fileFor(routine()));
  gh([["state=all", { message: "Not Found" }]]);
  await assert.rejects(load(), /Unexpected response from GitHub/);
});

// ---- the button -----------------------------------------------------------

test("▶ opens a task carrying §2's body and labels", async () => {
  const r = routine({ title: "Opens a task", priority: "high" });
  host.files.set(FILE, fileFor(r));
  gh([
    ["POST", issue({ number: 77, body: bodyFor(r) })],
    ["state=all", []],
  ]);
  const { items } = await load();
  await act(items[0]);

  const post = apiCalls().find((c) => c.args.includes("POST"));
  assert.ok(post, "no issue was opened");
  assert.ok(post.args.includes(`repos/${REPO}/issues`));
  assert.ok(post.args.includes(`title=${r.title}`));
  assert.ok(post.args.includes("labels[]=kraken-task"));
  assert.ok(post.args.includes("labels[]=project:chores"));
  assert.ok(post.args.includes("labels[]=priority:high"));
  const body = post.args.find((a) => String(a).startsWith("body="));
  assert.match(body, /### Goal/);
  assert.match(body, /### Acceptance/);
  assert.match(body, /<!-- routine /);
});

test("▶ tells the other panels the queue changed", async () => {
  const r = routine({ title: "Signals the others" });
  host.files.set(FILE, fileFor(r));
  gh([["POST", issue({ number: 78, body: bodyFor(r) })], ["state=all", []]]);
  const { items } = await load();
  await act(items[0]);
  assert.deepEqual(host.run.map((c) => c.name), ["personal-cockpit.refresh"]);
});

test("a routine that is not ready opens nothing", async () => {
  // The guard against two workers on one goal. Removing it has to fail here.
  for (const state of ["open", "paused", "invalid"]) {
    reset();
    gh([["POST", issue({ number: 1 })]]);
    await act({ state, title: "x", def: routine(), repo: REPO, key: "k" });
    assert.deepEqual(apiCalls(), [], `state ${state} should not open a task`);
    assert.deepEqual(host.run, [], `state ${state} should signal nothing`);
  }
});

test("a routine with no definition or no queue opens nothing", async () => {
  gh([["POST", issue({ number: 1 })]]);
  await act({ state: "ready", title: "x", def: null, repo: REPO, key: "k" });
  await act({ state: "ready", title: "x", def: routine(), repo: null, key: "k" });
  assert.deepEqual(apiCalls(), []);
});

test("a task just opened holds the button down until the list catches up", async () => {
  // GitHub takes a few seconds to include a new issue in `GET /issues`. In that
  // window a load correctly finds nothing and would put ▶ straight back --
  // which is how two tasks were once opened three seconds apart.
  const r = routine({ title: "Read after write" });
  host.files.set(FILE, fileFor(r));
  gh([["POST", issue({ number: 90, state: "open", body: bodyFor(r) })], ["state=all", []]]);

  const first = await load();
  assert.equal(first.items[0].state, "ready");
  await act(first.items[0]);

  // The list still does not have it.
  const second = await load();
  assert.equal(second.items[0].state, "open", "the button came back too early");
  assert.equal(second.items[0].open.number, 90);

  // Once the list agrees, the held copy is dropped and the real one stands.
  gh([["state=all", [issue({ number: 90, state: "open", body: bodyFor(r) })]]]);
  const third = await load();
  assert.equal(third.items[0].state, "open");
  assert.equal(third.items[0].open.number, 90);
});

// ---- the groups -----------------------------------------------------------

const item = (over = {}) => ({ state: "ready", open: null, title: "t", key: "k", ...over });

test("the groups are in reading order and empty ones are dropped", () => {
  const items = [item({ state: "ready" }), item({ state: "open" }), item({ state: "paused" }), item({ state: "invalid" })];
  assert.deepEqual(
    sections(items).map((s) => s.label),
    ["Needs you", "In the queue", "Ready", "Paused"],
  );
});

test("a task parked on a human needs you, wherever it is in the queue", () => {
  for (const name of ["needs-decision", "awaiting-merge"]) {
    const items = [item({ state: "open", open: { labels: [name] } })];
    assert.deepEqual(sections(items).map((s) => s.label), ["Needs you"], name);
    assert.equal(attention(items), 1);
  }
});

test("a task with other labels is just in the queue", () => {
  const items = [item({ state: "open", open: { labels: ["kraken-task", "project:chores"] } })];
  assert.deepEqual(sections(items).map((s) => s.label), ["In the queue"]);
  assert.equal(attention(items), 0);
});

test("an invalid routine needs you", () => {
  assert.equal(attention([item({ state: "invalid" })]), 1);
});

test("a routine is in exactly one group", () => {
  const items = [
    item({ state: "invalid", key: "a" }),
    item({ state: "open", key: "b", open: { labels: [] } }),
    item({ state: "open", key: "c", open: { labels: ["needs-decision"] } }),
    item({ state: "ready", key: "d" }),
    item({ state: "paused", key: "e" }),
  ];
  const shown = sections(items).flatMap((s) => s.items.map((i) => i.key));
  assert.deepEqual(shown.sort(), ["a", "b", "c", "d", "e"]);
});

test("the header says which queue, and counts the problems", () => {
  assert.equal(stampNote({ repo: REPO }), REPO);
  assert.equal(stampNote({}), null);
  assert.equal(footnote({ problems: [] }), null);
  assert.equal(footnote({ problems: ["one thing"] }), "one thing");
  assert.match(footnote({ problems: ["a", "b"] }), /^2 problems in routines\.yml$/);
});

test("a row builds in every state", () => {
  const cases = [
    item({ state: "ready" }),
    item({ state: "open", open: { number: 1, labels: ["needs-decision"], comments: 2 }, url: "https://x/1" }),
    item({ state: "paused" }),
    item({ state: "invalid", error: "no goal" }),
    item({ state: "ready", detail: "project:chores", latest: { number: 9, created_at: minutesAgo(90), comments: 0, labels: [] } }),
  ];
  for (const one of cases) {
    assert.doesNotThrow(
      () => rowOf(theme(), one, { selected: false, wide: true, onClick: () => {}, onAction: () => {} }),
      one.state,
    );
    assert.doesNotThrow(() =>
      rowOf(theme(), one, { selected: true, wide: false, acting: true, onClick: () => {}, onAction: () => {} }),
    );
  }
});
