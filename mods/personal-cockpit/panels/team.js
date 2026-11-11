// Team's pull requests: the open PRs of the people you watch, grouped by
// whoever opened them.
//
// The panel above it (pulls.js) asks `viewer.pullRequests` -- the PRs *you*
// wrote -- and so needs no configuration at all, because GitHub already knows
// who you are. Nothing can ask that question about somebody else, so this one
// searches instead, with a query kept in `team.yml`: a search is the only way
// to say "these people, in this org" in a single request, and a request per
// person would cost a call each poll for every teammate.
//
// It groups by person and not by what needs you, which is how every other panel
// here groups. That is the point of it: you are watching people, so the section
// head is a person, and the group order is the order they are written in the
// file. A row that wants your review says so on its own second line and in the
// header's count instead of jumping to the top -- a list whose order moves
// under you is one you have to read, and this is one you glance at.

import { div } from "gpui-kit";
import { ago, agoShort, graphql, viewer } from "../kit/github.js";
import { RED, RUNNING } from "../kit/checks.js";
import { checkGlyph, row } from "../kit/kit.js";
import * as conf from "../kit/conf.js";

export const panel = "team";
export const title = "Team's pull requests";
export const icon = "mods/personal-cockpit/icons/team.svg";
// The search lives in team.yml, not in a repo pick, so there is no picker: the
// gear opens the file.
export const needsRepo = false;
// Between your own pull requests' 180s and the queue's 60s. A teammate opening
// a PR is worth hearing about within a couple of minutes, and this is one call.
export const refreshMs = 120000;
export const loading = "Searching for pull requests…";
export const empty = "No open pull requests";

const FILE = "team.yml";

// One page, newest-updated first. More than a sidebar panel can show, and a
// second page would double what every poll costs.
const MAX = 50;

// GitHub's own cap on a search query. Checked here because the alternative is
// a bare "Validation Failed" from the API, which does not say which part of the
// query was the problem -- and the query it refuses is one somebody typed.
const MAX_QUERY = 256;

// A query that already says what state it wants is left alone, so that
// `merged:>2026-01-01` or `is:closed` is not quietly contradicted by `is:open`.
const STATED = /\bis:(open|closed|merged)\b|\b(state|merged|closed):/;

// Measured at 2 GraphQL rate-limit points a call on a full page of 50 results,
// against a budget of 5,000 an hour -- so ~60 an hour at 120s. Counting the
// child nodes suggests an order of magnitude more than that; GitHub charges per
// connection it had to go and fetch, not per node it returned. Worth measuring
// again with `rateLimit { cost }` before adding a connection to this, and not
// worth guessing at.
const QUERY = `
query($q: String!) {
  search(type: ISSUE, first: ${MAX}, query: $q) {
    issueCount
    nodes {
      __typename
      ... on PullRequest {
        number title url isDraft updatedAt
        additions deletions changedFiles
        mergeable reviewDecision
        author { login }
        repository { nameWithOwner isArchived }
        comments { totalCount }
        reviewThreads(first: 20) { nodes { isResolved } }
        latestOpinionatedReviews(first: 10) { nodes { state author { login } } }
        reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

// ---- the file -------------------------------------------------------------

/** The logins under `people:`, in the order they are written: that order is the
 *  order of the groups in the panel. A line that cannot be a login is reported
 *  rather than sent to GitHub, where it would come back as a whole failed
 *  query instead of one bad name. */
function peopleOf(items, problems) {
  const out = [];
  for (const item of items) {
    // A bare `- alice`, or `- login: alice` for anyone who writes it that way.
    const who = (typeof item === "string" ? item : String(item?.login ?? "")).trim();
    if (!who) {
      problems.push(`a line under \`people:\` has no login`);
    } else if (/[\s"']/.test(who)) {
      problems.push(`"${who}" is not a GitHub login`);
    } else if (!out.includes(who)) {
      out.push(who);
    }
  }
  return out;
}

/** The search the panel runs: what the file asked for, the people as `author:`
 *  terms, and the three things a list of open pull requests wants anyway.
 *
 *  Exported for the sake of being readable on its own -- the panel's whole
 *  behaviour is this string, and everything else here only draws what it
 *  returned. */
