// Every piece of chrome this mod draws, on sample data, in one scroll.
//
// `herdr-app check` renders the mod once with no props, which is the pull
// requests panel with an empty list: it never builds a row, never draws a
// header's attention pill, and never shows the other three panels at all. The
// way to see any of those used to be to edit main.js, run check, and put it
// back -- so a change to a shared piece was checked against one of its five
// callers and the themes were compared from memory.
//
// This is that, done once and kept: open it beside a theme switch and every
// state of every piece is on screen at the same time.
//
// The data here is made up on purpose and stays made up -- no repo, login or
// task of anybody's. See CONTRIBUTING.md.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import { Drawer } from "./drawer.js";
import { WIDE, badge, button, checkGlyph, header, rail, sectionHead, spinner } from "../kit/kit.js";
import * as issues from "../panels/issues.js";
import * as pulls from "../panels/pulls.js";
import * as routines from "../panels/routines.js";
import * as team from "../panels/team.js";

// The width a panel is drawn at here: wider than WIDE, so rows draw their
// second line. The narrow column beside it is under it, so both are visible.
const PANEL = 300;
const NARROW = WIDE - 40;

const iso = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

// ---- made-up data ---------------------------------------------------------

const prPayload = (over = {}) => ({
  number: 128,
  title: "Keep the last good list when a refresh fails",
  url: "https://github.com/acme/app/pull/128",
  isDraft: false,
  updatedAt: iso(42),
  additions: 86,
  deletions: 12,
  changedFiles: 4,
  mergeable: "MERGEABLE",
  reviewDecision: null,
  headRefName: "keep-last-good",
  baseRefName: "main",
  repository: { nameWithOwner: "acme/app", isArchived: false },
  comments: { totalCount: 2 },
  reviewThreads: { nodes: [] },
  latestOpinionatedReviews: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  ...over,
});

const failing = {
  state: "FAILURE",
  contexts: { totalCount: 2, nodes: [{ __typename: "CheckRun", name: "lint", conclusion: "FAILURE", status: "COMPLETED" }] },
};

const PULLS = [
  pulls.shape(prPayload({ commits: { nodes: [{ commit: { statusCheckRollup: failing } }] } })),
  pulls.shape(
    prPayload({
      number: 127,
      title: "Read the five YAML constructs the config files use",
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] },
      commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS", contexts: { totalCount: 3, nodes: [] } } } }] },
    }),
  ),
  pulls.shape(prPayload({ number: 126, title: "Split the panel chrome out of the list", isDraft: true })),
];

