// config.js: which repo a panel watches, and the handful you switch between.
//
// Three places it can come from, most specific first: the layout pins one, the
// picker chose one, or nothing. The shared store here is the real thing with an
// in-memory backing, so these read back what the mod actually wrote.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { looksLikeRepo, repoOf, recent, choose, forget } from "../mods/personal-cockpit/kit/config.js";
import { host, reset } from "./support/host/herdr.js";

beforeEach(() => reset());

// ---- what can be a repo ---------------------------------------------------

test("owner/name is a repo", () => {
  for (const good of ["acme/app", "rafael-adcp/kraken", "a/b", "Org.With.Dots/repo_name", "a/b-c.d"]) {
    assert.equal(looksLikeRepo(good), true, good);
  }
});

test("surrounding whitespace does not stop it being one", () => {
  assert.equal(looksLikeRepo("  acme/app  "), true);
});

test("a bare name, a path and nothing are not repos", () => {
  // Enough to reject "" and "personal-tasks" without pretending to know what
  // GitHub allows.
  for (const bad of ["", "   ", "personal-tasks", "acme/app/extra", "/app", "acme/", "acme app", "acme/ap p", "/"]) {
    assert.equal(looksLikeRepo(bad), false, JSON.stringify(bad));
  }
});

test("anything that is not a string is not a repo", () => {
  for (const bad of [null, undefined, 7, {}, [], true, { repo: "acme/app" }]) {
    assert.equal(looksLikeRepo(bad), false, JSON.stringify(bad));
  }
});

// ---- where the repo comes from --------------------------------------------

test("with nothing chosen, the panel has no repo and offers the picker", () => {
  assert.deepEqual(repoOf("issues"), { repo: null, pinned: false });
});

test("a repo in the layout pins the block to it", () => {
  // Use it to show two task panels at once, personal and work side by side.
  host.props = { kind: "issues", repo: "acme/work" };
  assert.deepEqual(repoOf("issues"), { repo: "acme/work", pinned: true });
});

test("a pinned repo is trimmed", () => {
  host.props = { repo: "  acme/work  " };
  assert.deepEqual(repoOf("issues"), { repo: "acme/work", pinned: true });
});

test("the live choice is not pinned, so the gear stays", () => {
  host.shared.set("cockpit.issues.repo", "acme/personal");
  assert.deepEqual(repoOf("issues"), { repo: "acme/personal", pinned: false });
});

test("the layout wins over the live choice", () => {
  host.props = { repo: "acme/work" };
  host.shared.set("cockpit.issues.repo", "acme/personal");
  assert.equal(repoOf("issues").repo, "acme/work");
});

test("a layout that pinned nonsense falls through to the live choice", () => {
  host.props = { repo: "not-a-repo" };
  host.shared.set("cockpit.issues.repo", "acme/personal");
  assert.deepEqual(repoOf("issues"), { repo: "acme/personal", pinned: false });
});

test("nonsense in the store is ignored rather than shown", () => {
  host.shared.set("cockpit.issues.repo", "garbage");
  assert.deepEqual(repoOf("issues"), { repo: null, pinned: false });
});

test("each panel keeps its own repo", () => {
  host.shared.set("cockpit.issues.repo", "acme/one");
  host.shared.set("cockpit.other.repo", "acme/two");
  assert.equal(repoOf("issues").repo, "acme/one");
  assert.equal(repoOf("other").repo, "acme/two");
});

// ---- choosing -------------------------------------------------------------

test("choosing a repo sets it and remembers it", () => {
  assert.equal(choose("issues", "acme/app"), true);
  assert.equal(repoOf("issues").repo, "acme/app");
  assert.deepEqual(recent("issues"), ["acme/app"]);
});

test("choosing trims what was typed", () => {
  choose("issues", "  acme/app  ");
  assert.equal(repoOf("issues").repo, "acme/app");
  assert.deepEqual(recent("issues"), ["acme/app"]);
});

test("choosing something that cannot be a repo changes nothing", () => {
  assert.equal(choose("issues", "personal-tasks"), false);
  assert.equal(choose("issues", ""), false);
  assert.equal(choose("issues", null), false);
  assert.equal(repoOf("issues").repo, null);
  assert.deepEqual(recent("issues"), []);
});

test("the recent list is newest first", () => {
  choose("issues", "acme/one");
  choose("issues", "acme/two");
  choose("issues", "acme/three");
  assert.deepEqual(recent("issues"), ["acme/three", "acme/two", "acme/one"]);
});

test("choosing one again moves it to the front instead of duplicating it", () => {
  choose("issues", "acme/one");
  choose("issues", "acme/two");
  choose("issues", "acme/one");
  assert.deepEqual(recent("issues"), ["acme/one", "acme/two"]);
});

test("the recent list is capped, oldest dropped", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7]) choose("issues", `acme/r${n}`);
  const list = recent("issues");
  assert.equal(list.length, 6);
  assert.equal(list[0], "acme/r7");
  assert.equal(list.includes("acme/r1"), false);
});

test("forgetting one leaves the rest and the current pick alone", () => {
  choose("issues", "acme/one");
  choose("issues", "acme/two");
  forget("issues", "acme/one");
  assert.deepEqual(recent("issues"), ["acme/two"]);
  assert.equal(repoOf("issues").repo, "acme/two");
});

test("forgetting what was never there is harmless", () => {
  choose("issues", "acme/one");
  assert.doesNotThrow(() => forget("issues", "acme/nope"));
  assert.deepEqual(recent("issues"), ["acme/one"]);
});

test("a recent list that is not a list, or holds rubbish, reads as empty", () => {
  host.shared.set("cockpit.issues.recent", "not a list");
  assert.deepEqual(recent("issues"), []);
  host.shared.set("cockpit.issues.recent", ["acme/ok", "rubbish", null, 7]);
  assert.deepEqual(recent("issues"), ["acme/ok"]);
});