export function searchFor(config, people, login) {
  const parts = [String(config.query ?? "").trim()];
  // Repeated qualifiers of one kind are OR-ed by GitHub search, so a run of
  // these reads "any of these people".
  for (const who of people) parts.push(`author:${who}`);
  let q = parts.filter(Boolean).join(" ");

  if (!/\bis:(pr|issue)\b/.test(q)) q = `is:pr ${q}`;
  if (!STATED.test(q)) q = `${q} is:open`;
  // Search sorts by relevance otherwise, which for a watch list is no order at
  // all: the same set of PRs would come back shuffled between polls.
  if (!/\bsort:/.test(q)) q = `${q} sort:updated-desc`;

  // `@me` is a gh and web shorthand the search API does not expand -- pulls.js
  // avoids `author:@me` for exactly that reason. Expanding it by hand here is
  // worth it for one query: `review-requested:@me` is what turns this panel
  // from who you watch into what is waiting on you.
  return (login ? q.replace(/@me\b/g, login) : q).trim();
}

// ---- the poll -------------------------------------------------------------

const updated = (pr) => Date.parse(pr.updatedAt) || 0;

/** One pull request of somebody else's, judged. A pure function of a GraphQL
 *  node, the login and the watch list -- exported for the same reason
 *  `searchFor` above it is. */
export function shape(pr, login, people) {
  const author = pr.author?.login ?? "ghost";
  const reviews = pr.latestOpinionatedReviews?.nodes ?? [];
  const requested = (pr.reviewRequests?.nodes ?? []).map((n) => n.requestedReviewer?.login).filter(Boolean);
  // Where this person's group sits. Anyone the query turned up who is not in
  // the file follows everybody who is, so an org-wide query still reads in a
  // stable order.
  const rank = people.indexOf(author);
  return {
    key: `${pr.repository?.nameWithOwner ?? "?"}#${pr.number}`,
    author,
    rank: rank < 0 ? people.length : rank,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    draft: pr.isDraft,
    updatedAt: pr.updatedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    comments: pr.comments?.totalCount ?? 0,
    repo: pr.repository?.nameWithOwner ?? "",
    // The rollup state only, not the list of contexts pulls.js asks for: on
    // somebody else's PR the name of the failing job is not yours to chase, and
    // 50 results of 20 contexts each would be the most expensive thing here.
    checks: pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? "NONE",
    approvals: reviews.filter((r) => r.state === "APPROVED").length,
    // Yours in particular: "somebody approved it" and "I approved it" are
    // different facts, and only the second one means you are done with it.
    youApproved: reviews.some((r) => r.state === "APPROVED" && r.author?.login === login),
    yourReview: Boolean(login) && requested.includes(login),
    conflicts: pr.mergeable === "CONFLICTING",
    changesRequested: pr.reviewDecision === "CHANGES_REQUESTED",
    reviewDecision: pr.reviewDecision,
    unresolved: (pr.reviewThreads?.nodes ?? []).filter((n) => !n.isResolved).length,
  };
}

/** `{ items, meta }`. Throws with a `kind` from github.js. */
export async function load() {
  const file = await conf.read(FILE);
  const problems = [...file.problems];

  if (file.missing) {
    return { items: [], meta: { problems: [`no ${FILE} yet — the gear writes one from the example`] } };
  }

  const people = peopleOf(file.items, problems);
  const written = String(file.config.query ?? "").trim();
  // Without either one the search has no scope, and an unscoped `is:pr is:open`
  // is every open pull request on GitHub. Say so instead of asking for it.
  if (!written && !people.length) {
    problems.push(`nothing to watch: set \`query\` or \`people\` in ${FILE}`);
    return { items: [], meta: { problems, people } };
  }

  // The login is wanted twice over: to expand `@me`, which the search API will
  // not, and to tell a review request of yours from everybody else's. It is
  // cached in github.js, so this is one call per run and not one per poll.
  const login = await viewer();
  const q = searchFor(file.config, people, login);
  if (q.length > MAX_QUERY) {
    throw Object.assign(
      new Error(
        `the search is ${q.length} characters and GitHub's limit is ${MAX_QUERY}. Scope it with \`org:\` instead of listing everybody, or watch fewer people.`,
      ),
      { kind: "error" },
    );
  }

  const data = await graphql(QUERY, null, { q });
  // A search of `type: ISSUE` answers with issues as well, whatever the query
  // said; an issue node has none of the fields asked for above and arrives
  // empty, so the typename is what tells them apart.
  const found = (data.search?.nodes ?? []).filter(
    (n) => n?.__typename === "PullRequest" && !n.repository?.isArchived,
  );

  return {
    items: found.map((pr) => shape(pr, login, people)),
    meta: { query: q, people, problems, count: data.search?.issueCount ?? found.length },
  };
}

/** The gear: team.yml, in whatever opens a .yml here. It is the whole
 *  configuration surface of this panel. */
export const configure = () => conf.openFile(FILE);

export const configureTip = `Open ${FILE}`;

// ---- shape ----------------------------------------------------------------