const teamPayload = (over = {}) => ({
  __typename: "PullRequest",
  number: 311,
  title: "Cache the issue templates per repo",
  url: "https://github.com/acme/app/pull/311",
  isDraft: false,
  updatedAt: iso(9),
  additions: 24,
  deletions: 3,
  changedFiles: 2,
  mergeable: "MERGEABLE",
  reviewDecision: "REVIEW_REQUIRED",
  author: { login: "robin" },
  repository: { nameWithOwner: "acme/app", isArchived: false },
  comments: { totalCount: 0 },
  reviewThreads: { nodes: [] },
  latestOpinionatedReviews: { nodes: [] },
  reviewRequests: { nodes: [{ requestedReviewer: { login: "you" } }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  ...over,
});

const TEAM = [
  team.shape(teamPayload(), "you", ["robin"]),
  team.shape(teamPayload({ number: 309, title: "Drop the unused header note slot", author: { login: "sam" }, reviewRequests: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } }), "you", ["robin", "sam"]),
];

// issues.js works on `slim`'s shape, which is not its payload: the panel keeps
// only what a row draws, so that is what a row is given here.
const ISSUES = [
  {
    number: 77,
    title: "Decide whether routines get a cron field",
    url: "https://github.com/acme/tasks/issues/77",
    comments: 4,
    updated_at: iso(20),
    labels: [{ name: "needs-decision", color: "d4c5f9" }, { name: "kraken-task", color: "1d76db" }],
  },
  {
    number: 76,
    title: "Prune worktrees whose branch is merged",
    url: "https://github.com/acme/tasks/issues/76",
    comments: 0,
    updated_at: iso(200),
    labels: [{ name: "kraken-task", color: "1d76db" }],
  },
];

// routines.js builds its items inside `load`, so these are that shape. Its
// `slim` keeps labels as bare names, unlike the issues panel's.
const ROUTINES = [
  {
    key: "0-Weekly dependency sweep",
    title: "Weekly dependency sweep",
    detail: "project:upkeep",
    project: "upkeep",
    def: { title: "Weekly dependency sweep" },
    repo: "acme/tasks",
    state: "open",
    error: null,
    url: "https://github.com/acme/tasks/issues/75",
    latest: null,
    open: { number: 75, url: "https://github.com/acme/tasks/issues/75", open: true, created_at: iso(300), comments: 1, labels: ["kraken-task", "awaiting-merge"] },
  },
  {
    key: "1-Rotate the preview tokens",
    title: "Rotate the preview tokens",
    detail: "project:upkeep",
    project: "upkeep",
    def: { title: "Rotate the preview tokens" },
    repo: "acme/tasks",
    state: "ready",
    error: null,
    url: null,
    latest: null,
    open: null,
  },
  {
    key: "2-unnamed",
    title: "routine 3",
    detail: "",
    project: null,
    def: { project: "upkeep" },
    repo: "acme/tasks",
    state: "invalid",
    error: "routine 3 has no title",
    url: null,
    latest: null,
    open: null,
  },
];

// The agent row is the one with a `go` instead of a `url`: it is a terminal in
// this window rather than a page, so it is the one row whose press needs the
// app. Drawn here with the handler pointing nowhere, which is how the gallery
// shows the chrome without being able to focus anybody's real terminal.
const DRAWER_ROWS = [
  { key: "agents:core/t3", verb: "answer", title: "rotate the preview tokens", reason: "Claude Code · acme", url: null, go: { name: "agent.focus", args: { terminal: "core/t3" } }, at: Date.now() - 6 * 60_000 },
  { key: "pulls:acme/app#128", verb: "fix", title: "Keep the last good list when a refresh fails", reason: "lint failing", url: "https://github.com/acme/app/pull/128", at: Date.now() - 42 * 60_000 },
  { key: "issues:77", verb: "decide", title: "Decide whether routines get a cron field", reason: "needs-decision", url: "https://github.com/acme/tasks/issues/77", at: Date.now() - 20 * 60_000 },
  { key: "routines:2-unnamed", verb: "config", title: "routine 3", reason: "routine 3 has no title", url: null, at: 0 },
];

// ---- the gallery ----------------------------------------------------------

const PANELS = [
  ["pulls", pulls, PULLS],
  ["team", team, TEAM],
  ["issues", issues, ISSUES],
  ["routines", routines, ROUTINES],
];

// A header wants a block to resize and callbacks to send nowhere.
const HOST = { id: "gallery", size: { px: 220 } };
const nowhere = () => {};

export class Gallery {
  constructor(view, cx) {
    this.view = view;
    this.overlay = props()?.overlay;
    this.handle = cx.focus_handle();
    this.selected = 0;
  }

  group(t, label, children) {
    return v_flex()
      .gap(8)
      .child(div().text_size(10).font_semibold().text_color(t.dim).child(label.toUpperCase()))
      .child(v_flex().gap(10).children(children));
  }

  /** A panel-shaped column, so a header and its rows are drawn at the width
   *  they are really drawn at rather than stretched across the gallery. */
  column(t, width, children) {
    return v_flex()
      .w(width)
      .flex_none()
      .bg(t.chrome)
      .border(1)
      .border_color(t.border)
      .rounded(6)
      .pb(6)
      .children(children);
  }

  headers(t) {
    const base = {
      id: "gallery-header",
      title: "Team's pull requests",
      stamp: "robin · Refreshed 2m ago",
      onRefresh: nowhere,
      onMove: nowhere,
      onMinimise: nowhere,
      host: HOST,
      place: "sidebar",
    };
    return [
      this.column(t, PANEL, [header(t, { ...base, count: 7 })]),
      this.column(t, PANEL, [header(t, { ...base, attention: 3 })]),
      this.column(t, PANEL, [header(t, { ...base, trouble: "sign in", troubleTip: "gh auth login" })]),
      this.column(t, PANEL, [header(t, { ...base, count: 7, busy: true })]),
      this.column(t, PANEL, [
        header(t, { ...base, title: "Kraken Tasks", count: 2, onNew: nowhere, newTip: "New task", onConfigure: nowhere, configureTip: "Choose a repository" }),
      ]),
      this.column(t, PANEL, [header(t, { ...base, count: 7, collapsed: true })]),
    ];
  }

  pieces(t) {
    return [
      h_flex()
        .gap(10)
        .items_center()
        .flex_wrap()
        .child(badge(t, "3 needs you"))
        .child(badge(t, 12, t.working))
        .child(badge(t, "stale", t.dim))
        .child(button(t, "gallery-button", "Choose repository", nowhere))
        .child(spinner(t))
        .child(h_flex().gap(6).items_center().child(checkGlyph(t, "SUCCESS")).child(checkGlyph(t, "FAILURE")).child(checkGlyph(t, "PENDING")).child(checkGlyph(t, "NONE"))),
      h_flex()
        .gap(16)
        .items_start()
        .child(this.column(t, 44, [rail(t, pulls.icon, 0)]))
        .child(this.column(t, 44, [rail(t, pulls.icon, 3)]))
        .child(this.column(t, 44, [rail(t, issues.icon, 12)]))
        .child(this.column(t, PANEL, [sectionHead(t, "Needs you", 2), sectionHead(t, "Ready to merge", 1)])),
    ];
  }

  /** Every panel's rows, each at its own full width and again narrow, so the
   *  two-line row and the one-line row are compared rather than remembered. */
  rows(t) {
    return PANELS.map(([name, source, items]) =>
      v_flex()
        .gap(6)
        .child(div().text_size(10).text_color(t.muted).child(source.title))
        .child(
          h_flex()
            .gap(16)
            .items_start()
            .child(
              this.column(t, PANEL, [
                v_flex()
                  .px(6)
                  .gap(1)
                  .children(
                    source.sections(items).flatMap((section) => [
                      sectionHead(t, section.label, section.items.length),
                      ...section.items.map((item, i) =>
                        source.rowOf(t, item, {
                          wide: true,
                          repo: "acme/tasks",
                          selected: i === 0 && name === "pulls",
                          acting: false,
                          done: false,
                          onAction: nowhere,
                          onClick: nowhere,
                        }),
                      ),
                    ]),
                  ),
              ]),
            )
            .child(
              this.column(t, NARROW, [
                v_flex()
                  .px(6)
                  .gap(1)
                  .children(
                    items.map((item) =>
                      source.rowOf(t, item, { wide: false, repo: "acme/tasks", selected: false, acting: false, done: false, onAction: nowhere, onClick: nowhere }),
                    ),
                  ),
              ]),
            ),
        ),
    );
  }

  render() {
    const t = theme();
    // The drawer's own body, on made-up rows: it takes them as an argument, so
    // nothing of the real panels' published state is read or written here. Its
    // actions are handed in the same way, and here they lead nowhere -- every
    // piece of its chrome is drawn, including the snooze on each row and the
    // count of what has been put off, and none of it can do anything.
    const drawer = new Drawer(this.view, { focus_handle: () => this.handle }).body(t, DRAWER_ROWS, {
      snoozed: 2,
      onGo: nowhere,
      onSnooze: nowhere,
      onWake: nowhere,
    });

    return v_flex()
      .id("cockpit-gallery")
      .size_full()
      .min_h(0)
      .bg(t.background)
      .text_size(13)
      .text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((e) => {
        if (e.key === "escape" && this.overlay) closeOverlay(this.overlay);
      })
      .child(
        h_flex()
          .px(20)
          .h(44)
          .flex_none()
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(div().flex_1().text_size(13).font_semibold().child("Personal Cockpit chrome"))
          .child(div().text_size(10).text_color(t.dim).child("made-up data · switch themes to compare")),
      )
      .child(
        v_flex()
          .id("cockpit-gallery-body")
          .flex_1()
          .min_h(0)
          .p(20)
          .gap(22)
          .overflow_y_scrollbar()
          .child(this.group(t, "Header bars", this.headers(t)))
          .child(this.group(t, "Pieces, rails and section heads", this.pieces(t)))
          .child(this.group(t, "Rows, wide and narrow", this.rows(t)))
          .child(this.group(t, "The floating drawer", [drawer])),
      );
  }
}
