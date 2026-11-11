// Jira, as a list source: the fifth player of the role pulls, issues, routines
// and team play for screens/list.js.
//
// It used to be a screen of its own -- a second copy of the refresh, the stale
// list, the cursor, the keys and the render, which is the thing this mod is one
// folder to avoid. What is actually different about Jira is where the rows come
// from and what a failure means, and both of those fit in the role. So this
// file is only that: the config file, the bridge, the row, and the handful of
// answers list.js asks every source for.
//
// Where its behaviour really does differ from the GitHub panels, it says so
// with an optional member rather than a branch in list.js: `keepsLastGood`,
// `commands`, `browse`, `heightKey`, `focusOnPress`.

import { div } from "gpui-kit";
import { openOverlay, readTextFile } from "herdr";
import { cell, row } from "../kit/kit.js";
import { DEFAULT_JQL, sections as byStatus } from "./jira-model.js";
import { configPath, executeQuery } from "./jira-query.js";

export const panel = "jira";
export const title = "My Jira tickets";
// Borrowed from Kraken Tasks: a ticket is the same idea, and this panel is
// optional, so it has not earned art of its own.
export const icon = "mods/personal-cockpit/icons/issues.svg";
export const needsRepo = false;
export const refreshMs = 180000;
export const loading = "Loading Jira tickets…";
export const empty = "No tickets match this query.";

// The standalone panel remembered its height under this key. Kept, so that
// neither that migration nor this one costs anybody the height they dragged.
export const heightKey = "jira-tickets.height";

// A failed poll never replaces a list that loaded, whatever the failure was and
// even when that list is empty. The GitHub panels give the screen up for a
// login problem, because the fix is a button they can draw; here the fix is in
// Pi or in a file, and "no tickets" that was true a minute ago is better than a
// panel that forgot it.
export const keepsLastGood = true;

// A press anywhere on the panel takes the keyboard, as the standalone one did.
export const focusOnPress = true;

// A mod command reaches every copy on screen. `refresh` is meant to; the other
// three would move or reconfigure every panel at once, so Jira answers to names
// of its own -- and, having its own `configure`, stays out of the shared one,
// which is the repo picker.
export const commands = {
  refresh: "jira-refresh",
  configure: "jira-configure",
  left: "jira-move-left",
  right: "jira-move-right",
};

async function readConfig() {
  const text = await readTextFile(configPath());
  return { text, config: text ? JSON.parse(text) : {} };
}

export async function load() {
  const { config } = await readConfig();
  const data = await executeQuery(config);
  return { items: data.items, meta: { jql: data.jql, url: data.url, count: data.items.length } };
}

/** The gear: the native query editor. It is handed the file's exact text, so
 *  its save can refuse to overwrite a config that changed underneath it. */
export async function configure() {
  const { text, config } = await readConfig();
  openOverlay({
    mod: "personal-cockpit",
    kind: "dialog",
    width: 680,
    props: { kind: "jira-settings", config, expected: text },
  });
}

export const configureTip = "Customize Jira query · c";

/** The same search in the browser: the exact JQL the list came from, never a
 *  board it might or might not mirror. */
export const browse = (meta) => meta?.url ?? null;

export const browseTip = "Open this search in Jira · o";

export const sections = byStatus;

// Nothing here is a move that is yours in the sense the drawer means: a ticket
// assigned to you is a list you read, not something stuck on you. So Jira
// publishes no rows, and its rail and header count nothing as needing you.
export const urgent = () => [];

export const attention = (items) => urgent(items).length;

export const stampNote = (meta) => meta?.jql ?? null;

export function footnote(meta) {
  if (!meta) return null;
  return `${meta.count} tickets · ${meta.jql === DEFAULT_JQL ? "Assigned to me" : "Custom JQL"}`;
}

// Below this the second line has no room for the priority after the status.
const ROOMY = 300;

export function rowOf(t, item, o) {
  const color = item.category === "indeterminate" ? t.working : item.category === "done" ? t.done : t.dim;
  const pressing = /highest|critical|blocker|\bP[12]\b/i.test(item.priority);
  return row(t, {
    id: `jira-${item.key}`,
    glyph: cell().text_color(color).child("●"),
    title: item.title,
    age: "",
    tooltip: [
      `${item.key} · ${item.title}`,
      `${item.status} · ${item.priority}`,
      `${item.project} · ${item.type}`,
      `Updated: ${item.updated ?? "unknown"}`,
    ].join("\n"),
    selected: o.selected,
    wide: o.wide,
    onClick: o.onClick,
    second: [
      div().flex_none().text_color(t.muted).child(item.key),
      div().flex_1().min_w(0).truncate().text_color(color).child(item.status),
      ...(o.width >= ROOMY ? [div().flex_none().text_color(pressing ? t.blocked : t.dim).child(item.priority)] : []),
    ],
  });
}
