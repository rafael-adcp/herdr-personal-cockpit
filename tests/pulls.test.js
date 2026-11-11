// My pull requests: which of the four groups a pull request lands in, and what
// the row says about its checks.
//
// `shape` is the whole judgement, and it is a pure function of one GraphQL
// node -- so none of this needs a fake GitHub. Every grouping test has a
// negative twin that pins down *why* it grouped that way: that a draft with a
// red build is still a draft, that an approval alone is not "ready".

import { test } from "node:test";
import assert from "node:assert/strict";

import { shape, sections, attention, stampNote, rowOf, load } from "../mods/personal-cockpit/panels/pulls.js";
import { host, reset, theme } from "./support/host/herdr.js";
import { prNode, rollup, checkRun, statusContext, minutesAgo } from "./support/factories.js";

const groupOf = (over) => shape(prNode(over)).group;

// ---- the four groups ------------------------------------------------------

test("a plain open pull request is waiting", () => {
  assert.equal(groupOf({}), "waiting");
});

test("a draft is a draft", () => {
  assert.equal(groupOf({ isDraft: true }), "draft");
});

test("a failing build needs you", () => {
  assert.equal(groupOf({ commits: rollup("FAILURE") }), "attention");
  assert.equal(groupOf({ commits: rollup("ERROR") }), "attention");
});

test("changes requested needs you", () => {
  assert.equal(groupOf({ reviewDecision: "CHANGES_REQUESTED" }), "attention");
});

test("a conflict needs you", () => {
  assert.equal(groupOf({ mergeable: "CONFLICTING" }), "attention");
});

test("GitHub's own merge button deciding CLEAN makes it ready", () => {
  assert.equal(groupOf({ mergeStateStatus: "CLEAN" }), "ready");
});

test("an approval stands in for CLEAN where the preview field is missing", () => {
  assert.equal(groupOf({ reviewDecision: "APPROVED", latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] } }), "ready");
});

// ---- why it grouped that way ----------------------------------------------

test("a draft with a red build is still a draft, not attention", () => {
  // The draft check comes first on purpose: a draft is not asking anything of
  // anybody yet, however broken it is.
  assert.equal(groupOf({ isDraft: true, commits: rollup("FAILURE") }), "draft");
  assert.equal(groupOf({ isDraft: true, mergeable: "CONFLICTING" }), "draft");
  assert.equal(groupOf({ isDraft: true, reviewDecision: "CHANGES_REQUESTED" }), "draft");
});

test("an approval without an APPROVED decision is not ready", () => {
  // Both halves of the conjunction matter: one person approving a PR that still
  // requires another review does not make it landable.
  assert.equal(
    groupOf({ reviewDecision: "REVIEW_REQUIRED", latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] } }),
    "waiting",
  );
});

test("an APPROVED decision with no approval counted is not ready", () => {
  assert.equal(groupOf({ reviewDecision: "APPROVED", latestOpinionatedReviews: { nodes: [] } }), "waiting");
});

test("CLEAN does not override a conflict or a red build", () => {
  // `landable` guards the ready branch, so a stale CLEAN cannot promote one.
  assert.equal(groupOf({ mergeStateStatus: "CLEAN", mergeable: "CONFLICTING" }), "attention");
  assert.equal(groupOf({ mergeStateStatus: "CLEAN", commits: rollup("FAILURE") }), "attention");
});

test("no checks at all is not a failure", () => {
  const pr = shape(prNode({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }));
  assert.equal(pr.checks.state, "NONE");
  assert.equal(pr.group, "waiting");
});

test("a build still running is not a failure", () => {
  assert.equal(groupOf({ commits: rollup("PENDING") }), "waiting");
  assert.equal(groupOf({ commits: rollup("EXPECTED") }), "waiting");
});

// ---- the checks ------------------------------------------------------------

test("a check run that has not completed is running, whatever its conclusion", () => {
  const { checks } = shape(prNode({ commits: rollup("PENDING", [checkRun("build", null, "IN_PROGRESS")]) }));
  assert.deepEqual(checks.running, ["build"]);
  assert.deepEqual(checks.failing, []);
});

