// One short-lived, read-only MCP connection per poll. No LLM, daemon or token copies.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { configOf, fetchIssues, PanelError, searchUrl } from "./jira-model.js";

const SERVER = "https://mcp.atlassian.com/v1/mcp";

export function piPackage(agentDir) {
  // Resolve the managed install's current version every time, not a pinned release.
  const version = readFileSync(join(agentDir, "install/current-version"), "utf8").trim();
  if (!/^[\w][\w.+-]*$/.test(version) || version === "." || version === "..") {
    throw new PanelError("setup", "The managed Pi installation has an invalid current-version file.");
  }
  return join(agentDir, "install/releases", version, "node_modules/@earendil-works/pi-coding-agent");
}

export async function connectPi(agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent")) {
  let pi;
  try { pi = piPackage(agentDir); } catch (e) {
    if (e instanceof PanelError) throw e;
    throw new PanelError("setup", "This panel needs the existing managed Pi installation and its Atlassian login.");
  }
  const configured = JSON.parse(readFileSync(join(agentDir, "mcp.json"), "utf8")).mcpServers?.atlassian;
  if (configured?.url !== SERVER || configured.enabled === false || configured.headers?.Authorization) {
    throw new PanelError("setup", "Enable the OAuth Atlassian server in ~/.pi/agent/mcp.json (https://mcp.atlassian.com/v1/mcp).");
  }
  if (!existsSync(join(agentDir, "mcp-auth.json"))) {
    throw new PanelError("auth", "Sign in with pi mcp login atlassian, then refresh this panel.");
  }

  // Use Pi's own credential store AND per-server refresh lock. Reimplementing
  // refresh here could rotate a token out from under an active Pi session.
  // This small adapter depends on Pi's internal OAuth module (tested on 1.4.0).
  // A missing/incompatible module fails closed and never changes configuration.
  const { McpClient, StreamableHttpTransport } = await import(pathToFileURL(join(pi, "../pi-mcp/dist/index.js")));
  const { McpOAuthCredentialStore, createMcpAuthProvider } = await import(pathToFileURL(join(pi, "dist/extensions/mcp/oauth.js")));
  const { FileAuthStorageBackend } = await import(pathToFileURL(join(pi, "dist/core/auth-storage.js")));
  const store = new McpOAuthCredentialStore(new FileAuthStorageBackend(join(agentDir, "mcp-auth.json")), agentDir)
    .forServer("atlassian", SERVER);
  const state = await store.load();
  if (!state?.tokens?.access_token) throw new PanelError("auth", "Sign in with pi mcp login atlassian, then refresh this panel.");
  const auth = createMcpAuthProvider({
    serverUrl: SERVER, store, settings: () => configured.oauth ?? {}, onChallenge() {},
  });
  const client = new McpClient({ name: "herdr-jira-tickets", version: "1.0.0", requestTimeoutMs: 25000 });
  const transport = new StreamableHttpTransport({
    url: SERVER, authProvider: auth, openGetStream: false,
    fetch: (input, init) => fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    }),
  });
  try {
    await client.connect(transport);
  } catch (e) {
    await client.close().catch(() => {});
    await auth.settled();
    throw e;
  }
  return {
    call: (name, args) => {
      // This is a read-only panel, even though the OAuth grant also has writes.
      if (name !== "searchJiraIssuesUsingJql") throw new PanelError("error", "This panel only permits Jira searches.");
      return client.callTool(name, args, { timeoutMs: 25000 });
    },
    close: async () => { await client.close(); await auth.settled(); },
  };
}

export async function poll(configPath, connect = connectPi, jql) {
  let config;
  try {
    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    config = configOf(jql === undefined ? saved : { ...saved, jql });
  } catch (e) {
    if (e instanceof PanelError) throw e;
    throw new PanelError("setup", "Create a valid jira.config.json in personal-cockpit (see jira.config.example.json).");
  }
  const connection = await connect();
  try {
    const items = await fetchIssues(connection.call, config);
    return { items, jql: config.jql, site: config.site, url: searchUrl(config), at: Date.now() };
  } finally { await connection.close(); }
}

export function publicError(error) {
  if (error instanceof PanelError) return { kind: error.kind, message: error.message };
  if (/Auth|Unauthorized/.test(error?.name ?? "") || error?.status === 401) {
    return { kind: "auth", message: "Atlassian sign-in expired. Run pi mcp login atlassian, then refresh." };
  }
  if (error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" || error?.code === "ENOENT") {
    return { kind: "setup", message: "Pi's MCP adapter is unavailable. Check your managed Pi installation (tested on 1.4.0)." };
  }
  // Raw OAuth/HTTP errors can contain credentials. Never forward them to the UI/logs.
  return { kind: "error", message: "Could not query Jira. Check your connection, Jira access and Pi Atlassian login, then retry." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await poll(process.argv[2] ?? fileURLToPath(new URL("./jira.config.json", import.meta.url)), connectPi, process.argv[3]);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: publicError(error) }) + "\n");
    process.exitCode = 1;
  }
}
