// main.js: one mod, several screens, chosen by props.kind.
//
// This is what lets two layout blocks run the same mod and still be two
// different panels -- and what lets the mod open its own repo dialog as an
// overlay instead of needing a second mod folder for it.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import Cockpit from "../mods/personal-cockpit/main.js";
import { Drawer } from "../mods/personal-cockpit/drawer.js";
import { Gallery } from "../mods/personal-cockpit/gallery.js";
import { List } from "../mods/personal-cockpit/list.js";
import { Picker } from "../mods/personal-cockpit/picker.js";
import { host, reset } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { tree, panelBlock, placedAt } from "./support/factories.js";

beforeEach(() => {
  reset();
  host.layout = tree({ sidebar: [panelBlock("pulls")] });
});

test("the repo dialog is a screen of this mod, not a second mod folder", () => {
  host.props = { kind: "repo-picker", panel: "issues" };
  const mod = new Cockpit(host.props, cx());
  assert.ok(mod.screen instanceof Picker);
});

test("the floating drawer and the chrome gallery are screens of it too", () => {
  // Same argument as the dialog: a mod cannot import across folders, so a
  // second folder for either would mean a second copy of the chrome they draw.
  host.props = { kind: "urgent" };
  assert.ok(new Cockpit(host.props, cx()).screen instanceof Drawer);
  host.props = { kind: "kit" };
  assert.ok(new Cockpit(host.props, cx()).screen instanceof Gallery);
});

test("every other kind is a list", () => {
  for (const kind of ["pulls", "issues", "routines", "team"]) {
    host.props = { kind };
    assert.ok(new Cockpit(host.props, cx()).screen instanceof List, kind);
  }
});

test("no props at all is the pull requests panel", () => {
  // `herdr-app check` renders the mod with no props, so this is the screen it
  // checks -- and the reason the other three need their own tests.
  const mod = new Cockpit(undefined, cx());
  assert.ok(mod.screen instanceof List);
  assert.equal(mod.screen.source.panel, "pulls");
});

test("an unknown kind falls back to a list rather than drawing nothing", () => {
  host.props = { kind: "something-else" };
  const mod = new Cockpit(host.props, cx());
  assert.ok(mod.screen instanceof List);
  assert.equal(mod.screen.source.panel, "pulls");
});

test("render goes to whichever screen was chosen", () => {
  host.props = { kind: "pulls" };
  const context = cx();
  const mod = new Cockpit(host.props, context);
  let asked = 0;
  mod.screen = { render: () => void asked++ };
  mod.render(context);
  assert.equal(asked, 1);
});

test("the mod renders without throwing, for every screen it has", () => {
  for (const kind of ["pulls", "issues", "routines", "team", "repo-picker", "urgent", "kit", "jira", "jira-settings"]) {
    reset();
    host.layout = tree({ sidebar: [panelBlock(kind)] });
    // The drawer asks where it is hanging; every other screen ignores it.
    host.placement = placedAt("right");
    host.props = { kind, panel: "issues" };
    const context = cx();
    const mod = new Cockpit(host.props, context);
    assert.doesNotThrow(() => mod.render(context), kind);
  }
});
