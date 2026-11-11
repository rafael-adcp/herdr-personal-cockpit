// Exercise the OAuth adapter against an isolated mock Pi install, never real credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { connectPi } from "../mods/personal-cockpit/jira/jira-bridge.mjs";

const SERVER = "https://mcp.atlassian.com/v1/mcp";

test("the installed bridge runs outside the repo on mod-root ESM metadata, with the config a level up", () => {
  // The shape the installers produce: the bridge and its model sit in `jira/`,
  // while `package.json` and the person's `jira.config.json` stay at the mod
  // root. So `jira-model.js` is a `.js` whose `"type": "module"` is only found
  // by walking up out of its own folder, and the bridge's default config path
  // has to climb the same way. Both were adjacent before and are not now.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "herdr-installed-jira-cli-")));
  try {
    const bridgeDir = join(dir, "jira");
    mkdirSync(bridgeDir);
    copyFileSync(join(import.meta.dirname, "../mods/personal-cockpit/package.json"), join(dir, "package.json"));
    for (const file of ["jira-bridge.mjs", "jira-model.js"]) {
      copyFileSync(join(import.meta.dirname, "../mods/personal-cockpit/jira", file), join(bridgeDir, file));
    }
    const saved = JSON.stringify({ site: "https://example.atlassian.net", cloudId: "10465e5c-dd46-47ec-a645-05ad3dab7ede", jql: "project = TEST" });
    writeFileSync(join(dir, "jira.config.json"), saved);
    const run = (args = []) => spawnSync(process.execPath, ["--no-experimental-detect-module", join(bridgeDir, "jira-bridge.mjs"), ...args], {
      cwd: tmpdir(), encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: join(dir, "missing-pi") },
    });
    const result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, "", "the shared .js model must load as ESM in the installed mod");
    assert.match(JSON.parse(result.stdout).error.message, /existing managed Pi installation/);
    const explicit = join(dir, "other.json");
    writeFileSync(explicit, JSON.stringify({ site: "invalid" }));
    assert.match(JSON.parse(run([explicit]).stdout).error.message, /HTTPS origin/);
    assert.equal(readFileSync(join(dir, "jira.config.json"), "utf8"), saved);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "herdr-fake-pi-"));
  const root = join(dir, "install/releases/1.4.0/node_modules/@earendil-works");
  const pi = join(root, "pi-coding-agent");
  const write = (name, value) => { const path = join(dir, name); mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, value); };
  write("install/current-version", "1.4.0");
  write("mcp.json", JSON.stringify({ mcpServers: { atlassian: { url: SERVER } } }));
  write("mcp-auth.json", "{}");
  for (const name of ["pi-coding-agent", "pi-mcp"]) write(`install/releases/1.4.0/node_modules/@earendil-works/${name}/package.json`, '{"type":"module"}');
  write("install/releases/1.4.0/node_modules/@earendil-works/pi-mcp/dist/index.js", `
    export class McpClient {
      constructor(options) { globalThis.jiraMock.options = options; }
      async connect(transport) {
        globalThis.jiraMock.transport = transport.options;
        await transport.options.authProvider.token();
        if (globalThis.jiraMock.error) throw globalThis.jiraMock.error;
      }
      async callTool(name, args, options) { globalThis.jiraMock.called = { name, args, options }; return globalThis.jiraMock.result ?? { content: [] }; }
      async close() { globalThis.jiraMock.closed++; if (globalThis.jiraMock.closeError) throw Error('close'); }
    }
    export class StreamableHttpTransport { constructor(options) { this.options = options; } }
  `);
  write("install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/oauth.js", `
    export class McpOAuthCredentialStore {
      constructor(backend, dir) { globalThis.jiraMock.dir = dir; globalThis.jiraMock.backend = backend; }
      forServer(name, url) {
        globalThis.jiraMock.server = { name, url };
        return { load: async () => globalThis.jiraMock.state, withRefreshLock: async f => f() };
      }
    }
    export function createMcpAuthProvider(options) {
      globalThis.jiraMock.oauth = options;
      return { token: async () => 'mock-access-token', settled: async () => { globalThis.jiraMock.settled++; } };
    }
  `);
  write("install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js", `
    export class FileAuthStorageBackend { constructor(path) { this.path = path; } }
  `);
  globalThis.jiraMock = { state: { tokens: { access_token: "mock-access-token" } }, closed: 0, settled: 0 };
  return { dir, pi, write, mock: globalThis.jiraMock, close() { rmSync(dir, { recursive: true, force: true }); delete globalThis.jiraMock; } };
}

