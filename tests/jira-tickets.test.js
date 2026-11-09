import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Jira as JiraTickets } from "../mods/personal-cockpit/jira.js";
import Cockpit from "../mods/personal-cockpit/main.js";
import { configOf, DEFAULT_JQL, fetchIssues, payloadOf, sections, shape, searchUrl, PanelError } from "../mods/personal-cockpit/jira-model.js";
import { connectPi, piPackage, poll, publicError } from "../mods/personal-cockpit/jira-bridge.mjs";
import { host, reset } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { callsOf, handlerOf, textOf } from "./support/element.js";

const site = "https://example.atlassian.net";
const config = { site, cloudId: "10465e5c-dd46-47ec-a645-05ad3dab7ede", jql: DEFAULT_JQL };
const issue = (key = "TEST-1", fields = {}) => ({ key, fields: { summary: key, status: { name: "Doing", statusCategory: { key: "indeterminate" } }, assignee: { displayName: "Test User" }, ...fields } });
const result = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const answer = (items = [shape(issue(), site)]) => ({ items, site, jql: DEFAULT_JQL, at: 12345, url: searchUrl(config) });
const success = (data = answer()) => ({ code: 0, stdout: JSON.stringify(data), stderr: "" });
const fail = (kind = "error") => success({ error: { kind, message: "Read failed" } });
const byId = (element, id) => {
  const node = element.__node ?? element;
  if (node.calls.some((c) => c.name === "id" && c.args[0] === id)) return node;
  for (const child of node.kids) { const found = byId(child, id); if (found) return found; }
};

beforeEach(() => { reset(); localStorage.clear(); host.onExec = () => success(); });

test("Jira is a screen of the same Cockpit, with no second mod or layout required", () => {
  host.props = { kind: "jira" };
  const mod = new Cockpit(host.props, cx());
  assert.ok(mod.screen instanceof JiraTickets);
  assert.ok(textOf(mod.render(cx())).includes("My Jira tickets"));
});

test("default JQL means assigned to the signed-in user and not done", () => {
  assert.match(DEFAULT_JQL, /assignee = currentUser\(\)/);
  assert.match(DEFAULT_JQL, /statusCategory != Done/);
  assert.deepEqual(configOf({ site, cloudId: config.cloudId }), config);
  assert.equal(configOf({ ...config, jql: "reporter = currentUser()" }).jql, "reporter = currentUser()");
  assert.equal(new URL(searchUrl(config)).searchParams.get("jql"), DEFAULT_JQL);
});

test("configuration cannot redirect a browse URL or embed credentials", () => {
  for (const bad of ["http://example.atlassian.net", "https://evil.test", "https://x.atlassian.net.evil.test", "https://a:b@example.atlassian.net", `${site}/browse/x`, `${site}?token=secret`, `${site}#x`, "bad", `${site}:444`]) {
    assert.throws(() => configOf({ ...config, site: bad }), PanelError);
  }
  for (const bad of [null, [], 42]) assert.throws(() => configOf(bad), PanelError);
  for (const bad of ["", "x", 13]) assert.throws(() => configOf({ ...config, cloudId: bad }), PanelError);
  for (const bad of ["", "  ", 13]) assert.throws(() => configOf({ ...config, jql: bad }), PanelError);
});

test("payload decoding supports text and structured MCP responses and rejects errors", () => {
  assert.deepEqual(payloadOf(result({ issues: [] })), { issues: [] });
  assert.deepEqual(payloadOf({ structuredContent: { issues: [] } }), { issues: [] });
  assert.throws(() => payloadOf({ isError: true, content: [{ type: "text", text: "private error" }] }), /rejected/);
  assert.throws(() => payloadOf(result({ noIssues: true })), /unexpected/);
  assert.throws(() => payloadOf({ content: [] }));
});

test("shaping discards private API metadata and tolerates absent optional fields", () => {
  const item = shape(issue("TEST-1", { priority: { name: "Critical" }, project: { name: "A" }, issuetype: { name: "Bug" }, updated: "2026-01-01" }), site);
  assert.equal(item.priority, "Critical"); assert.equal(item.project, "A"); assert.equal(item.type, "Bug");
  assert.equal(item.url, `${site}/browse/TEST-1`); assert.equal(item.assignee, "Test User");
  const missing = shape({ key: "TEST/2" }, site);
  assert.equal(missing.url, `${site}/browse/TEST%2F2`);
  assert.equal(missing.title, "TEST/2"); assert.equal(missing.priority, "No priority"); assert.equal(missing.category, "unknown");
  assert.ok(!("fields" in item));
});

