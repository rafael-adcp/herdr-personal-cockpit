import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { QuerySettings } from "../mods/personal-cockpit/jira-settings.js";
import Cockpit from "../mods/personal-cockpit/main.js";
import { Jira as JiraTickets } from "../mods/personal-cockpit/jira.js";
import { DEFAULT_JQL } from "../mods/personal-cockpit/jira-model.js";
import { host, reset } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { handlerOf, textOf } from "./support/element.js";

const path = "/herdr/mods/personal-cockpit/jira.config.json";
const config = { site: "https://example.atlassian.net", cloudId: "10465e5c-dd46-47ec-a645-05ad3dab7ede", node: "/custom/node", jql: DEFAULT_JQL, extra: { preserve: true } };
const success = (jql = DEFAULT_JQL) => ({ code: 0, stdout: JSON.stringify({ items: [], jql, at: 1, url: "https://example.atlassian.net/issues/" }), stderr: "" });
const byId = (element, id) => {
  const node = element.__node ?? element;
  if (node.calls.some((c) => c.name === "id" && c.args[0] === id)) return node;
  for (const child of node.kids) { const found = byId(child, id); if (found) return found; }
};
function open(context = cx({ spawn: "run" })) {
  const expected = JSON.stringify(config);
  host.files.set(path, expected);
  host.props = { kind: "jira-settings", config: { ...config }, expected, overlay: "settings-1" };
  host.overlays.push({ id: "settings-1" });
  return { context, settings: new QuerySettings({}, context), expected };
}
beforeEach(() => { reset(); host.onExec = () => success(); });

test("the native settings screen creates a multiline editor but does not poll Jira", () => {
  const { context, settings } = open();
  const view = new Cockpit({}, context);
  assert.ok(view.screen instanceof QuerySettings);
  assert.equal(context.timers.filter((t) => !t.once).length, 0);
  assert.equal(settings.input.options.rows, 5);
  assert.equal(settings.input.value(), DEFAULT_JQL);
  assert.ok(textOf(view.render(context)).includes("Customize Jira query"));
  const rendered = view.render(context);
  for (const id of ["jira-query-input", "jira-query-save", "jira-query-cancel", "jira-query-file"]) {
    assert.ok(byId(rendered, id), `missing ${id}`);
  }
  assert.equal(byId(rendered, "jira-query-default"), undefined);
  assert.equal(textOf(rendered).includes("Assigned open tickets"), false);
  assert.equal(host.exec.length, 0);
  settings.input.fire("blur", context); assert.equal(settings.focused, false);
  settings.input.fire("focus", context); assert.equal(settings.focused, true);
  settings.error = "old"; settings.input.type("project = TEST", context); assert.equal(settings.error, null);
  const n = settings.input.focused; context.timers[0].fn(context); assert.ok(settings.input.focused > n);
});

test("saving validates the exact draft through argv, preserves other config and refreshes the panel", async () => {
  const { settings, context } = open();
  const jql = 'project = TEST AND assignee = currentUser()\nORDER BY Rank ASC';
  settings.input.type(`  ${jql}  `, context);
  handlerOf(byId(settings.render(), "jira-query-save"), "on_click")({}, context);
  assert.equal(settings.busy, true);
  await context.settle();
  assert.deepEqual(host.exec[0], { command: "/custom/node", args: ["/herdr/mods/personal-cockpit/jira-bridge.mjs", path, jql] });
  assert.deepEqual(JSON.parse(host.files.get(path)), { ...config, jql });
  assert.deepEqual(host.run, [{ name: "personal-cockpit.jira-refresh", props: undefined }]);
  assert.equal(host.overlays.length, 0); assert.equal(settings.error, null); assert.equal(settings.busy, false);
});

test("empty JQL and invalid connection config do not write or run a query", async () => {
  const { settings, context, expected } = open();
  settings.input.type("  ", context); settings.save(context); await context.settle();
  assert.match(settings.error, /non-empty JQL/); assert.equal(host.files.get(path), expected); assert.equal(host.exec.length, 0);
  settings.input.type(DEFAULT_JQL, context); settings.config.site = "invalid"; settings.save(context);
  assert.match(settings.error, /HTTPS origin/); assert.equal(host.exec.length, 0);
});

test("invalid remote JQL leaves the draft and last working config untouched", async () => {
  const { settings, context, expected } = open();
  host.onExec = () => ({ code: 1, stdout: JSON.stringify({ error: { kind: "error", message: "Jira rejected the search. Check your access and JQL in config.json." } }) });
  settings.input.type("not valid JQL", context); settings.save(context); await context.settle();
  assert.match(settings.error, /rejected/); assert.equal(settings.input.value(), "not valid JQL");
  assert.equal(host.files.get(path), expected); assert.equal(host.overlays.length, 1); assert.equal(host.run.length, 0);
  assert.ok(textOf(settings.render()).some((text) => text.includes("rejected")));
});

