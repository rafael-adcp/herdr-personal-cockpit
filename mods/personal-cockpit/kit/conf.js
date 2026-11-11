// The YAML file in the installed mod folder that configures a panel.
//
// Two panels have one: `routines.yml` holds the tasks you keep, `team.yml` the
// search and the people whose pull requests you watch. Both live in the
// *installed* mod folder rather than in this repo -- the repo's path differs
// per machine -- and both are in the installers' exclude list, so an edit takes
// effect on the next poll with no reinstall and no restart. That is the
// opposite of how every other file here works, and the reason the gear in those
// two headers opens a file instead of a dialog: the file is the whole
// configuration surface, so there is nowhere else to look.
//
// It also makes them per machine, like `shared.json` and for the same reason
// (see config.js): your two laptops can watch different people, and neither
// can open the other's tasks.

import { appHome, exec, readTextFile, window as hostWindow, writeTextFile } from "herdr";
import * as yaml from "./yaml.js";

const MOD = "personal-cockpit";

/** Where one of this mod's config files lives. */
export const pathOf = (name) => `${appHome()}/mods/${MOD}/${name}`;

/** The example shipped beside it: `team.yml` -> `team.example.yml`. */
const exampleOf = (name) => name.replace(/(\.ya?ml|\.json)$/i, ".example$1");

/** `{ path, missing, config, items, problems }` -- the top-level scalars, the
 *  `- ` list under whichever key has one, and everything that did not parse.
 *  A panel reads this on every poll: the file is cheap and the alternative is
 *  an edit that does nothing until a restart. */
export async function read(name) {
  const path = pathOf(name);
  const text = await readTextFile(path);
  if (text === null) return { path, missing: true, config: {}, items: [], problems: [] };
  const { top, items, problems } = yaml.parse(text);
  return { path, missing: false, config: top, items, problems };
}

/**
 * The gear: hands the file to whatever opens a .yml here, writing it from the
 * example first if it is not there. Both installers seed it, so that only
 * happens to a file someone deleted -- and a gear that hands the desktop a
 * path with no file at it gets an error dialog from the desktop, which neither
 * explains the problem nor fixes it.
 *
 * `cx.open_url` cannot do this one. It takes an absolute `http`/`https` URL and
 * refuses every other scheme by design, so that a mod cannot hand an arbitrary
 * URI to whichever handler the desktop registered for it (gpui-kit.d.ts) --
 * and that rules out `file://`, which is what this has to open. Hence a
 * program, and hence the third place in this mod that knows which platform it
 * is on, after finding `gh` and offering to install it.
 *
 * With nothing registered for .yml the desktop asks which program to use. That
 * is the right question for it to ask, and not one this can answer.
 */
export async function openFile(name) {
  const path = pathOf(name);
  if ((await readTextFile(path)) === null) {
    const seed = await readTextFile(pathOf(exampleOf(name)));
    if (seed !== null) {
      // `null` as the expected text means "only if it is still absent", so the
      // write loses to whoever got there first instead of replacing their copy.
      try {
        await writeTextFile(path, seed, null);
      } catch {
        // Someone else wrote it between the read and here. Open theirs.
      }
    }
  }

  const platform = hostWindow()?.platform;
  // `start` is a cmd builtin rather than a program, and exec runs programs. Its
  // first argument is the window title, which it otherwise takes from the path
  // -- leaving it with no path to open.
  if (platform === "windows") return exec("cmd", ["/c", "start", "", path]);
  if (platform === "macos") return exec("open", [path]);
  return exec("xdg-open", [path]);
}
