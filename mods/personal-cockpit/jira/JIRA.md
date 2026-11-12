# My Jira tickets

An optional read-only panel of the Personal Cockpit mod (`props.kind: "jira"`).
It is a list source like the GitHub panels, run by the same `screens/list.js`,
so the header, rows, rail, SVG controls, docking, keyboard and stale handling
are theirs rather than copies. There is no separate mod or duplicated layout.
The source (`jira.js`) and its `jira-model.js`, `jira-query.js`,
`jira-settings.js` and `jira-bridge.mjs` helpers live in the mod's `jira/` folder. The root `package.json`
only marks shared `.js` modules as ESM for Node; it declares no dependencies.
It uses no LLM. Default JQL:

```jql
assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC
```

Shows all matching tickets (follows Jira page tokens), grouped into **In progress**,
**To do**, and any other returned status categories. Rows show title, key, actual
workflow status and priority; the tooltip also shows project, type and update time.
Each group preserves the JQL result order (newest-updated for the default query;
for example, `ORDER BY Rank ASC` for a board-style query). Clicking a row opens its
Jira page. The header opens the exact JQL search in the browser, refreshes, opens a native query editor,
moves the panel left/right, or folds it to 42px. The SVG controls and docking
behavior use the same Personal Cockpit helpers, not local copies. Moving changes
only the personal layout tree: an empty right column hides and keeps its width,
and returning reuses it. Errors keep the last successful list and mark it **stale**.
Polling is every three minutes, with overlapping refreshes prevented. No disk cache
of tickets is created.

## Requirements and authentication

