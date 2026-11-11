// Team's pull requests.
//
// The panel's whole behaviour is the search string it builds, which is why
// `searchFor` was already exported before any of this existed. Most of the file
// is that function: what it adds, what it refuses to contradict, and what it
// expands.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { searchFor, shape, sections, attention, stampNote, footnote, load, rowOf } from "../mods/personal-cockpit/panels/team.js";
import { host, reset, theme } from "./support/host/herdr.js";
import { gh } from "./support/gh.js";
import { teamPrNode, reviewRequest, review, minutesAgo } from "./support/factories.js";

const FILE = "/herdr/mods/personal-cockpit/team.yml";

beforeEach(() => reset());

// ---- the search string ----------------------------------------------------

test("the three things a list of open pull requests wants are added", () => {
  assert.equal(searchFor({ query: "org:acme" }, [], null), "is:pr org:acme is:open sort:updated-desc");
});

test("people become author terms, in the order they were written", () => {
  // Repeated qualifiers are OR-ed by GitHub, and the order is the order of the
  // groups in the panel.
  assert.equal(
    searchFor({ query: "org:acme" }, ["alice", "bob"], null),
    "is:pr org:acme author:alice author:bob is:open sort:updated-desc",
  );
});

test("people alone are a valid search", () => {
  assert.equal(searchFor({}, ["alice"], null), "is:pr author:alice is:open sort:updated-desc");
});

test("a query that states its own state is not contradicted", () => {
  for (const stated of ["is:closed", "is:merged", "state:closed", "merged:>2026-01-01", "closed:>2026-01-01"]) {
    const q = searchFor({ query: `org:acme ${stated}` }, [], null);
    assert.ok(!q.includes("is:open"), `${stated} should not get is:open`);
  }
});

test("is:open is added when the query says nothing about state", () => {
  assert.ok(searchFor({ query: "org:acme label:bug" }, [], null).includes("is:open"));
});

test("a query that picks its own sort keeps it", () => {
  const q = searchFor({ query: "org:acme sort:created-asc" }, [], null);
  assert.ok(q.includes("sort:created-asc"));
  assert.ok(!q.includes("sort:updated-desc"));
});

test("a query asking for issues is not turned into one for pull requests", () => {
  const q = searchFor({ query: "is:issue org:acme" }, [], null);
  assert.ok(!q.includes("is:pr"));
});

test("@me is expanded, because the search API does not know it", () => {
  // This is the one that turns the panel from who you watch into what is
  // waiting on you, so it has to reach the API as a login.
  const q = searchFor({ query: "org:acme review-requested:@me" }, [], "rafael");
  assert.ok(q.includes("review-requested:rafael"));
  assert.ok(!q.includes("@me"));
});

test("@me is left alone when the login is not known", () => {
  // Nothing better to do: replacing it with nothing would silently widen the
  // search to the whole org.
  assert.ok(searchFor({ query: "review-requested:@me" }, [], null).includes("@me"));
});

test("every @me in one query is expanded", () => {
  const q = searchFor({ query: "review-requested:@me -author:@me" }, [], "rafael");
  assert.equal(q.includes("@me"), false);
  assert.ok(q.includes("review-requested:rafael"));
  assert.ok(q.includes("-author:rafael"));
});

test("a missing or blank query does not leave stray spaces", () => {
  for (const config of [{}, { query: "" }, { query: "   " }, { query: null }]) {
    const q = searchFor(config, ["alice"], null);
    assert.equal(q, q.trim());
    assert.equal(q.includes("  "), false, JSON.stringify(config));
  }
});

// ---- one pull request of somebody else's ----------------------------------

test("a review requested of you is the one thing on this panel about you", () => {
  const pr = shape(teamPrNode({ reviewRequests: { nodes: [reviewRequest("rafael")] } }), "rafael", ["alice"]);
  assert.equal(pr.yourReview, true);
});

test("somebody else's review request is not yours", () => {
  const pr = shape(teamPrNode({ reviewRequests: { nodes: [reviewRequest("bob")] } }), "rafael", ["alice"]);
  assert.equal(pr.yourReview, false);
});

test("with no login known, nothing is waiting on you", () => {
  const pr = shape(teamPrNode({ reviewRequests: { nodes: [reviewRequest("rafael")] } }), null, []);
  assert.equal(pr.yourReview, false);
});

test("somebody approved it and you approved it are different facts", () => {
  const node = teamPrNode({ latestOpinionatedReviews: { nodes: [review("APPROVED", "bob")] } });
  const pr = shape(node, "rafael", []);
  assert.equal(pr.approvals, 1);
  assert.equal(pr.youApproved, false);

  const mine = shape(teamPrNode({ latestOpinionatedReviews: { nodes: [review("APPROVED", "rafael")] } }), "rafael", []);
  assert.equal(mine.youApproved, true);
});

