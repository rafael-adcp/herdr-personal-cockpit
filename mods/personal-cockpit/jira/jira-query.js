import { exec } from "herdr";
import { pathOf } from "../kit/conf.js";
export const configPath = () => pathOf("jira.config.json");

// Both polling and the settings dialog use this same read-only bridge. The
// optional JQL is a separate argv entry, never shell text or a temporary file.
//
// The bridge is named with its folder because this path is built at run time
// from the installed mod root, not resolved as an import: moving the file would
// leave this string pointing at nothing and nothing would say so until a query
// ran. `jira.config.json` has no folder for the opposite reason -- it is the
// person's, and both installers keep it at the mod root.
export async function executeQuery(config, jql) {
  const node = config.node ?? "node";
  if (typeof node !== "string" || !node.trim()) throw new Error("Set node to the Node.js executable path in jira.config.json.");
  const args = [pathOf("jira/jira-bridge.mjs"), configPath()];
  if (jql !== undefined) args.push(jql);
  const result = await exec(node, args);
  let data;
  try { data = JSON.parse(result.stdout); } catch { throw new Error("Jira bridge returned no valid response. Check that Node.js and the managed Pi installation are available."); }
  if (data.error) {
    const error = new Error(data.error.message);
    error.kind = data.error.kind;
    throw error;
  }
  if (result.code !== 0 || !Array.isArray(data.items)) throw new Error("Jira bridge failed to load tickets.");
  return data;
}