test("a concurrent config edit cannot be overwritten by a saved draft", async () => {
  const { settings, context } = open();
  const external = JSON.stringify({ ...config, node: "/new-node" });
  host.onExec = () => { host.files.set(path, external); return success(); };
  settings.input.type("project = TEST", context); settings.save(context); await context.settle();
  assert.equal(host.files.get(path), external); assert.match(settings.error, /changed on disk/);
  assert.equal(host.overlays.length, 1); assert.equal(host.run.length, 0);
});

test("save guards overlapping requests and keeps controls responsive", async () => {
  const { settings, context } = open();
  let finish;
  host.onExec = () => new Promise((resolve) => { finish = resolve; });
  settings.save(context); settings.save(context); await context.settle();
  assert.equal(host.exec.length, 1); assert.ok(textOf(settings.render()).includes("Checking query…"));
  assert.ok(byId(settings.render(), "jira-query-cancel"));
  assert.equal(byId(settings.render(), "jira-query-default"), undefined);
  finish(success()); await context.settle(); assert.equal(settings.busy, false);
});

test("editing the draft and cancel/Escape do not change the stored query", () => {
  const { settings, context, expected } = open();
  settings.input.type("project = OTHER", context);
  settings.render(); assert.equal(settings.input.value(), "project = OTHER");
  handlerOf(settings.render(), "on_key_down")({ key: "other" }, context); assert.equal(host.overlays.length, 1);
  handlerOf(settings.render(), "on_key_down")({ key: "escape" }, context); assert.equal(host.overlays.length, 0); assert.equal(context.stopped, 1);
  host.overlays.push({}); handlerOf(byId(settings.render(), "jira-query-cancel"), "on_click")({}, context);
  assert.equal(host.files.get(path), expected); assert.equal(host.exec.length, 0);
});

test("advanced config retains the explicit system-editor action on each platform", async () => {
  for (const [platform, command] of [["macos", "open"], ["linux", "xdg-open"], ["windows", "cmd"]]) {
    const { settings, context } = open(); host.platform = platform;
    handlerOf(byId(settings.render(), "jira-query-file"), "on_click")({}, context); await context.settle();
    assert.deepEqual(host.exec.at(-1), { command, args: platform === "windows" ? ["/c", "start", "", path] : [path] });
    host.onExec = () => ({ code: 1 }); settings.openFile(context); await context.settle(); assert.match(settings.error, /manually/);
    host.onExec = () => { throw new Error("opener unavailable"); }; settings.openFile(context); await context.settle(); assert.match(settings.error, /opener unavailable/);
    host.onExec = () => success();
  }
});

test("a settings refresh signal arriving mid-poll is queued, not lost", async () => {
  let finish;
  host.props = null;
  host.files.set(path, JSON.stringify(config));
  host.onExec = () => host.exec.length === 1 ? new Promise((resolve) => { finish = resolve; }) : success("project = OTHER");
  const context = cx({ spawn: "run" }); const view = new JiraTickets({}, context); await context.settle();
  view.requestRefresh(context); assert.equal(view.pendingRefresh, true);
  assert.equal(host.exec.length, 1);
  finish(success()); await context.settle();
  assert.equal(host.exec.length, 2); assert.equal(view.pendingRefresh, false); assert.equal(view.data.jql, "project = OTHER");
  assert.ok(textOf(view.render(context)).includes("0 tickets · Custom JQL"));
});

test("cancelling or closing settings during validation prevents a later config write", async () => {
  for (const closeView of [false, true]) {
    const { context, expected } = open();
    const view = new Cockpit({}, context); const settings = view.screen;
    let finish;
    host.onExec = () => new Promise((resolve) => { finish = resolve; });
    settings.input.type("project = OTHER", context); settings.save(context); await context.settle();
    if (closeView) view.close(); else settings.cancel();
    finish(success()); await context.settle();
    assert.equal(host.files.get(path), expected); assert.equal(settings.busy, false);
    assert.equal(host.run.length, 0);
  }
  host.props = null; const view = new Cockpit({}, cx()); view.close();
});

test("settings can start without props, with an explicit default query", () => {
  host.props = null;
  const settings = new QuerySettings({}, cx()); assert.equal(settings.input.value(), DEFAULT_JQL);
  assert.equal(settings.expected, null);
});