test("an author in the watch list ranks where the file put them", () => {
  const people = ["alice", "bob"];
  assert.equal(shape(teamPrNode({ author: { login: "alice" } }), null, people).rank, 0);
  assert.equal(shape(teamPrNode({ author: { login: "bob" } }), null, people).rank, 1);
});

test("an author the query turned up but the file does not name ranks last", () => {
  // That is how an org-wide query still reads in a stable order.
  assert.equal(shape(teamPrNode({ author: { login: "carol" } }), null, ["alice", "bob"]).rank, 2);
});

test("a deleted account is a ghost rather than a crash", () => {
  const pr = shape(teamPrNode({ author: null }), null, []);
  assert.equal(pr.author, "ghost");
});

test("only the rollup state is kept, not the list of contexts", () => {
  // On somebody else's pull request the name of the failing job is not yours
  // to chase, and 50 results of 20 contexts each would be the most expensive
  // thing in the mod.
  const pr = shape(teamPrNode({ commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } }), null, []);
  assert.equal(pr.checks, "FAILURE");
});

test("a commit with no checks reads as NONE", () => {
  assert.equal(shape(teamPrNode({ commits: { nodes: [] } }), null, []).checks, "NONE");
});

// ---- the groups -----------------------------------------------------------

const authored = (login, over = {}) => shape(teamPrNode({ author: { login }, ...over }), "rafael", ["alice", "bob"]);

test("one group per person, in the file's order", () => {
  const items = [authored("bob"), authored("alice")];
  assert.deepEqual(
    sections(items).map((s) => s.label),
    ["alice", "bob"],
  );
});

test("someone the file does not name follows everybody it does", () => {
  const items = [authored("carol"), authored("bob"), authored("alice")];
  assert.deepEqual(
    sections(items).map((s) => s.label),
    ["alice", "bob", "carol"],
  );
});

test("inside a group, what wants your review is first", () => {
  const items = [
    authored("alice", { number: 1, updatedAt: minutesAgo(1) }),
    authored("alice", { number: 2, updatedAt: minutesAgo(90), reviewRequests: { nodes: [reviewRequest("rafael")] } }),
  ];
  const [group] = sections(items);
  assert.deepEqual(group.items.map((p) => p.number), [2, 1]);
});

test("otherwise a group is newest first", () => {
  const items = [
    authored("alice", { number: 1, updatedAt: minutesAgo(90) }),
    authored("alice", { number: 2, updatedAt: minutesAgo(5) }),
  ];
  assert.deepEqual(sections(items)[0].items.map((p) => p.number), [2, 1]);
});

test("sections lose no pull request", () => {
  const items = [authored("alice", { number: 1 }), authored("carol", { number: 2 }), authored("bob", { number: 3 })];
  const shown = sections(items).flatMap((s) => s.items.map((p) => p.number));
  assert.deepEqual(shown.sort(), [1, 2, 3]);
});

test("attention is how many asked for your review", () => {
  const items = [
    authored("alice", { reviewRequests: { nodes: [reviewRequest("rafael")] } }),
    authored("bob", { reviewRequests: { nodes: [reviewRequest("someone")] } }),
    authored("carol"),
  ];
  assert.equal(attention(items), 1);
});

// ---- what the header says -------------------------------------------------

test("the stamp note counts the watched, and falls back to the query", () => {
  assert.equal(stampNote({ people: ["alice", "bob"] }), "2 watched");
  assert.equal(stampNote({ people: [], query: "org:acme is:open" }), "org:acme is:open");
  assert.equal(stampNote({}), null);
});

test("the footnote names one problem and counts several", () => {
  assert.equal(footnote({ problems: ["only this"] }), "only this");
  assert.match(footnote({ problems: ["a", "b", "c"] }), /^3 problems in team\.yml$/);
});

test("the footnote says when the page was truncated", () => {
  assert.equal(footnote({ problems: [], count: 120 }), "First 50 of 120");
  assert.equal(footnote({ problems: [], count: 12 }), null);
});

// ---- the load, at the gh boundary -----------------------------------------

test("with no file at all, the panel points at the gear", async () => {
  const { items, meta } = await load();
  assert.deepEqual(items, []);
  assert.match(meta.problems[0], /no team\.yml yet/);
});

test("pointed at nothing, it says so instead of searching", async () => {
  // An unscoped `is:pr is:open` is every open pull request on GitHub.
  host.files.set(FILE, "# nothing configured\n");
  const { items, meta } = await load();
  assert.deepEqual(items, []);
  assert.match(meta.problems.join(" "), /nothing to watch/);
  // And it did not reach GitHub to find that out.
  assert.deepEqual(host.exec, []);
});

