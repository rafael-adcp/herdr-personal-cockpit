// Install into a disposable home; the app stub cannot touch the live window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
    assert.ok(existsSync(join(mod, "jira.js")));
    for (const file of ["jira-bridge.mjs", "jira-model.js", "jira-query.js", "jira-settings.js", "JIRA.md"]) {
      assert.ok(existsSync(join(mod, file)), `missing ${file}`);
    }
    assert.equal(JSON.parse(readFileSync(join(mod, "package.json"), "utf8")).type, "module");
    assert.equal(existsSync(join(mod, "jira")), false, "Jira helpers belong at the mod root");
    assert.ok(existsSync(join(mod, "jira.config.example.json")));
    assert.equal(existsSync(join(home, "mods/jira-tickets")), false);
    assert.equal(existsSync(join(mod, "jira.config.json")), false, "never seed fake site/cloud ID as live config");
    const configs = {
      "routines.yml": "coordination_repo: example/tasks\n",
      "team.yml": "query: org:example\n",
      "jira.config.json": '{"node":"/keep/node","jql":"project = TEST","extra":true}\n',
    };
    for (const [file, text] of Object.entries(configs)) writeFileSync(join(mod, file), text);
    writeFileSync(join(mod, "obsolete.js"), "must disappear");
    mkdirSync(join(mod, "jira"));
    writeFileSync(join(mod, "jira/bridge.mjs"), "obsolete nested bridge");
    install();
    for (const [file, text] of Object.entries(configs)) assert.equal(readFileSync(join(mod, file), "utf8"), text);
    assert.equal(existsSync(join(mod, "obsolete.js")), false);
    assert.equal(existsSync(join(mod, "jira")), false, "reinstall removes the obsolete nested helpers");
    assert.equal(readFileSync(join(home, "layouts/cockpit.json"), "utf8"), layout);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("the PowerShell mirror excludes the personal Jira config along with YAML configs", () => {
  const script = readFileSync(join(root, "tools/install.ps1"), "utf8");
  assert.match(script, /robocopy .*\/XF .*routines\.yml team\.yml jira\.config\.json \/NFL/);
});
