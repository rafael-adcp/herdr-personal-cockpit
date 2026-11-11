// Pure query, pagination and shaping shared by the native view and its CLI bridge.
export const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
export const FIELDS = ["summary", "status", "priority", "project", "updated", "issuetype", "assignee"];

export class PanelError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

export function configOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PanelError("setup", "jira.config.json must contain a JSON object.");
  let site;
  try { site = new URL(value.site); } catch { /* reported below */ }
  if (!site || site.protocol !== "https:" || !site.hostname.endsWith(".atlassian.net") ||
      site.username || site.password || site.pathname !== "/" || site.search || site.hash || site.port) {
    throw new PanelError("setup", "Set site to your Jira HTTPS origin in jira.config.json (https://your-team.atlassian.net).");
  }
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value.cloudId ?? "")) {
    throw new PanelError("setup", "Set your Jira cloudId in jira.config.json.");
  }
  if (value.jql !== undefined && (typeof value.jql !== "string" || !value.jql.trim())) {
    throw new PanelError("setup", "jql must be a non-empty JQL query.");
  }
  return { site: site.origin, cloudId: value.cloudId, jql: value.jql ?? DEFAULT_JQL };
}

export function payloadOf(result) {
  if (result?.isError) throw new PanelError("error", "Jira rejected the search. Check your access and JQL in jira.config.json.");
  const data = result?.structuredContent ?? JSON.parse((result?.content ?? [])
    .filter((c) => c.type === "text").map((c) => c.text).join("\n"));
  if (!Array.isArray(data?.issues)) throw new PanelError("error", "Jira returned an unexpected response; no list was replaced.");
  return data;
}

export function shape(issue, site) {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    title: f.summary ?? issue.key,
    status: f.status?.name ?? "Unknown status",
    category: f.status?.statusCategory?.key ?? "unknown",
    priority: f.priority?.name ?? "No priority",
    project: f.project?.name ?? "",
    type: f.issuetype?.name ?? "",
    updated: f.updated ?? null,
    assignee: f.assignee?.displayName ?? "",
    url: `${site}/browse/${encodeURIComponent(issue.key)}`,
  };
}

export async function fetchIssues(call, config) {
  const items = new Map(), seen = new Set();
  let nextPageToken;
  // A bounded poll: never show a truncated page as a complete list.
  for (let page = 0; page < 50; page++) {
    const args = { cloudId: config.cloudId, jql: config.jql, fields: FIELDS, maxResults: 100 };
    if (nextPageToken) args.nextPageToken = nextPageToken;
    const data = payloadOf(await call("searchJiraIssuesUsingJql", args));
    for (const issue of data.issues) {
      if (typeof issue.key !== "string" || !issue.key) throw new PanelError("error", "Jira returned an issue without a key.");
      items.set(issue.key, shape(issue, config.site));
    }
    if (data.isLast === true || (!data.nextPageToken && data.isLast !== false)) return [...items.values()];
    nextPageToken = data.nextPageToken;
    if (!nextPageToken || seen.has(nextPageToken)) throw new PanelError("error", "Jira pagination did not advance; showing the previous list.");
    seen.add(nextPageToken);
  }
  throw new PanelError("error", "Jira search exceeded 50 pages. Narrow the JQL in jira.config.json.");
}

export function sections(items) {
  const order = ["indeterminate", "new", "done", "unknown"];
  const names = { indeterminate: "In progress", new: "To do", done: "Done", unknown: "Other" };
  return order.map((category) => ({
    label: names[category],
    // The JQL ORDER BY is authoritative (boards often use Rank ASC).
    items: items.filter((item) => (order.includes(item.category) ? item.category : "unknown") === category),
  })).filter((group) => group.items.length);
}

export const searchUrl = (config) => `${config.site}/issues/?jql=${encodeURIComponent(config.jql)}`;
