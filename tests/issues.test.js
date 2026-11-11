// Kraken Tasks: the open issues of a coordination repo, which are the queue.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  newUrl, labelColor, sections, attention, footnote, stampNote, cached, save, load, rowOf,
} from "../mods/personal-cockpit/panels/issues.js";
import { reset, theme } from "./support/host/herdr.js";
import { gh, apiCalls } from "./support/gh.js";
import { issue, label, minutesAgo } from "./support/factories.js";

const REPO = "acme/tasks";

beforeEach(() => {
  reset();
  localStorage.clear();
});

// ---- where the New task button goes ---------------------------------------

test("kraken's own form wins, because the name is a contract", () => {
  // `kraken init` installs its issue form at exactly this path, so in a repo it
  // touched the name is not a guess -- and a bug report is not a kraken task.
  const url = newUrl(REPO, { templates: ["bug.yml", "task.yml", "feature.md"] });
  assert.equal(url, `https://github.com/${REPO}/issues/new?template=task.yml`);
});

test("kraken's form is matched whatever its case", () => {
  assert.match(newUrl(REPO, { templates: ["Task.YML"] }), /template=Task\.YML$/);
});

test("a repo with one form means it", () => {
  assert.match(newUrl(REPO, { templates: ["anything.yml"] }), /template=anything\.yml$/);
});

test("several unknown forms go to GitHub's chooser", () => {
  // Picking among them would be wrong about half the time.
  assert.equal(newUrl(REPO, { templates: ["bug.yml", "feature.yml"] }), `https://github.com/${REPO}/issues/new/choose`);
});

test("no forms at all gets a blank issue", () => {
  assert.equal(newUrl(REPO, { templates: [] }), `https://github.com/${REPO}/issues/new`);
  assert.equal(newUrl(REPO, {}), `https://github.com/${REPO}/issues/new`);
  assert.equal(newUrl(REPO, null), `https://github.com/${REPO}/issues/new`);
});

test("a layout that insists on one form overrides everything", () => {
  assert.match(newUrl(REPO, { templates: ["task.yml"] }, "other.yml"), /template=other\.yml$/);
});

test("an empty pin is not a pin", () => {
  assert.match(newUrl(REPO, { templates: ["task.yml"] }, ""), /template=task\.yml$/);
});

test("a form name is encoded, not pasted", () => {
  assert.match(newUrl(REPO, {}, "a form.yml"), /template=a%20form\.yml$/);
});

// ---- label colours --------------------------------------------------------

test("a dark label is lifted until it reads against the sidebar", () => {
  // GitHub picks label colours to sit on a white page.
  const lifted = labelColor(theme(), "000000");
  assert.match(lifted, /^#[0-9a-f]{6}$/);
  assert.notEqual(lifted, "#000000");
});

test("a light label is left alone", () => {
  assert.equal(labelColor(theme(), "ffffff"), "#ffffff");
});

test("lifting stops: a colour is never pushed past white", () => {
  const value = labelColor(theme(), "010101").slice(1);
  for (const channel of [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16))) {
    assert.ok(channel <= 255);
    assert.ok(Number.isFinite(channel));
  }
});

