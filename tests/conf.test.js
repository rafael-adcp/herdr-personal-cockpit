// conf.js: the YAML file in the installed mod folder that configures a panel.
//
// The gear opens a file rather than a dialog, which is the whole configuration
// surface of two panels. It cannot go through `cx.open_url` -- that takes an
// http(s) URL by design -- so this is the third place in the mod that knows
// which platform it is on, and the only place that can be tested for it.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { pathOf, read, openFile } from "../mods/personal-cockpit/kit/conf.js";
import { host, reset } from "./support/host/herdr.js";

const FILE = "team.yml";
const PATH = "/herdr/mods/personal-cockpit/team.yml";
const EXAMPLE = "/herdr/mods/personal-cockpit/team.example.yml";

beforeEach(() => reset());

// ---- where the file lives -------------------------------------------------

test("a config file lives in the installed mod folder, not in the repo", () => {
  // The repo's path differs per machine; the installed folder does not.
  assert.equal(pathOf(FILE), PATH);
  assert.equal(pathOf("routines.yml"), "/herdr/mods/personal-cockpit/routines.yml");
});

test("the path follows the app home it was told", () => {
  host.home = "/somewhere/else";
  assert.equal(pathOf(FILE), "/somewhere/else/mods/personal-cockpit/team.yml");
});

// ---- reading it -----------------------------------------------------------

test("no file is missing, not empty", () => {
  // The panel says "the gear writes one" rather than "nothing configured".
  return read(FILE).then((file) => {
    assert.equal(file.missing, true);
    assert.equal(file.path, PATH);
    assert.deepEqual(file.config, {});
    assert.deepEqual(file.items, []);
    assert.deepEqual(file.problems, []);
  });
});

test("a file is parsed into its config and its list", async () => {
  host.files.set(PATH, ["query: org:acme", "people:", "  - alice", "  - bob"].join("\n"));
  const file = await read(FILE);
  assert.equal(file.missing, false);
  assert.deepEqual(file.config, { query: "org:acme" });
  assert.deepEqual(file.items, ["alice", "bob"]);
  assert.deepEqual(file.problems, []);
});

test("an empty file is present, not missing", () => {
  // Someone deleted the contents rather than the file: there is nothing to
  // seed and nothing to complain about.
  host.files.set(PATH, "");
  return read(FILE).then((file) => {
    assert.equal(file.missing, false);
    assert.deepEqual(file.config, {});
  });
});

test("what did not parse comes back with the rest", async () => {
  host.files.set(PATH, ["query: org:acme", "\tbad tab"].join("\n"));
  const file = await read(FILE);
  assert.deepEqual(file.config, { query: "org:acme" });
  assert.equal(file.problems.length, 1);
  assert.match(file.problems[0], /line 2: tab indentation/);
});

// ---- opening it -----------------------------------------------------------

test("the gear hands the path to whatever opens a .yml", async () => {
  host.files.set(PATH, "query: org:acme\n");
  await openFile(FILE);
  assert.deepEqual(host.exec, [{ command: "xdg-open", args: [PATH] }]);
});

test("on Windows it goes through start, with an empty window title", async () => {
  // `start` takes its first argument as the title, which would otherwise eat
  // the path.
  host.platform = "windows";
  host.files.set(PATH, "x: 1\n");
  await openFile(FILE);
  assert.deepEqual(host.exec, [{ command: "cmd", args: ["/c", "start", "", PATH] }]);
});

test("on macOS it goes through open", async () => {
  host.platform = "macos";
  host.files.set(PATH, "x: 1\n");
  await openFile(FILE);
  assert.deepEqual(host.exec, [{ command: "open", args: [PATH] }]);
});

test("an unknown platform gets the freedesktop opener", async () => {
  host.platform = undefined;
  host.files.set(PATH, "x: 1\n");
  await openFile(FILE);
  assert.equal(host.exec[0].command, "xdg-open");
});

test("a file that is not there is written from the example first", async () => {
  // A gear that handed the desktop a path with no file at it gets an error
  // dialog, which neither explains the problem nor fixes it.
  host.files.set(EXAMPLE, "query: org:example\n");
  await openFile(FILE);
  assert.equal(host.files.get(PATH), "query: org:example\n");
  assert.deepEqual(host.exec, [{ command: "xdg-open", args: [PATH] }]);
});

test("an existing file is never overwritten by the example", async () => {
  host.files.set(PATH, "query: mine\n");
  host.files.set(EXAMPLE, "query: org:example\n");
  await openFile(FILE);
  assert.equal(host.files.get(PATH), "query: mine\n");
});

test("with no example either, it still opens the path", async () => {
  // The desktop will say what it thinks of that, which is its question to ask.
  await openFile(FILE);
  assert.equal(host.files.has(PATH), false);
  assert.deepEqual(host.exec, [{ command: "xdg-open", args: [PATH] }]);
});

test("losing a race to write it opens the winner's copy", async () => {
  // `null` as the expected text means "only if it is still absent", so the
  // write loses to whoever got there first instead of replacing their copy.
  //
  // The race is the point, so the file has to appear *between* the read that
  // found it absent and the write that follows: a file that was there all along
  // would skip the seeding branch entirely and test nothing.
  const real = host.files;
  real.set(EXAMPLE, "query: org:example\n");
  real.set(PATH, "query: theirs\n");

  let asked = 0;
  host.files = {
    has: (key) => (key === PATH && asked++ === 0 ? false : real.has(key)),
    get: (key) => real.get(key),
    set: (key, value) => real.set(key, value),
  };

  await openFile(FILE);

  assert.equal(asked > 1, true, "the write never checked whether it had lost");
  assert.equal(real.get(PATH), "query: theirs\n", "the winner's copy was replaced");
  assert.deepEqual(host.exec, [{ command: "xdg-open", args: [PATH] }]);
});
