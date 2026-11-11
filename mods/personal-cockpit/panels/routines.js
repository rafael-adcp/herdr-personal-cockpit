// Routines: task templates you keep, and the kraken task each one opened.
//
// A routine does not run anything and there is no scheduler here. It holds the
// three things PROTOCOL.md §2 demands of a task -- a Goal, an Acceptance and a
// project -- and a ▶ that opens it as an issue in the coordination repo. A
// worker claims it from there, which is why this file has no locking, no lease
// and no history: §5's compare-and-swap on a git ref decides who runs it, and
// the issue timeline is the record.
//
// So the queue is the state, and there is none here. Nothing is remembered
// between polls, nothing is written to shared state, and the two laptops agree
// because the only thing they both read is GitHub. (Herdr persists shared state
// per home and a home is per machine -- see config.js -- so a "last opened"
// kept here would be known on one laptop and not the other.)
//
// A cron field is the obvious next step and deliberately not here yet; `git log`
// has a tested implementation of one if it is ever wanted.

import { div } from "gpui-kit";
import { run } from "herdr";
import { ago, agoShort, createIssue, rest } from "../kit/github.js";
import { repoOf } from "../kit/config.js";
import { CELL, cell, row, spinner } from "../kit/kit.js";
import * as conf from "../kit/conf.js";

export const panel = "routines";
export const title = "Routines";
export const icon = "mods/personal-cockpit/routines.svg";
// The queue is the Kraken Tasks panel's repo, or routines.yml's own
// `coordination_repo`. Either way it is not a per-panel pick, so no picker.
export const needsRepo = false;
// The panel whose pick is the queue when the file names none. Exported so the
// screen can watch it: this panel has no repo of its own, so without that a
// repo chosen in Kraken Tasks would not reach it until the next poll -- which
// is a minute of nothing happening after the one action offered as the way out
// of a 404.
export const repoFrom = "issues";
export const refreshMs = 60000;
export const loading = "Reading routines…";
export const empty = "No routines";

const MOD = "personal-cockpit";
const FILE = "routines.yml";

// One page of issues, newest first. Enough to find the last task of every
// routine in a personal queue, and one request either way.
const PAGE = 100;

// The labels that park a task on a human, as the Kraken Tasks panel reads them.
const ATTENTION = ["needs-decision", "awaiting-merge"];

// ---- the file -------------------------------------------------------------

/** Everything §2 requires of a task, checked when the file is read rather than
 *  when ▶ is pressed: a routine missing its Goal is worth knowing about while
 *  you are looking at the panel. */
export function validate(r, n, seen) {
  const title = String(r.title ?? "").trim();
  const where = title ? `"${title}"` : `routine ${n + 1}`;
  const out = [];

  if (!title) out.push(`${where}: no title`);
  // The title is the routine's identity -- it is what the marker carries -- so
  // two routines sharing one would each show the other's task as its own.
  else if (seen.has(title)) out.push(`${where}: duplicate title`);
  // It is written inside an HTML comment, which `-->` would close early.
  else if (title.includes("-->")) out.push(`${where}: a title cannot contain "-->"`);

  // §2: a task without exactly one `project:<name>` is invisible to every
  // conforming worker, and one with an empty Goal or Acceptance stalls whoever
  // claims it.
  if (!String(r.project ?? "").trim()) out.push(`${where}: no project`);
  if (!String(r.goal ?? "").trim()) out.push(`${where}: no goal`);
  if (!String(r.acceptance ?? "").trim()) out.push(`${where}: no acceptance`);

  return out;
}

// ---- the marker -----------------------------------------------------------

// Which routine a task came from. An HTML comment in the body, following
// kraken's own marker convention (§4), carrying the title it was opened under.
//
// The title rather than an id of its own: the title already identifies the
// routine, and a second field to keep in step with it would earn its place only
// for renames. Since the marker keeps the title it was *opened* with, a rename
// on GitHub's side does not break the link -- a rename in routines.yml does,
// and the loose task is sitting in Kraken Tasks where it can be seen.
//
// Lazy up to the closing `-->`, so a `}` inside a title does not cut it short.
const MARKER = /<!--\s*routine\s+(\{[\s\S]*?\})\s*-->/;

export function markerOf(body) {
  const found = MARKER.exec(String(body ?? ""));
  if (!found) return null;
  try {
    const value = JSON.parse(found[1]);
    return typeof value?.title === "string" ? value : null;
  } catch {
    return null;
  }
}

