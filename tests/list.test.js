// list.js: the screen that runs whichever panel it was given.
//
// It knows nothing about pull requests or issues -- it asks `this.source` for a
// list and for a row, which is what makes the four panels one file instead of
// four. So these tests are about the orchestration: which source was chosen,
// what happens to a list when a poll fails, and the guards that stop two loads
// or two button presses overlapping.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { List } from "../mods/personal-cockpit/screens/list.js";
import { shareKey } from "../mods/personal-cockpit/kit/urgent.js";
import { host, reset, theme } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { gh, apiCalls, fails } from "./support/gh.js";
import { handlerOf, textOf } from "./support/element.js";
import { tree, panelBlock, prNode, issue } from "./support/factories.js";

const view = {};

/** The answers the pull requests panel needs. */
const pullsAnswer = (nodes = [prNode({})]) =>
  gh([["pullRequests", { data: { viewer: { login: "rafael", pullRequests: { totalCount: nodes.length, nodes } } } }]]);

/** The answers the tasks panel needs. */
const issuesAnswer = (items = [issue({})]) =>
  gh([
    ["ISSUE_TEMPLATE", []],
    ["state=open", items],
  ]);

beforeEach(() => {
  reset();
  host.layout = tree({ sidebar: [panelBlock("pulls")] });
  localStorage.clear();
});

// ---- which panel am I -----------------------------------------------------

test("the kind in the layout chooses the source", () => {
  for (const [kind, panel] of [["pulls", "pulls"], ["issues", "issues"], ["routines", "routines"], ["team", "team"]]) {
    reset();
    host.props = { kind };
    assert.equal(new List(view, cx()).source.panel, panel, kind);
  }
});

test("an unknown or missing kind is the pull requests panel", () => {
  assert.equal(new List(view, cx()).source.panel, "pulls");
  host.props = { kind: "nonsense" };
  assert.equal(new List(view, cx()).source.panel, "pulls");
});

test("the remembered height is keyed by the panel, so each keeps its own", () => {
  host.props = { kind: "team" };
  assert.equal(new List(view, cx()).heightKey, "cockpit.team.height");
  host.props = { kind: "pulls" };
  assert.equal(new List(view, cx()).heightKey, "cockpit.pulls.height");
});

test("a layout can name the block and pin an issue form outright", () => {
  host.props = { kind: "issues", node: "work-issues", template: "task.yml" };
  const list = new List(view, cx());
  assert.equal(list.node, "work-issues");
  assert.equal(list.template, "task.yml");
});

test("with no props, nothing is pinned", () => {
  const list = new List(view, cx());
  assert.equal(list.node, null);
  assert.equal(list.template, null);
});

// ---- opening the panel ----------------------------------------------------

test("a panel takes the keyboard handle and polls at its source's interval", () => {
  host.props = { kind: "team" };
  const context = cx();
  const list = new List(view, context);
  assert.equal(context.focused >= 0, true);
  assert.deepEqual(context.timers.map((t) => t.ms), [list.source.refreshMs]);
  assert.equal(list.source.refreshMs, 120000);
});

test("a repo-keyed panel opens on its cached list rather than a blank box", () => {
  host.props = { kind: "issues" };
  host.shared.set("cockpit.issues.repo", "acme/tasks");
  localStorage.setItem("cockpit.issues:acme/tasks", JSON.stringify({ items: [issue({ number: 3 })], at: 99 }));

  const list = new List(view, cx());
  assert.equal(list.state, "ok");
  assert.equal(list.items[0].number, 3);
  assert.equal(list.fetchedAt, 99);
});

test("a panel with no repo chosen asks for one instead of loading", async () => {
  host.props = { kind: "issues" };
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "no-repo");
  assert.deepEqual(apiCalls(), [], "it went to GitHub with no repo");
});

test("a panel that needs no repo loads straight away", async () => {
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "ok");
  assert.equal(list.items.length, 1);
  assert.ok(list.fetchedAt > 0);
});

test("a load writes the cache for a panel that has one", async () => {
  host.props = { kind: "issues" };
  host.shared.set("cockpit.issues.repo", "acme/tasks");
  issuesAnswer([issue({ number: 12 })]);
  const context = cx({ spawn: "run" });
  new List(view, context);
  await context.settle();
  const saved = JSON.parse(localStorage.getItem("cockpit.issues:acme/tasks"));
  assert.equal(saved.items[0].number, 12);
});

// ---- when a poll fails ----------------------------------------------------

