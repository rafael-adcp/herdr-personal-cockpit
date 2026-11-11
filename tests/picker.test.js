// picker.js: the dialog that chooses which repo a panel watches.
//
// It is a screen of this mod rather than a second mod folder, which is the
// other half of what `props.kind` buys (see main.js).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Picker } from "../mods/personal-cockpit/screens/picker.js";
import { recent, repoOf } from "../mods/personal-cockpit/kit/config.js";
import { host, reset, theme } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { gh, apiCalls } from "./support/gh.js";

const view = {};

const repos = (...names) => gh([["repo", names.map((nameWithOwner) => ({ nameWithOwner }))]]);

beforeEach(() => reset());

// ---- opening it -----------------------------------------------------------

test("it watches the panel it was opened for, defaulting to the queue", () => {
  host.props = { kind: "repo-picker", panel: "work-issues" };
  assert.equal(new Picker(view, cx()).panel, "work-issues");

  reset();
  host.props = { kind: "repo-picker" };
  assert.equal(new Picker(view, cx()).panel, "issues");
});

test("the repo already chosen is there, selected, ready to be replaced", () => {
  // Typing over it is the common case; having to clear it first would not be.
  host.props = { kind: "repo-picker", current: "acme/app" };
  const picker = new Picker(view, cx());
  assert.equal(picker.text, "acme/app");
  assert.deepEqual(picker.input.range, { start: 0, end: "acme/app".length });
});

test("with nothing chosen yet, the field is empty and unselected", () => {
  const picker = new Picker(view, cx());
  assert.equal(picker.text, "");
  assert.equal(picker.input.range, null);
});

test("the field is focused now and again once the overlay has animated in", () => {
  // The first focus can land before the overlay exists.
  const context = cx();
  const picker = new Picker(view, context);
  assert.equal(picker.input.focused, 1);

  const late = context.timers.find((t) => t.ms === 600);
  assert.ok(late, "nothing re-focuses the field after the overlay appears");
  late.fn(context);
  assert.equal(picker.input.focused, 2);
});

// ---- suggestions ----------------------------------------------------------

test("it offers the repos gh could list", async () => {
  repos("acme/app", "acme/tools");
  const context = cx({ spawn: "run" });
  const picker = new Picker(view, context);
  await context.settle();
  assert.deepEqual(picker.suggestions, ["acme/app", "acme/tools"]);
  assert.equal(picker.looking, false);
});

test("typing filters what was offered", async () => {
  repos("acme/app", "acme/tools", "other/thing");
  const context = cx({ spawn: "run" });
  const picker = new Picker(view, context);
  await context.settle();

  picker.text = "too";
  assert.deepEqual(picker.matches(), ["acme/tools"]);
  picker.text = "ACME";
  assert.deepEqual(picker.matches(), ["acme/app", "acme/tools"]);
});

test("a repo already remembered is not offered twice", async () => {
  // It is in the recent list above, so repeating it in the suggestions below
  // would be the same row twice.
  host.shared.set("cockpit.issues.recent", ["acme/app"]);
  repos("acme/app", "acme/tools");
  const context = cx({ spawn: "run" });
  const picker = new Picker(view, context);
  await context.settle();
  assert.deepEqual(picker.matches(), ["acme/tools"]);
});

test("the list of suggestions is capped", async () => {
  repos(...Array.from({ length: 20 }, (_, n) => `acme/r${n}`));
  const context = cx({ spawn: "run" });
  const picker = new Picker(view, context);
  await context.settle();
  assert.equal(picker.matches().length, 8);
});

test("only the owner half starts a new lookup", async () => {
  // Each lookup is a `gh` process, and typing the name part cannot change
  // whose repos they are. Note that going from nothing typed to `acme/` *is* an
  // owner change -- from none to "acme" -- so the lookup it triggers is right.
  repos("acme/app");
  const context = cx({ spawn: "run" });
  const picker = new Picker(view, context);
  await context.settle();

  picker.text = "acme/";
  picker.look(context);
  await context.settle();
  const settled = apiCalls().length;
  assert.equal(picker.owner, "acme");

  for (const text of ["acme/a", "acme/ap", "acme/app"]) {
    picker.text = text;
    picker.look(context);
  }
  await context.settle();
  assert.equal(apiCalls().length, settled, "typing the name half asked gh again");

  picker.text = "other/";
  picker.look(context);
  await context.settle();
  assert.equal(apiCalls().length, settled + 1, "a new owner should ask gh");
});

