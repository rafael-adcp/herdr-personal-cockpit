// github.js: everything that talks to GitHub, through the `gh` CLI.
//
// The error taxonomy is the valuable part. Each panel offers a different fix
// depending on the `kind` of the throw -- install gh, sign in, pick another
// repo -- so a message classified wrongly sends somebody to the wrong button.
// It can only be tested where the subprocess answers, which is why this file
// drives `exec` rather than any of github.js's own functions.
//
// Two things here cache in the module for the life of the process: which `gh`
// answered, and the login. The tests are therefore ordered -- the failures come
// before the successes that cache -- and say so where it matters.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { ghCommand, resolve, graphql, rest, createIssue, repoList, viewer, ago, agoShort } from "../mods/personal-cockpit/kit/github.js";
import { host, reset } from "./support/host/herdr.js";
import { gh, apiCalls } from "./support/gh.js";

const WINDOWS_GH = "C:\\Program Files\\GitHub CLI\\gh.exe";

beforeEach(() => reset());

// ---- finding gh (before anything caches) ----------------------------------

test("before anything has answered, the command is plain gh", () => {
  assert.equal(ghCommand(), "gh");
});

test("every candidate failing is a no-gh error, carrying the last reason", async () => {
  host.onExec = () => ({ code: 1, stdout: "", stderr: "not recognized" });
  await assert.rejects(resolve(), (e) => {
    assert.equal(e.kind, "no-gh");
    assert.match(e.message, /not recognized/);
    return true;
  });
  // Six candidates are tried before giving up.
  assert.equal(host.exec.length, 6);
  assert.equal(host.exec[0].command, "gh");
});

test("a candidate that throws is not fatal: the next one is tried", async () => {
  host.onExec = (command) => {
    if (command === "gh") throw new Error("ENOENT");
    return { code: 1, stdout: "", stderr: "no" };
  };
  await assert.rejects(resolve(), { kind: "no-gh" });
  assert.equal(host.exec.length, 6);
});

test("a gh that is not on PATH is found at its install path, and remembered", async () => {
  // Herdr's environment is the one it started with, so a gh installed
  // afterwards is not on its PATH until the app restarts. This is load-bearing
  // on Windows, where the installer does not touch a running process's PATH.
  host.onExec = (command) =>
    command === WINDOWS_GH
      ? { code: 0, stdout: "gh version 2.62.0", stderr: "" }
      : { code: 1, stdout: "", stderr: "not found" };

  assert.equal(await resolve(), WINDOWS_GH);
  assert.equal(ghCommand(), WINDOWS_GH, "the gh that answered is what terminal.open should use");

  // Remembered: a second call probes nothing.
  reset();
  assert.equal(await resolve(), WINDOWS_GH);
  assert.deepEqual(host.exec, []);
});

// ---- the error taxonomy ---------------------------------------------------

const refuses = (stderr, code = 1) => {
  host.onExec = () => ({ code, stdout: "", stderr });
};

test("never having signed in is no-auth, so the panel offers the login", async () => {
  for (const message of [
    "gh auth login required",
    "You are not logged in to any GitHub hosts",
    "authentication failed",
    "GH_TOKEN is invalid",
    "HTTP 401: Bad credentials",
    "HTTP 403: Forbidden",
  ]) {
    refuses(message);
    await assert.rejects(rest("user"), (e) => {
      assert.equal(e.kind, "no-auth", message);
      return true;
    });
  }
});

test("a repo that is not there is not-found, which is also what no access looks like", async () => {
  // GitHub answers 404, not 403, for a private repo the token cannot see.
  for (const message of ["HTTP 404: Not Found", "Not Found"]) {
    refuses(message);
    await assert.rejects(rest("repos/acme/ghost"), (e) => {
      assert.equal(e.kind, "not-found", message);
      return true;
    });
  }
});

test("anything else is a plain error", async () => {
  refuses("HTTP 500: Internal Server Error");
  await assert.rejects(rest("user"), { kind: "error" });
  refuses("could not resolve host");
  await assert.rejects(rest("user"), { kind: "error" });
});

test("auth is checked before not-found, so a 401 is not read as a missing repo", async () => {
  refuses("HTTP 401: Not Found");
  await assert.rejects(rest("user"), { kind: "no-auth" });
});

test("a failure with no message at all still says which call failed", async () => {
  refuses("", 7);
  await assert.rejects(rest("user"), (e) => {
    assert.equal(e.kind, "error");
    assert.match(e.message, /gh api exited 7/);
    return true;
  });
});

