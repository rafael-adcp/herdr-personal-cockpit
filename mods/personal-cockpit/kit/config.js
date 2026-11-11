// Which repo a panel watches, and the handful you switch between.
//
// Three places it can come from, most specific first:
//
//   1. `props.repo` in the layout -- pins that block to one repo. Use it to
//      show two task panels at once, personal and work side by side.
//   2. `shared("cockpit.<panel>.repo")` -- the live choice, changed from the
//      panel's own picker. Herdr persists shared state per home, and a home is
//      per machine, so the laptop at work and the desktop at home each keep
//      their own answer with no machine-detection anywhere.
//   3. nothing -- the panel says so and offers the picker.

import { props, shared, setShared } from "herdr";

const RECENT_MAX = 6;

const repoKey = (panel) => `cockpit.${panel}.repo`;
const recentKey = (panel) => `cockpit.${panel}.recent`;

/** "owner/name", loosely: enough to reject "" and "personal-tasks" without
 *  pretending to know what GitHub allows. */
export const looksLikeRepo = (s) => typeof s === "string" && /^[^/\s]+\/[^/\s]+$/.test(s.trim());

/** `{ repo, pinned }`. `pinned` means the layout chose it, so the picker stays
 *  out of the way: that block is meant to be that repo. */
export function repoOf(panel) {
  const fromLayout = props()?.repo;
  if (looksLikeRepo(fromLayout)) return { repo: fromLayout.trim(), pinned: true };
  const chosen = shared(repoKey(panel));
  if (looksLikeRepo(chosen)) return { repo: chosen.trim(), pinned: false };
  return { repo: null, pinned: false };
}

/** The repos chosen before, newest first, for one-click switching. */
export function recent(panel) {
  const saved = shared(recentKey(panel));
  return Array.isArray(saved) ? saved.filter(looksLikeRepo) : [];
}

/** Choose a repo. Setting shared state re-renders every mod, so the panel
 *  picks it up without being told. */
export function choose(panel, repo) {
  if (!looksLikeRepo(repo)) return false;
  const picked = repo.trim();
  setShared(repoKey(panel), picked);
  setShared(recentKey(panel), [picked, ...recent(panel).filter((r) => r !== picked)].slice(0, RECENT_MAX));
  return true;
}

export function forget(panel, repo) {
  setShared(recentKey(panel), recent(panel).filter((r) => r !== repo));
}
