# Contributing to Personal Cockpit

Issues and pull requests are welcome. For anything larger than a fix, open an
issue first so the shape can be agreed before it is written.

`RECIPE.md` is the brief this mod was built from, in the format
[herdr.dev](https://herdr.dev) documents for a shared layout. It is not a
changelog of what happened: it describes what the thing *is*, exactly enough
for another agent to build it again from nothing. Keep it in step with the
files — a change that makes the recipe wrong is unfinished.

## What the repo holds

| Path | What it is |
| --- | --- |
| `mods/personal-cockpit/` | The mod: plain ES modules the app loads as they are, its SVGs, and its YAML/JSON example configs. This is what ships. |
| `layouts/cockpit.json` | The layout, and `cockpit.svg`, the preview the Settings picker draws. |
| `tools/install.sh`, `tools/install.ps1` | The installers. They copy `mods/personal-cockpit` and `layouts/` into a Herdr home and nothing else. |
| `tools/sandbox.sh`, `tools/sandbox.ps1` | A throwaway Herdr home on made-up data, for looking at the panels full. |
| `tools/demo.mjs`, `tools/demo/` | The made-up world that sandbox runs on. |
| `tests/` | The suite. `tests/support/host/` are the doubles for the three modules the app injects. Nothing here is installed. |
| `RECIPE.md` | The brief. |
| `preview.png` | What the gallery at herdr.dev shows. |

## The screens

One mod, one entry point. `main.js` is required at the mod root and `mod.json`
says where it first appears. Everything else is grouped into five folders --
`kit/` what every screen shares, `screens/` what a `kind` resolves to,
`panels/` the four list sources, `jira/` the optional screen with its own
model, adapter, dialog and Node process, and `icons/` the art. A mod may hold
subfolders and import freely between them; what it cannot do is import out of
its own folder, which is why this is one mod and not five. There is no second
mod, manifest, or copy of the panel controls:

| File | Its one job |
|---|---|
| `main.js` | picks the screen `props.kind` asked for |
| `screens/list.js` | runs whichever panel it was given, and publishes its urgent rows |
| `screens/drawer.js` | the floating "Needs you" drawer |
| `screens/gallery.js` | every piece of chrome, on sample data |
| `screens/picker.js` | the repo dialog |
| `jira/jira.js`, `jira/jira-*.js`, `jira/jira-bridge.mjs` | optional Jira screen, JQL dialog and read-only provider bridge; reuses `kit/kit.js`, `kit/dock.js` and `kit/conf.js` |
| `panels/pulls.js` `panels/issues.js` `panels/routines.js` `panels/team.js` | the four panels — one role, four players |
| `kit/dock.js` | where a panel lives, and how it moves |
| `kit/kit.js` | the chrome a panel draws |
| `kit/urgent.js` | which of four kinds of "your move" comes first |
| `kit/checks.js` | what a commit's check rollup means |
| `kit/github.js` | everything that talks to GitHub, through `gh`, and demo mode |
| `kit/config.js` | which repo a panel watches |
| `kit/conf.js` | config paths, YAML reads and shared YAML/JSON file opener |
| `kit/yaml.js` | reads the five constructs those files use |

`mod.json`, `package.json` and the person's config files stay at the mod root:
`package.json` is what makes every `.js` beneath it load as ESM, and both
installers preserve the config files by top-level basename, which cannot reach
into a subfolder. The app also writes a `gpui-kit.d.ts` into each folder
holding JavaScript, so there is one per subfolder; `.gitignore` and both
installers exclude them by name.

The art is the one thing a move cannot break by import. An asset path is
resolved from the Herdr home rather than from the file that names it, so
`icons/` costs no `../` anywhere — but it also means nothing fails at build
time, and an icon that does not load draws nothing and reports nothing. Two
assertions in `tests/structure.test.js` are the whole guard: every asset path
the mod names must be a file that is there, and every icon that ships must be
drawn by something. It finds the paths by their shape rather than by the call
they sit in, because they reach `svg()` as an argument to `action()` or
`rail()` or as a panel's exported `icon`, and it expands the two that are
assembled (`icons/dock-${here ? "left" : "right"}.svg`). If you add an icon,
those two tests are what tell you that you wired it up.

The import lists are worth reading as the design. `kit.js` imports from the
toolkit and nothing from `herdr`: it takes a theme and some data and returns an
element, so it cannot decide anything. `dock.js` is the reverse — it imports
`herdr` and nothing from the toolkit, because it reads the layout tree, decides,
and sends a command back. `checks.js`, `yaml.js` and `urgent.js` import nothing
at all. A file whose dependencies state its job is one you can put down and
pick up. `tests/structure.test.js` asserts all of it.

The four panels are interchangeable to `list.js`, so they are players of one
role rather than four special cases: each exports the same `load`, `sections`,
`attention`, `urgent` and `rowOf`, and adding a fifth means writing a module and
naming it in `list.js`. Nothing else has to know. Jira has its own screen
because its polling/auth/error contract differs; it shares the visual and
layout primitives rather than changing the four GitHub source contracts.

## Why one mod

The two panels began as two mod folders and shared about a third of their code
line for line — plus a second copy of every bug fix. Mods cannot import across
folders (`./relative` inside the folder is the limit), so the only way to share
is to be one mod, with the layout running it several times under different
`props.kind`. That is what the Herdr app's own `win98` does, and what `cockpit`,
`redline` and `claude-chat` do in the community.

`git log` has the before: the first commit is both panels exactly as they ran,
the second is the merge.

It is also why the repo dialog, the drawer and the gallery are `kind`s rather
than mod folders of their own. Each would otherwise need its own copy of the
chrome it draws.

## Developing

The loop is edit, reinstall, look — there is no hot reload here, because the
mod is installed as a copy (see the README's warning about links):

```powershell
.\tools\install.ps1 -NoSwitch     # copy over the installed one; runs check too
```

```sh
./tools/install.sh --no-switch
herdr-app status                  # errors from layouts, keys and mods
herdr-app shot shot.png           # the last rendered frame, as a PNG
```

Both installers replace the installed copy wholesale, so a file deleted here is
deleted there, and both run `check` on what they installed before switching.
`--no-layout` / `-NoLayout` leaves `layouts/cockpit.json` alone.
`HERDR_APP_HOME` points either installer at another home, which is how the
sandbox works and how they get tested.

```sh
herdr-app check mods/personal-cockpit   # must exit 0 before you call it done
```

`check` renders the mod once with no props, which is the pull requests panel.
Three things it does not do, which is most of why this repo has the suite and
the two screens below: it builds no row, because a load is async and it does not
wait; it resolves no asset, so a missing SVG draws nothing and reports nothing;
and it says nothing about the keys.

`jsconfig.json` and `gpui-kit.d.ts` are written into the mod folder by the app
on every start and are deliberately not committed: the typings have to match the
installed version.

### The chrome gallery

Every header state, every rail, every row of all four panels and the drawer's
own body, on sample data, in one scroll. It is the only way to compare a change
to the shared chrome against all of its callers at once, and the only way to see
the two themes side by side rather than from memory.

```sh
herdr-app do personal-cockpit.kit     # or: sh tools/sandbox.sh kit
```

It is a screen of this mod (`props.kind: "kit"`), opened as an overlay by
whichever panel is on screen. Its data is held, not fetched, so it draws with no
`gh`, no login and no network. Add a piece to `kit.js` and add it there.

### The sandbox, and the made-up world

A throwaway Herdr home with the mod installed and every panel full:

```sh
sh tools/sandbox.sh start      # build it, install, write the demo data, check
sh tools/sandbox.sh kit        # the gallery, in that window
sh tools/sandbox.sh shot       # a screenshot in each theme
sh tools/sandbox.sh refresh    # rewrite the demo data with fresh ages
sh tools/sandbox.sh stop       # delete the home
```

```powershell
.\tools\sandbox.ps1 start
```

It never touches the real home: everything lives under `$COCKPIT_SANDBOX`
(default: a `personal-cockpit-sandbox` folder in the temp directory), and every
`herdr-app` call carries that `HERDR_APP_HOME`. Opening a *window* on it is the
one thing it cannot do for you — `herdr-app` talks to an app that is already
running, and which command starts a second one depends on how Herdr was
installed. `start` prints what to run.

How it fills the panels: `tools/demo.mjs` writes a `personal-cockpit-demo.json`
into that home, and `github.js` answers every `gh` call from it instead of
spawning one. The panels do not know — the queries go out, the answers come
back, and each panel's own `shape` judges them exactly as it judges a live one.
A route matches on a word of the request, the same rule the suite's own `gh`
double uses and for the same reason.

The file is generated rather than committed as data because the ages on the rows
are relative: one written in March reads as a dead queue in November. Run
`refresh` before shooting.

## No real data

Every fixture, sample and screenshot uses the made-up world: repos `acme/app`,
`acme/web` and `acme/tasks`, the login `you`, teammates `robin` and `sam`.
Nothing of anybody's goes into this repo — no employer or customer names, no
real logins, repository names, issue numbers, URLs or home-folder paths.

A sandbox screenshot is the likeliest way one escapes, so the rule is checked
where the data is: `tests/demo.test.js` and `tests/gallery.test.js` assert that
every URL and repository in the sample data is in the `acme` world.

### Reshooting `preview.png`

It is the herdr.dev gallery card and the README image, so it is the one picture
of this mod most people ever see. Shoot it from the sandbox:

```powershell
.\tools\sandbox.ps1 start
.\tools\sandbox.ps1 dark
.\tools\sandbox.ps1 shot
```

The panels take care of themselves — every one of them is full of the `acme`
world. The **work area does not**: the sandbox window shares herdr-core with
your own, so whatever terminal is in front is yours, with your home folder in
its prompt. The version before this one went out with a real repo, a real
login and a real home path in it.

So give it a terminal of its own somewhere neutral:

```sh
git clone --no-hardlinks . /c/Users/Public/cockpit-demo
```

```powershell
herdr-app do tab.new --name demo --folder "C:\Users\Public\cockpit-demo"
hc send <terminal> "git log --oneline --decorate --no-merges -7"
.\tools\sandbox.ps1 shot
herdr-app do tab.close --id <tab> --confirmed true     # it is in your window too
```

`herdr-app do window.maximize` first: the card wants the full 1920. Delete the
clone afterwards.

## Tests

```sh
npm test               # the suite
npm run coverage       # the suite, with a coverage report and its floor
npm run coverage:lcov  # the same, writing coverage/lcov.info
```

No dependencies and no lockfile: it is `node:test` and `node:assert`, so a clone
runs the suite with nothing installed. Node 22 or newer.

The mod imports `herdr`, `gpui-kit` and `gpui-base` from nowhere — the app
injects them — so `tests/support/register.mjs` resolves those three names onto
doubles in `tests/support/host/`. The mod's own source is then imported
unmodified, exactly as the app loads it. Nothing in `tests/` is installed, so the
thing under test is the thing that ships.

What the doubles do and do not do is the shape of the whole suite:

- **State the app holds** — shared state, the files in the mod folder, the layout
  tree, where a floating mod is hanging — is kept for real, in memory. A test
  sets it up and reads back what the mod did to it.
- **Messages the mod sends outward** — `run`, `exec`, `openOverlay` — are
  recorded. "Pressing ▶ opens an issue labelled `kraken-task`" is the behaviour,
  so the assertion is that the message went, with those arguments.
- **GitHub is not faked.** No test stubs `graphql` to a canned payload. The
  judgement each panel makes about a pull request is a pure function of one
  (`pulls.shape`, `team.shape`), exported and called directly — which is why
  `searchFor` was already exported before any of this existed. Where a test does
  need `gh`, it answers at the process boundary, so the real `github.js` builds
  the real arguments and parses the real JSON: its error taxonomy can only be
  tested there.

Three files are worth knowing about before changing anything:

`tests/panel-role.test.js` is the one to keep green through a refactor. The four
panels are interchangeable to `list.js`, so they are players of one role, and
that file runs one set of tests against all four — the contract read off
`list.js`'s own use of them rather than invented. Split a file, move one into a
subfolder, rename a private helper: if all four still answer the same messages
with the same kinds of answer, nothing downstream can tell the difference.

`tests/structure.test.js` asserts the invariants of a mod folder: that every
asset referenced is really there, that nothing imports its way out of the
folder, that the files which must not reach the app or the toolkit do not, that
every block in the shipped layout asks for a `kind` the mod knows — including
the floating one, which is not in the tree — and that both installers still
leave `routines.yml` and `team.yml` alone.

`tests/demo.test.js` keeps the made-up world answering. A demo route matches on
a word of a query, so a query that changes stops matching; without this the
first anybody would know is an empty sandbox.

Two modules keep state for the life of the process, by design, and `reset()`
cannot clear it: `routines.js` remembers a task ▶ just opened (to paper over
GitHub's read-after-write lag), and `issues.js` remembers a repo's issue forms.
A test about either needs a routine title or a repo name no other test has used.
`github.js` caches the `gh` it found and the signed-in login the same way, which
is why `tests/demo.test.js` shapes the team's rows directly instead of loading
them. Both places say so where it matters.

## Quality gate

Run what applies to what you touched. CI runs the first two on three platforms
and two versions of Node.

```sh
npm test
npm run coverage                        # the floors, which is what protects a refactor
herdr-app check mods/personal-cockpit   # on a machine with Herdr
sh -n tools/sandbox.sh tools/install.sh # the shell scripts still parse
```

For a visible change, look at it: `sh tools/sandbox.sh kit` for the chrome, and
`sh tools/sandbox.sh start` then a screenshot in both themes for a panel. A
change nobody looked at in both themes is not finished — `check` passes on a
panel drawn in colours that cannot be read.

## Commits and pull requests

- One topic per pull request, with a short description of what changes for
  somebody using the panels.
- Commit subjects are one short line saying what changes, e.g.
  `Keep the last good list when a refresh fails`.
- Comments and doc comments are one or two plain sentences in the present tense,
  saying what the code does and why it is that way rather than the obvious
  alternative. No history ("used to", "no longer"), no issue or PR numbers.
- `RECIPE.md` is part of the change, not a follow-up.

By contributing, you agree that your contributions are licensed under the MIT
licence of this repository.