// §2.1: section detection keys on the headings the issue form produces, so
// `### Goal` and `### Acceptance` are a contract here, not a style choice.
export function bodyFor(r) {
  const parts = [`### Goal\n\n${String(r.goal).trim()}`, `### Acceptance\n\n${String(r.acceptance).trim()}`];
  const notes = String(r.notes ?? "").trim();
  if (notes) parts.push(`### Notes\n\n${notes}`);
  parts.push(`<!-- routine ${JSON.stringify({ title: String(r.title).trim() })} -->`);
  return parts.join("\n\n");
}

export function labelsFor(r) {
  // §1: a task *is* an open issue labeled `kraken-task`. §2: exactly one
  // `project:<name>`. §5.2 orders candidates by `priority:high` first.
  const labels = ["kraken-task", `project:${String(r.project).trim()}`];
  const priority = String(r.priority ?? "").trim();
  if (priority) labels.push(`priority:${priority}`);
  return labels;
}

const slim = (i) => ({
  number: i.number,
  url: i.html_url,
  open: i.state === "open",
  created_at: i.created_at,
  comments: i.comments ?? 0,
  labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean),
});

// Tasks this panel opened that `GET /issues` has not caught up with yet.
//
// GitHub answers the create with the issue itself, and then takes a few seconds
// to include it in the list. In that window a load reads the queue, correctly
// finds nothing, and puts the ▶ back on a routine that has just been run --
// which is how #77 and #78 were opened three seconds apart. The create's own
// answer is the authority here and the list is the thing lagging, so it is held
// until the list agrees.
//
// Not persisted and not shared: it exists to paper over one API's read-after-
// write lag on this machine, and it is wrong to keep for any longer than that.
const justOpened = new Map();

// A belt for the braces: the entry below clears as soon as the list shows the
// task at all, whatever its state. This only catches the case where that never
// happens -- a task deleted outright -- so that a routine cannot be left with
// no button and no way back except restarting the app.
const UNCONFIRMED_MS = 5 * 60 * 1000;

/** The newest issues, open *and closed*: an open one says the routine is
 *  already in the queue, a closed one says when it last ran. */
async function recent(repo) {
  const body = await rest(`repos/${repo}/issues?state=all&per_page=${PAGE}&sort=created&direction=desc`);
  if (!Array.isArray(body)) throw new Error("Unexpected response from GitHub");
  return body.filter((i) => !i.pull_request);
}

// ---- the poll -------------------------------------------------------------

const noFile = (path) => ({
  key: "no-file",
  title: `No ${FILE}`,
  detail: "the gear writes one from the example",
  state: "invalid",
  error: path,
  def: null,
  repo: null,
  project: null,
  latest: null,
  open: null,
  url: null,
});

