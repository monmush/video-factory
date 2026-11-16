import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// The media provider's MCP tools for the live director (experiment branch,
// docs/LIVE_DIRECTOR_EXPERIMENT.md). Electron-free, so a script can drive it.
//
// Two ways in, best first:
//   - "signed-in": the owner connected the provider's MCP server in his own
//     Claude Code with the browser sign-in. Claude Code keeps that sign-in
//     under the server's name and a hash of its type and URL, so a session
//     given the same name and URL uses it from any working folder.
//   - "key": the app's own API key. The key never leaves this process: the
//     session gets an in-process server whose tools forward to the provider,
//     and only the planning tools below exist on it.
// Either way the director can only plan. Spending, uploading, library,
// account and feedback tools are refused by name, by the allow-list and by a
// hook that denies anything not on it.

export const MCP_SERVER = "fal";
const REMOTE_URL = "https://mcp.fal.ai/mcp";

/** Read-only planning tools: the only ones the director may call. */
export const PLANNING_TOOLS = [
  "get_model_schema",
  "get_pricing",
  "estimate_cost",
  "search_models",
  "browse_models",
  "recommend_model",
  "search_guidance",
  "read_guidance",
  "search_docs",
  "prepare_media_workflow",
] as const;

/** Never given to the director, by name (anything new is refused by the allow-list too). */
export const DENIED_TOOLS = [
  "run_model",
  "submit_job",
  "submit_jobs",
  "upload_file",
  "upload_attachment",
  "verify_upload",
  "cancel_job",
  "check_job",
  "get_job_result",
  "get_submission",
  "wait_for_jobs",
  "prepare_media_transform",
  "prepare_deliverables",
  "list_model_sets",
  "check_account_status",
  "list_accounts",
  "select_account",
  "get_generation_defaults",
  "resolve_model_inputs",
  "search_request_history",
  "get_job_recipe",
  "inspect_images",
  "send_feedback",
  "show_media",
  "open_library",
  "search_mentions",
  "open_media_file",
  "library_search",
  "library_read",
  "library_create",
  "library_update",
  "library_link",
  "library_favorite",
  "library_delete",
] as const;

export const toolId = (name: string) => `mcp__${MCP_SERVER}__${name}`;
export const isPlanningTool = (fullName: string) =>
  (PLANNING_TOOLS as readonly string[]).some((t) => toolId(t) === fullName);

export type FalConnection =
  | { kind: "signed-in"; name: string; url: string }
  | { kind: "key"; key: string };

interface ClaudeConfigServer {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
}

/**
 * The provider's MCP server as the owner connected it in Claude Code (user or
 * any project's local scope), read from ~/.claude.json without changing it.
 * Only a browser sign-in counts: an entry with its own headers carries a key.
 */
export async function signedInServer(
  configPath = join(homedir(), ".claude.json"),
): Promise<{ name: string; url: string } | null> {
  let config: {
    mcpServers?: Record<string, ClaudeConfigServer>;
    projects?: Record<string, { mcpServers?: Record<string, ClaudeConfigServer> }>;
  };
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return null;
  }
  const scopes = [
    config.mcpServers ?? {},
    ...Object.values(config.projects ?? {}).map((p) => p.mcpServers ?? {}),
  ];
  for (const servers of scopes) {
    for (const [name, server] of Object.entries(servers)) {
      if (server.type !== "http" || !server.url || Object.keys(server.headers ?? {}).length) {
        continue;
      }
      try {
        if (new URL(server.url).hostname === "mcp.fal.ai") return { name, url: server.url };
      } catch {}
    }
  }
  return null;
}

/** The connections to try, best first. */
export async function falConnections(key: string | null): Promise<FalConnection[]> {
  const signedIn = await signedInServer();
  return [
    ...(signedIn ? [{ kind: "signed-in" as const, ...signedIn }] : []),
    ...(key ? [{ kind: "key" as const, key }] : []),
  ];
}

// ---------------------------------------------------------------------------
// Key mode: an in-process server forwarding the planning tools only.
// ---------------------------------------------------------------------------

async function rpc(key: string, body: unknown, timeoutMs = 150_000): Promise<unknown> {
  const res = await fetch(REMOTE_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  // Answers come as server-sent events ("data: {...}") or plain JSON.
  const data = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5))
    .join("");
  const parsed = JSON.parse(data || text) as { result?: unknown; error?: { message?: string } };
  if (parsed.error) throw new Error(parsed.error.message ?? `HTTP ${res.status}`);
  return parsed.result;
}

interface RemoteTool {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

/** One argument's type from its JSON schema; anything unconvertible stays open. */
function argType(schema: unknown): z.ZodType {
  try {
    return z.fromJSONSchema(schema as never);
  } catch {
    return z.any();
  }
}

/**
 * An in-process MCP server named like the remote one, whose only tools are
 * the planning tools, forwarded with the app's key.
 */
export async function keyProxyServer(key: string) {
  const listed = (await rpc(key, { jsonrpc: "2.0", id: 1, method: "tools/list" })) as {
    tools?: RemoteTool[];
  };
  const remote = new Map((listed.tools ?? []).map((t) => [t.name, t]));
  const tools = PLANNING_TOOLS.filter((name) => remote.has(name)).map((name) => {
    const def = remote.get(name) as RemoteTool;
    const required = new Set(def.inputSchema?.required ?? []);
    const shape = Object.fromEntries(
      Object.entries(def.inputSchema?.properties ?? {}).map(([arg, schema]) => {
        const type = argType(schema);
        return [arg, required.has(arg) ? type : type.optional()];
      }),
    );
    return tool(name, def.description ?? name, shape, async (args) => {
      try {
        const result = (await rpc(key, {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        })) as { content?: { type: "text"; text: string }[]; isError?: boolean };
        return { content: result.content ?? [], isError: Boolean(result.isError) };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: (error as Error).message }],
          isError: true,
        };
      }
    });
  });
  return createSdkMcpServer({ name: MCP_SERVER, version: "1", tools });
}