test("pagination loads every page, sends exact JQL and deduplicates issue keys", async () => {
  const calls = [];
  const items = await fetchIssues(async (name, args) => {
    calls.push({ name, args });
    return result(args.nextPageToken ? { issues: [issue("TEST-1"), issue("TEST-2")], isLast: true } : { issues: [issue()], nextPageToken: "cursor", isLast: false });
  }, config);
  assert.equal(items.length, 2);
  assert.equal(calls[0].name, "searchJiraIssuesUsingJql");
  assert.equal(calls[0].args.jql, DEFAULT_JQL); assert.equal(calls[0].args.cloudId, config.cloudId);
  assert.equal(calls[0].args.maxResults, 100); assert.ok(!("nextPageToken" in calls[0].args));
  assert.equal(calls[1].args.nextPageToken, "cursor");
});

test("empty final page succeeds, even when isLast is omitted", async () => {
  assert.deepEqual(await fetchIssues(async () => result({ issues: [] }), config), []);
});

test("broken or repeated cursors, page caps, missing keys and later-page failure never return partial lists", async () => {
  for (const data of [{ issues: [], isLast: false }, { issues: [], isLast: false, nextPageToken: "repeat" }, { issues: [{}], isLast: true }]) {
    await assert.rejects(() => fetchIssues(async () => result(data), config), PanelError);
  }
  let page = 0;
  await assert.rejects(() => fetchIssues(async () => result({ issues: [], nextPageToken: String(++page) }), config), /50 pages/);
  assert.equal(page, 50);
  page = 0;
  await assert.rejects(() => fetchIssues(async () => {
    if (page++) throw new Error("offline");
    return result({ issues: [issue()], nextPageToken: "next" });
  }, config), /offline/);
});

test("status sections group work in progress first and preserve JQL result order within each group", () => {
  const a = shape(issue("T-1", { updated: "2020-01-01" }), site);
  const b = { ...a, key: "T-2", updated: "2026-01-01" };
  const c = { ...a, key: "T-3", category: "new" };
  const d = { ...a, key: "T-4", category: "custom", updated: "not a date" };
  const e = { ...a, key: "T-5", category: "done" };
  const groups = sections([c, a, d, b, e]);
  assert.deepEqual(groups.map((g) => g.label), ["In progress", "To do", "Done", "Other"]);
  assert.deepEqual(groups[0].items.map((i) => i.key), ["T-1", "T-2"]);
  assert.deepEqual(sections([]), []);
  assert.deepEqual(sections([a, { ...a, key: "T-0" }])[0].items.map((i) => i.key), ["T-1", "T-0"]);
});

