# Personal Cockpit

[![CI](https://github.com/rafael-adcp/herdr-personal-cockpit/actions/workflows/ci.yml/badge.svg)](https://github.com/rafael-adcp/herdr-personal-cockpit/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/rafael-adcp/herdr-personal-cockpit/branch/main/graph/badge.svg)](https://codecov.io/gh/rafael-adcp/herdr-personal-cockpit)

Panels for the [Herdr](https://herdr.dev) desktop app: what needs me, on both
sides of the terminals doing the work. Your own pull requests on the left, with
Spaces and Agents; the queue and the people you watch on the right.

![Personal Cockpit](preview.png)

| Panel | What it shows |
|---|---|
| **My pull requests** | Your open PRs across every repo you can read: build state, approvals, conflicts, unresolved threads, diff size. Grouped into Needs you / Ready to merge / Waiting / Drafts. |
| **Team's pull requests** | The same, for the people you watch — from a search you keep in `team.yml`. **Grouped by whoever opened them**, and a row says when your review is the thing it is waiting for. |
| **Kraken Tasks** | The open issues of one coordination repo you choose — a [kraken](https://github.com/rafael-adcp/kraken) task queue. Grouped into Needs you / Queue, with the issues' own GitHub labels. |
| **Routines** | Kraken tasks you keep instead of rewriting. A `▶` opens one in the queue; while its task is open the button is gone. Grouped into Needs you / In the queue / Ready / Paused. |

**My pull requests** ships in the sidebar; **Routines**, **Kraken Tasks** and
**Team's pull requests** ship in a 380px column on the right of the work area,
in that order. Any of them moves to the other side with the dock arrow in its
header, and the layout remembers where you put it.

All four keep their last good list when a refresh fails, minimise to their own
header bar — the minus, or a press anywhere else on the bar — and drop to an
icon-and-count rail when their column is dragged narrow.

## Optional: My Jira tickets

The [Jira screen](mods/personal-cockpit/JIRA.md) is part of the same mod:
`content: { mod: "personal-cockpit", props: { kind: "jira", node: "jira-tickets" } }`.
Both installers include it; enable it by adding a block to your personal layout.
No second mod or duplicate layout is needed. The default layout stays GitHub-only.

It lists tickets assigned to the signed-in Atlassian user and not done, with key,
status and priority. It reuses an existing managed Pi Atlassian OAuth login;
no API token or LLM is required. This adapter is tested with Pi 1.4.0 and requires
Node.js only when the Jira screen is used. It shares the Cockpit header, rows,
rail and docking code, and has a native multiline JQL editor with validation
before saving. See its README for setup, migration and board-filter limitations.
The local `jira.config.json` is preserved on reinstall, like the YAML configs.

## The drawer on the edge

Hanging off the left edge of the window is a 44px strip with a count: what is
waiting on you across **My pull requests**, **Kraken Tasks** and **Routines** —
and any agent in the terminals that has stopped to ask you something.
**Team's pull requests stays in its own panel**: its rows do not appear in the
drawer or count towards its badge, even when your review is requested. Hover the
strip and it slides out. With nothing waiting it is not there at all — the reward
for being up to date is a clean edge.

What it adds is the order, and that it survives the panels: they divide the
sidebar's height between them and all four leave the screen the moment the
sidebar is folded or a terminal is maximised. The drawer floats over the work
area, so it is still there.

Each panel can say "3 need you" about its own list, but only something looking
across the included panels can say which to deal with first. So the rows are
grouped by what the move actually is, worst first:

| | What it is |
|---|---|
| **Answer** | an agent of yours is blocked, waiting for you to answer it |
| **Fix** | a pull request of yours that cannot land: a red build, a conflict, changes requested |
| **Decide** | a task in the queue is parked on `needs-decision` or `awaiting-merge` |
| **Configure** | `routines.yml` holds a routine that does not parse |

An idling agent comes before your own work stuck, which comes before queue
decisions; inside a group the longest wait is first — the row most likely to
have been forgotten. **Answer** leads because it is the only one whose cost is
still being paid: a red build is already broken and will be just as broken in an
hour. A click opens the row in the browser, or goes to the terminal for an
agent; the one kind of row with nowhere to go, a routine whose file is wrong,
says so instead of pretending to be a link. Past nine rows the rest are counted
rather than drawn.

### The agents

These rows cost nothing: they come from Herdr's own live answer about its own
terminals, so there is no panel to install, no block to add to a layout and
nothing polled. An agent in another tab or another space is on the drawer all
the same, and a click takes you to it wherever it is.

Only a blocked agent gets a row. One that is working is not waiting on anybody,
and one that finished is not either — Herdr marks it `done` and then `idle` the
moment you look at it, so a row for it would clear itself for reasons the drawer
cannot see. The agent that currently has your keyboard is left out too: it is
already in front of you.

### Not today

The crescent at the end of a row puts it off until 8am tomorrow — or this
morning, if it is still before eight. A drawer that is always lit is not a
signal, and a pull request you cannot touch until Monday would keep it lit for
three days.

**Only the drawer goes quiet.** The panel the row came from publishes it exactly
as before and still counts it in its own header, which is where to look for
something you put off and now want back. Under the rows, `N snoozed` says how
many are asleep, and a press on it brings all of them back. Put everything off
and the edge goes clean, the same as having nothing waiting — including the
strip, so that line is then out of reach until the morning. What is snoozed is
remembered per machine, like the repo you pick.

There is one rule about when it shows: something is waiting, or it is not. It
does not step aside for a panel docked in the right column, or for Herdr's
files and changes panel — if something needs you, you see it. Where it overlaps,
drag the strip to the other edge and Herdr remembers it.

## Requirements

- Herdr 0.1.14 or newer. The drawer asks the app which agents are blocked
  (`agents()`, `spaces()`), and a `herdr` that does not have those is not a
  drawer without agent rows — it is an import that fails and takes every panel
  with it. 0.1.14 is the version this was verified on; if those functions turn
  out to predate it, this is the line to lower.
- The [GitHub CLI](https://cli.github.com), signed in: `gh auth login`. It is
  the only way in — there is no token to configure. On Windows it does not need
  to be on your PATH; the known install paths are tried too.

## Install

From a clone of this repo. **Copy the mod folder — do not link it.**

```powershell
.\tools\install.ps1          # Windows
```

```sh
./tools/install.sh           # macOS, Linux
```

Either one copies `mods/personal-cockpit` and `layouts/cockpit.json` into
`~/.config/herdr-app` and switches to the layout. `ctrl-shift-l` cycles back to
your own, and `ctrl-alt-shift-escape` always returns to the default `main`.

**Reinstalling resets where you put the panels.** Moving a panel to the right
column, or minimising one, is written straight back into `cockpit.json` — the
same file the installer replaces. Pass `--no-layout` / `-NoLayout` to update
the mod and leave your arrangement alone. It is only worth taking the new
layout when this README says the layout itself changed, as it did for the
drawer.

> **Don't install it as a junction or a symlink.** It is tempting — the mod
> hot-reloads as you edit, with no copy step. The JavaScript does load that
> way, so the panels come up and look right. But `svg("mods/personal-cockpit/…")`
> resolves to a path outside `~/.config/herdr-app` and the icons silently do
> not draw: no refresh, no gear, no dock arrow, no minimise, and nothing in
> `herdr-app status` to say why. Verified on Windows 0.1.13 by A/B — same
> commit, same layout, junction gives bare headers and a copy gives all four
> buttons. That the app resolves the real path at all means a Unix symlink
> will very likely do the same; untested, and the install scripts copy on
> every platform so it never comes up. Re-run the installer after each edit.

## Platforms

Windows, macOS and Linux. `gh` is the only thing it shells out to and it
behaves the same on all three; the panel talks to it through `exec`, never
through a shell, so nothing here depends on PowerShell or on `sh`.

Three places know which platform they are on, all through `window().platform`:

- **Finding `gh`.** Herdr's environment is the one it started with, so a `gh`
  installed afterwards is not on its PATH until the app restarts. The lookup
  tries `gh` first, then `C:\Program Files\GitHub CLI\gh.exe` and its x86
  sibling, `/opt/homebrew/bin/gh`, `/usr/local/bin/gh`, `/usr/bin/gh`.
- **Offering to install it.** Windows gets a button running
  `winget install --id GitHub.cli -e`, macOS one running `brew install gh`.
  Linux gets a line of text instead, because guessing between apt, dnf,
  pacman, zypper and the rest is worse than pointing at cli.github.com.
- **Opening a config file** from the Routines or Team gear (`conf.js`):
  `cmd /c start`, `open`, `xdg-open`. `cx.open_url` cannot do this one — it
  takes an absolute `http`/`https` URL and refuses every other scheme by
  design, so that a mod cannot hand an arbitrary URI to whichever handler the
  desktop registered for it. That rules out `file://`, and a file is what this
  has to open.

Everything else — opening a row, the New task form — goes through
`cx.open_url`, which hands the URL to whatever the system opens URLs with.

An earlier version of the tasks panel read a GitHub token out of Git
Credential Manager through a bundled PowerShell script, which worked on
Windows only. It is gone; `gh` holds the login now.

To put the panels in a layout you already have, add a block per panel to a
column:

```json
{ "id": "pulls", "type": "block", "min": 42, "size": { "weight": 1 },
  "content": { "mod": "personal-cockpit", "props": { "kind": "pulls", "node": "pulls" } } },
{ "id": "team", "type": "block", "min": 42, "size": { "weight": 1 },
  "content": { "mod": "personal-cockpit", "props": { "kind": "team", "node": "team" } } },
{ "id": "routines", "type": "block", "min": 42, "size": { "weight": 1 },
  "content": { "mod": "personal-cockpit", "props": { "kind": "routines", "node": "routines" } } },
{ "id": "kraken-issues", "type": "block", "min": 42, "size": { "weight": 1 },
  "content": { "mod": "personal-cockpit", "props": { "kind": "issues", "node": "kraken-issues" } } }
```

Put the first block in your sidebar column and the other three in a
`right-lists` column inside the row that holds your tab block, which is where
the dock arrow moves a panel to. Leave that column out and the first press of
the arrow creates it.

The drawer is not in the tree. It goes in `floating`, beside the root's
`children`, and the `peek` is what stays showing when the pointer is elsewhere:

```json
"floating": [
  { "id": "urgent", "edge": "left", "align": "center", "peek": 44,
    "content": { "mod": "personal-cockpit", "props": { "kind": "urgent" } } }
]
```

Leave it out and nothing else changes — the panels never ask whether it is
there. On the top or bottom edge there is no peek, so the whole drawer shows;
in an ordinary block it fills the block, with no strip.

## Choosing the repo Kraken Tasks watches

Click the gear in its header, or press `c` while the panel has the keyboard.
Type `owner/name`; anything the signed-in `gh` can read works, including a
private repo on an org. The repos you pick are remembered for one-click
switching.

The choice lives in `shared("cockpit.issues.repo")`, which Herdr keeps in that
machine's `shared.json`. **So each machine keeps its own** — the desktop can
watch `you/personal-tasks` while the work laptop watches `org/work-tasks`, with
no configuration beyond picking once on each.

To pin a block instead, name the repo in the layout and the gear disappears —
useful for showing two task panels at once:

```json
"props": { "kind": "issues", "node": "work-issues", "repo": "org/work-tasks" }
```

## Adding a task

The pencil in the Kraken Tasks header, `n` with the keyboard, or the button
under "No open tasks" when the queue is empty. It opens the new-issue form for
the repo you are watching, in the browser.

Which form it lands on is resolved against the templates the repo really has:

| The repo's `.github/ISSUE_TEMPLATE` | Where the button goes |
|---|---|
| has `task.yml` | straight into it — kraken installs its issue form at exactly that path, so in a repo `kraken init` touched the name is a contract |
| one template, another name | straight into that one |
| several, no `task.yml` | GitHub's `/issues/new/choose` |
| none, or unreadable | a blank `/issues/new` |

The list is looked up once per repo per run, not on every poll. To force one
named form regardless, add `"template": "something.yml"` to the block's props.

## Team's pull requests

Nothing can ask GitHub for somebody else's pull requests the way the panel
above asks for yours — `viewer.pullRequests` is only ever you. So this one
searches, with a query you keep in `team.yml` **in the installed mod folder**:

```
~/.config/herdr-app/mods/personal-cockpit/team.yml
```

The gear in the header opens it, and `c` with the keyboard does the same. It
writes the file from `team.example.yml` the first time, so the gear always opens
something. Both installers leave it alone, so a new teammate takes effect on the
next poll — no reinstall, no restart, and like `routines.yml` it is per machine.

Two settings, both optional on their own but not together:

```yaml
query: org:your-org draft:false -author:your-login

people:
  - alice
  - bob
```

`query` is GitHub's own issue-search syntax — the string you would type into
the search box. **Scope it**: without an `org:` or a `repo:` you get a
teammate's weekend projects beside the work. `is:pr`, `is:open` and
`sort:updated-desc` are added when you leave them out, and a query that already
says `is:closed` or `merged:` keeps the state it asked for. `@me` is expanded
before the call, so `review-requested:@me` works here even though the search API
does not know that shorthand — that one query turns the panel from who you watch
into what is waiting on you.

`people` are GitHub logins. They go on as `author:` terms, so the panel holds
those people and nobody else, and **the order you write them in is the order of
the groups**. Leave it out and the query stands alone, with a group for whoever
it found, most recently active first: that is how to watch a whole org without
naming anybody.

The groups do not reorder themselves as things happen — a list you glance at is
one whose rows are where you left them. What wants you is in the header's red
count, in a `your review` on the row, and first inside that person's group.
`you approved` says you are done with one. Set the panel wide, or dock it to the
right column, and the second line gets room for all of it.

Pointed at nothing, the panel says `nothing to watch` rather than showing you an
empty list and letting you wonder. A query too long for GitHub's 256-character
cap says that too, with the length, instead of returning a bare
`Validation Failed`.

## Routines

A task you open again and again — review the flaky tests, prune merged
branches — written once and kept. Press `▶` in the row and it is opened in the
queue, labelled and with its Goal and Acceptance already in it; a worker claims
it from there.

The queue is the repo picked in **Kraken Tasks**, so a fresh install needs no
second answer. Set `coordination_repo` in the file to pin Routines to a
different one — it wins where it is set, which is also why the shipped example
leaves it commented out.

They live in `routines.yml` **in the installed mod folder**, not in this repo:

```
~/.config/herdr-app/mods/personal-cockpit/routines.yml
```

The gear in the panel's header opens that file, and `c` with the keyboard does
the same — it is the whole configuration surface of the panel, so there is
nowhere else to look and no path to remember. If it is not there, the gear
writes it from `routines.example.yml` first.

Both installers leave that file alone — it is in their exclude list beside
`team.yml` and the two the app writes — and copy `routines.example.yml` across
only when it is not there yet. So a new routine takes effect on the next poll, with no reinstall and
no restart, which is the opposite of how every other file here works. It is also
why the file is per machine: your two laptops can keep different routines, and
neither can open the other's tasks.

The example file is the reference for the fields. Three of them are not a style
preference — `PROTOCOL.md §2` makes **Goal**, **Acceptance** and exactly one
`project:<name>` mandatory, because a task with no project label is invisible to
every conforming worker and one with an empty Goal stalls whoever claims it. The
panel checks that when it reads the file, so a broken routine says so in its row
rather than when you press the button.

A routine has no id: **the title is its identity**, written into a marker in
every task it opens, which is how the panel tells whose task is whose. A second
field to keep in step with the title would earn its place only for renames, and
the cost of not having it is narrow — rename a routine while its task is open
and the `▶` comes back, so a second task can be opened. The loose one is sitting
in Kraken Tasks. Renaming the *issue* on GitHub is safe: the marker keeps the
title the task was opened with.

**Nothing here is scheduled.** The `▶` is the only way a routine opens anything:
no timer, no daemon, no launchd or Task Scheduler, and so nothing to install and
nothing that behaves differently on Windows than on macOS. A cron field is the
obvious next step and deliberately not here; `git log` has a tested
implementation of one if it is ever wanted.

While a routine's task is still open, its `▶` is gone: two workers on one goal
would deliver the same work twice. Close the task to run it again. That is the
only guard, and it is enough because the queue is the state — nothing about a
routine is remembered locally, so both laptops read the same answer out of
GitHub rather than disagreeing from their own `shared.json`.

## Keys

Handled by the focused panel, no binding needed:

| Key | Does |
|---|---|
| `↑` / `↓` | move the selection |
| `enter` | open the selected row in the browser |
| `r` | refresh |
| `n` | new task (Kraken Tasks) |
| `c` | the gear: choose the repository (Kraken Tasks), open `routines.yml` (Routines) or `team.yml` (Team's pull requests) |

`pane.go` reaches the panels, so `ctrl-alt-<arrow>` or whatever you have bound
to it moves the keyboard onto one.

A binding in `keys.json` reaches **every** panel, because they are one mod:

```json
{ "mod:personal-cockpit": { "f5": "personal-cockpit.refresh" } }
```

No `keys.json` ships here, so nothing of yours is touched.

## Developing

[CONTRIBUTING.md](CONTRIBUTING.md) has the map of the repo, the install loop,
the sandbox that fills every panel with made-up data, the chrome gallery, the
suite and the quality gate.

`RECIPE.md` is the brief this was built from, in the format herdr.dev
documents for a shared layout -- read that to rebuild or change it, and keep
it current when you do. The files here are one build of it.

## Licence

MIT.
