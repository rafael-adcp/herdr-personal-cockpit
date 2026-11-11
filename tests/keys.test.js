// The keys a focused panel handles, with no binding needed.
//
// The README documents these as a table, which makes them a promise. The
// handler is built into an element and handed to the app, so pressing a key in
// a test means reaching the function that was wired -- there is no other way
// in, and until now nothing pressed any of them.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { List } from "../mods/personal-cockpit/screens/list.js";
import { host, reset } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { gh, apiCalls } from "./support/gh.js";
import { handlerOf } from "./support/element.js";
import { tree, panelBlock, prNode, issue } from "./support/factories.js";

const view = {};

const pullsAnswer = (nodes) =>
  gh([["pullRequests", { data: { viewer: { login: "rafael", pullRequests: { totalCount: nodes.length, nodes } } } }]]);

/** A loaded pull requests panel, and the key handler it wired. */
async function panel(nodes = [prNode({ number: 1 }), prNode({ number: 2 }), prNode({ number: 3 })]) {
  host.props = { kind: "pulls" };
  pullsAnswer(nodes);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  const drawn = list.render(context);
  return { list, context, press: handlerOf(drawn, "on_key_down"), drawn };
}

beforeEach(() => {
  reset();
  host.layout = tree({ sidebar: [panelBlock("pulls")] });
  localStorage.clear();
});

// ---- moving the selection -------------------------------------------------

test("down and up move the selection", async () => {
  const { list, context, press } = await panel();
  assert.equal(list.at, 0);
  press({ key: "down" }, context);
  assert.equal(list.at, 1);
  press({ key: "down" }, context);
  assert.equal(list.at, 2);
  press({ key: "up" }, context);
  assert.equal(list.at, 1);
});

test("the selection wraps at both ends", async () => {
  const { list, context, press } = await panel();
  press({ key: "up" }, context);
  assert.equal(list.at, 2, "up from the first row should wrap to the last");
  press({ key: "down" }, context);
  assert.equal(list.at, 0, "down from the last row should wrap to the first");
});

test("moving the selection redraws and goes no further", async () => {
  const { context, press } = await panel();
  const before = context.notifies;
  press({ key: "down" }, context);
  assert.ok(context.notifies > before, "the panel did not redraw");
  assert.ok(context.stopped > 0, "the key was passed on as well as handled");
});

test("an empty list has nothing to move, and says so by not stopping the key", async () => {
  const { context, press } = await panel([]);
  press({ key: "down" }, context);
  assert.equal(context.stopped, 0);
});

// ---- opening a row --------------------------------------------------------

test("enter opens the selected row in the browser", async () => {
  // The handler closes over the row selected *when it was built*, so moving the
  // selection and pressing enter on the same handler would open the old row.
  // That is not a bug: moving calls `cx.notify()`, and the app redraws before
  // the next key arrives. The redraw is the part a test has to do itself.
  const { list, context } = await panel([
    prNode({ number: 1, url: "https://github.com/acme/app/pull/1" }),
    prNode({ number: 2, url: "https://github.com/acme/app/pull/2" }),
  ]);

  handlerOf(list.render(context), "on_key_down")({ key: "down" }, context);
  handlerOf(list.render(context), "on_key_down")({ key: "enter" }, context);

  assert.deepEqual(context.opened, ["https://github.com/acme/app/pull/2"]);
});

test("enter on the first row opens it without having to move first", async () => {
  const { context, press } = await panel([prNode({ number: 1, url: "https://github.com/acme/app/pull/1" })]);
  press({ key: "enter" }, context);
  assert.deepEqual(context.opened, ["https://github.com/acme/app/pull/1"]);
});

test("a row with no url opens nothing rather than a broken tab", async () => {
  const { context, press } = await panel([prNode({ number: 1, url: null })]);
  press({ key: "enter" }, context);
  assert.deepEqual(context.opened, []);
});

