# Personal Cockpit

Panels down both sides of the Herdr window, with the terminals between them:
in the sidebar under Spaces and Agents, your open pull requests across every
repo you can read; in a column on the right, the tasks you keep instead of
rewriting, the open issues of one coordination repo you pick — a kraken task
queue — and the open pull requests of the people you watch. Each says in its
header how many want something from you, keeps its last good list when the
network blips, minimises to its own header bar, and moves to the other side
with one button. Click a row to open it in the browser.

Hanging off the window's left edge, a 44 px strip with a count: what is waiting
on you across My pull requests, Kraken Tasks and Routines, ordered by what the
move actually is. Team's pull requests remains in its own panel, excluded from
the drawer and its count. The drawer floats over the work area, so it is still
there when the sidebar is folded — and with nothing waiting it is not drawn at all.

![Personal Cockpit](preview.png)

## What you see

The shipped `cockpit` layout is Herdr's `main` with four panels, one on each
side of the work area, and the drawer in `floating`. The terminals sit between
them, which is the point of the arrangement: what is yours alone is on the
left, what you share with other people is on the right, and the work is in the
middle.

The **sidebar** reads top to bottom:

- **Brand** — 46 px, `workspace-chrome`, drags the window.
- **Spaces** — flexible, `min` 90.
- **Agents** — flexible, `min` 90.
- **My pull requests** — flexible, `min` 42.
- **Footer** — 69 px, `workspace-chrome` with `footer: true`.

It is 268 px, `min` 44, `max` 480, background `chrome`, not resizable. To its
right the usual work column: a 42 px tab bar, the active tab with card panes
(radius 10, gap 8, 30 px always-on header, `lone: true`), a 28 px status bar.

In `work-body`, past the tab, two more columns:

