// Everything that talks to GitHub, for every panel in this mod.
//
// One way in: the `gh` CLI. It already holds the login (its own keyring, or
// GH_TOKEN) and behaves the same on Windows, macOS and Linux. The tasks panel
// used to read a bearer token out of Git Credential Manager through a
// PowerShell script instead -- Windows-only, and a second login path to keep
// working for no gain, since gh was installed and authenticated anyway.

import { appHome, exec, readTextFile } from "herdr";

// Herdr's env is the one it started with: a gh installed after that isn't on
// its PATH until the app restarts, so the usual install spots are tried too.
// This is load-bearing on Windows, where the installer does not touch the PATH
// of an already-running process.
const CANDIDATES = [
  "gh",
  "C:\\Program Files\\GitHub CLI\\gh.exe",
  "C:\\Program Files (x86)\\GitHub CLI\\gh.exe",
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
  "/usr/bin/gh",
];

/** Errors carry a `kind` so a panel can offer the right fix:
 *  "no-gh" (not installed), "no-auth" (never signed in), "not-found" (no such
 *  repo, or the login cannot see it), "error" (anything else). Plain objects,
 *  not Error subclasses: `instanceof` across a hot reload isn't worth relying on. */
const fail = (kind, message) => Object.assign(new Error(message), { kind });

const AUTH = /auth login|not logged in|authentication|GH_TOKEN|bad credentials|HTTP 401|HTTP 403/i;
// GitHub answers 404, not 403, for a private repo the token cannot see.
const MISSING = /HTTP 404|Not Found/i;

let found = null;

/** The gh that answered last, for `terminal.open` to use. */
export function ghCommand() {
  return found ?? "gh";
}

// ---- demo mode ------------------------------------------------------------

// One file in the Herdr home answers every call `gh` would have made.
//
// It is here and not in the panels because every panel, and the repo picker,
// reaches GitHub through the one `ask` below -- so demo mode is a single
// decision in a single place, and the judgement each panel makes about what it
// gets back is the real one. A demo row went through `shape` exactly as a live
// row does.
//
// What it is for: seeing all four panels full, and shooting them. Until now a
// screenshot of a panel was a picture of whatever happened to be in somebody's
// queue that morning -- not reproducible, and not publishable. It also makes
// the window usable on a machine with no `gh`, no login and no network, which
// is what a demonstration needs and what a plane has.
//
// It does *not* help `herdr-app check`: check renders once and does not wait on
// later async states, so the panel it draws is still empty however fast the
// answer is. gallery.js is the screen that covers that, by holding its data
// rather than loading it.
//
// Scoped by the home rather than by a flag: `HERDR_APP_HOME` is how both
// installers already target another home, so the file lives in the throwaway
// one the sandbox builds and the real home never has it. There is no env var
// because a mod cannot read one -- `exec` passes the environment to a child,
// but nothing hands it to the JS.
const DEMO = "personal-cockpit-demo.json";

/**
 * The routes, or null when this home has no demo file.
 *
 * Read on every call, not once: editing the file then shows up on the next
 * poll with no reload, which is the whole point of a file you iterate
 * screenshots with. A read that finds nothing costs a stat, next to the
 * process spawn it is standing in front of.
 */
async function routes() {
  try {
    const body = await readTextFile(`${appHome()}/${DEMO}`);
    if (body === null) return null;
    const parsed = JSON.parse(body);
    return Array.isArray(parsed?.routes) ? parsed.routes : null;
  } catch {
    // A demo file that does not parse must not look like a GitHub outage: fall
    // through to the real gh and let the panel say whatever is true.
    return null;
  }
}

/**
 * Every `gh` call goes through here. With no demo file it is `exec`.
 *
 * A route answers when its `match` appears anywhere in the arguments, which is
 * the same rule the test suite's own `gh` double uses, for the same reason:
 * the request is a GraphQL document or a REST path, and naming the one
 * distinctive word in it is steadier than reproducing the whole thing.
 *
 * An unrouted call fails rather than returning empty, so a panel that reaches
 * somewhere the demo file does not cover says so in its header instead of
 * drawing a convincing blank.
 */
async function ask(gh, args) {
  const demo = await routes();
  if (!demo) return exec(gh, args);
  const route = demo.find((r) => args.some((arg) => String(arg).includes(r.match)));
  if (!route) return { code: 1, stdout: "", stderr: `demo mode: no route for ${args.join(" ")}` };
  return { code: 0, stdout: JSON.stringify(route.json), stderr: "" };
}

export async function resolve() {
  // Nothing is executed in demo mode, so there is no binary to go looking for
  // -- and the probe would fail on a machine that has none, which is exactly
  // the machine demo mode is for. Before the cache, so that turning the file on
  // does not have to wait for a restart.
  if (await routes()) return "gh";
  if (found) return found;
  let last = "";
  for (const candidate of CANDIDATES) {
    try {
      const r = await exec(candidate, ["--version"]);
      if (r.code === 0) return (found = candidate);
      last = (r.stderr || r.stdout).trim();
    } catch (e) {
      last = String(e?.message ?? e);
    }
  }
  throw fail("no-gh", last || "gh not found");
}