test("every conclusion GitHub uses for a failed run counts as failing", () => {
  for (const conclusion of ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]) {
    const { checks } = shape(prNode({ commits: rollup("FAILURE", [checkRun("build", conclusion)]) }));
    assert.deepEqual(checks.failing, ["build"], conclusion);
  }
});

test("a successful or skipped run is neither failing nor running", () => {
  for (const conclusion of ["SUCCESS", "NEUTRAL", "SKIPPED"]) {
    const { checks } = shape(prNode({ commits: rollup("SUCCESS", [checkRun("build", conclusion)]) }));
    assert.deepEqual(checks.failing, [], conclusion);
    assert.deepEqual(checks.running, [], conclusion);
  }
});

test("a status context is classified by its state, under its own name", () => {
  const contexts = [
    statusContext("ci/one", "FAILURE"),
    statusContext("ci/two", "ERROR"),
    statusContext("ci/three", "PENDING"),
    statusContext("ci/four", "EXPECTED"),
    statusContext("ci/five", "SUCCESS"),
  ];
  const { checks } = shape(prNode({ commits: rollup("FAILURE", contexts) }));
  assert.deepEqual(checks.failing, ["ci/one", "ci/two"]);
  assert.deepEqual(checks.running, ["ci/three", "ci/four"]);
});

test("check runs and status contexts mix on one commit", () => {
  const { checks } = shape(
    prNode({ commits: rollup("FAILURE", [checkRun("unit", "FAILURE"), statusContext("legacy/ci", "PENDING")]) }),
  );
  assert.deepEqual(checks.failing, ["unit"]);
  assert.deepEqual(checks.running, ["legacy/ci"]);
});

test("the total is what GitHub counted, not what it returned", () => {
  // The query asks for the first 20 contexts; a PR with more must still say
  // how many there really are.
  const many = { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS", contexts: { totalCount: 57, nodes: [checkRun("one", "SUCCESS")] } } } }] };
  assert.equal(shape(prNode({ commits: many })).checks.total, 57);
});

// ---- the facts a row draws ------------------------------------------------

test("approvals, unresolved threads and comments are counted", () => {
  const pr = shape(
    prNode({
      latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }, { state: "APPROVED" }, { state: "COMMENTED" }] },
      reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }, { isResolved: false }] },
      comments: { totalCount: 4 },
    }),
  );
  assert.equal(pr.approvals, 2);
  assert.equal(pr.unresolved, 2);
  assert.equal(pr.comments, 4);
});

test("a missing connection counts as none rather than throwing", () => {
  // GraphQL omits a field it could not resolve, and a panel that threw on one
  // would show nothing at all instead of a row with one fact missing.
  const pr = shape({ number: 1, title: "t", repository: null, commits: null, comments: null, reviewThreads: null, latestOpinionatedReviews: null });
  assert.equal(pr.approvals, 0);
  assert.equal(pr.unresolved, 0);
  assert.equal(pr.comments, 0);
  assert.equal(pr.repo, "");
  assert.equal(pr.checks.state, "NONE");
});

// ---- the groups on screen -------------------------------------------------

test("sections are in reading order and empty ones are dropped", () => {
  const items = [
    shape(prNode({ number: 1 })),
    shape(prNode({ number: 2, isDraft: true })),
    shape(prNode({ number: 3, commits: rollup("FAILURE") })),
  ];
  assert.deepEqual(
    sections(items).map((s) => s.label),
    ["Needs you", "Waiting", "Drafts"],
  );
});

test("sections lose no pull request", () => {
  const items = [
    shape(prNode({ number: 1 })),
    shape(prNode({ number: 2, isDraft: true })),
    shape(prNode({ number: 3, commits: rollup("FAILURE") })),
    shape(prNode({ number: 4, mergeStateStatus: "CLEAN" })),
  ];
  const shown = sections(items).flatMap((s) => s.items.map((p) => p.number));
  assert.deepEqual(shown.sort(), [1, 2, 3, 4]);
});

test("attention counts what needs you and nothing else", () => {
  const items = [
    shape(prNode({ number: 1 })),
    shape(prNode({ number: 2, commits: rollup("FAILURE") })),
    shape(prNode({ number: 3, mergeable: "CONFLICTING" })),
    shape(prNode({ number: 4, isDraft: true, commits: rollup("FAILURE") })),
  ];
  assert.equal(attention(items), 2);
});