test("an owner gh has nothing to say about is not asked about twice", async () => {
  // The expensive case, and the one the guard used to miss: an org this login
  // cannot list answers with no repos, so there was nothing to remember the
  // lookup by and every pause in typing spawned another `gh`.
  repos();
  const context = cx({ spawn: "run" });
  const picker = new Picker(view, context);
  await context.settle();
  const settled = apiCalls().length;

  for (const text of ["acme/", "acme/a", "acme/ap"]) {
    picker.text = text;
    picker.look(context);
    await context.settle();
  }

  assert.deepEqual(picker.suggestions, []);
  assert.equal(apiCalls().length, settled + 1, "one lookup for the owner, not one per keystroke");
});

test("typing asks gh once per pause, not once per keystroke", async () => {
  repos("acme/app");
  const context = cx({ spawn: "run" });
  const picker = new Picker(view, context);
  await context.settle();
  const before = apiCalls().length;

  // Four keystrokes, each scheduling a lookup.
  for (const text of ["o", "ot", "oth", "other/"]) {
    picker.text = text;
    picker.schedule(context);
  }
  // Every debounce timer fires, but only the last one is still the newest.
  for (const timer of context.timers.filter((t) => t.ms === 350)) timer.fn(context);
  await context.settle();

  assert.equal(apiCalls().length, before + 1, "the debounce let more than one lookup through");
});

test("gh failing leaves the dialog usable, because a repo can be typed", async () => {
  host.onExec = () => ({ code: 1, stdout: "", stderr: "HTTP 401: Bad credentials" });
  const context = cx({ spawn: "run" });
  const picker = new Picker(view, context);
  await context.settle();
  assert.deepEqual(picker.suggestions, []);
  assert.deepEqual(picker.matches(), []);
});

// ---- choosing -------------------------------------------------------------

test("choosing a repo sets it and closes the dialog", () => {
  host.props = { kind: "repo-picker", overlay: "overlay-1" };
  host.overlays.push({ id: "overlay-1" });
  const picker = new Picker(view, cx());

  picker.save("acme/app");
  assert.equal(repoOf("issues").repo, "acme/app");
  assert.deepEqual(recent("issues"), ["acme/app"]);
  assert.deepEqual(host.overlays, []);
});

test("something that cannot be a repo leaves the dialog open", () => {
  // Closing on a rejected value would look like it worked.
  host.props = { kind: "repo-picker", overlay: "overlay-1" };
  host.overlays.push({ id: "overlay-1" });
  const picker = new Picker(view, cx());

  picker.save("personal-tasks");
  assert.equal(repoOf("issues").repo, null);
  assert.equal(host.overlays.length, 1);
});

test("pressing enter in the field chooses what was typed", () => {
  host.props = { kind: "repo-picker", overlay: "overlay-1" };
  host.overlays.push({ id: "overlay-1" });
  const context = cx();
  const picker = new Picker(view, context);

  picker.input.type("acme/typed", context);
  picker.input.submit(context);
  assert.equal(repoOf("issues").repo, "acme/typed");
  assert.deepEqual(host.overlays, []);
});

test("escape closes it and goes no further", () => {
  host.props = { kind: "repo-picker", overlay: "overlay-1" };
  host.overlays.push({ id: "overlay-1" });
  const context = cx();
  const picker = new Picker(view, context);

  picker.key({ key: "escape" }, context);
  assert.deepEqual(host.overlays, []);
  assert.equal(context.stopped, 1);
});

test("any other key is left to the field", () => {
  host.props = { kind: "repo-picker", overlay: "overlay-1" };
  host.overlays.push({ id: "overlay-1" });
  const context = cx();
  const picker = new Picker(view, context);

  picker.key({ key: "a" }, context);
  assert.equal(host.overlays.length, 1);
  assert.equal(context.stopped, 0);
});

test("focus and blur are tracked, because the border follows them", () => {
  const context = cx();
  const picker = new Picker(view, context);
  assert.equal(picker.inputFocused, true);
  picker.input.fire("blur", context);
  assert.equal(picker.inputFocused, false);
  picker.input.fire("focus", context);
  assert.equal(picker.inputFocused, true);
});

// ---- drawing --------------------------------------------------------------

test("the dialog renders empty, with suggestions, and with a recent list", async () => {
  host.shared.set("cockpit.issues.recent", ["acme/kept", "acme/also-kept"]);
  repos("acme/app", "acme/tools");
  const context = cx({ spawn: "run" });
  const picker = new Picker(view, context);

  assert.doesNotThrow(() => picker.render(context), "while still looking");
  await context.settle();
  assert.doesNotThrow(() => picker.render(context), "with suggestions");

  picker.text = "nothing matches this";
  assert.doesNotThrow(() => picker.render(context), "with no matches");
});

test("an option row builds, with and without the forget button", () => {
  const picker = new Picker(view, cx());
  assert.doesNotThrow(() => picker.option(theme(), "o-1", "acme/app", null));
  assert.doesNotThrow(() => picker.option(theme(), "o-2", "acme/app", () => {}));
});
