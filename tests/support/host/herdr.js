// `herdr`, as much of it as this mod names.
//
// Two different things live here, and the difference is the whole reason the
// tests look the way they do:
//
//   State the app holds for the mod -- shared state, the files in the mod
//   folder, the layout tree -- is kept for real, in memory. A test sets it up
//   and then reads what the mod did to it. Nothing is faked about the
//   behaviour; it is the same key-value store with a different backing.
//
//   Messages the mod sends outward -- `run`, `exec`, `openOverlay` -- are
//   recorded. "Pressing ▶ opens an issue" and "the gear hands the path to
//   `open` on macOS" are the behaviour, so the assertion is that the message
//   was sent, with those arguments.
//
// What is deliberately *not* here is a canned GitHub. No test stubs `graphql`
// to a payload: the judgement each panel makes about a pull request is a pure
// function of one, exported and called directly.

/** Everything a test can set up or read back. `reset()` between tests. */
export const host = {
  home: "/herdr",
  platform: "linux",
  files: new Map(),
  shared: new Map(),
  layout: null,
  props: null,
  /**
   * Where a floating mod sits, as `placement()` answers it, or null for one
   * that does not float -- which is every screen but the drawer, and the
   * drawer too when a layout puts it in an ordinary block.
   *
   * Kept rather than recorded: it is state the app holds about this copy, and
   * the drawer reads it to decide which side its peek strip goes on.
   */
  placement: null,
  /** The agents the app is running, as `agents()` answers, and the spaces they
   *  are in. Kept rather than recorded: it is the app's state, and the drawer
   *  reads it the way it reads shared state. */
  agents: [],
  spaces: [],
  /** Resolves the `nextCommand()` a panel is awaiting. */
  deliver: null,
  exec: [],
  run: [],
  overlays: [],
  /** Answers `exec`. Default: success, empty output. */
  onExec: null,
};

export function reset(over = {}) {
  host.home = "/herdr";
  host.platform = "linux";
  host.files = new Map();
  host.shared = new Map();
  host.layout = null;
  host.props = null;
  host.placement = null;
  host.agents = [];
  host.spaces = [];
  host.deliver = null;
  host.exec = [];
  host.run = [];
  host.overlays = [];
  host.onExec = null;
  Object.assign(host, over);
}

// ---- state the app holds --------------------------------------------------

export const appHome = () => host.home;

export const window = () => ({ platform: host.platform });

export const props = () => host.props;

export const layout = () => host.layout;

export const placement = () => host.placement;

export const agents = () => host.agents;

export const spaces = () => host.spaces;

export const shared = (key) => host.shared.get(key);

export const setShared = (key, value) => void host.shared.set(key, value);

export async function readTextFile(path) {
  return host.files.has(path) ? host.files.get(path) : null;
}

/** `expected === null` means "only if it is still absent", which is how
 *  conf.js loses a race instead of overwriting the winner. */
export async function writeTextFile(path, text, expected) {
  if (expected === null ? host.files.has(path) : (host.files.get(path) ?? null) !== expected) throw new Error("stale snapshot");
  host.files.set(path, text);
}

// ---- messages the mod sends outward ---------------------------------------

export async function exec(command, args) {
  host.exec.push({ command, args });
  return host.onExec?.(command, args) ?? { code: 0, stdout: "", stderr: "" };
}

export const run = (name, withProps) => void host.run.push({ name, props: withProps });

export const openOverlay = (options) => void host.overlays.push(options);

export const closeOverlay = () => void host.overlays.pop();

/**
 * The real one resolves when the app sends this mod a command, and the panels
 * await it in a `for (;;)` loop. So the default here is a promise that never
 * resolves -- anything else spins that loop forever and hangs the test.
 *
 * `host.deliver("refresh")` resolves the one currently being awaited.
 */
export function nextCommand() {
  return new Promise((resolve) => {
    host.deliver = resolve;
  });
}

// ---- the theme ------------------------------------------------------------

// Every colour answers with its own name, so a missing key is a visible
// `undefined` in a failure rather than a crash, and no test has to know what
// the palette actually is.
const THEME = new Proxy({}, { get: (_t, key) => (typeof key === "string" ? key : undefined) });

export const theme = () => THEME;