test("a login that cannot be one is reported rather than sent", async () => {
  host.files.set(FILE, ["query: org:acme", "people:", '  - "not a login"', "  - alice"].join("\n"));
  gh([
    ["viewer { login }", { data: { viewer: { login: "rafael" } } }],
    ["search(", { data: { search: { issueCount: 0, nodes: [] } } }],
  ]);
  const { meta } = await load();
  assert.match(meta.problems.join(" "), /is not a GitHub login/);
  // The good one still went.
  assert.deepEqual(meta.people, ["alice"]);
});

test("a repeated login is only watched once", async () => {
  host.files.set(FILE, ["query: org:acme", "people:", "  - alice", "  - alice"].join("\n"));
  gh([
    ["viewer { login }", { data: { viewer: { login: "rafael" } } }],
    ["search(", { data: { search: { issueCount: 0, nodes: [] } } }],
  ]);
  assert.deepEqual((await load()).meta.people, ["alice"]);
});

test("a search too long for GitHub says so, with the length", async () => {
  // The alternative is a bare "Validation Failed" from the API, about a query
  // somebody typed.
  host.files.set(FILE, `query: ${"org:acme ".repeat(40)}`);
  gh([["viewer { login }", { data: { viewer: { login: "rafael" } } }]]);
  await assert.rejects(load(), (e) => {
    assert.equal(e.kind, "error");
    assert.match(e.message, /is \d\d\d+ characters and GitHub's limit is 256/);
    return true;
  });
});

test("issues the search returned alongside pull requests are dropped", async () => {
  // `type: ISSUE` answers with issues too, whatever the query said, and an
  // issue node has none of the fields asked for.
  host.files.set(FILE, "query: org:acme\n");
  gh([
    ["viewer { login }", { data: { viewer: { login: "rafael" } } }],
    [
      "search(",
      {
        data: {
          search: {
            issueCount: 3,
            nodes: [teamPrNode({ number: 1 }), { __typename: "Issue", number: 2 }, teamPrNode({ number: 3 })],
          },
        },
      },
    ],
  ]);
  const { items } = await load();
  assert.deepEqual(items.map((p) => p.number), [1, 3]);
});

test("a pull request in an archived repo is dropped", async () => {
  host.files.set(FILE, "query: org:acme\n");
  gh([
    ["viewer { login }", { data: { viewer: { login: "rafael" } } }],
    [
      "search(",
      {
        data: {
          search: {
            issueCount: 2,
            nodes: [
              teamPrNode({ number: 1, repository: { nameWithOwner: "acme/old", isArchived: true } }),
              teamPrNode({ number: 2 }),
            ],
          },
        },
      },
    ],
  ]);
  assert.deepEqual((await load()).items.map((p) => p.number), [2]);
});

test("the search goes as a GraphQL variable, not spliced into the document", async () => {
  // A quote in somebody's config file would otherwise change what the document
  // means.
  host.files.set(FILE, "query: org:acme\n");
  gh([
    ["viewer { login }", { data: { viewer: { login: "rafael" } } }],
    ["search(", { data: { search: { issueCount: 0, nodes: [] } } }],
  ]);
  await load();
  const call = host.exec.find((c) => c.args.some((a) => String(a).includes("search(")));
  assert.ok(call.args.includes("-f"));
  assert.ok(
    call.args.some((a) => String(a).startsWith("q=is:pr org:acme")),
    `variable missing from ${call.args.join(" ")}`,
  );
});

test("a row builds from any shaped pull request", () => {
  const cases = [
    teamPrNode({}),
    teamPrNode({ isDraft: true }),
    teamPrNode({ reviewRequests: { nodes: [reviewRequest("rafael")] } }),
    teamPrNode({ mergeable: "CONFLICTING" }),
    teamPrNode({ reviewDecision: "CHANGES_REQUESTED" }),
    teamPrNode({ reviewDecision: "REVIEW_REQUIRED" }),
    teamPrNode({ commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } }),
    teamPrNode({ commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] } }),
    teamPrNode({ latestOpinionatedReviews: { nodes: [review("APPROVED", "rafael")] } }),
    teamPrNode({ reviewThreads: { nodes: [{ isResolved: false }] } }),
    teamPrNode({ repository: { nameWithOwner: "noslash", isArchived: false } }),
  ];
  for (const node of cases) {
    const item = shape(node, "rafael", ["alice"]);
    assert.doesNotThrow(() => rowOf(theme(), item, { selected: false, wide: true, onClick: () => {} }));
    assert.doesNotThrow(() => rowOf(theme(), item, { selected: true, wide: false, onClick: () => {} }));
  }
});
