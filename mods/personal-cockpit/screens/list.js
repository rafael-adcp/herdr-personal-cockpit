// The list panel, for whichever source `props.kind` names.
//
// Everything here used to exist twice -- once per mod -- and had already
// drifted: only one side kept a cache, only one had a keyboard cursor, only one
// held its last good list when a refresh failed. Now both get all three,
// because there is one of each.
//
// Then it existed twice again, when Jira arrived as a screen of its own. It is
// a source now (jira/jira.js), and the few things it did that this did not --
// a refresh asked for mid-poll is kept, the cursor follows its row across a
// reload -- are here for every panel rather than there for one.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { layout, nextCommand, openOverlay, props, run, setShared, theme, window as hostWindow } from "herdr";
import {
  COLLAPSED_MAX,
  RAIL_MAX,
  find,
  hostBlockFor,
  minimise,
  moveTo,
  narrowSidebar,
  placeOf,
} from "../kit/dock.js";
import { WIDE, button, header, rail, sectionHead, shell } from "../kit/kit.js";
import { ago, ghCommand } from "../kit/github.js";
import { repoOf } from "../kit/config.js";
import { shareKey } from "../kit/urgent.js";
import * as pulls from "../panels/pulls.js";
import * as issues from "../panels/issues.js";
import * as routines from "../panels/routines.js";
import * as team from "../panels/team.js";
import * as jira from "../jira/jira.js";

/** The panels, by the `props.kind` that names one. Exported so the drawer can
 *  select its sources from this roster and read their published urgent rows
 *  without running any of them. Jira is last and optional: no shipped layout
 *  has a block for it, and it publishes no rows. */
export const SOURCES = { pulls, issues, routines, team, jira };

// A mod command reaches every copy on screen, which is what makes `refresh`
// useful and what would make `kit` open four identical dialogs at once. One
// copy has to be the one that answers; the first panel is an arbitrary but
// stable choice, and it is the one `herdr-app check` renders anyway.
const OPENS_KIT = Object.values(SOURCES)[0].panel;

// How long a row says what its button just did. Long enough to read on the way
// past, short enough that it is gone before it could describe anything stale.
const DONE_MS = 6000;

// What makes a row the same row after a reload. Every source's items have a
// page; routines' also have a `key`, because a broken one has no page at all.
const idOf = (item) => item?.key ?? item?.url ?? null;