test("one failed poll does not blank a list that was right a moment ago", async () => {
  // A dropped connection or a TLS timeout. The list is kept and called old.
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "ok");

  host.onExec = () => ({ code: 1, stdout: "", stderr: "could not resolve host" });
  await context.tick(list.source.refreshMs);

  assert.equal(list.state, "ok", "the good list was thrown away");
  assert.equal(list.items.length, 1);
  assert.match(list.stale, /could not resolve host/);
});

test("a fresh panel with nothing to keep shows the error", async () => {
  host.props = { kind: "pulls" };
  host.onExec = () => ({ code: 1, stdout: "", stderr: "could not resolve host" });
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "error");
  assert.match(list.error, /could not resolve host/);
  assert.equal(list.stale, null);
});

test("a login problem replaces the list, because the fix is a button", async () => {
  // Unlike a dropped connection: no amount of waiting fixes this one, so the
  // panel has to stop showing a list and offer the sign-in.
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "ok");

  host.onExec = () => ({ code: 1, stdout: "", stderr: "HTTP 401: Bad credentials" });
  await context.tick(list.source.refreshMs);

  assert.equal(list.state, "no-auth");
  assert.equal(list.stale, null);
});

test("every kind of failure reaches the panel under its own name", async () => {
  for (const [stderr, state] of [
    ["HTTP 401: Bad credentials", "no-auth"],
    ["HTTP 404: Not Found", "not-found"],
    ["HTTP 500: Server Error", "error"],
  ]) {
    reset();
    host.props = { kind: "pulls" };
    host.onExec = () => ({ code: 1, stdout: "", stderr });
    const context = cx({ spawn: "run" });
    const list = new List(view, context);
    await context.settle();
    assert.equal(list.state, state, stderr);
  }
});

test("a poll already in flight is not started again", async () => {
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);

  // The constructor's load has not settled yet.
  list.refresh(context);
  list.refresh(context);
  await context.settle();

  assert.equal(apiCalls().length, 1, "the panel polled while it was already polling");
});

test("a refresh asked for mid-poll runs once when that poll lands, however often it was asked", async () => {
  // The timer's own tick is dropped while a load is in flight -- another is
  // coming. A request is somebody saying the world changed, after that load
  // had already started reading it.
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);

  list.requestRefresh(context);
  list.requestRefresh(context);
  assert.equal(list.pending, true);
  await context.settle();

  assert.equal(apiCalls().length, 2);
  assert.equal(list.pending, false);
  assert.equal(list.busy, false);
});