test("a success that is not JSON is an error naming what came back", async () => {
  host.onExec = () => ({ code: 0, stdout: "<!DOCTYPE html><html>a proxy login page", stderr: "" });
  await assert.rejects(rest("user"), (e) => {
    assert.equal(e.kind, "error");
    assert.match(e.message, /couldn't read gh's answer: <!DOCTYPE html>/);
    return true;
  });
});

test("an error on stderr is classified even when gh printed it alongside output", async () => {
  host.onExec = () => ({ code: 1, stdout: "{}", stderr: "HTTP 404: Not Found" });
  await assert.rejects(rest("x"), { kind: "not-found" });
});

// ---- GraphQL --------------------------------------------------------------

test("a GraphQL error list is a throw, not a half-drawn panel", async () => {
  host.onExec = (command, args) =>
    args[0] === "--version"
      ? { code: 0, stdout: "v", stderr: "" }
      : { code: 0, stdout: JSON.stringify({ errors: [{ message: "Field 'x' doesn't exist" }, { message: "and another" }] }), stderr: "" };
  await assert.rejects(graphql("query {}"), (e) => {
    assert.equal(e.kind, "error");
    assert.match(e.message, /Field 'x' doesn't exist; and another/);
    return true;
  });
});

test("a GraphQL error about credentials is no-auth", async () => {
  gh([["query", { errors: [{ message: "Bad credentials" }] }]]);
  await assert.rejects(graphql("query {}"), { kind: "no-auth" });
});

test("an answer with no data is an error rather than an empty list", async () => {
  gh([["query", { data: null }]]);
  await assert.rejects(graphql("query {}"), (e) => {
    assert.match(e.message, /gh returned no data/);
    return true;
  });
});

test("the data is returned unwrapped", async () => {
  gh([["query", { data: { viewer: { login: "rafael" } } }]]);
  assert.deepEqual(await graphql("query {}"), { viewer: { login: "rafael" } });
});

test("variables go as -f, never spliced into the document", async () => {
  // That is how a search string somebody wrote in a config file reaches the
  // API without one quote of theirs changing what the document means.
  gh([["query", { data: {} }]]);
  await graphql("query($q: String!) {}", null, { q: 'a "quoted" thing', n: 7 });
  const { args } = apiCalls()[0];
  assert.deepEqual(args.slice(0, 3), ["api", "graphql", "-f"]);
  assert.ok(args.includes('q=a "quoted" thing'));
  assert.ok(args.includes("n=7"));
});

test("a preview media type is added as a header only when asked for", async () => {
  gh([["query", { data: {} }]]);
  await graphql("query {}", "Accept: application/vnd.github.merge-info-preview+json");
  assert.ok(apiCalls()[0].args.includes("-H"));
  assert.ok(apiCalls()[0].args.includes("Accept: application/vnd.github.merge-info-preview+json"));

  reset();
  gh([["query", { data: {} }]]);
  await graphql("query {}");
  assert.equal(apiCalls()[0].args.includes("-H"), false);
});

// ---- REST -----------------------------------------------------------------

test("a REST path is passed through as given", async () => {
  gh([["repos/acme/app/issues", [{ number: 1 }]]]);
  assert.deepEqual(await rest("repos/acme/app/issues?state=open"), [{ number: 1 }]);
  assert.deepEqual(apiCalls()[0].args, ["api", "repos/acme/app/issues?state=open"]);
});

// ---- opening an issue -----------------------------------------------------

test("an issue is opened with its fields as arguments, and labels repeated", async () => {
  // `exec` has no stdin, so there is no JSON body to send; `-f` is gh's own
  // string-field form and `labels[]=` is how it builds an array.
  gh([["POST", { number: 7, html_url: "https://github.com/acme/tasks/issues/7" }]]);
  const made = await createIssue("acme/tasks", {
    title: "Prune branches",
    body: "### Goal\n\nDo it.\n\n### Acceptance\n\nDone.",
    labels: ["kraken-task", "project:chores"],
  });

  assert.equal(made.number, 7);
  const { args } = apiCalls()[0];
  assert.deepEqual(args.slice(0, 4), ["api", "-X", "POST", "repos/acme/tasks/issues"]);
  assert.ok(args.includes("title=Prune branches"));
  assert.ok(args.includes("body=### Goal\n\nDo it.\n\n### Acceptance\n\nDone."), "a multi-line body is fine in an argument");
  assert.deepEqual(args.filter((a) => String(a).startsWith("labels[]=")), ["labels[]=kraken-task", "labels[]=project:chores"]);
});

test("an issue with no labels sends none", async () => {
  gh([["POST", { number: 8 }]]);
  await createIssue("acme/tasks", { title: "t", body: "b" });
  assert.deepEqual(apiCalls()[0].args.filter((a) => String(a).startsWith("labels[]=")), []);
});

// ---- the repo list --------------------------------------------------------

test("the picker's suggestions are the repos gh listed", async () => {
  gh([["repo", [{ nameWithOwner: "acme/app", isPrivate: false, updatedAt: "2026-01-01" }]]]);
  const found = await repoList();
  assert.deepEqual(found.map((r) => r.nameWithOwner), ["acme/app"]);
  assert.deepEqual(apiCalls()[0].args, ["repo", "list", "--limit", "100", "--json", "nameWithOwner,isPrivate,updatedAt"]);
});

test("an owner narrows the list, which is how another account is reachable", async () => {
  // A bare `gh repo list` only knows the authenticated user's own.
  gh([["repo", []]]);
  await repoList("some-org", 25);
  assert.deepEqual(apiCalls()[0].args, ["repo", "list", "some-org", "--limit", "25", "--json", "nameWithOwner,isPrivate,updatedAt"]);
});

test("suggestions are a nicety, so failure is an empty list and not a throw", async () => {
  // The picker always accepts a typed owner/name.
  refuses("HTTP 401: Bad credentials");
  assert.deepEqual(await repoList(), []);

  host.onExec = () => ({ code: 0, stdout: "not json", stderr: "" });
  assert.deepEqual(await repoList(), []);

  host.onExec = () => ({ code: 0, stdout: JSON.stringify({ message: "nope" }), stderr: "" });
  assert.deepEqual(await repoList(), []);
});

// ---- the login (caches on success, so failure is tested first) ------------

test("a login that cannot be read is null, not a throw", async () => {
  // "Signed in at all" gets answered without a panel having to interpret an
  // error. A failure does not cache, so the next poll asks again.
  refuses("HTTP 401: Bad credentials");
  assert.equal(await viewer(), null);

  gh([["viewer", { data: { viewer: null } }]]);
  assert.equal(await viewer(), null);
});

test("the login is read once and remembered", async () => {
  gh([["viewer", { data: { viewer: { login: "rafael" } } }]]);
  assert.equal(await viewer(), "rafael");

  reset();
  assert.equal(await viewer(), "rafael");
  assert.deepEqual(host.exec, [], "the login was asked for twice");
});

// ---- ages -----------------------------------------------------------------

const agesAgo = (seconds) => Date.now() - seconds * 1000;

test("an age reads in the largest unit that fits", () => {
  assert.equal(ago(agesAgo(5)), "just now");
  assert.equal(ago(agesAgo(59)), "just now");
  assert.equal(ago(agesAgo(60)), "1m ago");
  assert.equal(ago(agesAgo(59 * 60)), "59m ago");
  assert.equal(ago(agesAgo(3600)), "1h ago");
  assert.equal(ago(agesAgo(23 * 3600)), "23h ago");
  assert.equal(ago(agesAgo(86400)), "1d ago");
  assert.equal(ago(agesAgo(29 * 86400)), "29d ago");
  assert.equal(ago(agesAgo(2592000)), "1mo ago");
  assert.equal(ago(agesAgo(365 * 86400)), "12mo ago");
});

test("the short form fits a sidebar row", () => {
  assert.equal(agoShort(agesAgo(5)), "now");
  assert.equal(agoShort(agesAgo(60)), "1m");
  assert.equal(agoShort(agesAgo(3600)), "1h");
  assert.equal(agoShort(agesAgo(86400)), "1d");
  assert.equal(agoShort(agesAgo(2592000)), "1mo");
});

test("an ISO string reads the same as an epoch", () => {
  const when = new Date(Date.now() - 3600 * 1000).toISOString();
  assert.equal(ago(when), "1h ago");
  assert.equal(agoShort(when), "1h");
});

test("a date in the future is just now, not a negative age", () => {
  assert.equal(ago(Date.now() + 60_000), "just now");
  assert.equal(agoShort(Date.now() + 60_000), "now");
});

test("an age that cannot be read draws nothing rather than NaN", () => {
  for (const bad of [null, undefined, "", "not a date", 0, {}]) {
    assert.equal(ago(bad), "", JSON.stringify(bad));
    assert.equal(agoShort(bad), "", JSON.stringify(bad));
  }
});