export class List {
  constructor(view, cx) {
    const p = props() ?? {};
    this.source = SOURCES[p.kind] ?? pulls;
    this.node = p.node ?? null;
    // Only for a repo with several issue forms where the layout wants one
    // named; with none or one, the right answer is found rather than told.
    this.template = p.template ?? null;
    this.heightKey = this.source.heightKey ?? `cockpit.${this.source.panel}.height`;

    this.items = [];
    this.meta = null;
    this.state = "loading"; // loading | ok | no-repo | no-gh | no-auth | not-found | error
    this.error = null;
    // Set when a refresh failed but the list it would have replaced is still good.
    this.stale = null;
    // Set when a row's own button failed. Its own field, because "couldn't
    // refresh" is the wrong thing to tell someone who pressed ▶.
    this.acted = null;
    // The row whose button is in flight, and the one that just succeeded. Both
    // belong to the panel rather than the source: they are what this screen is
    // doing, not anything the queue knows about.
    this.acting = null;
    this.done = null;
    this.fetchedAt = null;
    this.busy = false;
    // A refresh somebody asked for while one was in flight. See `requestRefresh`.
    this.pending = false;
    this.width = 0;
    this.at = 0;

    this.repo = this.source.needsRepo ? repoOf(this.source.panel).repo : null;
    // The pick this panel's source falls back to when its own file names no
    // repo (routines -> Kraken Tasks). Kept so a change to it is noticed in
    // `render`, the same way this panel's own pick is.
    this.from = this.source.repoFrom ? repoOf(this.source.repoFrom).repo : null;
    // The repo the current failure was about, and the panel whose pick would
    // change it -- what the "no access" screen names and offers. This panel's
    // own repo and own picker for the three sources that watch one; a source
    // that resolves its repo inside `load` says otherwise with the error.
    this.tried = { repo: this.repo, panel: this.source.panel };
    if (this.source.needsRepo && this.repo && this.source.cached) {
      const saved = this.source.cached(this.repo);
      if (saved) {
        this.items = saved.items;
        this.fetchedAt = saved.at ?? null;
        this.state = "ok";
      }
    }

    this.handle = cx.focus_handle();
    this.refresh(cx);
    cx.timer.every(this.source.refreshMs, (cx) => this.refresh(cx));

    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        // A source may answer to command names of its own. A mod command
        // reaches every copy on screen, so anything that should move or
        // reconfigure one panel has to be named for that panel -- and a source
        // that names its own `configure` is left out of the shared one, which
        // is the repo picker and would be a dialog it has no use for.
        const own = this.source.commands ?? {};
        if (command === "focus") this.handle.focus();
        else if (command === "refresh" || command === own.refresh) this.requestRefresh(cx);
        else if (own.configure && command === own.configure) this.configureWith(cx);
        else if (command === "configure" && !own.configure) this.configure();
        else if (command === own.left) this.move("sidebar");
        else if (command === own.right) this.move("right");
        else if (command === "new") this.openNew(cx);
        else if (command === "kit" && this.source.panel === OPENS_KIT) this.openKit();
        cx.notify();
      }
    });
  }

  // ---- data ---------------------------------------------------------------

  /** The rows this panel would put in the drawer, left where the drawer can
   *  read them. See urgent.js for why it is shared state and not a second set
   *  of calls.
   *
   *  Called when a load lands, never from `render`: writing shared state
   *  re-renders every mod, and a write during a render would be a render that
   *  asks for another one, forever.
   *
   *  A panel with no repo, no `gh` or no login publishes nothing. The drawer is
   *  about work waiting on you; a panel's own setup trouble is said in that
   *  panel's header, which is where the button that fixes it is. A refresh that
   *  failed over a good list leaves `state` at "ok", so those rows stay -- the
   *  drawer goes stale exactly when the panel does. */
  publish() {
    setShared(shareKey(this.source.panel), this.state === "ok" ? this.source.urgent(this.items) : []);
  }

  /** A refresh somebody asked for: the button, the key, a command. The poll's
   *  own timer calls `refresh` and is simply dropped when one is in flight --
   *  another is coming. A request is different: it usually means something
   *  changed (Jira's query editor saves and then asks), and the load in flight
   *  started before it did. So one more runs when that one lands. One, however
   *  many times it was asked for. */
  requestRefresh(cx) {
    if (this.busy) this.pending = true;
    else this.refresh(cx);
  }

  refresh(cx) {
    if (this.busy) return;
    // Whatever was asked for, this load is newer than the asking.
    this.pending = false;
    if (this.source.needsRepo && !this.repo) {
      this.state = "no-repo";
      this.publish();
      cx.notify();
      return;
    }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const { items, meta } = await this.source.load({ repo: this.repo });
        const held = idOf(this.strip().pickable[this.at]);
        this.items = items;
        this.meta = meta;
        this.follow(held);
        this.state = "ok";
        this.error = null;
        this.stale = null;
        this.fetchedAt = Date.now();
        if (this.source.save) this.source.save(this.repo, items, this.fetchedAt);
      } catch (e) {
        const kind = e?.kind ?? "error";
        const message = String(e?.message ?? e);
        // One failed poll -- a dropped connection, a TLS timeout -- shouldn't
        // blank a list that was right a moment ago. Keep it and say it's old.
        //
        // Only that kind, and only a list with something in it: a login problem
        // gives the screen to the button that fixes it. A source with no such
        // button says `keepsLastGood`, and keeps whatever loaded -- an empty
        // list included -- through any failure at all.
        const kept = this.source.keepsLastGood || (kind === "error" && this.items.length);
        if (this.state === "ok" && kept) {
          this.stale = message;
        } else {
          this.state = kind;
          this.error = message;
          this.stale = null;
          // A source that resolved its own repo names it on the error; for the
          // rest it is the one this panel was watching all along.
          this.tried =
            e?.repo ? { repo: e.repo, panel: e.repoPanel ?? null } : { repo: this.repo, panel: this.source.panel };
        }
      } finally {
        this.busy = false;
        // Whatever a row's button was waiting for, this list is now newer than
        // it: the spinner has nothing left to stand for.
        this.acting = null;
        this.publish();
        cx.notify();
        if (this.pending) this.refresh(cx);
      }
    });
    cx.notify();
  }

  /** Keep the cursor on the row it was on. A reload reorders -- a list sorted
   *  by last update moves a row every time somebody touches it -- and a cursor
   *  that stays at "third" is then on a different thing than the one you were
   *  about to open. A row that is gone leaves the index alone, and `render`
   *  clamps it. */
  follow(held) {
    if (held === null) return;
    const { pickable } = this.strip();
    if (idOf(pickable[this.at]) === held) return;
    const at = pickable.findIndex((item) => idOf(item) === held);
    if (at >= 0) this.at = at;
  }

  // The repo changed under us: a pick in this panel's own dialog, or in another
  // copy of it. Shared state re-renders every mod, which is how we hear about it.
  reload(cx) {
    this.items = [];
    this.meta = null;
    // Only a panel that watches a repo can be short of one. A panel whose
    // source finds its own would otherwise ask for a pick it has no use for.
    this.state = this.source.needsRepo && !this.repo ? "no-repo" : "loading";
    this.error = null;
    this.stale = null;
    this.acted = null;
    this.tried = { repo: this.repo, panel: this.source.panel };
    this.fetchedAt = null;
    if (this.repo && this.source.cached) {
      const saved = this.source.cached(this.repo);
      if (saved) {
        this.items = saved.items;
        this.fetchedAt = saved.at ?? null;
        this.state = "ok";
      }
    }
    this.refresh(cx);
  }

  /** A row's own button, for a source that has one (routines' ▶). The source
   *  does the work and keeps no state; this refreshes afterwards so the result
   *  lands in the row that was pressed instead of up to a poll later.
   *
   *  `acting` is deliberately not cleared here. The work being done is only
   *  half of it: until the refresh lands, the row still describes the world as
   *  it was, so clearing the spinner on the way out would put the button back
   *  for the length of one round trip. `refresh` clears it when the list it
   *  loaded is the one on screen. */
  act(item, cx) {
    if (!this.source.act || this.busy) return;
    this.busy = true;
    this.acted = null;
    this.acting = item.key;
    cx.spawn(async (cx) => {
      try {
        await this.source.act(item, { repo: this.repo });
        const at = Date.now();
        this.done = { key: item.key, at };
        // A note, not a state: the row itself says what happened from here on.
        cx.timer.after(DONE_MS, (cx) => {
          if (this.done?.at !== at) return;
          this.done = null;
          cx.notify();
        });
      } catch (e) {
        this.acted = String(e?.message ?? e);
      } finally {
        this.busy = false;
        this.refresh(cx);
        cx.notify();
      }
    });
    cx.notify();
  }

  /** The gear, for a source that brings its own settings action instead of the
   *  repo picker. Errors land in the same place a row button's do, because a
   *  gear that does nothing and says nothing is the worst of both. */
  configureWith(cx) {
    cx.spawn(async (cx) => {
      try {
        await this.source.configure();
      } catch (e) {
        this.acted = String(e?.message ?? e);
        cx.notify();
      }
    });
  }

  /** The repo picker, for this panel's own pick or -- when its source follows
   *  another panel's -- for that one. The dialog writes `cockpit.<panel>.repo`,
   *  so the panel it is opened for has to be the one whose key is actually
   *  read: offering Routines a picker that wrote its own key was a dialog that
   *  asked a question and threw the answer away. */
  configure(panel = this.source.panel) {
    const current = panel === this.source.panel ? this.repo : repoOf(panel).repo;
    openOverlay({
      mod: "personal-cockpit",
      kind: "dialog",
      width: 420,
      props: { kind: "repo-picker", panel, current },
    });
  }

  /** The chrome gallery (gallery.js). Not a panel feature -- it is how a change
   *  to the shared chrome gets looked at -- but a command only reaches a mod
   *  that is already on screen, and a panel is the copy that always is. */
  openKit() {
    openOverlay({
      mod: "personal-cockpit",
      kind: "dialog",
      width: 760,
      height: 620,
      props: { kind: "kit" },
    });
  }

  terminal(argv) {
    run("terminal.open", { argv, place: "tab" });
  }

  /** The layout block showing this copy, or null for a pane or an overlay. */
  host(tree = layout()) {
    return hostBlockFor(tree, this.source.panel, this.node) ?? find(tree, this.source.panel);
  }

  /** To the other column, when there is one to go to -- the same condition the
   *  header's arrow is drawn on, for a command that arrives without it. */
  move(side) {
    const tree = layout();
    const host = this.host(tree);
    if (placeOf(tree, host)) moveTo(host, side);
  }

  // ---- shape --------------------------------------------------------------

  // The flat strip the list draws and the arrows walk: group titles in place,
  // every item under its own.
  strip() {
    const rows = [], pickable = [];
    for (const section of this.source.sections(this.items)) {
      rows.push({ kind: "head", label: section.label, count: section.items.length });
      for (const item of section.items) {
        rows.push({ kind: "item", item });
        pickable.push(item);
      }
    }
    return { rows, pickable };
  }

  open(item, cx) {
    if (item?.url) cx.open_url(item.url);
  }

  /** Where "New task" points, or null for a panel that makes nothing (pull
   *  requests come from a branch, not a form) or one with no repo yet. */
  newUrl() {
    if (!this.source.newUrl || !this.repo) return null;
    return this.source.newUrl(this.repo, this.meta, this.template);
  }

  openNew(cx) {
    const url = this.newUrl();
    if (url) cx.open_url(url);
  }

  // ---- ui -----------------------------------------------------------------

  // Not an empty panel: say what's missing and hand over the thing that fixes it.
  setup(t) {
    const note = (text) => div().text_size(11).text_color(t.dim).child(text);
    const panel = v_flex().px(16).pb(10).gap(8).items_start();
    const id = `cockpit-${this.source.panel}`;

    if (this.state === "no-repo") {
      return panel
        .child(note("No repository yet. Pick the one whose open issues are your queue."))
        .child(button(t, `${id}-pick`, "Choose repository", () => this.configure()));
    }
    if (this.state === "no-gh") {
      panel.child(note("GitHub CLI not found. Install it, sign in, then restart Herdr so it picks up the new PATH."));
      // Offer a command only where there is one command to offer. Linux has a
      // dozen package managers and guessing wrong is worse than saying where
      // to look.
      switch (hostWindow()?.platform) {
        case "windows":
          return panel.child(
            button(t, `${id}-install`, "Install gh", () =>
              this.terminal(["powershell", "-NoProfile", "-Command", "winget install --id GitHub.cli -e"]),
            ),
          );
        case "macos":
          return panel.child(
            button(t, `${id}-install`, "Install gh", () => this.terminal(["brew", "install", "gh"])),
          );
        default:
          return panel.child(note("Your package manager, or cli.github.com — then restart Herdr."));
      }
    }
    if (this.state === "no-auth") {
      return panel
        .child(note("Not signed in. `gh auth login` opens your browser once."))
        .child(button(t, `${id}-signin`, "Sign in", () => this.terminal([ghCommand(), "auth", "login"])));
    }
    if (this.state === "not-found") {
      const tried = this.tried;
      panel.child(
        note(
          `No access to ${tried.repo ?? "the repository"}. GitHub answers the same for a repo that isn't there and one your login can't see.`,
        ),
      );
      // The way out has to be whatever decides that repo. `panel: null` means a
      // file does -- a picker there writes a key nothing reads, so the 404
      // outlives every attempt to fix it from this screen.
      if (!tried.panel && this.source.configure) {
        return panel.child(
          button(t, `${id}-config`, this.source.configureTip ?? "Settings", (_e, cx) => this.configureWith(cx)),
        );
      }
      return panel.child(
        button(t, `${id}-repick`, "Choose another", () => this.configure(tried.panel ?? this.source.panel)),
      );
    }
    // Not every failure is a setup problem: a dropped connection lands here
    // too, so the way out is to try again, not to reinstall anything.
    return panel
      .child(div().text_size(11).text_color(t.ansi1).child(this.error ?? "unknown error"))
      .child(button(t, `${id}-retry`, "Try again", (_e, cx) => this.refresh(cx)));
  }

  render(cx) {
    const t = theme();
    const source = this.source;

    // A pick in the dialog lands in shared state, which re-renders us. Noting
    // it here and loading from a deferred timer keeps the work out of the
    // render pass; the comparison makes it fire once per actual change.
    if (source.needsRepo) {
      const current = repoOf(source.panel).repo;
      if (current !== this.repo) {
        this.repo = current;
        cx.timer.after(0, (cx) => this.reload(cx));
      }
    } else if (source.repoFrom) {
      // Routines' queue, when its file names none, is the repo Kraken Tasks
      // watches. A pick there is a different queue for this panel too, so it
      // reloads on the same frame rather than a poll later.
      //
      // Whether the file overrides it is only known to the load, so a panel
      // pinned by `coordination_repo` reloads here too and reads the same
      // queue again. One `gh` call, on an action that was already reloading
      // the panel next to it -- cheaper than a second way to say which of the
      // two the last load used.
      const current = repoOf(source.repoFrom).repo;
      if (current !== this.from) {
        this.from = current;
        cx.timer.after(0, (cx) => this.reload(cx));
      }
    }

    const tree = layout();
    const host = this.host(tree);
    const place = placeOf(tree, host);
    const collapsed = Boolean(host) && host.size?.px <= COLLAPSED_MAX;
    // Go by this copy's own measured width when it has one, not by a node name:
    // the panel can be in either column, and either one can be dragged narrow.
    const railed = this.width > 0 ? this.width < RAIL_MAX : narrowSidebar();
    const wide = this.width >= WIDE;

    const { rows, pickable } = this.strip();
    this.at = Math.min(this.at, Math.max(0, pickable.length - 1));
    const selected = pickable[this.at] ?? null;
    const attention = source.attention(this.items);
    const pinned = source.needsRepo && repoOf(source.panel).pinned;
    const newTask = this.newUrl();
    // The list's own page in a browser, for a source that has one (Jira's
    // search). Only once something loaded: before that there is no URL to open.
    const browseUrl = source.browse ? source.browse(this.meta) : null;

    // A source may bring its own settings action -- routines opens the file it
    // is configured by. Otherwise the gear is the repo picker, for a panel that
    // watches one and was not pinned to it by the layout.
    const onConfigure =
      source.configure ? (c) => this.configureWith(c)
      : source.needsRepo && !pinned ? () => this.configure()
      : null;

    const trouble =
      this.state === "no-repo" ? "no repo"
      : this.state === "no-gh" ? "gh missing"
      : this.state === "no-auth" ? "sign in"
      : this.state === "not-found" ? "no access"
      : this.state === "error" ? "failed"
      // A kind only its own source knows (Jira's `auth`, `setup`): the word is
      // the label, and the message is in the tooltip and under the header.
      : this.state !== "ok" && this.state !== "loading" ? this.state
      : this.stale ? "stale" : null;

    const note = source.stampNote ? source.stampNote(this.meta, this.repo) : null;
    const body = [
      railed
        ? rail(t, source.icon, attention)
        : header(t, {
            id: `cockpit-${source.panel}`,
            title: source.title,
            attention,
            count: this.state === "ok" ? this.items.length : 0,
            trouble,
            troubleTip: this.stale ?? this.error ?? undefined,
            stamp: this.fetchedAt ? `${note ? `${note} · ` : ""}Refreshed ${ago(this.fetchedAt)}` : "Never refreshed",
            busy: this.busy,
            host,
            collapsed,
            place,
            onConfigure,
            configureTip:
              source.configureTip ?? (this.repo ? `Watching ${this.repo} — change it` : "Choose a repository"),
            onNew: newTask ? (c) => this.openNew(c) : null,
            newTip: `${source.newLabel} in ${this.repo}`,
            onRefresh: (c) => this.requestRefresh(c),
            onBrowse: browseUrl ? (c) => c.open_url(browseUrl) : null,
            browseTip: source.browseTip,
            onMove: (side) => moveTo(host, side),
            onMinimise: () => minimise(host, collapsed, this.heightKey),
          }),
    ];

    if (!railed && !collapsed) {
      if (this.state !== "ok" && this.state !== "loading") {
        body.push(this.setup(t));
      } else {
        if (!rows.length) {
          // An empty queue is the good case, so it gets the way to fill it
          // rather than only the news that it is empty.
          const idle = v_flex()
            .px(16)
            .pb(10)
            .gap(8)
            .items_start()
            .child(
              div().text_size(12).text_color(t.dim).child(this.state === "loading" ? source.loading : source.empty),
            );
          if (newTask && this.state !== "loading") {
            idle.child(button(t, `cockpit-${source.panel}-new-empty`, source.newLabel, (_e, cx) => this.openNew(cx)));
          }
          body.push(idle);
        } else {
          body.push(
            v_flex()
              .id(`cockpit-${source.panel}-list`)
              .flex_1()
              .min_h(0)
              .px(6)
              .gap(1)
              .overflow_y_scrollbar()
              .children(
                rows.map((r) =>
                  r.kind === "head"
                    ? sectionHead(t, r.label, r.count)
                    : source.rowOf(t, r.item, {
                        wide,
                        width: this.width,
                        repo: this.repo,
                        selected: r.item === selected,
                        acting: this.acting === r.item.key,
                        done: this.done?.key === r.item.key,
                        onAction: (item, cx) => this.act(item, cx),
                        onClick: (_e, cx) => {
                          this.at = Math.max(0, pickable.indexOf(r.item));
                          this.open(r.item, cx);
                          cx.notify();
                        },
                      }),
                ),
              ),
          );
        }

        // Under the empty list as much as under a full one. A panel configured
        // by a file is usually empty *because* of that file, and the footnote
        // is where that file's problems are said -- "nothing to watch" with
        // nothing under it is the one case that most needs a reason.
        const footnote = source.footnote ? source.footnote(this.meta) : null;
        if (this.acted) {
          body.push(
            div()
              .flex_none()
              .px(16)
              .pb(6)
              .text_size(10)
              .truncate()
              .text_color(t.ansi1)
              .tooltip(this.acted)
              .child("That didn't go through"),
          );
        } else if (this.stale) {
          body.push(
            div()
              .flex_none()
              .px(16)
              .pb(6)
              .text_size(10)
              .truncate()
              .text_color(t.dim)
              .tooltip(this.stale)
              .child(`Couldn't refresh · showing ${ago(this.fetchedAt)}`),
          );
        } else if (footnote) {
          body.push(
            div().flex_none().px(16).pb(6).text_size(10).truncate().tooltip(footnote).text_color(t.dim).child(footnote),
          );
        }
      }
    }

    const root = shell(t, {
      id: `cockpit-${source.panel}`,
      handle: this.handle,
      body,
      onSize: (size, cx) => {
        if (size.width === this.width) return;
        this.width = size.width;
        cx.notify();
      },
      onKey: (e, cx) => {
        if (e.key === "r") {
          this.requestRefresh(cx);
          cx.stop_propagation();
          return;
        }
        if (e.key === "o" && browseUrl) {
          cx.open_url(browseUrl);
          cx.stop_propagation();
          return;
        }
        if (e.key === "c" && onConfigure) {
          onConfigure(cx);
          cx.stop_propagation();
          return;
        }
        if (e.key === "n" && newTask) {
          this.openNew(cx);
          cx.stop_propagation();
          return;
        }
        if (!pickable.length) return;
        if (e.key === "down") this.at = (this.at + 1) % pickable.length;
        else if (e.key === "up") this.at = (this.at + pickable.length - 1) % pickable.length;
        else if (e.key === "enter") this.open(selected, cx);
        else return;
        cx.stop_propagation();
        cx.notify();
      },
    });
    // For a source that asks: a press anywhere on the panel takes the keyboard.
    // Not for all of them -- the GitHub panels leave it in the terminal you
    // were typing in, and a row there opens a browser tab either way.
    return source.focusOnPress ? root.on_mouse_down("left", () => this.handle.focus()) : root;
  }
}
