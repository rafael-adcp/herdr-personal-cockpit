// The invariants of a mod folder, which no unit test would notice breaking.
//
// Three of these cover things `herdr-app check` cannot:
//
//   An SVG that fails to load draws nothing and reports nothing -- `status`
//   stays clean. That is the bug the README's junction warning is about, and
//   the only cheap guard is to assert every referenced file is really there.
//
//   `check` renders the mod once with no props, which is the pull requests
//   panel. The other three panels' icons are never resolved by it.
//
//   A mod cannot import across folders, and a relative import that climbs out
//   of the mod folder is the way that happens by accident -- most likely while
//   moving files into subfolders, where every `./x.js` becomes a `../x.js`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";

import * as pulls from "../mods/personal-cockpit/pulls.js";
import * as issues from "../mods/personal-cockpit/issues.js";
import * as routines from "../mods/personal-cockpit/routines.js";
import * as team from "../mods/personal-cockpit/team.js";
import Cockpit from "../mods/personal-cockpit/main.js";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const MOD_NAME = "personal-cockpit";
const MOD = join(ROOT, "mods", MOD_NAME);

/** Every .js in the mod, at any depth: the assertions below must keep holding
 *  if the files are ever grouped into subfolders. */
function sources(dir = MOD) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".js") ? [path] : [];
  });
}

const read = (path) => readFileSync(path, "utf8");
const shown = (path) => relative(ROOT, path).split(sep).join("/");

// ---- the assets really exist ----------------------------------------------

// Assets this mod borrows from a mod the app ships, rather than drawing its
// own. Legal -- an asset path is relative to the Herdr home, not to the mod --
// and a real dependency: if the app renames one of these, our spinner stops
// drawing with no error anywhere. Listed explicitly so that borrowing a second
// one is a decision somebody made, not something that crept in.
const BORROWED = new Set(["mods/workspace-chrome/spinner.svg"]);