// Turns gh's exit into either parsed JSON or a typed throw. Both GraphQL and
// REST come through here so every panel reports trouble the same way.
function answer(r, args) {
  const text = `${r.stdout}\n${r.stderr}`.trim();
  if (r.code !== 0) {
    const kind = AUTH.test(text) ? "no-auth" : MISSING.test(text) ? "not-found" : "error";
    throw fail(kind, text || `gh ${args[0]} exited ${r.code}`);
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw fail("error", `couldn't read gh's answer: ${r.stdout.slice(0, 200)}`);
  }
}

/** Runs a GraphQL query. `preview` adds an Accept header for a field still
 *  behind a preview media type; pass null for none.
 *
 *  `vars` becomes GraphQL variables -- every `-f` gh is given besides `query`
 *  is one. That is how a search string somebody wrote in a config file reaches
 *  the API without being spliced into the document, where one quote of theirs
 *  would change what the document means. */
export async function graphql(query, preview = null, vars = null) {
  const gh = await resolve();
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(vars ?? {})) args.push("-f", `${name}=${value}`);
  if (preview) args.push("-H", preview);
  const body = answer(await ask(gh, args), args);
  if (body.errors?.length) {
    const message = body.errors.map((e) => e.message).join("; ");
    throw fail(AUTH.test(message) ? "no-auth" : "error", message);
  }
  if (!body.data) throw fail("error", "gh returned no data");
  return body.data;
}

/** A REST call: `rest("repos/owner/name/issues?state=open")`. */
export async function rest(path) {
  const gh = await resolve();
  const args = ["api", path];
  return answer(await ask(gh, args), args);
}

/** Opens an issue, and resolves with the one GitHub made.
 *
 *  Fields go as arguments rather than a JSON body on stdin, because `exec` has
 *  no stdin: `-f` is gh's own string-field form, and `labels[]=` is how it
 *  builds an array out of repeated flags. A multi-line body is fine in an
 *  argument -- it is the shell that would have minded, and there is no shell. */
export async function createIssue(repo, { title, body, labels = [] }) {
  const gh = await resolve();
  const args = ["api", "-X", "POST", `repos/${repo}/issues`, "-f", `title=${title}`, "-f", `body=${body}`];
  for (const label of labels) args.push("-f", `labels[]=${label}`);
  return answer(await ask(gh, args), args);
}

/** `owner/name` for every repo the login can push to, for the repo picker's
 *  suggestions. `owner` narrows it to one user or org -- which is how a repo on
 *  another account (a work org) becomes reachable at all, since a bare
 *  `gh repo list` only knows the authenticated user's own.
 *  Resolves with [] rather than throwing: suggestions are a nicety, and the
 *  picker always accepts a typed `owner/name`. */
export async function repoList(owner = null, limit = 100) {
  try {
    const gh = await resolve();
    const args = ["repo", "list"];
    if (owner) args.push(owner);
    args.push("--limit", String(limit), "--json", "nameWithOwner,isPrivate,updatedAt");
    const r = await ask(gh, args);
    if (r.code !== 0) return [];
    const body = JSON.parse(r.stdout);
    return Array.isArray(body) ? body : [];
  } catch {
    return [];
  }
}

/** The issue-form templates a repo offers, by file name, newest API shape
 *  first. `config.yml` is the chooser's own settings, not a template.
 *
 *  Resolves with [] for a repo with no `.github/ISSUE_TEMPLATE` folder, which
 *  GitHub answers with a 404 — the same answer as no access, and harmless
 *  either way: no templates just means a blank new-issue form. */
export async function issueTemplates(repo) {
  try {
    const body = await rest(`repos/${repo}/contents/.github/ISSUE_TEMPLATE`);
    if (!Array.isArray(body)) return [];
    return body
      .filter((f) => f.type === "file" && /\.(ya?ml|md)$/i.test(f.name) && f.name.toLowerCase() !== "config.yml")
      .map((f) => f.name);
  } catch {
    return [];
  }
}

/** The signed-in login, or null. Cheap and cached: the header shows it in a
 *  tooltip, and it is how "signed in at all" gets answered without a panel
 *  having to interpret an error. */
let login = null;
export async function viewer() {
  if (login) return login;
  try {
    const data = await graphql("query { viewer { login } }");
    return (login = data.viewer?.login ?? null);
  } catch {
    return null;
  }
}

const seconds = (when) => {
  const at = typeof when === "number" ? when : Date.parse(when);
  return at ? Math.max(0, (Date.now() - at) / 1000) : null;
};

/** "just now", "6m ago", "3d ago". Takes an ISO string or an epoch in ms. */
export function ago(when) {
  const s = seconds(when);
  if (s === null) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / 2592000)}mo ago`;
}

/** The same, short enough for a sidebar row: "now", "6m", "3d". */
export function agoShort(when) {
  const s = seconds(when);
  if (s === null) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 2592000)}mo`;
}