/** One group per person, in the file's order; then anyone else, by their newest
 *  pull request. Inside a group, whatever wants your review is first -- a
 *  person's few PRs, so it is a nudge rather than a reordering. */
export function sections(items) {
  const groups = new Map();
  for (const pr of items) {
    const found = groups.get(pr.author);
    if (found) found.items.push(pr);
    else groups.set(pr.author, { label: pr.author, rank: pr.rank, at: 0, items: [pr] });
  }

  const out = [...groups.values()];
  for (const group of out) {
    group.items.sort((a, b) => Number(b.yourReview) - Number(a.yourReview) || updated(b) - updated(a));
    group.at = Math.max(...group.items.map(updated));
  }
  return out.sort((a, b) => a.rank - b.rank || b.at - a.at);
}

/** The rows that want something from you. On somebody else's pull request that
 *  is one thing only: your review was asked for -- so the reason a row gives is
 *  not what is wrong with it but who is waiting, which is the fact the header's
 *  count cannot carry and the one that decides whether you go now. */
export function urgent(items) {
  return items
    .filter((pr) => pr.yourReview)
    .map((pr) => ({
      key: `team:${pr.key}`,
      verb: "review",
      title: pr.title,
      reason: pr.author,
      url: pr.url,
      at: Date.parse(pr.updatedAt) || 0,
    }));
}

export const attention = (items) => urgent(items).length;

export const stampNote = (meta) =>
  meta?.people?.length ? `${meta.people.length} watched` : (meta?.query ?? null);

export function footnote(meta) {
  const problems = meta?.problems ?? [];
  if (problems.length) return problems.length === 1 ? problems[0] : `${problems.length} problems in ${FILE}`;
  const count = meta?.count ?? 0;
  return count > MAX ? `First ${MAX} of ${count}` : null;
}

// ---- ui -------------------------------------------------------------------

// What is true of this PR, most pressing first: the line truncates from the
// right, so the thing you would act on survives a narrow panel.
function signals(t, pr) {
  const out = [];
  const tag = (text, color) => out.push(div().flex_none().text_color(color).child(text));
  // First, always. It is the only thing on this panel that is about you.
  if (pr.yourReview) tag("your review", t.blocked);
  if (pr.conflicts) tag("conflicts", t.ansi1);
  if (pr.changesRequested) tag("changes requested", t.ansi1);
  if (RED(pr.checks)) tag("checks failed", t.ansi1);
  if (pr.unresolved) tag(`${pr.unresolved} unresolved`, t.blocked);
  if (RUNNING(pr.checks)) tag("building", t.working);
  if (pr.youApproved) tag("you approved", t.ansi2);
  else if (pr.approvals) tag(`${pr.approvals} approved`, t.ansi2);
  else if (pr.reviewDecision === "REVIEW_REQUIRED") tag("review needed", t.muted);
  return out;
}

// Everything the row had to truncate away, in full.
function tooltip(pr) {
  const lines = [`${pr.repo} #${pr.number}`, pr.title, `opened by ${pr.author}`];
  if (pr.yourReview) lines.push("your review was requested");
  if (pr.youApproved) lines.push("you approved it");
  else if (pr.approvals) lines.push(`${pr.approvals} approved`);
  if (pr.unresolved) lines.push(`${pr.unresolved} unresolved thread${pr.unresolved > 1 ? "s" : ""}`);
  if (pr.comments) lines.push(`${pr.comments} comment${pr.comments > 1 ? "s" : ""}`);
  lines.push(`${pr.changedFiles} file${pr.changedFiles === 1 ? "" : "s"}, +${pr.additions} −${pr.deletions}`);
  lines.push(`updated ${ago(pr.updatedAt)}`);
  return lines.join("\n");
}

export function rowOf(t, pr, o) {
  // The owner is dropped: the group head says who wrote it and a watch list is
  // normally one org, so the repo name is the part that varies.
  const short = pr.repo.includes("/") ? pr.repo.split("/")[1] : pr.repo;
  return row(t, {
    id: `team-${pr.key}`,
    glyph: checkGlyph(t, pr.checks),
    title: pr.title,
    tag: pr.draft ? "draft" : null,
    age: agoShort(pr.updatedAt),
    tooltip: tooltip(pr),
    selected: o.selected,
    wide: o.wide,
    onClick: o.onClick,
    second: [
      div().flex_none().text_color(t.muted).child(`${short} #${pr.number}`),
      ...signals(t, pr),
      div().flex_none().text_color(t.ansi2).child(`+${pr.additions}`),
      div().flex_none().text_color(t.ansi1).child(`−${pr.deletions}`),
    ],
  });
}