/** Every asset the mod names, and the file that named it. */
function assets() {
  const found = new Map();
  for (const path of sources()) {
    for (const [, asset] of read(path).matchAll(/(?:svg|image)\(\s*["'`]([^"'`]+)["'`]/g)) {
      found.set(asset, shown(path));
    }
  }
  return found;
}

test("every asset path is relative to the Herdr home", () => {
  // A path outside it resolves to nothing and draws nothing, with no error
  // anywhere -- the bug the README's junction warning is about.
  const referenced = assets();
  assert.ok(referenced.size > 0, "no assets found at all -- has the regex stopped matching?");
  for (const [asset, from] of referenced) {
    assert.match(asset, /^mods\/[^/]+\//, `${from}: "${asset}" must start with mods/<name>/`);
  }
});

test("every asset the mod draws itself is a file that is there", () => {
  for (const [asset, from] of assets()) {
    if (BORROWED.has(asset)) continue;
    assert.ok(
      asset.startsWith(`mods/${MOD_NAME}/`),
      `${from}: "${asset}" belongs to another mod -- add it to BORROWED if that is deliberate`,
    );
    assert.ok(existsSync(join(ROOT, asset)), `${from}: "${asset}" does not exist`);
  }
});

test("a borrowed asset is still there in the installed app", (t) => {
  // Only checkable on a machine that has Herdr: in CI there is no app home, so
  // this skips rather than failing. It is the one guard against the app
  // renaming a file this mod points at.
  const home = process.env.HERDR_APP_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".config", "herdr-app");
  if (!existsSync(home)) return t.skip("no Herdr home on this machine");

  for (const asset of BORROWED) {
    assert.ok(existsSync(join(home, asset)), `${asset} is gone from ${home} -- the app renamed or dropped it`);
  }
});

test("every panel's icon is a file that is there", () => {
  // `check` renders one panel, so three of these four are otherwise unverified.
  for (const panel of [pulls, issues, routines, team]) {
    assert.ok(existsSync(join(ROOT, panel.icon)), `${panel.panel}: ${panel.icon} does not exist`);
  }
});

test("every svg in the folder is valid xml with a viewBox", () => {
  // A malformed one fails the same silent way a missing one does.
  const icons = readdirSync(MOD).filter((name) => name.endsWith(".svg"));
  assert.ok(icons.length > 0);
  for (const name of icons) {
    const body = read(join(MOD, name));
    assert.match(body, /<svg[\s>]/, name);
    assert.match(body, /viewBox=/, `${name} has no viewBox, so it will not scale`);
    assert.match(body, /<\/svg>\s*$/, `${name} is truncated`);
  }
});

// ---- the mod stays one folder --------------------------------------------

test("nothing imports its way out of the mod folder", () => {
  // Mods cannot import across folders: `herdr-app check` refuses it, and this
  // says so before the install does.
  for (const path of sources()) {
    for (const [, specifier] of read(path).matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      if (!specifier.startsWith(".")) continue;
      const target = resolvePath(dirname(path), specifier);
      assert.ok(
        !relative(MOD, target).startsWith(".."),
        `${shown(path)} imports "${specifier}", which is outside the mod folder`,
      );
      assert.ok(existsSync(target), `${shown(path)} imports "${specifier}", which does not exist`);
    }
  }
});

test("the only bare imports are the three the app injects", () => {
  // Anything else would need a node_modules the app does not have.
  const allowed = new Set(["herdr", "gpui-kit", "gpui-base"]);
  for (const path of sources()) {
    for (const [, specifier] of read(path).matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      if (specifier.startsWith(".")) continue;
      assert.ok(allowed.has(specifier), `${shown(path)} imports "${specifier}", which the app does not provide`);
    }
  }
});

// What each of these may import, as the README's table claims. Asserted
// because it is the whole result of splitting kit.js: a file that cannot reach
// the app cannot decide anything, and a file that cannot reach the toolkit
// cannot draw. One convenient import puts it back where it was.
const ALLOWED = {
  "kit.js": { deny: ["herdr"], why: "kit.js draws; it must not decide" },
  "dock.js": { deny: ["gpui-kit", "gpui-base"], why: "dock.js decides; it must not draw" },
  "checks.js": { deny: ["herdr", "gpui-kit", "gpui-base"], why: "checks.js is vocabulary" },
  "yaml.js": { deny: ["herdr", "gpui-kit", "gpui-base"], why: "yaml.js is a parser" },
  "urgent.js": { deny: ["herdr", "gpui-kit", "gpui-base"], why: "urgent.js is an order, not a screen" },
};

test("the files that must not reach the app or the toolkit do not", () => {
  for (const [name, { deny, why }] of Object.entries(ALLOWED)) {
    const path = join(MOD, name);
    assert.ok(existsSync(path), `${name} is gone -- update this test with it`);
    const imports = [...read(path).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(([, s]) => s);
    for (const forbidden of deny) {
      assert.equal(imports.includes(forbidden), false, `${name} imports "${forbidden}" — ${why}`);
    }
  }
});

test("checks.js, yaml.js and urgent.js import nothing at all", () => {
  // Their empty import list is the point: it is what makes them callable from
  // a test with no setup, and what stops any of them becoming a place to put
  // things.
  for (const name of ["checks.js", "yaml.js", "urgent.js"]) {
    const imports = [...read(join(MOD, name)).matchAll(/\bfrom\s+["']([^"']+)["']/g)];
    assert.deepEqual(imports.map(([, s]) => s), [], `${name} has grown an import`);
  }
});

test("nothing reaches for a Node built-in or the network", () => {
  for (const path of sources()) {
    const body = read(path);
    assert.doesNotMatch(body, /\brequire\s*\(/, `${shown(path)} uses require()`);
    assert.doesNotMatch(body, /\bfetch\s*\(/, `${shown(path)} uses fetch() -- gh is the only way in`);
    assert.doesNotMatch(body, /\bsetTimeout\s*\(|\bsetInterval\s*\(/, `${shown(path)} uses a timer instead of cx.timer`);
  }
});

// ---- the manifest ---------------------------------------------------------

test("mod.json is valid and says where the mod first appears", () => {
  const manifest = JSON.parse(read(join(MOD, "mod.json")));
  assert.ok(["right", "left", "top", "bottom", "none"].includes(manifest.place), `place: ${manifest.place}`);
  if ("focusable" in manifest) assert.equal(typeof manifest.focusable, "boolean");
  if ("size" in manifest) assert.equal(typeof manifest.size, "number");
  if ("title" in manifest) assert.ok(manifest.title.length > 0);
});

test("the mod is focusable, because the panels handle their own keys", () => {
  // Without this opt-in, `pane.go` cannot give a panel the keyboard and none of
  // the arrow, enter, r, n or c keys ever arrive.
  const manifest = JSON.parse(read(join(MOD, "mod.json")));
  assert.equal(manifest.focusable, true);
});

test("main.js default-exports a View", () => {
  assert.equal(typeof Cockpit, "function");
  assert.ok(/^class\s/.test(Cockpit.toString()), "the default export must be a class");
  assert.equal(typeof Cockpit.prototype.render, "function");
});

// ---- the layout -----------------------------------------------------------

test("the shipped layout parses and its preview is beside it", () => {
  const path = join(ROOT, "layouts", "cockpit.json");
  const layout = JSON.parse(read(path));
  assert.ok(layout.name || layout.id, "a layout needs a name");
  if (layout.preview) {
    assert.ok(existsSync(join(ROOT, "layouts", layout.preview.split("/").pop())), `preview ${layout.preview} is missing`);
  }
});

test("every block running this mod asks for a kind the mod knows", () => {
  const layout = JSON.parse(read(join(ROOT, "layouts", "cockpit.json")));
  const known = new Set(["pulls", "issues", "routines", "team", "repo-picker", "urgent", "kit"]);
  const blocks = [];

  // `floating` as well as `children`: a floating block sits over the tree
  // rather than in it, so a walk of the children alone would have skipped the
  // drawer -- and a typo in its `kind` draws the pull requests panel on the
  // window's edge, silently, since an unknown kind falls back to the list.
  const walk = (node) => {
    if (node?.content?.mod === MOD_NAME) blocks.push(node);
    for (const child of node?.children ?? []) walk(child);
    for (const child of node?.floating ?? []) walk(child);
  };
  walk(layout);
  walk(layout.layout ?? null);

  assert.ok(blocks.length > 0, "the shipped layout runs none of this mod");
  for (const block of blocks) {
    const kind = block.content.props?.kind;
    assert.ok(known.has(kind), `block ${block.id} asks for kind "${kind}"`);
  }
});

// ---- the recipe describes these files -------------------------------------

test("the recipe's module count is the number of modules there are", () => {
  // It has been wrong twice: "eleven modules" over a list of twelve, and then
  // fourteen files described as twelve after kit.js was split. A build from the
  // recipe is a build of whatever it says, so the count is load-bearing prose.
  const WORDS = {
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, "twenty-one": 21,
  };
  const recipe = read(join(ROOT, "RECIPE.md"));
  const [, word] = recipe.match(/One mod, ([a-z-]+) modules/) ?? [];
  assert.ok(word, "RECIPE.md no longer says how many modules this is");
  assert.ok(word in WORDS, `"${word}" is not a number this test knows`);

  const modules = readdirSync(MOD).filter((name) => name.endsWith(".js") && !name.endsWith(".d.ts"));
  assert.equal(WORDS[word], modules.length, `the recipe says ${word}, the folder has ${modules.length}`);
});

test("every module the recipe lists is a file, and every file is listed", () => {
  // The other half: a count can be right while the list under it names a file
  // that was renamed, or misses one that was added.
  const recipe = read(join(ROOT, "RECIPE.md"));
  const listed = new Set([...recipe.matchAll(/^ {2}([a-z-]+\.js)\b/gm)].map(([, name]) => name));
  const onDisk = readdirSync(MOD).filter((name) => name.endsWith(".js") && !name.endsWith(".d.ts"));

  for (const name of onDisk) {
    assert.ok(listed.has(name), `RECIPE.md's Built from does not mention ${name}`);
  }
  for (const name of listed) {
    assert.ok(existsSync(join(MOD, name)), `RECIPE.md's Built from names ${name}, which is not there`);
  }
});

test("the shipped layout puts the panels where, and in the order, it says", () => {
  // Not a style preference: this is how the layout is meant to be read, left
  // column then right, and RECIPE.md's What you see describes exactly this.
  // A panel that quietly changed places would make the recipe wrong.
  const layout = JSON.parse(read(join(ROOT, "layouts", "cockpit.json")));
  const find = (node, id) => (node?.id === id ? node : (node?.children ?? []).reduce((a, c) => a || find(c, id), null));
  const kinds = (column) => (column?.children ?? []).map((c) => c.content?.props?.kind).filter(Boolean);

  assert.deepEqual(kinds(find(layout, "sidebar-lists")), ["pulls"]);
  assert.deepEqual(kinds(find(layout, "right-lists")), ["routines", "issues", "team"]);

  // The right column ships with panels in it, so it ships shown. dock.js hides
  // it only once the last panel is moved out.
  assert.notEqual(find(layout, "right-lists").hidden, true);
});

test("the shipped layout hangs the drawer off an edge, with a peek", () => {
  // The strip the drawer draws is exactly `peek` wide: any other number and
  // the count sits half off the screen. drawer.js names it EDGE.
  const layout = JSON.parse(read(join(ROOT, "layouts", "cockpit.json")));
  const floating = layout.floating ?? [];
  const drawer = floating.find((block) => block.content?.props?.kind === "urgent");
  assert.ok(drawer, "the drawer must be a floating block, not one in the tree");
  assert.ok(["left", "right"].includes(drawer.edge), `edge: ${drawer.edge} -- peek is for the sides only`);
  assert.equal(typeof drawer.peek, "number");

  const edge = Number(read(join(MOD, "drawer.js")).match(/^const EDGE = (\d+);$/m)?.[1]);
  assert.equal(drawer.peek, edge, "layouts/cockpit.json's peek and drawer.js's EDGE have drifted");
});

// ---- the promises the installers make -------------------------------------

test("both installers leave the person's own files alone", () => {
  // routines.yml and team.yml are edited in place so that a new routine or a
  // new teammate never means reinstalling. An installer that copied over them
  // would quietly discard somebody's configuration.
  for (const name of ["install.sh", "install.ps1"]) {
    const body = read(join(ROOT, "tools", name));
    for (const kept of ["routines.yml", "team.yml"]) {
      assert.match(body, new RegExp(kept.replace(".", "\\.")), `${name} must exclude ${kept}`);
    }
  }
});

test("neither installer copies the files the app writes into the mod folder", () => {
  // jsconfig.json and the .d.ts have to match the installed version, so the app
  // rewrites them on every start and they are deliberately not committed.
  for (const name of ["install.sh", "install.ps1"]) {
    const body = read(join(ROOT, "tools", name));
    assert.match(body, /gpui-kit\.d\.ts/, `${name} must exclude gpui-kit.d.ts`);
    assert.match(body, /jsconfig\.json/, `${name} must exclude jsconfig.json`);
  }
});

test("both installers copy a subfolder rather than stopping at one", () => {
  // The mod is flat today, so nothing here exercises this -- which is exactly
  // why it is asserted. `cp` without -R refuses a directory and exits 1, and
  // install.sh runs under `set -e`: the first subfolder anybody adds would end
  // the install with nothing copied. robocopy /MIR recurses by definition.
  const sh = read(join(ROOT, "tools", "install.sh"));
  const copies = sh.match(/^\s*cp\s[^\n]*"\$dst\/"/gm) ?? [];
  assert.ok(copies.length > 0, "install.sh no longer copies the mod the way this test expects");
  for (const line of copies) {
    assert.match(line, /\bcp\s+-[A-Za-z]*[Rr]/, `install.sh copies the mod without -R: ${line.trim()}`);
  }

  const ps1 = read(join(ROOT, "tools", "install.ps1"));
  assert.match(ps1, /robocopy[^\n]*\/MIR/, "install.ps1 must mirror the folder, which recurses");
});

test("the files the app writes are ignored by git", () => {
  const ignored = read(join(ROOT, ".gitignore"));
  for (const name of ["gpui-kit.d.ts", "jsconfig.json"]) {
    assert.ok(ignored.includes(name), `.gitignore must cover ${name}`);
  }
});

test("the example configs ship, and the real ones do not", () => {
  // The gear seeds a deleted file from the example, and both installers copy
  // the example across only when it is not there yet.
  for (const name of ["routines.example.yml", "team.example.yml"]) {
    assert.ok(existsSync(join(MOD, name)), `${name} must ship`);
  }
  for (const name of ["routines.yml", "team.yml"]) {
    assert.equal(existsSync(join(MOD, name)), false, `${name} is the person's, and must not be committed`);
  }
});

test("the example configs parse, and satisfy the panels that read them", async () => {
  // An example that did not parse would seed a broken file into a fresh install.
  const { parse } = await import("../mods/personal-cockpit/yaml.js");

  const routinesFile = parse(read(join(MOD, "routines.example.yml")));
  assert.deepEqual(routinesFile.problems, [], "routines.example.yml does not parse");
  assert.ok(routinesFile.items.length > 0, "the example should show at least one routine");
  const seen = new Set();
  for (const [n, item] of routinesFile.items.entries()) {
    assert.deepEqual(routines.validate(item, n, seen), [], `routine ${n + 1} of the example is invalid`);
    seen.add(String(item.title).trim());
  }

  const teamFile = parse(read(join(MOD, "team.example.yml")));
  assert.deepEqual(teamFile.problems, [], "team.example.yml does not parse");
});

test("the routines example names no queue, so a fresh file follows Kraken Tasks", async () => {
  // Both installers and the gear seed `routines.yml` from this file, and an
  // explicit `coordination_repo` wins over the repo picked in Kraken Tasks. So
  // one named here is a repo nobody chose, on every fresh install -- and a
  // 404 for anyone whose login cannot read it.
  const { parse } = await import("../mods/personal-cockpit/yaml.js");
  const { top } = parse(read(join(MOD, "routines.example.yml")));
  assert.equal(top.coordination_repo, undefined);
});