export async function load() {
  const file = await conf.read(FILE);
  const problems = [...file.problems];

  if (file.missing) {
    return { items: [noFile(file.path)], meta: { repo: null, problems, path: file.path } };
  }

  const named = String(file.config.coordination_repo ?? "").trim();
  const repo = named || repoOf(repoFrom).repo;
  if (!repo) {
    problems.push(`no queue: set \`coordination_repo\` in ${FILE}, or pick a repo in Kraken Tasks`);
    return { items: [], meta: { repo: null, problems } };
  }

  // The queue is resolved in here, out of a file the screen does not read, so a
  // failure that leaves nothing to draw has to carry the repo it was about --
  // otherwise the panel can only say "no access to" the repo it has, which for
  // this one is none.
  //
  // `repoPanel` is which pick decides it, and that is what the way out of a 404
  // turns on: a picker writing `cockpit.<panel>.repo` fixes the fallback and
  // changes nothing at all when the file named the repo outright, where the
  // file is the only thing worth opening.
  let issues;
  try {
    issues = await recent(repo);
  } catch (e) {
    throw Object.assign(e, { repo, repoPanel: named ? null : repoFrom });
  }

  // Newest first, so the first marker seen for a title is that routine's latest
  // task and the first open one is what is in the queue now.
  const latest = new Map();
  const open = new Map();
  // Every number the list returned, which is how a held task is told apart from
  // the ones that came before it.
  const listed = new Set();
  for (const issue of issues) {
    listed.add(issue.number);
    const marker = markerOf(issue.body);
    if (!marker) continue;
    if (!latest.has(marker.title)) latest.set(marker.title, issue);
    if (issue.state === "open" && !open.has(marker.title)) open.set(marker.title, issue);
  }

  const items = [];
  const seen = new Set();

  for (let n = 0; n < file.items.length; n++) {
    const r = file.items[n];
    const bad = validate(r, n, seen);
    const named = String(r.title ?? "").trim();
    if (named) seen.add(named);

    // Caught up means the list returned *this* task, by number. Asking whether
    // the routine has any task at all answers yes on the first load, because a
    // routine that has run before has older ones carrying the same marker --
    // which dropped the held copy immediately and put the button straight back.
    const pending = justOpened.get(named);
    if (pending && (listed.has(pending.issue.number) || Date.now() - pending.at > UNCONFIRMED_MS)) {
      justOpened.delete(named);
    }

    // While held, it is the newest thing there is: it outranks the list's idea
    // of latest, which can only be an older run.
    const held = justOpened.get(named)?.issue ?? null;
    const task = held ?? latest.get(named) ?? null;
    const queued = open.get(named) ?? held;

    const base = {
      key: `${n}-${named || "unnamed"}`,
      title: named || `routine ${n + 1}`,
      detail: r.project ? `project:${String(r.project).trim()}` : "",
      project: r.project ?? null,
      def: r,
      repo,
      latest: task ? slim(task) : null,
      open: queued ? slim(queued) : null,
      error: null,
      url: task?.html_url ?? null,
    };

    if (bad.length) {
      problems.push(...bad);
      items.push({ ...base, state: "invalid", error: bad[0] });
    } else if (queued) {
      items.push({ ...base, state: "open" });
    } else if (r.enabled === false) {
      items.push({ ...base, state: "paused" });
    } else {
      items.push({ ...base, state: "ready" });
    }
  }

  return { items, meta: { repo, problems, path: file.path } };
}

/**
 * ▶ -- opens this routine's task in the queue. The List calls this and then
 * refreshes, so the new issue appears in the row that opened it.
 *
 * Only a `ready` routine has the button at all: while its last task is still
 * open, a second one would put two workers on the same goal and land two
 * deliveries for it. Close the open task to run the routine again.
 */
export async function act(item) {
  if (item.state !== "ready" || !item.def || !item.repo) return;
  const issue = await createIssue(item.repo, {
    title: item.title,
    body: bodyFor(item.def),
    labels: labelsFor(item.def),
  });

  // Remember it before anything reloads: the next load is very likely to be
  // too early to see it, and a routine that shows ▶ a second after it ran is
  // an invitation to run it twice.
  // Stored exactly as the API shaped it, so `load` slims it the same way it
  // slims one that came out of the list.
  justOpened.set(item.title, { issue, at: Date.now() });

  // The queue just changed, and Kraken Tasks is watching the same repo from
  // another copy of this mod with its own sixty-second clock. A mod command
  // reaches every copy, so the task lands there now rather than whenever that
  // clock next comes round -- which is the difference between the two panels
  // agreeing and one of them being a minute behind the thing you just did.
  //
  // The copy that pressed the button is refreshing anyway; its `busy` guard
  // drops the duplicate. Pull requests reloads too, which is one `gh` call it
  // did not need, and cheaper than a second signalling mechanism.
  run(`${MOD}.refresh`);
}

/** The gear: routines.yml, in whatever opens a .yml here. The file is the whole
 *  configuration surface of this panel, so the header points at it rather than
 *  making you remember a path inside the Herdr home. See conf.js for why this
 *  cannot go through `cx.open_url`. */
export const configure = () => conf.openFile(FILE);

export const configureTip = `Open ${FILE}`;

// ---- shape ----------------------------------------------------------------

const needsYou = (item) =>
  item.state === "invalid" || (item.open?.labels ?? []).some((name) => ATTENTION.includes(name));

/** Which label parked this routine's open task on a human, in ATTENTION's
 *  order. `slim` keeps labels as bare names, so there is nothing to unwrap. */
const parkedBy = (task) => (task?.labels ?? []).find((name) => ATTENTION.includes(name)) ?? "needs you";

export function sections(items) {
  return [
    { label: "Needs you", items: items.filter(needsYou) },
    { label: "In the queue", items: items.filter((i) => i.state === "open" && !needsYou(i)) },
    { label: "Ready", items: items.filter((i) => i.state === "ready") },
    { label: "Paused", items: items.filter((i) => i.state === "paused") },
  ].filter((s) => s.items.length);
}