- Node.js 22.19+ (on Herdr's PATH, or set `node` in Jira config). This panel
  itself needs nothing newer than Herdr 0.1.13; the mod it ships in asks for
  0.1.14, and the README says why.
- An existing **managed Pi installation** at `~/.pi/agent` (or
  `PI_CODING_AGENT_DIR`), tested with Pi **1.4.0**.
- The user-level `atlassian` OAuth server in `~/.pi/agent/mcp.json` at
  `https://mcp.atlassian.com/v1/mcp`, already signed in through
  `pi mcp login atlassian`.

Each poll runs `jira-bridge.mjs` as one short-lived Node process. It connects only to
that Atlassian server and permits only `searchJiraIssuesUsingJql`. It reuses Pi's
own OAuth credential store and cross-process refresh lock; tokens are **not copied
into the mod, config or recovery kit**. A poll can refresh the existing OAuth token
in Pi's credential store, but it never launches a browser sign-in, registers another
server, installs a dependency, starts a terminal or creates/edits a Jira ticket.

**Compatibility boundary:** the bridge uses the standalone `pi-mcp` client plus Pi's
internal OAuth adapter. It resolves the managed current release on every poll,
not a hardcoded release. A future Pi release may change that internal API; the
panel then reports an error instead of reinstalling anything or exposing raw
OAuth/HTTP errors. Non-managed/npm/Bun installs and token-based MCP configurations
are not currently supported. The existing macOS setup has been tested live;
Windows/Linux openers have unit tests, not live platform validation.

## Enable in a Cockpit installation

Both normal Cockpit installers include this screen. The default layout stays
GitHub-only, so installations without Node/Pi/Atlassian need no extra setup.
Run the normal installer with `--no-layout --no-switch` (PowerShell:
`-NoLayout -NoSwitch`) to update code without replacing your arrangement.
Copy `jira.config.example.json` to `jira.config.json` in the installed
`mods/personal-cockpit/` **only if your config does not exist**. Both installers
preserve this personal file on subsequent updates. Set:

```json
{
  "site": "https://your-team.atlassian.net",
  "cloudId": "00000000-0000-0000-0000-000000000000",
  "jql": "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
}
```

If the desktop app cannot find `node` (common with NVM), add a `node` property
with the absolute executable path returned by `command -v node` in your shell,
for example `"node": "/Users/you/.nvm/versions/node/v24.16.0/bin/node"`.
This is passed directly to `exec`, not interpolated into a shell command. Update
it if you remove that Node version. The local installation uses this setting.

Use your real Atlassian cloud UUID. The Atlassian MCP's
`getAccessibleAtlassianResources` returns the cloud ID and site URL. Configuration
contains no credentials and is read on each refresh. The gear or **c** opens
**Customize Jira query**, with a multiline JQL editor. **Save & refresh** runs a
read-only search to validate the draft, then saves only the JQL change while
preserving all other settings. Invalid queries and concurrent file edits never
replace the working config. Cancelling during validation does not save.
**Advanced config…** opens the complete JSON in the system editor. To include
reported or completed tickets, change the JQL explicitly.

### Matching a team board

A board URL plus `?assignee=...` does **not** contain the board's saved filter,
column/status mappings, active-sprint selection, Kanban subfilter or quick filters.
Do not replace it with an assumed `project = ...` query. Copy the real saved JQL
from **Board settings → General → Filter → Edit query**, then include the URL's
assignee restriction and any board-specific sprint/quick/status filters as needed.
The current Atlassian MCP integration exposes JQL searches, not board configuration;
its OAuth token is not accepted by the Agile board API (401 in the live test).
Consequently the team board's exact filter must be supplied by the user; the panel
does not claim that a generic open-ticket query mirrors a board. Browser ↗ opens
the exact configured JQL search, not an unverified board.

Add this block to a **personal** layout column, alongside the other Cockpit
panels (no special layout is required):

```json
{
  "id": "jira-tickets",
  "type": "block",
  "content": { "mod": "personal-cockpit", "props": { "kind": "jira", "node": "jira-tickets" } },
  "size": { "weight": 1 },
  "min": 42
}
```

Set `props.node` to the actual block ID if you rename it. `mod.json` has
`place: none`, so discovering/installing the folder never auto-docks a duplicate.
Adding a layout block does not change spaces, tabs, splits, terminal IDs or keys.
Jira tickets do not feed the GitHub/kraken urgency drawer.

Keyboard while focused: **↑/↓** select, **Enter** opens the selected ticket,
**r** refreshes, **c** opens config, **o** opens the current JQL search. The mod also
accepts `personal-cockpit.jira-refresh`, `personal-cockpit.jira-configure`,
`personal-cockpit.jira-move-left` and `personal-cockpit.jira-move-right` commands.
The general `personal-cockpit.refresh` refreshes all list screens; the Jira-specific
commands do not affect GitHub panels. A refresh signalled while another poll is
running is queued, so saving a new query cannot lose its refresh.

## Migrating an earlier standalone installation

Copy the old `mods/jira-tickets/config.json` to
`mods/personal-cockpit/jira.config.json` without changing its bytes or overwriting
an existing destination. Update only the Jira block's `content.mod` to
`personal-cockpit` and add `content.props.kind: "jira"`, preserving its ID,
`props.node`, location, size and all other fields. Update any explicit command
bindings to the Jira-specific Cockpit commands above. Keep the existing personal
layout name/thumbnail; do not replace the tree with the repository's default.
After checking the integrated panel, remove the old `mods/jira-tickets/` folder.
The remembered `jira-tickets.height` is deliberately retained across migration.

## Updating an earlier nested-helper installation

Run the normal installer with `--no-layout --no-switch` (PowerShell:
`-NoLayout -NoSwitch`). It replaces the old code tree, removes the former `jira/`
helper directory and preserves the root `jira.config.json` plus YAML configs.
No layout or command migration is needed for this file-only reorganization.
Do not move the generated nested `gpui-kit.d.ts` over the root copy.

## Recovery on this Mac

The standard `~/herdr-backup/herdr-setup.py refresh` captures the unified
`mods/personal-cockpit/`, including `jira.config.json`, plus personal layouts and
thumbnails. The normal `restore --apply` adds missing files without replacing
existing files or changing existing terminals. An existing layout named
`cockpit-jira` is just a preserved personal arrangement, not a second mod or
a second shipped template. The canonical snapshot must no longer contain
`mods/jira-tickets/`. Pi/Node and the Atlassian login remain external prerequisites:
the recovery kit deliberately does not include Pi OAuth credentials.