test("the stamp note is the login the load reported", () => {
  assert.equal(stampNote({ login: "rafael" }), "rafael");
  assert.equal(stampNote({}), null);
});

test("a row builds from any shaped pull request", () => {
  // Not an assertion about what it looks like. `herdr-app check` renders this
  // one panel and no other, and it renders it empty -- so without this, no
  // automated thing has ever built a row.
  const cases = [
    prNode({}),
    prNode({ isDraft: true }),
    prNode({ commits: rollup("FAILURE", [checkRun("unit", "FAILURE"), checkRun("lint", "FAILURE")]) }),
    prNode({ commits: rollup("PENDING", [checkRun("a", null, "QUEUED"), checkRun("b", null, "QUEUED")]) }),
    prNode({ mergeStateStatus: "CLEAN" }),
    prNode({ mergeStateStatus: "BEHIND" }),
    prNode({ reviewDecision: "REVIEW_REQUIRED" }),
    prNode({ repository: { nameWithOwner: "noslash", isArchived: false } }),
    prNode({ updatedAt: minutesAgo(60 * 24 * 40) }),
  ];
  for (const node of cases) {
    const item = shape(node);
    assert.doesNotThrow(
      () => rowOf(theme(), item, { selected: false, wide: true, onClick: () => {} }),
      `row for #${item.number}`,
    );
    assert.doesNotThrow(() => rowOf(theme(), item, { selected: true, wide: false, onClick: () => {} }));
  }
});

// ---- the load, at the gh boundary -----------------------------------------

/** Answers gh, counting the calls, so a retry is visible. */
function answers(handler) {
  const calls = [];
  host.onExec = (command, args) => {
    if (args[0] === "--version") return { code: 0, stdout: "gh version 2.62.0", stderr: "" };
    calls.push(args);
    return handler(args, calls.length);
  };
  return calls;
}

const page = (nodes, login = "rafael") => ({
  code: 0,
  stdout: JSON.stringify({ data: { viewer: { login, pullRequests: { totalCount: nodes.length, nodes } } } }),
  stderr: "",
});

test("a graduated or withdrawn preview is asked for again without it", async () => {
  // mergeStateStatus sits behind a preview media type. Everything else on the
  // row survives without it, so losing the field must not lose the panel.
  reset();
  const calls = answers((args) =>
    args.includes("-H")
      ? { code: 1, stdout: "", stderr: "Field 'mergeStateStatus' doesn't exist on type 'PullRequest'" }
      : page([prNode({})]),
  );

  const { items, meta } = await load();
  assert.equal(items.length, 1);
  assert.equal(meta.login, "rafael");
  assert.equal(calls.length, 2, "the query was not retried");
  assert.equal(calls[0].includes("-H"), true);
  assert.equal(calls[1].includes("-H"), false);
});

test("the retry is only for the preview, not for anything else that failed", async () => {
  // Retrying a 401 would double every failed poll's cost and fix nothing.
  reset();
  const calls = answers(() => ({ code: 1, stdout: "", stderr: "HTTP 401: Bad credentials" }));
  await assert.rejects(load(), { kind: "no-auth" });
  assert.equal(calls.length, 1);
});

test("a pull request in an archived repo is dropped", async () => {
  reset();
  answers(() =>
    page([
      prNode({ number: 1, repository: { nameWithOwner: "acme/old", isArchived: true } }),
      prNode({ number: 2 }),
    ]),
  );
  assert.deepEqual((await load()).items.map((p) => p.number), [2]);
});

test("a null in the list is skipped rather than shaped", async () => {
  reset();
  answers(() => page([null, prNode({ number: 2 })]));
  assert.deepEqual((await load()).items.map((p) => p.number), [2]);
});

test("the login comes back with the list, for the header to show", async () => {
  reset();
  answers(() => page([], "someone-else"));
  const { items, meta } = await load();
  assert.deepEqual(items, []);
  assert.equal(meta.login, "someone-else");
  assert.equal(stampNote(meta), "someone-else");
});
