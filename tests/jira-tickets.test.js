import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as jira from "../mods/personal-cockpit/jira/jira.js";
import { List } from "../mods/personal-cockpit/screens/list.js";
import Cockpit from "../mods/personal-cockpit/main.js";
import { configOf, DEFAULT_JQL, fetchIssues, payloadOf, sections, shape, searchUrl, PanelError } from "../mods/personal-cockpit/jira/jira-model.js";
import { connectPi, piPackage, poll, publicError } from "../mods/personal-cockpit/jira/jira-bridge.mjs";
import { host, reset } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { handlerOf, textOf } from "./support/element.js";

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

const CONFIG = "/herdr/mods/personal-cockpit/jira.config.json";
const POLL = 180000;

/** The Jira panel: the list screen, given the `kind` a layout block would. */
function panel(options) {
  host.props = { kind: "jira" };
  const context = cx(options);
  return { context, list: new List({}, context) };
}

beforeEach(() => { reset(); localStorage.clear(); host.onExec = () => success(); });

test("Jira is a panel of the same Cockpit: the list screen, with Jira as its source", () => {
  host.props = { kind: "jira" };
  const mod = new Cockpit(host.props, cx());
  assert.ok(mod.screen instanceof List);
  assert.equal(mod.screen.source, jira);
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

// ---- the panel ------------------------------------------------------------
//
// Jira has no screen of its own: these drive list.js with Jira as its source.
// What is asserted is what the standalone screen promised, so that becoming a
// source cost none of it.

test("the panel loads through a short-lived Node helper and polls gently", async () => {
  const { context, list } = panel({ spawn: "run" });
  assert.equal(list.busy, true); await context.settle();
  assert.equal(list.items.length, 1); assert.equal(list.state, "ok"); assert.equal(list.busy, false);
  assert.equal(context.timers[0].ms, POLL);
  assert.deepEqual(host.exec[0], { command: "node", args: ["/herdr/mods/personal-cockpit/jira/jira-bridge.mjs", CONFIG] });
  assert.ok(textOf(list.render(context)).includes("My Jira tickets"));
  assert.ok(textOf(list.render(context)).includes("TEST-1"));
  await context.tick(POLL); assert.equal(host.exec.length, 2);
});

test("the desktop can use an absolute Node path without a shell or PATH changes", async () => {
  host.files.set(CONFIG, JSON.stringify({ ...config, node: "/custom/node" }));
  const { context, list } = panel({ spawn: "run" }); await context.settle();
  assert.equal(host.exec[0].command, "/custom/node"); assert.equal(list.state, "ok");
  host.files.set(CONFIG, JSON.stringify({ node: "" }));
  await context.tick(POLL); assert.match(list.stale, /Node.js executable/);
  assert.equal(host.exec.length, 1);
  host.files.set(CONFIG, JSON.stringify({ site }));
  await context.tick(POLL); assert.equal(host.exec.at(-1).command, "node");
});

test("a refresh already running cannot overlap another", () => {
  const { context, list } = panel(); const before = context.spawned.length;
  list.refresh(context); assert.equal(context.spawned.length, before);
});

test("failed refreshes preserve the last good list, including a successful empty list", async () => {
  for (const items of [[shape(issue(), site)], []]) {
    host.onExec = () => success(answer(items));
    const { context, list } = panel({ spawn: "run" }); await context.settle();
    // Not the one kind the GitHub panels keep a list through: Jira keeps it
    // through any of them.
    host.onExec = () => fail("auth"); await context.tick(POLL);
    assert.equal(list.items.length, items.length); assert.equal(list.state, "ok"); assert.equal(list.stale, "Read failed");
    const text = textOf(list.render(context));
    assert.ok(text.includes("stale"));
    assert.ok(text.some((line) => line.startsWith("Couldn't refresh")));
    host.onExec = () => success(answer([])); await context.tick(POLL);
    assert.equal(list.stale, null); assert.equal(list.items.length, 0);
  }
});

test("first-load failures say what failed, under their own name, with retry and the gear", async () => {
  host.onExec = () => fail("auth");
  const { context, list } = panel({ spawn: "run" }); await context.settle();
  const rendered = list.render(context);
  assert.equal(list.state, "auth");
  assert.ok(textOf(rendered).includes("Read failed"));
  assert.ok(textOf(rendered).includes("auth"), "the header names a failure only Jira knows");
  assert.ok(byId(rendered, "cockpit-jira-retry")); assert.ok(byId(rendered, "cockpit-jira-configure"));
  host.onExec = () => success(); handlerOf(byId(rendered, "cockpit-jira-retry"), "on_click")({}, context); await context.settle();
  assert.equal(list.state, "ok"); assert.equal(list.error, null);
});

test("invalid helper output, nonzero exits and launch failures are visible", async () => {
  for (const fn of [() => ({ code: 1, stdout: "invalid" }), () => ({ code: 1, stdout: "{}" }), () => { throw new Error("node missing"); }]) {
    host.onExec = fn; const { context, list } = panel({ spawn: "run" }); await context.settle();
    assert.equal(list.state, "error"); assert.ok(list.error);
    assert.ok(textOf(list.render(context)).includes(list.error));
  }
});

test("rows, search button and keyboard open only browser URLs", async () => {
  const items = [shape(issue("T-1"), site), shape(issue("T-2"), site)];
  host.onExec = () => success(answer(items));
  const { context, list } = panel({ spawn: "run" }); await context.settle();
  handlerOf(byId(list.render(context), "jira-T-1"), "on_click")({}, context);
  assert.equal(context.opened.at(-1), `${site}/browse/T-1`);
  const key = handlerOf(list.render(context), "on_key_down");
  key({ key: "down" }, context); assert.equal(list.at, 1);
  handlerOf(list.render(context), "on_key_down")({ key: "enter" }, context); assert.equal(context.opened.at(-1), `${site}/browse/T-2`);
  key({ key: "up" }, context); assert.equal(list.at, 0);
  key({ key: "o" }, context); assert.equal(context.opened.at(-1), searchUrl(config));
  handlerOf(byId(list.render(context), "cockpit-jira-browser"), "on_click")({}, context); assert.equal(context.opened.at(-1), searchUrl(config));
  assert.equal(context.opened.length, 4);
  const n = context.stopped; key({ key: "x" }, context); assert.equal(context.stopped, n);
  assert.equal(host.run.length, 0, "opening a ticket must not touch terminals or Jira state");
});

test("there is no search to open until one has loaded", async () => {
  host.onExec = () => fail("setup");
  const { context, list } = panel({ spawn: "run" }); await context.settle();
  const rendered = list.render(context);
  assert.equal(byId(rendered, "cockpit-jira-browser"), undefined);
  handlerOf(rendered, "on_key_down")({ key: "o" }, context);
  assert.equal(context.opened.length, 0);
});

test("the cursor follows its ticket across a refresh that reorders, and is clamped when it is gone", async () => {
  const items = ["T-1", "T-2", "T-3"].map((key) => shape(issue(key), site));
  host.onExec = () => success(answer(items));
  const { context, list } = panel({ spawn: "run" }); await context.settle();
  const key = handlerOf(list.render(context), "on_key_down");
  key({ key: "down" }, context); key({ key: "down" }, context); assert.equal(list.at, 2);
  await context.tick(POLL); assert.equal(list.at, 2);
  // Somebody touched T-3, and the default query sorts by last update.
  host.onExec = () => success(answer([items[2], items[0], items[1]])); await context.tick(POLL);
  assert.equal(list.at, 0);
  key({ key: "up" }, context); assert.equal(list.at, 2);
  // T-2 is closed and leaves the list: the cursor stays in range.
  host.onExec = () => success(answer([items[2], items[0]])); await context.tick(POLL);
  list.render(context); assert.equal(list.at, 1);
});

test("loading, empty, priority, narrow and optional data states render", async () => {
  const { context, list } = panel();
  assert.ok(textOf(list.render(context)).includes("Loading Jira tickets…"));
  list.busy = false; list.state = "ok"; list.meta = { jql: DEFAULT_JQL, url: searchUrl(config), count: 0 };
  assert.ok(textOf(list.render(context)).includes("No tickets match this query."));
  assert.ok(textOf(list.render(context)).includes("0 tickets · Assigned to me"));
  list.items = [shape(issue("T-1", { priority: { name: "High [P2]" } }), site), shape({ key: "T-2" }, site), { ...shape(issue("T-3"), site), category: "done" }];
  handlerOf(list.render(context), "on_size_change")({ width: 380 }, context);
  assert.ok(textOf(list.render(context)).includes("High [P2]"));
  // Still two lines, but no longer room for the priority after the status.
  handlerOf(list.render(context), "on_size_change")({ width: 260 }, context);
  assert.ok(textOf(list.render(context)).includes("Doing"));
  assert.ok(!textOf(list.render(context)).includes("High [P2]"));
  const n = context.notifies; handlerOf(list.render(context), "on_size_change")({ width: 260 }, context); assert.equal(context.notifies, n);
  handlerOf(list.render(context), "on_mouse_down")({}, context); assert.ok(context.focused > 0);
});

test("the footnote says whether the query is the default or the person's own", () => {
  assert.equal(jira.footnote({ jql: DEFAULT_JQL, count: 3 }), "3 tickets · Assigned to me");
  assert.equal(jira.footnote({ jql: "project = OTHER", count: 1 }), "1 tickets · Custom JQL");
  assert.equal(jira.footnote(null), null);
});

test("collapse and expansion alter only their own layout block, not terminals", () => {
  const { context, list } = panel();
  host.layout = { id: "root", children: [{ id: "jira-tickets", content: { mod: "personal-cockpit", props: { kind: "jira" } }, size: { px: 240 } }] };
  handlerOf(byId(list.render(context), "cockpit-jira-minimise"), "on_click")({}, context);
  // The key the standalone panel used, so a height dragged then is still here.
  assert.equal(host.shared.get("jira-tickets.height"), 240);
  assert.deepEqual(host.run.at(-1), { name: "layout.resize", props: { id: "jira-tickets", px: 42 } });
  host.layout.children[0].size.px = 42;
  assert.ok(!byId(list.render(context), "cockpit-jira-list"));
  handlerOf(byId(list.render(context), "cockpit-jira-header"), "on_click")({}, context);
  assert.deepEqual(host.run.at(-1).props, { id: "jira-tickets", px: 240 });
  host.shared.clear();
  handlerOf(byId(list.render(context), "cockpit-jira-header"), "on_click")({}, context);
  assert.deepEqual(host.run.at(-1).props, { id: "jira-tickets", weight: 1 });
  assert.ok(host.run.every((sent) => sent.name === "layout.resize"));
});

test("configuration opens a native query dialog without an editor or new terminal", async () => {
  const saved = JSON.stringify({ ...config, node: "/custom/node", extra: "keep" });
  host.files.set(CONFIG, saved);
  const { context, list } = panel({ spawn: "run" }); await context.settle();
  const gear = () => handlerOf(byId(list.render(context), "cockpit-jira-configure"), "on_click")({}, context);
  gear(); await context.settle();
  assert.equal(host.overlays.at(-1).mod, "personal-cockpit");
  assert.equal(host.overlays.at(-1).props.kind, "jira-settings");
  assert.equal(host.overlays.at(-1).props.expected, saved);
  assert.equal(host.overlays.at(-1).props.config.extra, "keep");
  assert.equal(host.exec.length, 1, "opening settings must not query Jira or launch an editor");
  // A config that stopped parsing opens no dialog over it, says so, and leaves
  // the list that loaded where it was.
  host.files.set(CONFIG, "{invalid");
  gear(); await context.settle();
  assert.equal(host.overlays.length, 1); assert.ok(list.acted);
  assert.ok(textOf(list.render(context)).includes("That didn't go through"));
  assert.equal(list.items.length, 1); assert.equal(list.state, "ok");
});

test("keyboard refresh/configure and mod commands reuse current contexts", async () => {
  const { context, list } = panel({ spawn: "run" }); await context.settle();
  host.deliver("focus"); await context.settle(); assert.equal(context.focused, 1);
  host.deliver("refresh"); await context.settle(); assert.equal(host.exec.length, 2);
  host.deliver("jira-configure"); await context.settle(); assert.equal(host.overlays.length, 1);
  host.deliver("unknown"); await context.settle();
  const key = handlerOf(list.render(context), "on_key_down");
  key({ key: "r" }, context); await context.settle();
  key({ key: "c" }, context); await context.settle(); assert.equal(host.exec.length, 3); assert.equal(host.overlays.length, 2);
  list.items = []; handlerOf(list.render(context), "on_key_down")({ key: "down" }, context);
  list.open(null, context); assert.equal(context.opened.length, 0);
});

test("Jira publishes no rows for the drawer, and counts nothing as needing you", async () => {
  const { context, list } = panel({ spawn: "run" }); await context.settle();
  assert.deepEqual(jira.urgent(list.items), []); assert.equal(jira.attention(list.items), 0);
  assert.deepEqual(host.shared.get("cockpit.jira.urgent"), []);
});