test("the cursor stays on its row when a reload moves it", async () => {
  host.props = { kind: "pulls" };
  const pr = (number) => prNode({ number, url: `https://github.com/acme/app/pull/${number}` });
  pullsAnswer([pr(1), pr(2), pr(3)]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  list.at = 2;
  const held = list.strip().pickable[2].url;
  assert.equal(held, pr(3).url);

  // GitHub answers newest first, and the one under the cursor was just pushed to.
  pullsAnswer([pr(3), pr(1), pr(2)]);
  list.refresh(context);
  await context.settle();

  assert.equal(list.at, 0);
  assert.equal(list.strip().pickable[list.at].url, held);
});

// ---- publishing to the drawer ---------------------------------------------

// The drawer is another copy of this mod and cannot see this one's items, so a
// panel leaves its urgent rows in shared state for it to read (urgent.js). The
// rule is that it publishes exactly what it is showing -- so these are about
// the states where "what it is showing" is not a list.

const published = (panel) => host.shared.get(shareKey(panel));

test("a load publishes the panel's urgent rows for the drawer", async () => {
  host.props = { kind: "pulls" };
  pullsAnswer([prNode({ mergeable: "CONFLICTING" })]);
  const context = cx({ spawn: "run" });
  new List(view, context);
  await context.settle();

  assert.equal(published("pulls").length, 1);
  assert.equal(published("pulls")[0].reason, "conflicts");
});

test("a panel with nothing urgent publishes an empty list, not nothing at all", async () => {
  // The difference matters: the drawer has to be able to tell "this panel has
  // no trouble" from "this panel has never run".
  host.props = { kind: "pulls" };
  pullsAnswer([prNode({})]);
  const context = cx({ spawn: "run" });
  new List(view, context);
  await context.settle();

  assert.deepEqual(published("pulls"), []);
});

test("a panel that cannot load publishes nothing", async () => {
  // Its own trouble is said in its own header, where the button that fixes it
  // is. The drawer is for work waiting on you.
  host.props = { kind: "pulls" };
  host.onExec = () => ({ code: 1, stdout: "", stderr: "gh: not logged in" });
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  assert.equal(list.state, "no-auth");
  assert.deepEqual(published("pulls"), []);
});

test("a panel with no repo chosen publishes nothing, so old rows do not linger", async () => {
  // The early return in `refresh` never reaches a load, which is exactly where
  // a stale list would have been left behind.
  host.props = { kind: "issues" };
  host.shared.set(shareKey("issues"), [{ key: "issues:1", verb: "decide", title: "old", reason: "x", url: null, at: 1 }]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  assert.equal(list.state, "no-repo");
  assert.deepEqual(published("issues"), []);
});

test("a failed refresh over a good list keeps publishing it", async () => {
  // The panel keeps the list and calls it old, so the drawer keeps the rows
  // and is old in exactly the same way. One of them going blank while the
  // other did not would be the two disagreeing.
  host.props = { kind: "pulls" };
  pullsAnswer([prNode({ mergeable: "CONFLICTING" })]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(published("pulls").length, 1);

  host.onExec = () => ({ code: 1, stdout: "", stderr: "could not resolve host" });
  await context.tick(list.source.refreshMs);

  assert.match(list.stale, /could not resolve host/);
  assert.equal(published("pulls").length, 1);
});

test("each panel publishes under its own key", async () => {
  // Shared with the remembered height and the chosen repo: one key per panel,
  // or two panels would overwrite each other's rows.
  const keys = ["pulls", "issues", "routines", "team"].map(shareKey);
  assert.equal(new Set(keys).size, keys.length, keys.join(", "));
  assert.deepEqual(keys[0], "cockpit.pulls.urgent");
});

// ---- the repo changing under it -------------------------------------------

test("a new repo clears the old list and loads the new one", async () => {
  host.props = { kind: "issues" };
  host.shared.set("cockpit.issues.repo", "acme/one");
  issuesAnswer([issue({ number: 1 })]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.items[0].number, 1);

  list.repo = "acme/two";
  issuesAnswer([issue({ number: 2 })]);
  list.reload(context);
  await context.settle();
  assert.equal(list.items[0].number, 2);
});

test("losing the repo altogether asks for one again", () => {
  host.props = { kind: "issues" };
  host.shared.set("cockpit.issues.repo", "acme/one");
  const list = new List(view, cx());
  list.repo = null;
  list.reload(cx());
  assert.equal(list.state, "no-repo");
  assert.deepEqual(list.items, []);
});

// ---- a row's own button ---------------------------------------------------

test("a panel whose source has no button does nothing when pressed", async () => {
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  const before = apiCalls().length;
  list.act({ key: "k" }, context);
  await context.settle();
  assert.equal(apiCalls().length, before);
});

test("the spinner stays on the pressed row until the new list lands", async () => {
  // Clearing it when the work finished would put the button back for the length
  // of one round trip, on a row that still describes the old world.
  host.props = { kind: "routines" };
  host.files.set("/herdr/mods/personal-cockpit/routines.yml", [
    "coordination_repo: acme/tasks",
    "routines:",
    "  - title: Prune",
    "    project: chores",
    "    goal: g",
    "    acceptance: a",
  ].join("\n"));
  gh([
    ["POST", issue({ number: 50, body: '<!-- routine {"title":"Prune"} -->' })],
    ["state=all", []],
  ]);

  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.items[0].state, "ready");

  list.act(list.items[0], context);
  assert.equal(list.acting, list.items[0].key, "the row did not show it was working");

  await context.settle();
  assert.equal(list.acting, null, "the spinner outlived the refresh");
  assert.equal(list.done.key, list.items[0].key);
});

// A routine that ▶ was pressed on is remembered in routines.js for the life of
// the process, to paper over GitHub's read-after-write lag. `reset()` cannot
// clear that, so a test about pressing ▶ needs a title no other test has used
// -- otherwise the routine arrives already "open" and the button does nothing.
test("a button that failed says so on the row, not as a dead panel", async () => {
  host.props = { kind: "routines" };
  host.files.set("/herdr/mods/personal-cockpit/routines.yml", [
    "coordination_repo: acme/tasks",
    "routines:",
    "  - title: Tidy the changelog",
    "    project: chores",
    "    goal: g",
    "    acceptance: a",
  ].join("\n"));
  gh([
    ["POST", () => ({ code: 1, stdout: "", stderr: "HTTP 403: Forbidden" })],
    ["state=all", []],
  ]);

  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  list.act(list.items[0], context);
  await context.settle();

  assert.match(list.acted, /Forbidden/);
  assert.equal(list.state, "ok", "a failed button must not blank the list");
});

// ---- the gear -------------------------------------------------------------

test("the gear of a panel with its own settings opens its file", async () => {
  host.props = { kind: "team" };
  host.files.set("/herdr/mods/personal-cockpit/team.yml", "query: org:acme\n");
  gh([
    ["viewer { login }", { data: { viewer: { login: "rafael" } } }],
    ["search(", { data: { search: { issueCount: 0, nodes: [] } } }],
  ]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  list.configureWith(context);
  await context.settle();
  assert.ok(host.exec.some((call) => call.command === "xdg-open"));
});

test("the gear of the repo-keyed panel opens the picker as an overlay", () => {
  host.props = { kind: "issues" };
  const list = new List(view, cx());
  list.configure();
  assert.equal(host.overlays.length, 1);
  assert.equal(host.overlays[0].mod, "personal-cockpit");
  assert.equal(host.overlays[0].props.kind, "repo-picker");
  assert.equal(host.overlays[0].props.panel, "issues");
});

// ---- the way out of "no access" -------------------------------------------

// A 404 is GitHub's answer for a repo that is not there *and* for one this login
// cannot see, so the screen cannot resolve it -- a person has to. These are
// about it naming the right repo and offering the one thing that changes it.

const ROUTINES_FILE = "/herdr/mods/personal-cockpit/routines.yml";

/** A routines file for one valid routine, with or without a named queue. */
const routinesFile = (queue) =>
  [
    ...(queue ? [`coordination_repo: ${queue}`] : []),
    "routines:",
    "  - title: One",
    "    project: p",
    "    goal: g",
    "    acceptance: a",
  ].join("\n");

/** A panel left in "no access", and the screen it draws for it. */
async function noAccess(kind, context) {
  host.props = { kind };
  // Every request about the repo, so this covers the issue list of either
  // panel and the template lookup that follows one of them.
  gh([["repos/", fails("HTTP 404: Not Found")]]);
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "not-found", `${kind} did not reach "no access"`);
  return { list, screen: list.setup(theme()) };
}

test("a panel that watches a repo names its own, and offers its own picker", async () => {
  host.shared.set("cockpit.issues.repo", "acme/gone");
  const context = cx({ spawn: "run" });
  const { screen } = await noAccess("issues", context);

  assert.match(textOf(screen).join(" "), /No access to acme\/gone/);
  handlerOf(screen, "on_click")({}, context);
  assert.equal(host.overlays[0].props.panel, "issues");
  assert.equal(host.overlays[0].props.current, "acme/gone");
});

test("Routines names the repo its request was for, not the none it holds itself", async () => {
  // `this.repo` is null for a panel whose source finds its own repo, which is
  // what used to be interpolated here: "No access to null".
  host.files.set(ROUTINES_FILE, routinesFile("acme/inaccessible"));
  const { list, screen } = await noAccess("routines", cx({ spawn: "run" }));
  assert.equal(list.repo, null);
  assert.match(textOf(screen).join(" "), /No access to acme\/inaccessible/);
});

test("a queue named in routines.yml offers that file, not a picker nothing reads", async () => {
  // The picker writes `cockpit.routines.repo`, which the routines loader never
  // looks at: with an explicit `coordination_repo` it is a dialog that asks a
  // question and throws the answer away.
  host.files.set(ROUTINES_FILE, routinesFile("acme/inaccessible"));
  const context = cx({ spawn: "run" });
  const { screen } = await noAccess("routines", context);

  assert.ok(textOf(screen).includes("Open routines.yml"), textOf(screen).join(" "));
  handlerOf(screen, "on_click")({}, context);
  await context.settle();

  assert.deepEqual(host.overlays, [], "a picker cannot change a repo the file names");
  assert.ok(host.exec.some((call) => call.command === "xdg-open"), "the file was not opened");
});

test("a queue inherited from Kraken Tasks offers a picker that writes that panel's key", async () => {
  host.shared.set("cockpit.issues.repo", "acme/fallback");
  host.files.set(ROUTINES_FILE, routinesFile(null));
  const context = cx({ spawn: "run" });
  const { screen } = await noAccess("routines", context);

  assert.match(textOf(screen).join(" "), /No access to acme\/fallback/);
  handlerOf(screen, "on_click")({}, context);

  assert.equal(host.overlays.length, 1);
  assert.equal(host.overlays[0].props.panel, "issues", "the pick would have gone where nothing reads it");
  assert.equal(host.overlays[0].props.current, "acme/fallback");
});

test("a repo picked in Kraken Tasks reloads Routines, rather than leaving it a poll behind", async () => {
  // The other half of offering that picker: a minute of the same 404 after
  // choosing an accessible queue reads as the button having done nothing.
  host.shared.set("cockpit.issues.repo", "acme/one");
  host.files.set(ROUTINES_FILE, routinesFile(null));
  host.props = { kind: "routines" };
  gh([["state=all", []]]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.meta.repo, "acme/one");

  host.shared.set("cockpit.issues.repo", "acme/two");
  list.render(context);
  await context.tick(0);

  assert.equal(list.meta.repo, "acme/two");
  assert.equal(list.state, "ok", "a panel that needs no repo must not ask for one");
});

// ---- commands the app sends -----------------------------------------------

// A mod command reaches every copy on screen. That is what makes `refresh`
// worth sending and what makes anything that opens a window need a guard.

/** Start a panel and let its command loop park on `nextCommand()`. */
async function running(kind, context) {
  host.props = { kind };
  const list = new List(view, context);
  await context.settle();
  return list;
}

test("the kit command opens the chrome gallery", async () => {
  const context = cx({ spawn: "run" });
  pullsAnswer();
  await running("pulls", context);

  host.deliver("kit");
  await context.settle();

  assert.equal(host.overlays.length, 1);
  assert.equal(host.overlays[0].props.kind, "kit");
  assert.equal(host.overlays[0].mod, "personal-cockpit");
});

test("only one panel answers the kit command, so one gallery opens and not four", async () => {
  // All four are on screen in the shipped layout and all four get the command.
  // Without the guard this is four identical dialogs stacked on each other.
  for (const kind of ["issues", "routines", "team"]) {
    reset();
    host.layout = tree({ sidebar: [panelBlock(kind)] });
    const context = cx({ spawn: "run" });
    await running(kind, context);

    host.deliver("kit");
    await context.settle();

    assert.deepEqual(host.overlays, [], `${kind} should have ignored it`);
  }
});

test("refresh, by contrast, is answered by every copy", async () => {
  // The other half of the same rule: a routine opening a task sends this so
  // that the tasks panel does not sit a minute behind what just happened.
  const context = cx({ spawn: "run" });
  pullsAnswer();
  const list = await running("pulls", context);
  const before = apiCalls().length;

  host.deliver("refresh");
  await context.settle();

  assert.ok(apiCalls().length > before, "the panel did not reload");
  assert.equal(list.state, "ok");
});

// ---- drawing --------------------------------------------------------------

test("the panel renders in every state it can be in", async () => {
  for (const kind of ["pulls", "issues", "routines", "team"]) {
    for (const state of ["loading", "ok", "no-repo", "no-gh", "no-auth", "not-found", "error"]) {
      reset();
      host.layout = tree({ sidebar: [panelBlock(kind)] });
      host.props = { kind };
      const context = cx();
      const list = new List(view, context);
      list.state = state;
      list.error = "something went wrong";
      assert.doesNotThrow(() => list.render(context), `${kind} in ${state}`);
    }
  }
});

test("the panel renders a list, a stale list and a failed button", async () => {
  host.props = { kind: "pulls" };
  pullsAnswer([prNode({ number: 1 }), prNode({ number: 2, isDraft: true })]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  assert.doesNotThrow(() => list.render(context));
  list.stale = "could not resolve host";
  assert.doesNotThrow(() => list.render(context));
  list.acted = "HTTP 403: Forbidden";
  assert.doesNotThrow(() => list.render(context));
  list.at = 1;
  assert.doesNotThrow(() => list.render(context));
});

test("the panel renders minimised, narrow and docked right", async () => {
  host.props = { kind: "pulls", node: "pulls" };
  pullsAnswer();

  for (const layout of [
    tree({ sidebar: [panelBlock("pulls", { size: { px: 42 } })] }),
    tree({ sidebarPx: 100, sidebar: [panelBlock("pulls")] }),
    tree({ right: { id: "right-lists", type: "column", size: { px: 380 }, children: [panelBlock("pulls")] } }),
  ]) {
    host.layout = layout;
    const context = cx({ spawn: "run" });
    const list = new List(view, context);
    await context.settle();
    assert.doesNotThrow(() => list.render(context));
  }
});
