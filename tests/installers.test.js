// Install into a disposable home; the app stub cannot touch the live window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");

test("the shell installer ships Jira with Cockpit, preserving personal config and layouts on reinstall", { skip: process.platform === "win32" }, () => {
  const temp = mkdtempSync(join(tmpdir(), "cockpit-install-"));
  try {
    const home = join(temp, "app"), bin = join(temp, "bin");
    mkdirSync(home); mkdirSync(bin); mkdirSync(join(home, "layouts"));
    writeFileSync(join(bin, "herdr-app"), '#!/bin/sh\n[ "$1" = check ] || exit 99\n', { mode: 0o700 });
    const layout = '{"sentinel":"keep arrangement"}\n';
    writeFileSync(join(home, "layouts/cockpit.json"), layout);
    const install = () => {
      const result = spawnSync("sh", [join(root, "tools/install.sh"), "--no-layout", "--no-switch"], {
        env: { ...process.env, HERDR_APP_HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    install();
    const mod = join(home, "mods/personal-cockpit");
    // The subfolders have to arrive whole: `cp` without -R would have refused
    // the first one and ended the install under `set -e` with nothing copied.
    for (const file of ["jira/jira.js", "jira/jira-bridge.mjs", "jira/jira-model.js", "jira/jira-query.js",
                        "jira/jira-settings.js", "jira/JIRA.md", "kit/kit.js", "screens/list.js", "panels/pulls.js"]) {
      assert.ok(existsSync(join(mod, file)), `missing ${file}`);
    }
    // At the mod root, and asserted there: `main.js` because the app requires
    // it there, `package.json` because it is what makes every `.js` under it --
    // including the ones in subfolders -- load as ESM.
    assert.ok(existsSync(join(mod, "main.js")));
    assert.equal(JSON.parse(readFileSync(join(mod, "package.json"), "utf8")).type, "module");
    assert.ok(existsSync(join(mod, "jira.config.example.json")));

    // Not just the root: the app writes a gpui-kit.d.ts and a jsconfig.json
    // into every folder it finds JavaScript in, so on a machine with Herdr
    // there is one in each subfolder of this repo. They must match the
    // installed version, which the app rewrites on start.
    const generated = readdirSync(mod, { recursive: true })
      .map((entry) => String(entry).split(sep).join("/"))
      .filter((entry) => /(?:^|\/)(?:gpui-kit\.d\.ts|jsconfig\.json)$/.test(entry));
    assert.deepEqual(generated, [], "the installer copied files the app generates");
    assert.equal(existsSync(join(home, "mods/jira-tickets")), false);
    assert.equal(existsSync(join(mod, "jira.config.json")), false, "never seed fake site/cloud ID as live config");
    const configs = {
      "routines.yml": "coordination_repo: example/tasks\n",
      "team.yml": "query: org:example\n",
      "jira.config.json": '{"node":"/keep/node","jql":"project = TEST","extra":true}\n',
    };
    for (const [file, text] of Object.entries(configs)) writeFileSync(join(mod, file), text);
    writeFileSync(join(mod, "obsolete.js"), "must disappear");
    writeFileSync(join(mod, "jira/obsolete.mjs"), "a stale file inside a folder that still ships");
    mkdirSync(join(mod, "old-helpers"));
    writeFileSync(join(mod, "old-helpers/stale.js"), "a folder that no longer ships at all");
    install();
    for (const [file, text] of Object.entries(configs)) assert.equal(readFileSync(join(mod, file), "utf8"), text);
    assert.equal(existsSync(join(mod, "obsolete.js")), false);
    // Now that the mod has subfolders, a reinstall has to replace them rather
    // than copy into them: a renamed module would otherwise be left behind
    // beside its replacement, and the stale copy is the one an import could
    // still resolve.
    assert.equal(existsSync(join(mod, "jira/obsolete.mjs")), false, "reinstall replaces a shipped folder instead of merging into it");
    assert.equal(existsSync(join(mod, "old-helpers")), false, "reinstall removes a folder that no longer ships");
    assert.equal(readFileSync(join(home, "layouts/cockpit.json"), "utf8"), layout);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("the PowerShell mirror excludes the personal Jira config along with YAML configs", () => {
  const script = readFileSync(join(root, "tools/install.ps1"), "utf8");
  assert.match(script, /robocopy .*\/XF .*routines\.yml team\.yml jira\.config\.json \/NFL/);
});