test("the source CLI returns search JSON, honors JQL overrides and sanitizes failures", () => {
  const f = fixture();
  try {
    const bridge = join(import.meta.dirname, "../mods/personal-cockpit/jira/jira-bridge.mjs");
    const config = join(f.dir, "jira.config.json");
    const saved = JSON.stringify({ site: "https://example.atlassian.net", cloudId: "10465e5c-dd46-47ec-a645-05ad3dab7ede", jql: "project = TEST" });
    f.write("jira.config.json", saved);
    const state = JSON.stringify({ ...f.mock, result: { structuredContent: { issues: [{ key: "TEST-1", fields: { summary: "CLI fixture" } }], isLast: true } } });
    f.write("cli-state.mjs", `globalThis.jiraMock = ${state};`);
    const run = (args = [config], managed = true) => {
      const env = { ...process.env, HOME: f.dir, USERPROFILE: f.dir, PI_CODING_AGENT_DIR: f.dir };
      if (!managed) delete env.PI_CODING_AGENT_DIR;
      const result = spawnSync(process.execPath, ["--import", pathToFileURL(join(f.dir, "cli-state.mjs")).href, bridge, ...args], {
        cwd: tmpdir(), encoding: "utf8", timeout: 10000, env,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.stderr, "");
      return { status: result.status, data: JSON.parse(result.stdout) };
    };
    const result = run();
    assert.equal(result.status, 0);
    assert.equal(result.data.items[0].key, "TEST-1");
    assert.equal(result.data.items[0].title, "CLI fixture");
    assert.equal(result.data.jql, "project = TEST");
    assert.ok(result.data.at > 0);
    assert.equal(run([config, "project = OTHER"]).data.jql, "project = OTHER");
    assert.equal(readFileSync(config, "utf8"), saved);
    const missing = run([join(f.dir, "missing-config.json")]);
    assert.equal(missing.status, 1);
    assert.equal(missing.data.error.kind, "setup");
    const unmanaged = run([config], false);
    assert.equal(unmanaged.status, 1);
    assert.match(unmanaged.data.error.message, /existing managed Pi installation/);
    f.write("cli-state.mjs", `globalThis.jiraMock = ${state}; globalThis.jiraMock.error = new Error("Bearer mock-secret");`);
    const failed = run();
    assert.equal(failed.status, 1);
    assert.equal(failed.data.error.kind, "error");
    assert.match(failed.data.error.message, /Could not query Jira/);
    assert.ok(!JSON.stringify(failed.data).includes("mock-secret"));
    // Redirect only the adjacent config read, never read a developer's personal config.
    f.write("cli-state.mjs", `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const read = fs.readFileSync;
      fs.readFileSync = (path, ...args) => read(path === ${JSON.stringify(join(import.meta.dirname, "../mods/personal-cockpit/jira.config.json"))} ? ${JSON.stringify(config)} : path, ...args);
      syncBuiltinESMExports();
      globalThis.jiraMock = ${state};
    `);
    const adjacent = run([]);
    assert.equal(adjacent.status, 0);
    assert.equal(adjacent.data.jql, "project = TEST");
  } finally { f.close(); }
});

test("OAuth adapter uses the existing Pi store, same server identity and refresh locks", async () => {
  const f = fixture();
  try {
    f.write("mcp.json", JSON.stringify({ mcpServers: { atlassian: { url: SERVER, oauth: { clientName: "pi" } } } }));
    const connection = await connectPi(f.dir);
    assert.deepEqual(f.mock.server, { name: "atlassian", url: SERVER });
    assert.equal(f.mock.dir, f.dir); assert.equal(f.mock.backend.path, join(f.dir, "mcp-auth.json"));
    assert.equal(f.mock.transport.url, SERVER); assert.equal(f.mock.transport.openGetStream, false);
    assert.equal(f.mock.oauth.settings().clientName, "pi"); f.mock.oauth.onChallenge({});
    assert.equal(f.mock.options.requestTimeoutMs, 25000);
    assert.throws(() => connection.call("createJiraIssue", {}), /only permits Jira searches/);
    await connection.call("searchJiraIssuesUsingJql", { jql: "test" });
    assert.equal(f.mock.called.name, "searchJiraIssuesUsingJql"); assert.equal(f.mock.called.options.timeoutMs, 25000);
    // Fetch always has a timeout, with and without a caller's cancellation signal.
    const originalFetch = globalThis.fetch;
    try {
      const received = [];
      globalThis.fetch = async (input, init) => { received.push({ input, init }); return { ok: true }; };
      await f.mock.transport.fetch("https://example.test", {});
      await f.mock.transport.fetch("https://example.test", { signal: new AbortController().signal });
      assert.ok(received.every((r) => r.init.signal instanceof AbortSignal));
    } finally { globalThis.fetch = originalFetch; }
    await connection.close(); assert.equal(f.mock.closed, 1); assert.equal(f.mock.settled, 1);
  } finally { f.close(); }
});

test("OAuth settings default to empty and connection failures close and settle refreshes", async () => {
  const f = fixture();
  try {
    const connection = await connectPi(f.dir); assert.deepEqual(f.mock.oauth.settings(), {}); await connection.close();
    f.mock.error = new Error("offline"); f.mock.closeError = true;
    await assert.rejects(() => connectPi(f.dir), /offline/);
    assert.equal(f.mock.closed, 2); assert.equal(f.mock.settled, 2);
  } finally { f.close(); }
});

test("disabled, different-URL and static-token servers fail closed", async () => {
  const f = fixture();
  try {
    for (const entry of [{ url: SERVER, enabled: false }, { url: "https://other.example/mcp" }, { url: SERVER, headers: { Authorization: "secret" } }, null]) {
      f.write("mcp.json", JSON.stringify({ mcpServers: { atlassian: entry } }));
      await assert.rejects(() => connectPi(f.dir), (e) => e.kind === "setup");
    }
  } finally { f.close(); }
});

test("missing login never starts a browser flow or creates credentials", async () => {
  const f = fixture();
  try {
    f.mock.state = undefined;
    await assert.rejects(() => connectPi(f.dir), (e) => e.kind === "auth");
    f.mock.state = {};
    await assert.rejects(() => connectPi(f.dir), (e) => e.kind === "auth");
    rmSync(join(f.dir, "mcp-auth.json"));
    await assert.rejects(() => connectPi(f.dir), /pi mcp login atlassian/);
    assert.equal(f.mock.closed, 0);
  } finally { f.close(); }
});

test("invalid managed version stays a setup error", async () => {
  const f = fixture();
  try { f.write("install/current-version", "../bad"); await assert.rejects(() => connectPi(f.dir), (e) => e.kind === "setup"); }
  finally { f.close(); }
});