/** The rows that want something from you, and which of two different things
 *  they want. A routine whose task is parked on a decision is the same move as
 *  a Kraken task parked on one -- go and decide it. A routine that does not
 *  parse is a different move entirely: nothing is waiting on an answer, the
 *  file is wrong and nobody can run it until it isn't.
 *
 *  A bad routine has no task and so no page to open. The row says what is
 *  wrong and does not pretend to be a link -- the gear beside the panel's own
 *  header is what opens the file. */
export function urgent(items) {
  return items.filter(needsYou).map((item) => {
    const broken = item.state === "invalid";
    return {
      key: `routines:${item.key}`,
      verb: broken ? "config" : "decide",
      title: item.title,
      // `def` is null only for the stand-in row a missing file produces, where
      // `error` is the path it would be written to rather than a complaint.
      reason: broken ? (item.def ? (item.error ?? "invalid") : "not written yet") : parkedBy(item.open),
      url: item.url,
      at: Date.parse(item.open?.created_at ?? "") || 0,
    };
  });
}

export const attention = (items) => urgent(items).length;

export const stampNote = (meta) => meta?.repo ?? null;

export function footnote(meta) {
  const problems = meta?.problems ?? [];
  if (!problems.length) return null;
  return problems.length === 1 ? problems[0] : `${problems.length} problems in ${FILE}`;
}

// ---- ui -------------------------------------------------------------------

function tooltip(item) {
  const lines = [item.title];
  if (item.project) lines.push(`project:${item.project}`);
  if (item.state === "ready") lines.push("▶ opens this task in the queue");
  if (item.state === "paused") lines.push("paused: `enabled: false` in routines.yml");
  if (item.open) lines.push(`#${item.open.number} is open — close it to run this again`);
  else if (item.latest) lines.push(`last ran as #${item.latest.number}, closed`);
  if (item.latest) lines.push(`opened ${ago(item.latest.created_at)}`);
  if (item.error) lines.push(item.error);
  return lines.filter(Boolean).join("\n");
}

/** The glyph cell doubles as the row's button: ▶ where there is something to
 *  press, the spinner while that press is in flight, and the status dot
 *  everywhere else. It is the one slot in a row that is already the row's own,
 *  so no shared layout had to grow a column.
 *
 *  The spinner is the same one the header uses, at the cell's width, so the
 *  title does not shift sideways when it takes the button's place. */
function control(t, item, o) {
  if (o.acting) return spinner(t, CELL);
  if (item.state === "ready") {
    return cell()
      .text_center()
      .text_color(t.accent)
      .cursor_pointer()
      .child("▶")
      .on_click((_e, cx) => {
        // Without this the row's own click would also open the last task's URL.
        cx.stop_propagation();
        o.onAction?.(item, cx);
      });
  }
  const mine = needsYou(item);
  return cell().text_center().text_color(mine ? t.blocked : t.dim).child(mine ? "●" : "·");
}

export function rowOf(t, item, o) {
  const note = (color, text) => div().flex_none().text_color(color).child(text);
  const second = [];

  if (item.detail) second.push(note(t.muted, item.detail));
  if (item.state === "invalid") second.push(note(t.ansi1, "invalid"));
  if (item.state === "paused") second.push(note(t.dim, "paused"));
  if (item.state === "ready" && !item.latest) second.push(note(t.dim, "never run"));

  const task = item.open ?? item.latest;
  if (task) {
    // The task's own labels, as they are on GitHub -- minus the two every task
    // carries, which say nothing the row does not already say.
    for (const label of task.labels) {
      if (label === "kraken-task" || label.startsWith("project:")) continue;
      second.push(note(t.dim, label));
    }
    if (!item.open) second.push(note(t.dim, "closed"));
    second.push(note(t.muted, `#${task.number}`));
  }

  return row(t, {
    id: `routine-${item.key}`,
    glyph: control(t, item, o),
    title: item.title,
    // On the first line, not in `second`: a narrow panel drops the second line,
    // and the one moment this has to be visible is the one just after a press.
    tag: o.done ? "task created" : null,
    age: task ? agoShort(task.created_at) : "",
    tooltip: tooltip(item),
    selected: o.selected,
    wide: o.wide,
    onClick: o.onClick,
    second,
  });
}