- **`panel`** (Herdr's Files and Changes, 368 px), `hidden` until used.
- **`right-lists`** — 380 px, `min` 300, `max` 640, shown, and holding three
  panels in this order: **Routines**, **Kraken Tasks**, **Team's pull
  requests**. Each flexible, `min` 42. It is the same stack the sidebar is, so
  a panel moves between the two and keeps its shape; emptied by moving all
  three out, the column hides rather than goes, and keeps its width.

Each panel is the same shape:

- A **41 px header**: the title in 11.5 px `dim`, shrinking and truncating so
  that a long one gives way to the pill beside it rather than pushing the
  buttons off the end; then one of a red `blocked`
  pill reading `N needs you`, a 10.5 px `blocked` word naming trouble
  (`no repo`, `gh missing`, `sign in`, `no access`, `failed`, `stale`), or a
  plain 10 px `muted` count. Right-aligned, 13 px icons, 8 px apart: a
  pencil-square on Kraken Tasks only, then refresh (a `working` ring spinner
  while loading), a gear on every panel but My pull requests — Team's and
  Routines open their config file, Kraken Tasks opens the repo dialog, and a
  block pinned with `props.repo` has none — then dock-left/dock-right, and
  minus/plus. The pencil has a glyph of its own rather than a bare plus,
  because a collapsed panel shows it next to the plus that expands. The bar
  itself is the minus/plus: it takes a `hover` background and a press anywhere
  on it that is not one of those icons folds the panel.
- A **list**, 6 px side padding, 1 px between rows, scrollbar on overflow.
  Group titles are 10 px semibold `dim` with a `muted` count beside them.
- Each **row** is 10 px × 5 px, radius 6, `hover` background, `selected`
  background under the keyboard cursor, tooltip with everything the row
  truncated. Line one: an 11 px glyph cell, the title in 12 px `foreground`
  truncating, an optional 9.5 px `dim` tag (`draft` on a pull request,
  `task created` on a routine), and an age in 10 px `dim` (`now`, `6m`, `3d`).
  Wider than 220 px a second line appears, indented under the title by the same
  11 px cell, 10.5 px.

**My pull requests** groups into Needs you, Ready to merge, Waiting, Drafts. The
glyph is `✓` in `ansi2` when checks passed, `✕` in `ansi1` when they failed, a
spinning ring in `working` while they run, `·` in `dim` with no checks. The
second line is `repo #number`, then what is true of it most-pressing-first —
`conflicts`, `changes requested`, then the failure named if exactly one job
failed (`lint failing`, or `build failed` with no name to give) and `N failing`
past that, `N unresolved`, `building` or `N running` past one, `N approved`,
`review needed`, `ready`, `behind base`, `no checks` — then `+additions` in
`ansi2` and `−deletions` in `ansi1`.

**Team's pull requests** is the same row, from a search instead of
`viewer.pullRequests`, and **grouped by the person who opened it**: one group
per login, the group head being the login and its count. The signals are
`your review` in `blocked` first, then `conflicts`, `changes requested`,
`checks failed`, `N unresolved`, `building`, and one of `you approved` /
`N approved` / `review needed`. The failing *job names* are not asked for —
on somebody else's PR they are not yours to chase, and they are what a page of
50 results would be expensive for.

**Kraken Tasks** groups into Needs you (any issue labelled `needs-decision` or
`awaiting-merge`) and Queue, each newest-updated first. The glyph is `●` in
`blocked` for the first group, `·` in `dim` otherwise. The second line is
`#number`, then the issue's own GitHub labels as badges in their own colours,
then `N comments`. A label colour too dark to read on the sidebar is lifted
toward white — every channel a quarter of the way to 255, up to eight times —
until its BT.601 luma, `(0.299R + 0.587G + 0.114B) / 255`, clears 0.45. That is
perceived brightness, not WCAG relative luminance, which is a different formula
over gamma-linearised channels. The hue survives exactly: moving every channel
the same fraction toward white scales `max − min` and each channel difference
alike, so only saturation and lightness move.

**Routines** groups into Needs you, In the queue, Ready and Paused, each group
drawn only when it has rows, and the rows in the order `routines.yml` writes
them — a list you keep is one whose rows stay where you left them. The first
cell doubles as the row's button: `▶` in `accent` on a routine that is ready to
run, the header's own spinner at the cell's 11 px while a press is in flight,
`●` in `blocked` when the routine needs you, and `·` in `dim` otherwise. The
second line is `project:<name>` in `muted`, then `invalid` in `ansi1`, `paused`
in `dim` or `never run` in `dim`; then the task's own GitHub labels in `dim`,
minus the two every kraken task carries (`kraken-task` and its `project:`),
which say nothing the row has not said; then `closed` in `dim` when the last
task is closed, and `#number` in `muted`. The age is when that task was opened.

Narrower than 160 px a panel drops to a **rail**: its icon, tinted `blocked`
when something needs you, and the count in a small pill.

**The drawer**, floating on the window's left edge, vertically centred, with a
44 px peek. It is not in the layout tree. With nothing waiting it is not drawn
at all — no strip, nothing on the edge.

- The **peek strip** is 44 px wide, 12 px of top padding, 5 px gap: a 15 px bell
  icon in `blocked` over the total in the same small pill the rail uses. The
  same icon-over-badge as a folded panel, on purpose — both are the same
  promise.
- The **body** is drawn only while the pointer is on the drawer. Closed, its
  320 px of width are still held — the block keeps the size Herdr slides out —
  but there is nothing in it, so the strip is all there is to see.
- Open, the body is 320 px, background `chrome`, a 1 px `border`, radius 8,
  8 px of bottom padding. Its first line matches a panel header's left half:
  `Needs you` in 11.5 px `dim` with the total in the `blocked` pill, 16 px side
  padding, 12 px above.
- Then a group per kind of move, in this order and only when it has rows, each
  with the same 10 px semibold `dim` section head and `muted` count a panel
  uses: **Fix**, **Decide**, **Configure**.
- Each **row** is the panels' own row, drawn by the same `row()`: an 11 px `●`
  in `blocked`, the title in 12 px `foreground`, the age in 10 px `dim`, and on
  the second line the one reason in 10.5 px `dim` — `conflicts`,
  `changes requested` or `N failing` for Fix; the label that parked it (`needs-decision`, `awaiting-merge`) for Decide; the
  validation message for Configure.
- Nine rows at most, then `+N more` in 10 px `dim`, 16 px in. Plain text, not a
  control.
- On the left edge the strip and the body swap, so the peek is always the side
  against the edge. On the top or bottom edge there is no strip: `peek` is for
  the sides only and Herdr shows the whole block.

**The chrome gallery** is a 760 × 620 dialog, background `background`, with a
44 px header (`Personal Cockpit chrome`, and a 10 px `dim` note), then one
scrolling column of 20 px padding and 22 px gaps: Header bars (six panel-shaped
columns, one per state), Pieces, rails and section heads, Rows wide and narrow
for all four panels, and The floating drawer. Everything on it is made up.

## How it behaves

- **Refresh.** My pull requests every 180 s, Team's every 120 s, Kraken Tasks
  and Routines every 60 s, all of them on the refresh icon and on `r` while the
  panel holds the keyboard. A refresh already running is not started again. The
  icon's tooltip names the signed-in login (my pull requests), how many people
  are watched or the query itself (team), or the watched repo (tasks and
  routines), and when it last succeeded.
- **A failed poll keeps the list.** If a refresh fails while a good list is on
  screen, the list stays, the header says `stale`, and a 10 px `dim` footer
  reads `Couldn't refresh · showing 6m ago` with the error as its tooltip. Only
  a failure with nothing to fall back on replaces the list.
- **Setup instead of an empty box.** `gh` missing offers Install gh (a terminal
  tab running `winget install --id GitHub.cli -e`; macOS and Linux get the
  one-liner as text). Not signed in offers Sign in (`gh auth login` in a tab).
  No repo chosen offers Choose repository. No access offers Choose another.
  Any other failure offers Try again.
- **Choosing the repo.** The gear, or `c` with the keyboard, opens a 420 px
  dialog: a text field taking `owner/name`, the repos picked before (each with
  a `✕` to forget it), and suggestions from `gh repo list` — of your own
  account, or of the owner you have typed so far, looked up 350 ms after you
  stop typing. Enter or Watch it saves; Esc or Cancel closes. A typed
  `owner/name` is always accepted whether or not it was suggested.
- **The choice is per machine.** It lands in `shared("cockpit.issues.repo")`,
  which Herdr keeps in that home's `shared.json` — so one machine watching
  `you/personal-tasks` and another watching `org/work-tasks` need no
  configuration beyond picking once on each. Setting it re-renders every mod,
  and the panel reloads within the same frame, cache first.
- **A panel configured by a file.** Team's pull requests is a search, and
  Routines is a list of tasks; both come from a YAML file in the *installed* mod
  folder (`conf.js`), which the installers exclude so an edit lands on the next
  poll with no reinstall. The gear opens it — writing it from the
  `*.example.yml` beside it when it is absent, so the gear never hands the
  desktop a path with no file at it. Which is also why the footnote is drawn
  under an *empty* list and not only under a full one: a panel configured by a
  file is usually empty because of that file, and the footnote is where the
  file's problems are said.
- **A routine opens a task.** `▶` files the routine as an issue in the queue —
  `coordination_repo` in `routines.yml`, or whatever Kraken Tasks is watching —
  titled by the routine, bodied `### Goal` / `### Acceptance` / `### Notes`
  (that last one only when written), and labelled `kraken-task`,
  `project:<name>` and `priority:<p>` when given. Those headings and labels are
  kraken's `PROTOCOL.md` §1 and §2, not a style choice: a task with no project
  label is invisible to every conforming worker. The row carries `task created`
  for 6 s, and after that the list says it on its own.
- **A routine is identified by its title**, written into an HTML comment in the
  body (`<!-- routine {"title":"…"} -->`, kraken's own marker convention) and
  read back to tell whose task is whose. So renaming the *issue* on GitHub is
  safe and renaming the routine in the file is not: the `▶` returns and a
  second task can be opened, with the loose one sitting in Kraken Tasks.
- **While a routine's task is open its `▶` is gone**, because two workers on one
  goal deliver the same work twice. Close the task to run it again — that is the
  only guard, and it is enough because the queue is the state: nothing about a
  routine is kept locally, so two machines read the same answer out of GitHub
  rather than disagreeing from their own `shared.json`. One exception, in
  memory only: GitHub answers the create with the issue but takes a few seconds
  to list it, and in that window a poll correctly finds nothing and would put
  the button back on a routine that has just run (which is how two tasks got
  opened three seconds apart). The create's own answer is held until the list
  returns that number, or for five minutes if it never does.
- **A broken routine says so in its row**, not when the button is pressed: the
  file is validated as it is read, so a missing Goal, Acceptance, project or
  title draws `invalid` with the reason in the tooltip and in the footnote.
- **Nothing here is scheduled.** The `▶` is the only thing that opens a task:
  no timer, no daemon, no launchd and no Task Scheduler, so there is nothing to
  install and nothing that behaves differently per platform. A cron field is the
  obvious next step and deliberately absent; `git log` holds a tested
  implementation of one if it is ever wanted.
- **The queue panels agree straight away.** Opening a task runs the mod command
  `personal-cockpit.refresh`, which reaches every shown copy — so Kraken Tasks
  shows the new task now instead of up to 60 s later. The copy that pressed the
  button is refreshing anyway and its `busy` guard drops the duplicate; the pull
  request panels reload too, one `gh` call each that they did not need, and
  cheaper than a second signalling mechanism.
- **Keyboard.** With the panel focused (`pane.go` reaches it, `focusable` is
  true): `↑`/`↓` move a selection that draws with the `selected` background,
  `enter` opens it, `r` refreshes, `c` opens the repo dialog or the config file.
- **New task.** The pencil, `n` with the keyboard, or the button that appears
  under "No open tasks", opens the watched repo's new-issue form in the
  browser. Which form is resolved against the templates the repo really has:
  `task.yml` wins when present — kraken installs its issue form at exactly
  `.github/ISSUE_TEMPLATE/task.yml` (`workflow.py` maps it there, and the
  conformance test asserts that destination), so it is taken even with other
  forms beside it, a bug report not being a kraken task. Failing that: a lone
  template whatever its name, else `/issues/new/choose`, else a blank
  `/issues/new`. The template list is fetched once per repo per run, not per
  poll. `props.template` overrides the lot. Pull requests has no such button:
  a PR comes from a branch, not a form.
- **Click** opens the row in the system browser (`cx.open_url`). GitHub stays
  the place to act on a PR or an issue; this is the "what needs me" view.
- **Minimise** resizes the block to 42 px — the header bar and nothing else, so
  there is still something to click. The height it had is remembered in
  `shared("cockpit.<panel>.height")` and given back on expand; a block never
  dragged gets `weight: 1` instead. Dragging the divider below 60 px counts as
  minimised however it happened. The whole header bar does it, not only the
  13 px glyph: a stack of panels is opened and shut all day and the 41 px strip
  is the target nobody has to aim at. The glyph stays, because it is the part
  that says which way the next press goes. The icons beside it stop the press
  (`cx.stop_propagation()` in `action`), so refreshing a panel does not also
  fold it; the bar is only pressable where there is a block to resize, since a
  pane or an overlay has no height to give back.
- **Move** rewrites the layout tree through `layout.set`: the panel goes to the
  column holding the `spaces` mod, or to `right-lists`, which is created inside
  the row holding the tab block if it is missing. An emptied `right-lists` is
  hidden rather than removed, so it keeps the width it was dragged to. Each
  side keeps its own size. The button hides when the layout has nowhere to go.
- **The drawer loads nothing.** Each panel writes what its own `urgent()`
  returned into `shared("cockpit.<panel>.urgent")` when a load lands — never
  from a render, since writing shared state asks for another one — and the
  drawer only reads its included sources (not Team, even from persisted state).
  So it costs no `gh` call, arrives by itself (a shared write re-renders every mod), and cannot show a row no panel believes in. A panel
  that cannot load, or has no repo chosen, publishes an empty list: its own
  trouble belongs in its own header, beside the button that fixes it. A refresh
  that failed over a good list leaves the panel's state `ok`, so those rows
  stay — the drawer goes stale exactly when the panel does.
- **The order is the drawer's whole reason to exist.** Any panel can say
  `3 needs you` about its own list; only something looking across the included
  panels can say which to deal with first. Verbs come in the order above — your
  own work stuck, then the queue waiting on a decision, then a file
  of ours that is wrong — and inside a verb the longest wait is first, which is
  the opposite of how the panels sort their own lists. They are lists you read;
  this is a list you are nagged by, and the forgotten row is the one that sat
  still. An unknown age sorts last rather than first.
- **A click on a drawer row** opens it in the browser. A Configure row has no
  page — a broken routine has no task — so it wires no click and takes no
  pointer: the gear in the Routines header is what opens the file.
- **The drawer never steps aside**, and that is deliberate. It reads nothing
  about the rest of the window: not whether a panel is docked in `right-lists`,
  not whether Herdr's files and changes panel is open. One rule decides whether
  it draws, and it is whether anything is waiting.
- **The gallery** opens on the mod command `personal-cockpit.kit`
  (`herdr-app do personal-cockpit.kit`) as a dialog overlay. A mod command
  reaches every copy on screen, so exactly one panel answers this one — the
  first in `list.js`'s `SOURCES` — or four identical dialogs open at once.
  `escape` closes it. Its data is held, not fetched, so it draws with no `gh`,
  no login and no network.
- **Demo mode.** With a `personal-cockpit-demo.json` in the Herdr home,
  `github.js` answers every `gh` call from it and spawns no process at all — not
  even the `--version` probe, since the point is a machine with no `gh` on it. A
  route answers when its `match` appears anywhere in the call's arguments; an
  unrouted call fails loudly, so a panel the file does not cover says so in its
  header instead of drawing a convincing blank. The file is re-read on every
  call, so editing it lands on the next poll. A file that does not parse is
  ignored rather than treated as an outage.

## Built from

```
layouts/cockpit.json          main + one panel in sidebar-lists, three in
                              right-lists, and the drawer in `floating`
layouts/cockpit.svg           its thumbnail in Settings, named by "preview"
mods/personal-cockpit/
  main.js      the one exported View; picks a screen by props.kind
  list.js      the list panel: state, refresh, setup states, keyboard, render,
               and publishing its urgent rows for the drawer. Exports SOURCES,
               the roster of panels there are
  jira.js      the optional Jira screen, reusing kit.js and dock.js; no urgency rows
  jira-model.js     pure query, pagination and shaping
  jira-query.js     exec adapter shared by the panel and query editor
  jira-settings.js  native JQL dialog
  jira-bridge.mjs   read-only Node/Pi MCP connection, run as a separate process
  package.json     private Node ES-module marker; no dependencies
  JIRA.md          Jira setup and recovery guide
  jira.config.example.json  Jira site/cloud ID/JQL example; no credentials
  picker.js    the repo dialog
  drawer.js    the floating drawer: reads included panels' published rows, decides
               whether to draw at all and which side the peek goes on.
               EDGE 44 (the layout's `peek` by hand), WIDTH 320, SHOWN 9
  gallery.js   every piece of chrome on made-up data, in one scroll
  kit.js       the chrome a panel draws: header, rail, row, section head,
               badge, button, spinner, shell, checkGlyph, CELL 11, WIDE 220.
               Takes a theme and some data, returns an element — it imports
               from the toolkit and nothing from `herdr`, so it decides nothing
  dock.js      where a panel lives and how it moves: find / parentOf /
               destinations / placeOf / hostBlockFor / narrowSidebar,
               minimise, moveTo, COLLAPSED 42, COLLAPSED_MAX 60,
               RAIL_MAX 160, RIGHT "right-lists". The reverse of kit.js — it
               imports `herdr` and nothing from the toolkit, because it reads
               the layout tree, decides, and sends a command back
  checks.js    RED and RUNNING: what a commit's check rollup means, in the two
               questions a row asks of it. Imports nothing
  urgent.js    which of four kinds of "your move" comes first: VERBS, merge(),
               groups(), shareKey(). An order is not a screen, so like
               checks.js and yaml.js it imports nothing
  github.js    gh discovery, graphql(), rest(), createIssue(), repoList(),
               issueTemplates(), viewer(), ago(), agoShort(), the typed error
               kinds, and demo mode (one file answers every call)
  config.js    repoOf / choose / recent / forget, and the precedence
  conf.js      config paths, YAML reads and shared YAML/JSON file opener
  yaml.js      the five-construct YAML reader those files are written in
  pulls.js     the GraphQL query, shaping, grouping and row for your PRs
  team.js      the search, searchFor(), shaping, grouping by person, and row
  issues.js    the REST call, slimming, cache, grouping and row for issues
  routines.js  the routines file, the marker, the ▶ that opens a task
  mod.json     { place: "none", title: "Cockpit", focusable: true,
                 overlay: { kind: "dialog", width: 420 } }
  *.svg        pulls, team, issues, routines, urgent, refresh, plus, minus,
               dock-left, dock-right, settings, new-task, browse
  *.example.yml  routines and team, seeded on install and by the gear
tools/sandbox.sh, tools/sandbox.ps1   a throwaway Herdr home on made-up data
tools/demo.mjs, tools/demo/           the made-up world it runs on
```

One mod, twenty-one modules at its root, plus the separate `jira-bridge.mjs`
Node process; Jira-specific helpers are named `jira-*`.
The only exported View is `main.js`; there is one `mod.json` and one
set of panel chrome/docking helpers and assets. The Node bridge is executed as a
separate process, never imported into the native runtime. Nothing in `tools/`
is installed.

Nine `kind`s, one screen each. The four default layout blocks are panels, with
`props: { kind: "pulls" | "team" | "routines" | "issues", node: "<block id>" }`;
one floating block is the drawer, `props: { kind: "urgent" }`; and the mod opens
two of its own as dialog overlays — `{ kind: "repo-picker", panel, current }`
from a gear, and `{ kind: "kit" }` from the `personal-cockpit.kit` command.
The optional `kind: "jira"` screen adds a Jira panel to any personal layout;
`kind: "jira-settings"` is its 680 px native query editor. Its three-minute
poll uses only read-only JQL searches through the existing managed Pi Atlassian
login. A failed poll retains even a successful empty list; a refresh requested
mid-poll is queued. Query save validates before a compare-and-swap config write,
and closing the overlay cancels a pending save through the View's close hook.
Only Jira handles the `jira-refresh`, `jira-configure`, `jira-move-left` and
`jira-move-right` commands; the general `refresh` still reaches every list.
Its local `jira.config.json` survives both installers. No OAuth credentials
are copied. Jira does not publish drawer rows. See `JIRA.md` for setup.

None of these screens needs another mod folder: a mod cannot import across
mod folders, so each would otherwise carry its own copy of the chrome. An
unknown `kind`, and no props at all, is the pull requests panel — which is what
`herdr-app check` renders.

The drawer's block, in the root's `floating` array rather than its `children`:

```json
{ "id": "urgent", "edge": "left", "align": "center", "peek": 44,
  "content": { "mod": "personal-cockpit", "props": { "kind": "urgent" } } }
```

**Shipped mods used:** `spaces` and `agents` (the layout), `workspace-chrome`
(brand, footer, and its `spinner.svg`), `tabs`, `pane`, `files`, `changes`,
`workspace-status`.

**`herdr` functions:** `exec`, `layout`, `run`, `props`, `shared`, `setShared`,
`theme`, `openOverlay`, `closeOverlay`, `nextCommand`, `appHome`,
`readTextFile`, `writeTextFile`, `window`, `placement` (the drawer, for the edge
it is hanging from; null for every other screen).
**Commands:** `layout.resize`, `layout.set`, `terminal.open`.
**Mod commands it answers** (`"<mod>.<command>"` reaches every copy on screen):
`refresh`, `focus`, `configure`, `new`, `kit`.
**Shared state:** `cockpit.<panel>.repo`, `cockpit.<panel>.recent`,
`cockpit.<panel>.height`, `cockpit.<panel>.urgent`.
**Programs:** `gh` — `api graphql`, `api repos/…/issues`,
`api repos/…/contents/.github/ISSUE_TEMPLATE`, `repo list`, `auth login`,
`--version`; and one of `cmd /c start` / `open` / `xdg-open` for the config
file. Nothing else. The only write to GitHub is the one a routine's `▶` makes:
New task opens a browser and does not file the issue, and the team panel never
writes at all.

**GraphQL cost.** Measured with `rateLimit { cost }`, not counted by hand: the
team panel's `search(first: 50)` costs **2** points on a full page of 50
results, against a budget of 5,000 an hour — ~60 an hour at 120 s.
`viewer.pullRequests(first: 30)` measured **1** at one open PR. Counting child
nodes suggests an order of magnitude more than either; GitHub charges per
connection it has to go and fetch, not per node it returns. Measure again before
adding a connection to one of these, and do not estimate.

## Watch out

- **Install the mod folder as a copy, never a junction or a symlink.** The
  JavaScript loads fine through a link, so the panels come up and look right —
  but `svg("mods/personal-cockpit/…")` then resolves outside
  `~/.config/herdr-app` and every icon silently draws nothing. The headers lose
  refresh, gear, dock and minimise, `herdr-app status` stays clean, and there
  is no error anywhere to follow. Established by A/B on 0.1.13: same commit,
  same layout, junction → bare headers, copy → all four buttons. The shipped
  `mods/workspace-chrome/spinner.svg` keeps working throughout, which is the
  tell — it is the one asset that does not come from the linked folder.
  `tools/install.ps1` copies, on purpose.
- **`gh` is often not on Herdr's PATH on Windows.** Herdr's environment is the
  one it started with, and the gh installer does not touch a running process.
  `github.js` tries `gh` and then five known install paths, including
  `C:\Program Files\GitHub CLI\gh.exe` — this is load-bearing, not belt and
  braces. Remove it and the panel reports gh missing on a machine that has it.
- **One mod means one key namespace.** `keys.json` sections are `mod:<name>`,
  and `<mod>.<command>` is delivered to *every shown copy* — so
  `personal-cockpit.refresh` refreshes all four panels, and there is no way to
  bind a key to only one of them. The in-panel `on_key_down` keys (`r`, `c`,
  arrows, enter) do go to just the focused panel. This is the price of the four
  panels sharing their code; it was a deliberate trade — and `routines.js`
  spends it on purpose, fanning a refresh out to every copy when a `▶` changes
  the queue.
- **Don't discover the host block by mod name.** Four blocks run this mod, so
  `content.mod === "personal-cockpit"` matches all of them. `hostBlockFor`
  goes by `content.props.kind`, with `props.node` winning when the layout
  states it.
- **Hardcoded node ids break when a layout renames them.** An earlier version
  of the tasks panel wrote the layout file directly and looked for
  `sidebar-lists` by name. `dock.destinations` finds the sidebar as "the node
  holding the `spaces` mod" and the work row as "the node holding the `tab`
  block" instead, so a differently-shaped layout degrades to hiding the move
  button rather than throwing.
- **A layout file can change under you.** The old dock button rewrote
  `layouts/<name>.json`, which reorders blocks. Anything that edits the tree
  must address blocks by id, never by index.
- **GitHub answers 404, not 403, for a private repo your token cannot see.**
  "No access" and "no such repo" are the same response; the panel says so
  rather than guessing.
- **`mergeStateStatus` sits behind a preview media type.** The query asks with
  the `merge-info-preview` Accept header and retries once without the field if
  the preview is gone. Everything else on the row survives without it; only
  "Ready to merge" gets less precise, falling back to an approval.
- **The issues endpoint returns pull requests too.** They are filtered on
  `pull_request` being absent.
- **And `search(type: ISSUE)` returns issues, whatever `is:pr` said.** An Issue
  node has none of the fields asked for inside `... on PullRequest` and arrives
  as `{ "__typename": "Issue" }`, so the filter is on the typename. Verified
  against `repo:cli/cli is:open`, which answers with both.
- **`@me` is not a search qualifier.** It is a gh and web shorthand; the API
  does not expand it, which is why `pulls.js` avoids `author:@me` and takes
  `viewer.pullRequests` instead. `team.js` does expand it, by hand, against the
  login from `viewer()` — so a `team.yml` written with `review-requested:@me`
  works and one read by anything else would not.
- **GitHub caps a search query at 256 characters.** A watch list long enough to
  pass it gets a message with the length in it; over the wire that is a
  `422 Validation Failed` naming nothing. Past a handful of people, an `org:`
  scope is the answer rather than more `author:` terms.
- **Don't let a config panel's trouble land only in the footnote of a
  non-empty list.** "Nothing to watch" and "that is not a login" are exactly
  the cases with no rows to draw, and the footnote used to be inside the
  has-rows branch — so the one panel state that most needed a reason had none.
- **The YAML reader takes `- name` as well as `- key: value`.** `people:` is a
  list of names, `routines:` a list of maps, and one flat `items` carries both;
  an item is a string or an object. A routine that lost its `title:` therefore
  arrives as a string rather than as a parse error, and `validate` is what
  reports it.
- **Suggestions in the picker are not the way in.** `gh repo list` only knows
  the account signed in right now, so a repo on a work account or an org may
  never appear. The text field always accepts a typed `owner/name`.
- **`props.repo` pins a block and hides the gear.** A layout that names a repo
  meant that block to be that repo; use it to show personal and work side by
  side, and expect no picker on those.
- **Every list is one page, and the ones that can overflow say so.** My pull
  requests asks for 30, Team's for 50 (footnote `First 50 of N` past that),
  Kraken Tasks for 100 (footnote `First 100 tasks` when it comes back full),
  Routines reads 100 issues to find each routine's last task. One page is
  already more than a sidebar panel can show, and a second would double what
  every poll costs. The picker shows 8 suggestions and remembers 6 repos.
- **The shipped layout pins the sidebar, so the rail is not reachable by
  dragging it.** `sidebar` is `resizable: false` — there is no boundary to drag
  — and `right-lists` has `min: 300`, so docking a panel there cannot reach
  160 either. The rail itself is right and goes by the panel's own measured
  width: it draws when the sidebar is folded, when a `layout.resize` makes it
  narrow, or in a layout that leaves the sidebar resizable. Don't write a check
  that asks someone to drag this one.
- **Two different pictures, easy to confuse.** `preview.png` at the repo root
  is the herdr.dev gallery card and the README image. `layouts/cockpit.svg` is
  the thumbnail inside the app, in Settings → Look, and it only appears
  because the layout root names it in `"preview"`. Herdr draws its own
  thumbnails for its own layouts, so a layout from elsewhere with no `preview`
  is the only one in that row showing an empty frame.
- **The installer has to copy the `.svg` too.** It is referenced from the
  layout, not from the mod, so a run that copies only `cockpit.json` leaves
  `"preview"` pointing at a file that is not in the Herdr home. Both scripts
  loop over `cockpit.json` and `cockpit.svg`.
- **`props.kind` is the only thing telling the copies apart.** A new panel is a
  module with the source interface (`panel`, `title`, `icon`, `load`,
  `sections`, `attention`, `urgent`, `rowOf`, and whichever of `configure`,
  `footnote`, `stampNote`, `newUrl`, `act`, `cached`/`save` it needs), one line
  in `SOURCES` in `list.js`, and a block in the layout. `panel` names the block,
  the remembered height, the cache and the shared key it publishes under — it is
  not the title, which is why renaming "Pull requests" to "My pull requests"
  left `panel: "pulls"` alone.
- **`attention` must stay derived from `urgent`.** Two functions each deciding
  what wants you is how a header pill and the drawer come to disagree, and the
  disagreement is invisible until somebody notices the numbers differ. Make
  `urgent` return the rows and `attention` its `length`; the role test asserts
  it for all four.
- **A panel's urgent key is read by a copy that cannot see its items.** Hence
  shared state and not a method call — but shared state is persisted, so a row
  written by an older version of the mod outlives it. `merge()` drops anything
  without a key and sorts an unknown verb last rather than throwing.
- **Never publish from a render.** Writing shared state re-renders every mod,
  so a write during a render is a render asking for another one, forever. It
  goes in the path that loaded.
- **`peek` is not measured in exactly the pixels the strip is drawn at.** On a
  1280-wide window a `peek` of 44 left about 75 showing, and what filled the
  difference was the right-hand edge of the body: a column of ages beside the
  count, belonging to rows that were not on screen. Hence the body is drawn
  only while `placement().hovered` — whatever extra shows is then blank. Don't
  go back to drawing it always and trusting the two numbers to agree.
  `EDGE` and the layout's `peek` are still the same number by hand, and
  `tests/structure.test.js` compares them, because the strip should fill the
  peek rather than rattle around in it.
- **The drawer draws its own background.** A floating block sits over whatever
  is behind it, which on this layout is a terminal, and these rows would be
  unreadable on one. If a future Herdr draws a surface under a floating block,
  this one is the same `chrome` and will not show — but check it on a real
  window, because `herdr-app check` renders the mod with no placement at all
  and so never draws the floating form.
- **Nothing waiting means nothing drawn, and that is a trade.** The edge stays
  clean, which is the point; the cost is that somebody who has never seen it
  full does not know it is there. The README names it so the drawer does not
  have to.
- **Don't make the drawer step aside for what is behind it.** It was built that
  way first: on the right edge it drew nothing while `right-lists` or `panel`
  was visible, reasoning that a drawer over a panel is worse than no drawer and
  the count is in that panel's header anyway. Docking three panels to the right
  showed what that costs. The drawer vanished for good, with nothing on screen
  to say why — and hiding takes away the one thing that would have fixed it, the
  strip there is to drag. Overlapping is the lesser harm and the one with a way
  out. The second half of the reasoning was wrong too: what the drawer adds is
  the order *between* the panels, which no panel's header carries.
- **The gallery must not read or write a panel's shared state.** Writing
  `cockpit.pulls.urgent` would poison the real drawer with made-up rows, and
  reading it would draw somebody's actual work into a screenshot. It takes its
  drawer rows as an argument for exactly that reason, and the test asserts both.
- **Demo mode is scoped by the home, not by a flag.** There is no env var
  because a mod cannot read one: `exec` hands the environment to a child, and
  nothing hands it to the JS. So the file lives in the Herdr home, and the only
  thing keeping it out of a real one is that nothing but `tools/sandbox.*` ever
  writes it. Don't add a copy of it to the mod folder, which both installers
  would then deliver to everybody.
- **Demo mode does not make `check` draw rows.** `check` renders once and does
  not wait on a load, so the panel in it is empty however fast the answer
  arrives. The gallery is what covers that, because it holds its data.
- **The cache is per mod copy, and only Kraken Tasks has one.** `localStorage`
  lands in `data/personal-cockpit/store-<hash>.json`, hashed from the props —
  so two blocks, or the same block with a different repo, do not share one.
  The entry inside names the repo too (`cockpit.issues:<owner>/<name>`), which
  is what makes switching repos show the right list before the network answers.
  A corrupt or unwritable cache is swallowed: it is worth one spinner, never a
  broken panel.
- **Only `gh` is checked at startup, not the repo.** A repo you cannot see is
  found out on the first call, which is what the `not-found` state is for.

## Done when

- Every panel draws in the sidebar with the `cockpit` layout, each with its own
  header and count.
- **Every header button is visible**: My pull requests shows refresh, dock and
  minimise; Team's pull requests and Routines add a gear; Kraken Tasks adds a
  gear and a pencil. An icon that does not draw means the mod was linked
  instead of copied — check this before anything else, because nothing else
  reports it.
- `herdr-app check mods/personal-cockpit` exits 0. It renders with no props,
  which is the pull requests panel with an empty list, so that is all it proves
  — the gallery is where the other panels' rows and the drawer get looked at,
  and the suite is where the keys and the assets do.
- With no `team.yml`, Team's pull requests says `no team.yml yet` and the gear
  writes one from the example and opens it.
- With the freshly-seeded `team.yml`, whose settings are all commented out, the
  panel says `nothing to watch: set query or people in team.yml` — under the
  empty list, not swallowed by it.
- With a `query` and two `people`, the panel shows a group per login in the
  order the file lists them, a third group for anyone else the query found, and
  `your review` on a PR that has you as a requested reviewer.
- A `people:` entry that cannot be a login is named in the footnote and left
  out of the query; the rest of the list still loads.
- Forty people in the file gives the 256-character message, before any call.
- With `gh` renamed away, the panel says `gh missing` and offers Install gh.
- With `gh` present but signed out, it says `sign in` and offers Sign in.
- The gear opens the dialog; typing `owner/name` of a repo you can read and
  pressing Enter replaces the list without a restart, and the repo appears
  under Recent next time.
- Typing a repo you cannot read gives `no access` and a Choose another button.
- `layout.resize {"id": "sidebar", "px": 120}` turns every panel into a rail
  with its count, and resizing back to 268 restores the rows. Not by dragging:
  the shipped `sidebar` is `resizable: false`, so there is no boundary to pull.
- Minus collapses a panel to a 42 px header; plus returns it to the height it
  had. Pressing the header bar anywhere else does the same both ways, and
  pressing refresh, the gear, the pencil or the dock arrow does not fold it.
- The dock arrow moves a panel into the right column, which appears at 380 px;
  moving the last one out hides the column but keeps its width.
- Killing the network mid-refresh leaves the rows on screen with `stale` in the
  header, not an empty panel.
- `↑`/`↓` move the selection in every panel and `enter` opens the selected row
  in the browser.
- With no `routines.yml`, Routines draws one row reading `No routines.yml` and
  the gear writes one from the example and opens it.
- A routine missing its Goal, Acceptance, project or title draws `invalid` with
  the reason in its tooltip and in the footnote, and has no `▶` — the file is
  checked when it is read, not when the button is pressed.
- `▶` on a ready routine files an issue in the queue labelled `kraken-task` and
  `project:<name>`, with `### Goal` and `### Acceptance` in the body and the
  `<!-- routine … -->` marker carrying the title. The row shows `task created`
  for 6 s, its `▶` is gone while that task is open, and Kraken Tasks shows the
  new task at once rather than on its own next poll.
- Pressing `▶` twice in a row opens one task, not two: the second press has no
  button to hit, and the create is held until the issues list catches up.
- Closing that task on GitHub brings the `▶` back on the next poll, and the row
  goes on naming it — `closed`, its number and its age — which is how the panel
  says when the routine last ran.
- The pencil on Kraken Tasks opens `…/issues/new?template=task.yml` for the
  watched repo, and Pull requests has no pencil at all.
- Pointed at a repo with no issue templates, New task still works and lands on
  a blank new-issue form.
- Settings → Look shows a drawn thumbnail on the cockpit card, not the empty
  frame a layout without a `preview` gets.
- **Nothing on the left edge** while all four panels are up to date: no strip,
  no count, nothing to hover.
- With a failing pull request of yours, a review requested of you, a task
  labelled `needs-decision` and a routine missing its Acceptance, the edge shows
  a bell and `3`. Hovering it slides out `Needs you · 3` over the work area, with
  **Fix**, **Decide** and **Configure** in that order and one row under each.
  The Team review stays in its own panel and does not affect the drawer's count.
  Each included row says the same thing its panel's row says.
- A click on the Fix row opens that pull request in the browser. The Configure
  row takes no pointer and opens nothing.
- Folding the sidebar away leaves the drawer where it was — which is the whole
  reason it is not in the sidebar.
- Moving every panel into one column leaves the drawer exactly where it was,
  overlapping whatever is under it. So does opening Herdr's files and changes
  panel. Nothing but an empty list takes it off the screen.
- Dragging the drawer to the right edge puts the strip on the right of the
  body, and Herdr still has it there after a restart.
- The sidebar holds My pull requests, and the right column Routines, Kraken
  Tasks and Team's pull requests, in that order. The dock arrow in any of their
  headers moves one across; moving all three out of the right column hides it
  and keeps its width for the next one.
- `herdr-app do personal-cockpit.kit` opens the gallery **once**, not four
  times, with every header state, the three rails, all four panels' rows wide
  and narrow, and the drawer's body on it. `escape` closes it. Switching the
  theme while it is open leaves every one of them readable.
- With `tools/sandbox.sh start` (or `.ps1`) and a window on that home, all four
  panels are full of the `acme` world, `gh` is never run, and a machine with no
  `gh` at all shows the same thing.
- Deleting `personal-cockpit-demo.json` from that home puts the panels back on
  the real `gh` within one poll, with no reload.
