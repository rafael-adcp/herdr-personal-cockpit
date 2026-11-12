// gallery.js: every piece of chrome on sample data.
//
// The gallery exists because `herdr-app check` renders one panel with an empty
// list, so a change to a shared piece was only ever checked against one of its
// callers. These tests are the same argument one level down: the gallery is
// only worth opening if it really draws all of them, and it is only safe to
// open if it cannot touch anything real while it does.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Gallery } from "../mods/personal-cockpit/screens/gallery.js";
import { shareKey } from "../mods/personal-cockpit/kit/urgent.js";
import * as issues from "../mods/personal-cockpit/panels/issues.js";
import * as pulls from "../mods/personal-cockpit/panels/pulls.js";
import * as routines from "../mods/personal-cockpit/panels/routines.js";
import * as team from "../mods/personal-cockpit/panels/team.js";
import { host, reset } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { callsOf, handlerOf, textOf } from "./support/element.js";

const view = {};
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "mods", "personal-cockpit", "screens", "gallery.js");

const render = () => new Gallery(view, cx()).render();

beforeEach(() => {
  reset();
});

test("it draws without a layout, a repo, a login or a single gh call", () => {
  // Which is the point: it is openable on a machine with nothing set up, and
  // the only screen here that owes nothing to the network.
  const el = render();
  assert.ok(textOf(el).includes("Personal Cockpit chrome"));
  assert.deepEqual(host.exec, []);
});

test("every panel's rows are drawn, which is the reason it exists", () => {
  const text = textOf(render());
  for (const source of [pulls, team, issues, routines]) {
    assert.ok(text.includes(source.title), `no ${source.panel} section`);
  }
  // One title from each panel's sample data, so a `rowOf` that throws or draws
  // nothing is caught rather than silently skipped.
  for (const title of [
    "Keep the last good list when a refresh fails",
    "Cache the issue templates per repo",
    "Decide whether routines get a cron field",
    "Weekly dependency sweep",
  ]) {
    assert.ok(text.includes(title), `no row titled ${title}`);
  }
});

test("the header bar is drawn in each of the states a panel can be in", () => {
  const text = textOf(render());
  assert.ok(text.includes("3 needs you"), "no attention pill");
  assert.ok(text.includes("sign in"), "no trouble line");
  assert.ok(text.includes("Choose repository"), "no button");
});

test("the drawer's own body is drawn, on rows of its own", () => {
  const text = textOf(render());
  assert.ok(text.includes("Needs you"));
  for (const label of ["Answer", "Fix", "Decide", "Configure"]) {
    assert.ok(text.includes(label), `the drawer sample is missing ${label}`);
  }
  assert.equal(text.includes("Review"), false, "Team reviews do not belong in the drawer sample");
  // The chrome that only exists while something has been put off, which is the
  // one state of the drawer nothing else gets to look at.
  assert.ok(text.includes("2 snoozed"));
});

test("it touches nothing real: no shared state read, none written", () => {
  // A gallery that wrote `cockpit.pulls.urgent` would poison the real drawer
  // with made-up rows, and one that read it would draw somebody's actual work
  // into a screenshot.
  host.shared.set(shareKey("pulls"), [
    { key: "pulls:private/repo#1", verb: "fix", title: "A REAL PULL REQUEST", reason: "x", url: null, at: 1 },
  ]);
  const before = new Map(host.shared);

  const text = textOf(render());

  assert.equal(text.includes("A REAL PULL REQUEST"), false, "the gallery read the panels' published rows");
  assert.deepEqual([...host.shared], [...before], "the gallery wrote to shared state");
  assert.deepEqual(host.run, []);
  assert.deepEqual(host.overlays, []);
});

test("pressing everything on it changes nothing and leads nowhere real", () => {
  // The panels' own sample rows are wired to a no-op, but the drawer's are
  // wired to `cx.open_url` by the drawer itself -- the gallery draws its real
  // body, not a copy of it. So a click there does open a page, and what this
  // guards is that it is a made-up one: no command, no process, no repository
  // of anybody's.
  const el = render();
  const context = cx();
  for (const args of callsOf(el, "on_click")) {
    const fn = args.find((arg) => typeof arg === "function");
    fn?.({}, context);
  }
  assert.deepEqual(host.run, []);
  assert.deepEqual(host.exec, []);
  assert.deepEqual(host.overlays, []);
  assert.ok(context.opened.length > 0, "the drawer sample should still have pressable rows");
  for (const url of context.opened) {
    assert.match(url, /^https:\/\/github\.com\/acme\//, `${url} is not in the made-up world`);
  }
});

test("escape closes it when it is an overlay, and is ignored when it is not", () => {
  host.props = { kind: "kit", overlay: "ov-1" };
  handlerOf(render(), "on_key_down")({ key: "escape" });
  assert.equal(host.overlays.length, 0, "closeOverlay pops, and there was nothing to pop");

  reset();
  host.overlays.push({ mod: "personal-cockpit" });
  host.props = { kind: "kit" };
  handlerOf(render(), "on_key_down")({ key: "escape" });
  assert.equal(host.overlays.length, 1, "a gallery in a block must not close somebody else's overlay");
});

test("its sample data stays in the made-up world", () => {
  // The rule in CONTRIBUTING.md, as a check: this file is the one that ships
  // with data in it, and a screenshot of the gallery is the likeliest place
  // for a real repo or login to escape into the repository.
  const body = readFileSync(SOURCE, "utf8");
  const urls = [...body.matchAll(/https?:\/\/[^\s"'`]+/g)].map(([url]) => url);
  assert.ok(urls.length > 0, "no sample URLs found -- has the data moved?");
  for (const url of urls) {
    assert.match(url, /^https:\/\/github\.com\/acme\//, `${url} is not in the made-up world`);
  }
});