test("poll reads config, executes search only and closes on success and failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jira-poll-"));
  try {
    const path = join(dir, "config.json"); writeFileSync(path, JSON.stringify(config));
    let closes = 0;
    const data = await poll(path, async () => ({ call: async () => result({ issues: [issue()], isLast: true }), close: async () => { closes++; } }));
    assert.equal(data.items.length, 1); assert.equal(data.site, site); assert.equal(data.url, searchUrl(config)); assert.ok(data.at > 0);
    const saved = readFileSync(path, "utf8");
    const custom = await poll(path, async () => ({ call: async (_name, args) => { assert.equal(args.jql, "project = OTHER"); return result({ issues: [] }); }, close: async () => {} }), "project = OTHER");
    assert.equal(custom.jql, "project = OTHER"); assert.equal(readFileSync(path, "utf8"), saved);
    await assert.rejects(() => poll(path, async () => { throw new Error("must not connect"); }, ""), /non-empty JQL/);
    await assert.rejects(() => poll(path, async () => ({ call: async () => { throw new Error("network"); }, close: async () => { closes++; } })), /network/);
    assert.equal(closes, 2);
    writeFileSync(path, "{invalid");
    await assert.rejects(() => poll(path), /valid jira\.config/);
    writeFileSync(path, JSON.stringify({ ...config, site: "invalid" }));
    await assert.rejects(() => poll(path), /HTTPS origin/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("public errors never forward raw HTTP or OAuth details", () => {
  assert.deepEqual(publicError(new PanelError("setup", "Safe")), { kind: "setup", message: "Safe" });
  for (const error of [Object.assign(new Error("secret"), { name: "McpOAuthAuthorizationRequiredError" }), { status: 401 }]) assert.equal(publicError(error).kind, "auth");
  for (const code of ["ENOENT", "ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"]) assert.equal(publicError({ code }).kind, "setup");
  assert.ok(!publicError(new Error("Bearer SECRET")).message.includes("SECRET"));
  assert.equal(publicError(null).kind, "error");
});

test("managed Pi version is resolved dynamically, never allowed to traverse directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "jira-pi-")); mkdirSync(join(dir, "install"));
  try {
    writeFileSync(join(dir, "install/current-version"), "1.4.0\n");
    assert.equal(piPackage(dir), join(dir, "install", "releases", "1.4.0", "node_modules", "@earendil-works", "pi-coding-agent"));
    for (const version of ["../escape", "..", ".", "", "x/y"]) {
      writeFileSync(join(dir, "install/current-version"), version);
      assert.throws(() => piPackage(dir), PanelError);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing Pi fails with setup instructions, not a credential dump", async () => {
  await assert.rejects(() => connectPi("/nonexistent-herdr-jira-test"), (e) => e.kind === "setup");
});

test("native view loads through a short-lived Node helper and polls gently", async () => {
  const context = cx({ spawn: "run" }); const view = new JiraTickets({}, context);
  assert.equal(view.busy, true); await context.settle();
  assert.equal(view.items.length, 1); assert.equal(view.error, null); assert.equal(view.busy, false);
  assert.equal(context.timers[0].ms, 180000);
  assert.deepEqual(host.exec[0], { command: "node", args: ["/herdr/mods/personal-cockpit/jira-bridge.mjs", "/herdr/mods/personal-cockpit/jira.config.json"] });
  assert.ok(textOf(view.render(context)).includes("My Jira tickets"));
  assert.ok(textOf(view.render(context)).includes("TEST-1"));
  await context.tick(180000); assert.equal(host.exec.length, 2);
});

test("the desktop can use an absolute Node path without a shell or PATH changes", async () => {
  host.files.set("/herdr/mods/personal-cockpit/jira.config.json", JSON.stringify({ ...config, node: "/custom/node" }));
  const context = cx({ spawn: "run" }); const view = new JiraTickets({}, context); await context.settle();
  assert.equal(host.exec[0].command, "/custom/node"); assert.equal(view.error, null);
  host.files.set("/herdr/mods/personal-cockpit/jira.config.json", JSON.stringify({ node: "" }));
  await context.tick(180000); assert.match(view.stale.message, /Node.js executable/);
  assert.equal(host.exec.length, 1);
  host.files.set("/herdr/mods/personal-cockpit/jira.config.json", JSON.stringify({ site }));
  await context.tick(180000); assert.equal(host.exec.at(-1).command, "node");
});

test("a refresh already running cannot overlap another", () => {
  const context = cx(); const view = new JiraTickets({}, context); const before = context.spawned.length;
  view.refresh(context); assert.equal(context.spawned.length, before);
});

test("failed refreshes preserve the last good list, including a successful empty list", async () => {
  for (const items of [[shape(issue(), site)], []]) {
    host.onExec = () => success(answer(items));
    const context = cx({ spawn: "run" }); const view = new JiraTickets({}, context); await context.settle();
    host.onExec = () => fail("auth"); await context.tick(180000);
    assert.equal(view.items.length, items.length); assert.equal(view.error, null); assert.equal(view.stale.kind, "auth");
    assert.ok(textOf(view.render(context)).includes("stale"));
    host.onExec = () => success(answer([])); await context.tick(180000);
    assert.equal(view.stale, null); assert.equal(view.items.length, 0);
  }
});

test("first-load failures have retry and configuration controls", async () => {
  host.onExec = () => fail("auth");
  const context = cx({ spawn: "run" }); const view = new JiraTickets({}, context); await context.settle();
  const rendered = view.render(context);
  assert.ok(textOf(rendered).includes("Read failed")); assert.ok(byId(rendered, "jira-retry"));
  host.onExec = () => success(); handlerOf(byId(rendered, "jira-retry"), "on_click")({}, context); await context.settle();
  assert.equal(view.error, null); assert.equal(context.stopped, 0);
});

test("invalid helper output, nonzero exits and launch failures are visible", async () => {
  for (const fn of [() => ({ code: 1, stdout: "invalid" }), () => ({ code: 1, stdout: "{}" }), () => { throw new Error("node missing"); }]) {
    host.onExec = fn; const context = cx({ spawn: "run" }); const view = new JiraTickets({}, context); await context.settle();
    assert.equal(view.error.kind, "error"); assert.ok(view.error.message);
  }
});

test("rows, search button and keyboard open only browser URLs", async () => {
  const items = [shape(issue("T-1"), site), shape(issue("T-2"), site)];
  host.onExec = () => success(answer(items));
  const context = cx({ spawn: "run" }); const view = new JiraTickets({}, context); await context.settle();
  handlerOf(byId(view.render(context), "jira-T-1"), "on_click")({}, context);
  assert.equal(context.opened.at(-1), `${site}/browse/T-1`);
  const key = handlerOf(view.render(context), "on_key_down");
  key({ key: "down" }, context); assert.equal(view.at, 1);
  handlerOf(view.render(context), "on_key_down")({ key: "enter" }, context); assert.equal(context.opened.at(-1), `${site}/browse/T-2`);
  key({ key: "up" }, context); assert.equal(view.at, 0);
  key({ key: "o" }, context); assert.equal(context.opened.at(-1), searchUrl(config));
  handlerOf(byId(view.render(context), "jira-browser"), "on_click")({}, context); assert.equal(context.opened.at(-1), searchUrl(config));
  const n = context.stopped; key({ key: "x" }, context); assert.equal(context.stopped, n);
  assert.equal(host.run.length, 0, "opening a ticket must not touch terminals or Jira state");
});

test("refresh keeps the selected key and clamps a removed selection", async () => {
  const items = [shape(issue("T-1"), site), shape(issue("T-2"), site)];
  host.onExec = () => success(answer(items));
  const context = cx({ spawn: "run" }); const view = new JiraTickets({}, context); await context.settle();
  handlerOf(view.render(context), "on_key_down")({ key: "down" }, context);
  await context.tick(180000); assert.equal(view.at, 1);
  host.onExec = () => success(answer([items[0]])); await context.tick(180000); assert.equal(view.at, 0);
});

test("loading, empty, priority, narrow and optional data states render", async () => {
  const context = cx(); const view = new JiraTickets({}, context);
  assert.ok(textOf(view.render(context)).includes("Loading Jira tickets…"));
  view.busy = false; view.data = answer([]);
  assert.ok(textOf(view.render(context)).includes("No tickets match this query."));
  view.items = [shape(issue("T-1", { priority: { name: "High [P2]" } }), site), shape({ key: "T-2" }, site), { ...shape(issue("T-3"), site), category: "done" }];
  assert.ok(textOf(view.render(context)).includes("High [P2]"));
  handlerOf(view.render(context), "on_size_change")({ width: 200 }, context);
  assert.ok(!textOf(view.render(context)).includes("High [P2]"));
  const n = context.notifies; handlerOf(view.render(context), "on_size_change")({ width: 200 }, context); assert.equal(context.notifies, n);
  handlerOf(view.render(context), "on_mouse_down")({}, context); assert.ok(context.focused > 0);
});

test("collapse and expansion alter only their own layout block, not terminals", () => {
  const context = cx(); const view = new JiraTickets({}, context);
  host.layout = { id: "root", children: [{ id: "jira-tickets", content: { mod: "personal-cockpit", props: { kind: "jira" } }, size: { px: 240 } }] };
  handlerOf(byId(view.render(context), "jira-minimise"), "on_click")({}, context);
  assert.equal(host.shared.get("jira-tickets.height"), 240);
  assert.deepEqual(host.run.at(-1), { name: "layout.resize", props: { id: "jira-tickets", px: 42 } });
  host.layout.children[0].size.px = 42;
  assert.ok(!byId(view.render(context), "jira-list"));
  handlerOf(byId(view.render(context), "jira-header"), "on_click")({}, context);
  assert.deepEqual(host.run.at(-1).props, { id: "jira-tickets", px: 240 });
  host.shared.clear(); view.toggle(host.layout.children[0], true);
  assert.deepEqual(host.run.at(-1).props, { id: "jira-tickets", weight: 1 });
});

test("configuration opens a native query dialog without an editor or new terminal", async () => {
  const saved = JSON.stringify({ ...config, node: "/custom/node", extra: "keep" });
  host.files.set("/herdr/mods/personal-cockpit/jira.config.json", saved);
  const context = cx({ spawn: "run" }); const view = new JiraTickets({}, context); await context.settle();
  view.configure(context); await context.settle();
  assert.equal(host.overlays.at(-1).mod, "personal-cockpit");
  assert.equal(host.overlays.at(-1).props.kind, "jira-settings");
  assert.equal(host.overlays.at(-1).props.expected, saved);
  assert.equal(host.overlays.at(-1).props.config.extra, "keep");
  assert.equal(host.exec.length, 1, "opening settings must not query Jira or launch an editor");
  host.files.set("/herdr/mods/personal-cockpit/jira.config.json", "{invalid");
  view.configure(context); await context.settle(); assert.equal(view.stale.kind, "setup");
  view.data = null; view.configure(context); await context.settle(); assert.equal(view.error.kind, "setup");
});

test("keyboard refresh/configure and mod commands reuse current contexts", async () => {
  const context = cx({ spawn: "run" }); const view = new JiraTickets({}, context); await context.settle();
  host.deliver("focus"); await context.settle(); assert.equal(context.focused, 1);
  host.deliver("refresh"); await context.settle(); assert.equal(host.exec.length, 2);
  host.deliver("jira-configure"); await context.settle(); assert.equal(host.overlays.length, 1);
  host.deliver("unknown"); await context.settle();
  const key = handlerOf(view.render(context), "on_key_down");
  key({ key: "r" }, context); await context.settle();
  key({ key: "c" }, context); await context.settle(); assert.equal(host.exec.length, 3); assert.equal(host.overlays.length, 2);
  view.items = []; key({ key: "down" }, context);
  view.open(null, context);
});