// ---- refreshing -----------------------------------------------------------

test("r refreshes", async () => {
  const { context, press } = await panel();
  const before = apiCalls().length;
  press({ key: "r" }, context);
  await context.settle();
  assert.equal(apiCalls().length, before + 1);
});

test("r is handled even with an empty list", async () => {
  // The empty-list guard comes after the r/c/n branches, so an empty panel can
  // still be refreshed -- which is the one thing you would want from it.
  const { context, press } = await panel([]);
  const before = apiCalls().length;
  press({ key: "r" }, context);
  await context.settle();
  assert.equal(apiCalls().length, before + 1);
});

// ---- the gear and the pencil ----------------------------------------------

test("c opens the config file of a panel that has one", async () => {
  host.props = { kind: "team" };
  host.files.set("/herdr/mods/personal-cockpit/team.yml", "query: org:acme\n");
  gh([
    ["viewer { login }", { data: { viewer: { login: "rafael" } } }],
    ["search(", { data: { search: { issueCount: 0, nodes: [] } } }],
  ]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  handlerOf(list.render(context), "on_key_down")({ key: "c" }, context);
  await context.settle();
  assert.ok(host.exec.some((call) => call.command === "xdg-open"));
});

// issues.js looks a repo's issue forms up once per repo per run and keeps them
// in the module, so two tests sharing a repo name share its templates -- and
// the second one gets whatever the first one answered. Hence a repo name per
// test below.
test("c opens the repo picker for the panel that needs a repo", async () => {
  host.props = { kind: "issues" };
  host.shared.set("cockpit.issues.repo", "acme/tasks-for-c");
  gh([["ISSUE_TEMPLATE", []], ["state=open", [issue({})]]]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  handlerOf(list.render(context), "on_key_down")({ key: "c" }, context);
  assert.equal(host.overlays.length, 1);
  assert.equal(host.overlays[0].props.kind, "repo-picker");
});

test("c does nothing on a panel with nothing to configure", async () => {
  const { context, press } = await panel();
  press({ key: "c" }, context);
  assert.deepEqual(host.overlays, []);
  assert.equal(context.stopped, 0, "an unhandled key must be passed on");
});

test("n opens the new task form for the repo being watched", async () => {
  host.props = { kind: "issues" };
  host.shared.set("cockpit.issues.repo", "acme/tasks-for-n");
  gh([["ISSUE_TEMPLATE", [{ type: "file", name: "task.yml" }]], ["state=open", [issue({})]]]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  handlerOf(list.render(context), "on_key_down")({ key: "n" }, context);
  assert.deepEqual(context.opened, ["https://github.com/acme/tasks-for-n/issues/new?template=task.yml"]);
});

test("n does nothing on a panel that opens nothing", async () => {
  const { context, press } = await panel();
  press({ key: "n" }, context);
  assert.deepEqual(context.opened, []);
  assert.equal(context.stopped, 0);
});

// ---- keys that are not ours ----------------------------------------------

test("a key the panel does not handle is left for whatever is behind it", async () => {
  const { context, press } = await panel();
  for (const key of ["a", "escape", "tab", "left", "right", "f5"]) {
    press({ key }, context);
  }
  assert.equal(context.stopped, 0, "a key was swallowed that should have been passed on");
});

// ---- the width ------------------------------------------------------------

test("a resize redraws once, and not again at the same width", async () => {
  // Every row reads the width to decide whether it has a second line, so a
  // redraw per resize event would be a redraw per pixel.
  const { context, drawn } = await panel();
  const resize = handlerOf(drawn, "on_size_change");

  const before = context.notifies;
  resize({ width: 300, height: 400 }, context);
  assert.equal(context.notifies, before + 1);

  resize({ width: 300, height: 999 }, context);
  assert.equal(context.notifies, before + 1, "a redraw at a width it already had");

  resize({ width: 301, height: 400 }, context);
  assert.equal(context.notifies, before + 2);
});
