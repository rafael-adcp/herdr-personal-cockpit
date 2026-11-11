// Jira is docked, folded and railed by the list screen, like every other panel:
// it has no header, no shell and no layout code of its own to keep in step.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as dock from "../mods/personal-cockpit/kit/dock.js";
import { List } from "../mods/personal-cockpit/screens/list.js";
import { host, reset } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { handlerOf, textOf } from "./support/element.js";

const block = (id = "jira-tickets") => ({ id, type: "block", content: { mod: "personal-cockpit", props: { kind: "jira", node: id } }, size: { px: 150 }, min: 42 });
const tree = () => ({ id: "root", children: [
  { id: "left", children: [{ id: "spaces", content: { mod: "spaces" } }] },
  { id: "work", children: [{ id: "main", content: { tab: "active" } },
    { id: "right-lists", size: { px: 430 }, children: [block()] }] },
] });
const byId = (element, id) => {
  const node = element.__node ?? element;
  if (node.calls.some((c) => c.name === "id" && c.args[0] === id)) return node;
  for (const child of node.kids) { const found = byId(child, id); if (found) return found; }
};
beforeEach(() => reset({ layout: tree() }));

/** The Jira panel, as a layout block with these props would run it. */
function panel(options, props = { kind: "jira" }) {
  host.props = props;
  const context = cx(options);
  return { context, list: new List({}, context) };
}

test("Jira draws no chrome and holds no layout code of its own, and has no separate mod or duplicated layout", () => {
  const source = readFileSync(new URL("../mods/personal-cockpit/jira/jira.js", import.meta.url), "utf8");
  // A row is the one thing a source draws. The header, the rail, the shell and
  // everything in dock.js belong to list.js, which is the point of being one.
  assert.doesNotMatch(source, /\bfrom "\.\.\/kit\/dock\.js"/);
  assert.doesNotMatch(source, /\b(header|rail|shell|sectionHead)\b\s*[,}(]/);
  assert.doesNotMatch(source, /\bclass\b/);
  assert.ok(!source.includes("mods/jira-tickets/"));
  assert.equal(existsSync(new URL("../mods/jira-tickets", import.meta.url)), false);
  assert.equal(existsSync(new URL("../layouts/cockpit-jira.json", import.meta.url)), false);
});

test("the shared header moves Jira without folding it or touching terminals", () => {
  const { context, list } = panel();
  const initial = structuredClone(host.layout);
  handlerOf(byId(list.render(context), "cockpit-jira-move"), "on_click")({}, context);
  assert.equal(context.stopped, 1);
  assert.deepEqual(host.layout, initial);
  assert.equal(host.run.length, 1); assert.equal(host.run[0].name, "layout.set");
  host.layout = host.run[0].props.layout;
  assert.equal(dock.find(host.layout, "right-lists").hidden, true);
  assert.equal(dock.find(host.layout, "right-lists").size.px, 430);
  assert.equal(dock.placeOf(host.layout, list.host()), "sidebar");
  handlerOf(byId(list.render(context), "cockpit-jira-move"), "on_click")({}, context);
  host.layout = host.run[1].props.layout;
  assert.equal(dock.placeOf(host.layout, list.host()), "right");
  assert.equal(dock.find(host.layout, "right-lists").hidden, false);
  host.layout = { id: "root" }; assert.equal(byId(list.render(context), "cockpit-jira-move"), undefined);
  list.move("right"); assert.equal(host.run.length, 2);
});

test("Jira finds its host by kind or explicit node, including renamed blocks", () => {
  const { list } = panel();
  assert.equal(list.host().id, "jira-tickets");
  const right = dock.find(host.layout, "right-lists"); right.children.push(block("another"));
  const { list: other } = panel(undefined, { kind: "jira", node: "another" });
  assert.equal(other.host().id, "another");
  other.move("sidebar"); host.layout = host.run.at(-1).props.layout;
  assert.equal(dock.placeOf(host.layout, dock.find(host.layout, "another")), "sidebar");
  assert.equal(dock.placeOf(host.layout, dock.find(host.layout, "jira-tickets")), "right");
});

test("Jira uses the same narrow rail as the other Cockpit panels", () => {
  const { context, list } = panel();
  handlerOf(list.render(context), "on_size_change")({ width: 100 }, context);
  assert.equal(byId(list.render(context), "cockpit-jira-header"), undefined);
  assert.equal(byId(list.render(context), "cockpit-jira-list"), undefined);
  assert.ok(!textOf(list.render(context)).includes("Loading Jira tickets…"));
});

test("Jira-specific commands reuse docking and ignore other panels' configure commands", async () => {
  host.onExec = () => ({ code: 0, stdout: '{"items":[]}' });
  const { context } = panel({ spawn: "run" }); await context.settle();
  host.deliver("jira-move-left"); await context.settle(); assert.equal(host.run.at(-1).name, "layout.set");
  host.layout = host.run.at(-1).props.layout;
  host.deliver("jira-move-right"); await context.settle(); assert.equal(host.run.length, 2);
  host.deliver("configure"); await context.settle(); assert.equal(host.overlays.length, 0);
  host.deliver("jira-refresh"); await context.settle(); assert.equal(host.exec.length, 2);
});

test("the GitHub panels do not answer Jira's commands", async () => {
  // A mod command reaches every copy on screen. These are named for Jira so
  // that moving or reconfiguring it does not move or reconfigure the rest.
  const { context } = panel({ spawn: "run" }, { kind: "pulls" }); await context.settle();
  const polls = host.exec.length;
  for (const command of ["jira-move-left", "jira-move-right", "jira-configure", "jira-refresh"]) {
    host.deliver(command); await context.settle();
  }
  assert.equal(host.run.length, 0); assert.equal(host.overlays.length, 0); assert.equal(host.exec.length, polls);
});
