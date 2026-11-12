// The shapes GitHub answers with, as the panels receive them.
//
// Every builder takes an override object, so a test names only the field it is
// about: `prNode({ isDraft: true })` reads as "a draft", and the forty fields
// that are not the point stay out of the test.

/** Fixed, so `ago()` and `agoShort()` are not a function of when the suite
 *  runs. Tests that care about age set the clock themselves. */
export const NOW = Date.parse("2026-03-01T12:00:00Z");

export const minutesAgo = (n) => new Date(NOW - n * 60_000).toISOString();

// ---- pull requests (pulls.js: viewer.pullRequests) ------------------------

/** A status-check rollup. `contexts` are CheckRun or StatusContext nodes. */
export const rollup = (state, contexts = []) => ({
  nodes: [{ commit: { statusCheckRollup: { state, contexts: { totalCount: contexts.length, nodes: contexts } } } }],
});

export const checkRun = (name, conclusion, status = "COMPLETED") => ({
  __typename: "CheckRun",
  name,
  conclusion,
  status,
});

export const statusContext = (context, state) => ({ __typename: "StatusContext", context, state });

export const prNode = (over = {}) => ({
  number: 7,
  title: "Tidy the header",
  url: "https://github.com/acme/app/pull/7",
  isDraft: false,
  updatedAt: minutesAgo(30),
  additions: 12,
  deletions: 4,
  changedFiles: 3,
  mergeable: "MERGEABLE",
  reviewDecision: null,
  headRefName: "tidy-header",
  baseRefName: "main",
  repository: { nameWithOwner: "acme/app", isArchived: false },
  comments: { totalCount: 0 },
  reviewThreads: { nodes: [] },
  latestOpinionatedReviews: { nodes: [] },
  // No checks at all, which is not a failure.
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  ...over,
});

// ---- somebody else's pull requests (team.js: search) ----------------------

export const teamPrNode = (over = {}) => ({
  __typename: "PullRequest",
  number: 12,
  title: "Cache the token",
  url: "https://github.com/acme/app/pull/12",
  isDraft: false,
  updatedAt: minutesAgo(10),
  additions: 30,
  deletions: 8,
  changedFiles: 2,
  mergeable: "MERGEABLE",
  reviewDecision: null,
  author: { login: "alice" },
  repository: { nameWithOwner: "acme/app", isArchived: false },
  comments: { totalCount: 0 },
  reviewThreads: { nodes: [] },
  latestOpinionatedReviews: { nodes: [] },
  reviewRequests: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  ...over,
});

export const reviewRequest = (login) => ({ requestedReviewer: { login } });

export const review = (state, login) => ({ state, author: { login } });

// ---- issues (issues.js and routines.js: REST) -----------------------------

export const issue = (over = {}) => ({
  number: 41,
  title: "Prune merged branches",
  html_url: "https://github.com/acme/tasks/issues/41",
  state: "open",
  comments: 0,
  created_at: minutesAgo(120),
  updated_at: minutesAgo(45),
  labels: [],
  body: "",
  ...over,
});

export const label = (name, color = null) => ({ name, color });

// ---- the layout tree (kit.js) ---------------------------------------------

/**
 * A layout shaped like the one the mod ships: a work row holding the tab block,
 * and a sidebar column holding the spaces mod and whichever panels are asked
 * for. `destinations()` finds both by what they hold, not by their names, so
 * the names here are deliberately not the ones it looks for.
 */
export function tree({ sidebar = [], right = null, sidebarPx } = {}) {
  const work = {
    id: "work",
    type: "row",
    children: [{ id: "tabs", type: "block", content: { tab: true } }],
  };
  if (right) work.children.push(right);
  return {
    id: "root",
    type: "row",
    children: [
      {
        id: "sidebar",
        type: "column",
        ...(sidebarPx === undefined ? {} : { size: { px: sidebarPx } }),
        children: [{ id: "spaces", type: "block", content: { mod: "spaces" } }, ...sidebar],
      },
      work,
    ],
  };
}

/** A block running this mod, told apart from its siblings by `props.kind`. */
export const panelBlock = (kind, over = {}) => ({
  id: kind,
  type: "block",
  size: { weight: 1 },
  content: { mod: "personal-cockpit", props: { kind, node: kind } },
  ...over,
});

export const rightColumn = (children = []) => ({
  id: "right-lists",
  type: "column",
  size: { px: 380 },
  children,
});

// ---- the floating drawer (drawer.js) --------------------------------------

/** `placement()`'s answer, as the app gives it to a floating mod. Defaults to
 *  where the shipped layout hangs the drawer: the right edge, pointer away.
 *  `vertical` follows the edge, because that is the one part of this the app
 *  derives rather than being told. */
export const placedAt = (edge = "right", over = {}) => ({
  edge,
  align: "center",
  vertical: edge === "left" || edge === "right",
  hovered: false,
  dragging: false,
  ...over,
});

// ---- the agents in the terminals (agents.js) ------------------------------

/** One agent, as `agents()` describes it. Blocked by default, because that is
 *  the only status the drawer draws and so the only one worth defaulting to. */
export const agentInfo = (over = {}) => ({
  address: "core/t1",
  pane: "p1",
  space: "s1",
  space_name: "app",
  tab: "t-1",
  tab_index: 2,
  tab_name: "install the hook",
  status: "blocked",
  app: "claude-code",
  program: { key: "claude", name: "Claude Code", icon: null, tint: true, tile: null, color: null, shell: false, agent: true },
  title: "waiting for input",
  seq: 7,
  pinned: false,
  focused: false,
  ...over,
});

/** A space holding tabs, as `spaces()` describes it: where an agent's row gets
 *  its age, since the agent's own record carries no clock. */
export const spaceWithTabs = (tabs = [], over = {}) => ({
  id: "s1",
  index: 1,
  name: "app",
  named: true,
  folder: "/home/you/app",
  machine: null,
  branch: "main",
  active: true,
  status: "blocked",
  tabs,
  ...over,
});

export const tabInfo = (over = {}) => ({
  id: "t-1",
  index: 2,
  name: "install the hook",
  named: true,
  active: true,
  status: "blocked",
  panes: 1,
  zoomed: false,
  settled: false,
  settled_at: null,
  changed_at: NOW - 25 * 60_000,
  working_since: null,
  ...over,
});

/** A row as a panel's `urgent` returns it, for the drawer to draw. */
export const urgentRow = (over = {}) => ({
  key: "pulls:acme/app#7",
  verb: "fix",
  title: "Tidy the header",
  reason: "lint failing",
  url: "https://github.com/acme/app/pull/7",
  at: NOW - 30 * 60_000,
  ...over,
});
