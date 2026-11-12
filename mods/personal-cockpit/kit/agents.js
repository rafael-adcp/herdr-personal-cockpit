// The agents in the terminals, as rows for the drawer.
//
// The drawer's rule is that it loads nothing: each panel publishes what it
// already judged, because the alternative is a second round of `gh` calls on
// their own clock and two lists that can disagree (see urgent.js). None of that
// applies here. `agents()` is the app's own live answer about its own
// terminals -- no process, no network, no clock of ours -- so the cheapest
// correct thing is for the drawer to read it itself. That is also why there is
// no agents panel and nothing to add to a layout: these rows are wherever the
// drawer already is.
//
// Only `blocked` is drawn. `working` is not waiting on anybody and `idle` is
// nothing; `done` becomes `idle` the moment somebody looks at it on any Herdr
// client, and a row that clears itself for reasons outside this mod is a row
// that flickers. So the one status that is unambiguously your move is the one
// that gets a row.

import { agents, spaces } from "herdr";

/** What a press on one of these rows runs. The app focuses the terminal
 *  wherever it is -- another tab, another space, a sub-agent of something
 *  else -- which is the whole reason the row carries a command and not a URL. */
export const GO = "agent.focus";

/** Which kind of move this is, as urgent.js orders them. */
export const VERB = "answer";

// A tab nobody named is called by its position ("2"), which is no use as a
// title -- so the terminal's own title is the better one exactly then.
const named = (name) => typeof name === "string" && name.length > 0 && !/^\d+$/.test(name);

/**
 * When each tab last changed state, by tab id.
 *
 * An agent's own record carries no clock: `seq` orders them but is not a time,
 * and the drawer both sorts by how long a row has waited and draws that age. A
 * tab's `changed_at` is the nearest honest answer -- for a blocked agent, the
 * last thing that changed in its tab is its becoming blocked -- and a tab where
 * nothing has changed since the app started reports null, which arrives as the
 * drawer's "no idea how long" and sorts last rather than first.
 */
function changed() {
  const at = new Map();
  for (const space of spaces() ?? []) {
    for (const tab of space?.tabs ?? []) {
      if (typeof tab?.changed_at === "number") at.set(tab.id, tab.changed_at);
    }
  }
  return at;
}

/**
 * The blocked agents, as rows the drawer can draw.
 *
 * An agent you are looking at is left out. It is already in front of you, so a
 * drawer nagging about it is the one row it could never be right about -- and
 * focusing one is what takes it off the list, the same way fixing a build does.
 */
export function rows() {
  const at = changed();
  return (agents() ?? [])
    .filter((agent) => agent?.status === "blocked" && !agent.focused)
    .map((agent) => ({
      key: `agents:${agent.address}`,
      verb: VERB,
      title: named(agent.tab_name) ? agent.tab_name : agent.title || agent.program?.name || "An agent",
      // Where it is, rather than what it asked: the question is in the terminal
      // the press lands in, and this is the half of it the drawer can be sure
      // of. The program's name says which agent is asking.
      reason: [agent.program?.name, agent.space_name].filter(Boolean).join(" · ") || "waiting on you",
      // Nothing to open: it is not a page, it is a terminal in this window.
      url: null,
      go: { name: GO, args: { terminal: agent.address } },
      at: at.get(agent.tab) ?? 0,
    }));
}
