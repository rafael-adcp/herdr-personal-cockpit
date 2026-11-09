// Jira uses the shared panel header/docking implementation, not a local copy.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as dock from "../mods/personal-cockpit/dock.js";
import { Jira } from "../mods/personal-cockpit/jira.js";
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

test("Jira references shared chrome assets and has no separate mod or duplicated layout", () => {
  const source = readFileSync(new URL("../mods/personal-cockpit/jira.js", import.meta.url), "utf8");
  assert.match(source, /import .* from "\.\/kit\.js"/);
  assert.match(source, /import .* from "\.\/dock\.js"/);
  assert.ok(!source.includes("mods/jira-tickets/"));
  assert.ok(!source.includes("const action ="));
  assert.equal(existsSync(new URL("../mods/jira-tickets", import.meta.url)), false);
  assert.equal(existsSync(new URL("../layouts/cockpit-jira.json", import.meta.url)), false);
});

test("the shared header moves Jira without folding it or touching terminals", () => {
  const context = cx(); const screen = new Jira({}, context);
  const initial = structuredClone(host.layout);
  handlerOf(byId(screen.render(context), "jira-move"), "on_click")({}, context);
  assert.equal(context.stopped, 1);
  assert.deepEqual(host.layout, initial);
  assert.equal(host.run.length, 1); assert.equal(host.run[0].name, "layout.set");
  host.layout = host.run[0].props.layout;
  assert.equal(dock.find(host.layout, "right-lists").hidden, true);
  assert.equal(dock.find(host.layout, "right-lists").size.px, 430);
  assert.equal(dock.placeOf(host.layout, screen.host()), "sidebar");
  handlerOf(byId(screen.render(context), "jira-move"), "on_click")({}, context);
  host.layout = host.run[1].props.layout;
  assert.equal(dock.placeOf(host.layout, screen.host()), "right");
  assert.equal(dock.find(host.layout, "right-lists").hidden, false);
  host.layout = { id: "root" }; assert.equal(byId(screen.render(context), "jira-move"), undefined);
  screen.move("right"); assert.equal(host.run.length, 2);
});

test("Jira finds its host by kind or explicit node, including renamed blocks", () => {
  const context = cx(); const screen = new Jira({}, context);
  assert.equal(screen.host().id, "jira-tickets");
  const right = dock.find(host.layout, "right-lists"); right.children.push(block("another"));
  host.props = { kind: "jira", node: "another" };
  screen.move("sidebar"); host.layout = host.run.at(-1).props.layout;
  assert.equal(dock.placeOf(host.layout, dock.find(host.layout, "another")), "sidebar");
  assert.equal(dock.placeOf(host.layout, dock.find(host.layout, "jira-tickets")), "right");
});

test("Jira uses the same narrow rail as the other Cockpit panels", () => {
  const context = cx(); const screen = new Jira({}, context);
  handlerOf(screen.render(context), "on_size_change")({ width: 100 }, context);
  assert.equal(byId(screen.render(context), "jira-header"), undefined);
  assert.equal(byId(screen.render(context), "jira-list"), undefined);
  assert.ok(!textOf(screen.render(context)).includes("Loading Jira tickets…"));
});

test("Jira-specific commands reuse docking and ignore other panels' configure commands", async () => {
  host.onExec = () => ({ code: 0, stdout: '{"items":[]}' });
  const context = cx({ spawn: "run" }); new Jira({}, context); await context.settle();
  host.deliver("jira-move-left"); await context.settle(); assert.equal(host.run.at(-1).name, "layout.set");
  host.layout = host.run.at(-1).props.layout;
  host.deliver("jira-move-right"); await context.settle(); assert.equal(host.run.length, 2);
  host.deliver("configure"); await context.settle(); assert.equal(host.overlays.length, 0);
  host.deliver("jira-refresh"); await context.settle(); assert.equal(host.exec.length, 2);
});