test("every channel stays two hex digits, so the colour is always parseable", () => {
  // The lift is per channel and `hex2` pads: a value under 16 must not produce
  // a five-character colour.
  for (const hex of ["000000", "010203", "0a0b0c", "123456", "fedcba"]) {
    assert.match(labelColor(theme(), hex), /^#[0-9a-f]{6}$/, hex);
  }
});

test("a label with no colour, or a broken one, falls back to the muted text", () => {
  for (const hex of [null, undefined, "", "not-a-colour", "zzzzzz"]) {
    assert.equal(labelColor(theme(), hex), "muted", String(hex));
  }
});

// ---- the groups -----------------------------------------------------------

const task = (over = {}) => ({ number: 1, title: "t", labels: [], comments: 0, updated_at: minutesAgo(10), ...over });

test("a task parked on a human comes first, in its own group", () => {
  for (const name of ["needs-decision", "awaiting-merge"]) {
    const items = [task({ number: 1 }), task({ number: 2, labels: [label(name)] })];
    const groups = sections(items);
    assert.deepEqual(groups.map((g) => g.label), ["Needs you", "Queue"]);
    assert.deepEqual(groups[0].items.map((i) => i.number), [2], name);
    assert.equal(attention(items), 1);
  }
});

test("each group is newest first", () => {
  const items = [
    task({ number: 1, updated_at: minutesAgo(90) }),
    task({ number: 2, updated_at: minutesAgo(5) }),
    task({ number: 3, updated_at: minutesAgo(40) }),
  ];
  assert.deepEqual(sections(items)[0].items.map((i) => i.number), [2, 3, 1]);
});

test("an empty group is dropped", () => {
  assert.deepEqual(sections([task({})]).map((g) => g.label), ["Queue"]);
  assert.deepEqual(sections([task({ labels: [label("needs-decision")] })]).map((g) => g.label), ["Needs you"]);
});

test("a task is in exactly one group", () => {
  const items = [task({ number: 1 }), task({ number: 2, labels: [label("needs-decision")] }), task({ number: 3 })];
  const shown = sections(items).flatMap((g) => g.items.map((i) => i.number));
  assert.deepEqual(shown.sort(), [1, 2, 3]);
});

test("the footnote appears only when the page was full", () => {
  assert.equal(footnote({ limited: true, perPage: 100 }), "First 100 tasks");
  assert.equal(footnote({ limited: false, perPage: 100 }), null);
  assert.equal(footnote({}), null);
});

test("the stamp note is the repo being watched", () => {
  assert.equal(stampNote({}, REPO), REPO);
  assert.equal(stampNote({}, null), null);
});

// ---- the cache ------------------------------------------------------------

test("a saved queue comes back", () => {
  const items = [task({ number: 4 })];
  save(REPO, items, 1234);
  const found = cached(REPO);
  assert.deepEqual(found.items, items);
  assert.equal(found.at, 1234);
});

test("each repo keeps its own", () => {
  save(REPO, [task({ number: 1 })], 1);
  save("acme/other", [task({ number: 2 })], 2);
  assert.equal(cached(REPO).items[0].number, 1);
  assert.equal(cached("acme/other").items[0].number, 2);
});

test("nothing cached, and no repo to cache under, are both null", () => {
  assert.equal(cached(REPO), null);
  assert.equal(cached(null), null);
  assert.equal(cached(""), null);
});

test("saving without a repo is a no-op rather than an error", () => {
  assert.doesNotThrow(() => save(null, [task({})], 1));
  assert.doesNotThrow(() => save("", [task({})], 1));
});

test("a cache that cannot be written costs one spinner, not the panel", () => {
  // localStorage throws when the quota is full, and the queue of a busy repo
  // is the kind of thing that fills it.
  const real = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  try {
    assert.doesNotThrow(() => save(REPO, [task({})], 1));
  } finally {
    localStorage.setItem = real;
  }
  assert.equal(cached(REPO), null);
});

test("a corrupt cache is not worth a broken panel", () => {
  localStorage.setItem(`cockpit.issues:${REPO}`, "{not json");
  assert.equal(cached(REPO), null);
});

test("a cache of the wrong shape is ignored", () => {
  localStorage.setItem(`cockpit.issues:${REPO}`, JSON.stringify({ items: "not an array" }));
  assert.equal(cached(REPO), null);
  localStorage.setItem(`cockpit.issues:${REPO}`, JSON.stringify(null));
  assert.equal(cached(REPO), null);
});

// ---- the load -------------------------------------------------------------

test("the queue is the open issues, slimmed to what a row draws", async () => {
  gh([
    ["ISSUE_TEMPLATE", [{ type: "file", name: "task.yml" }]],
    ["state=open", [issue({ number: 7, title: "Do the thing", labels: [label("project:chores", "ededed")] })]],
  ]);
  const { items, meta } = await load({ repo: REPO });
  assert.deepEqual(items, [
    {
      number: 7,
      title: "Do the thing",
      url: "https://github.com/acme/tasks/issues/41",
      comments: 0,
      updated_at: items[0].updated_at,
      labels: [{ name: "project:chores", color: "ededed" }],
    },
  ]);
  assert.deepEqual(meta.templates, ["task.yml"]);
});

test("the issues endpoint returns pull requests, and they are not tasks", async () => {
  gh([
    ["ISSUE_TEMPLATE", []],
    ["state=open", [issue({ number: 1 }), { ...issue({ number: 2 }), pull_request: { url: "x" } }]],
  ]);
  assert.deepEqual((await load({ repo: REPO })).items.map((i) => i.number), [1]);
});

test("a label given as a bare string is normalised", async () => {
  gh([["ISSUE_TEMPLATE", []], ["state=open", [issue({ labels: ["kraken-task", { name: "p", color: "fff" }] })]]]);
  const { items } = await load({ repo: REPO });
  assert.deepEqual(items[0].labels, [
    { name: "kraken-task", color: null },
    { name: "p", color: "fff" },
  ]);
});

test("a nameless label is dropped rather than drawn blank", async () => {
  gh([["ISSUE_TEMPLATE", []], ["state=open", [issue({ labels: [{ color: "fff" }, { name: "keep" }] })]]]);
  assert.deepEqual((await load({ repo: REPO })).items[0].labels, [{ name: "keep", color: null }]);
});

test("an answer that is not a list is an error", async () => {
  gh([["ISSUE_TEMPLATE", []], ["state=open", { message: "Not Found" }]]);
  await assert.rejects(load({ repo: REPO }), /Unexpected response from GitHub/);
});

test("the templates of a repo are looked up once, not every poll", async () => {
  // They change about never, and the panel polls every 60 seconds.
  gh([["ISSUE_TEMPLATE", [{ type: "file", name: "task.yml" }]], ["state=open", []]]);
  await load({ repo: "acme/looked-up-once" });
  await load({ repo: "acme/looked-up-once" });
  await load({ repo: "acme/looked-up-once" });
  assert.equal(apiCalls().filter((c) => c.args.some((a) => String(a).includes("ISSUE_TEMPLATE"))).length, 1);
});

test("config.yml is the chooser's settings, not a template", async () => {
  gh([
    ["ISSUE_TEMPLATE", [{ type: "file", name: "config.yml" }, { type: "file", name: "bug.md" }]],
    ["state=open", []],
  ]);
  assert.deepEqual((await load({ repo: "acme/with-config" })).meta.templates, ["bug.md"]);
});

test("a folder inside ISSUE_TEMPLATE is not a template", async () => {
  gh([
    ["ISSUE_TEMPLATE", [{ type: "dir", name: "nested" }, { type: "file", name: "task.yml" }, { type: "file", name: "notes.txt" }]],
    ["state=open", []],
  ]);
  assert.deepEqual((await load({ repo: "acme/with-dir" })).meta.templates, ["task.yml"]);
});

test("a repo with no template folder is not an error", async () => {
  // GitHub answers 404, which is also what no access looks like, and both mean
  // the same thing here: a blank new-issue form.
  gh([["ISSUE_TEMPLATE", () => ({ code: 1, stdout: "", stderr: "HTTP 404: Not Found" })], ["state=open", []]]);
  const { meta } = await load({ repo: "acme/no-templates" });
  assert.deepEqual(meta.templates, []);
});

test("a row builds from any task", () => {
  const cases = [
    task({}),
    task({ labels: [label("needs-decision", "d73a4a")] }),
    task({ labels: [label("project:chores", "000000"), label("no-colour", null)] }),
    task({ comments: 1 }),
    task({ comments: 5 }),
  ];
  for (const one of cases) {
    assert.doesNotThrow(() => rowOf(theme(), one, { repo: REPO, selected: false, wide: true, onClick: () => {} }));
    assert.doesNotThrow(() => rowOf(theme(), one, { repo: REPO, selected: true, wide: false, onClick: () => {} }));
  }
});
