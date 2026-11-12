import { execFile, spawn } from "node:child_process";
import { access, constants, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { nativeImage } from "electron";
import type { ClaudeCodeStatus, ClaudeLimits, ClaudeLimitWindow } from "../shared/ipc";
import { dataDir } from "./paths";
import { saveClaudeLimits } from "./usage";

interface RawWindow {
  utilization?: number;
  resetsAt?: number;
}

/** Claude Code reports plan usage per window (5-hour session, 7-day week) with each call. */
export function toLimits(
  info: { unifiedWindows?: Record<string, RawWindow> } | undefined,
): ClaudeLimits {
  const window = (raw?: RawWindow): ClaudeLimitWindow | null =>
    raw && typeof raw.utilization === "number" && typeof raw.resetsAt === "number"
      ? { utilization: raw.utilization, resetsAt: new Date(raw.resetsAt * 1000).toISOString() }
      : null;
  return {
    session: window(info?.unifiedWindows?.five_hour),
    weekly: window(info?.unifiedWindows?.seven_day),
    capturedAt: new Date().toISOString(),
  };
}

// Runs the user's own Claude Code CLI for text and image-understanding tasks,
// the same pattern T3 Code uses. Constraints from Anthropic's Claude Code
// "Legal and compliance" page (checked 2026-11-12):
//   - run the binary unmodified, as installed by the user;
//   - never collect, store or relay Claude credentials: the user signs in
//     through Anthropic's own flow (`claude auth login` in Terminal);
//   - usage is billed to the user's own plan or key; we never pay for,
//     resell or intermediate it;
//   - do not use the Claude Code name or logo as our product/feature name.
// Every call disables all tools, MCP servers and settings, so Claude can only
// answer the question; it cannot run commands or touch files.

const run = promisify(execFile);

// GUI apps on macOS do not inherit the shell PATH, so look in the usual places.
const CANDIDATE_DIRS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".claude", "local"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

let cachedPath: string | null | undefined;

export async function findClaude(): Promise<string | null> {
  if (cachedPath !== undefined) return cachedPath;
  const dirs = [...CANDIDATE_DIRS, ...(process.env.PATH ?? "").split(delimiter)];
  for (const dir of dirs) {
    const candidate = join(dir, process.platform === "win32" ? "claude.exe" : "claude");
    try {
      await access(candidate, constants.X_OK);
      cachedPath = candidate;
      return candidate;
    } catch {}
  }
  cachedPath = null;
  return null;
}

export async function claudeCodeStatus(): Promise<ClaudeCodeStatus> {
  cachedPath = undefined; // re-detect: the user may have just installed it
  const bin = await findClaude();
  if (!bin) return { installed: false, version: null, loggedIn: false, plan: null };
  const version = await run(bin, ["--version"], { timeout: 10_000 })
    .then((r) => r.stdout.trim().split(" ")[0] ?? null)
    .catch(() => null);
  try {
    const { stdout } = await run(bin, ["auth", "status", "--json"], { timeout: 10_000 });
    const status = JSON.parse(stdout) as { loggedIn?: boolean; subscriptionType?: string };
    return {
      installed: true,
      version,
      loggedIn: Boolean(status.loggedIn),
      plan: status.subscriptionType ?? null,
    };
  } catch {
    return { installed: true, version, loggedIn: false, plan: null };
  }
}

export async function imageBlock(path: string, maxSide: number) {
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) throw new Error("Không đọc được ảnh");
  const { width, height } = image.getSize();
  const scaled =
    Math.max(width, height) > maxSide
      ? image.resize(width >= height ? { width: maxSide } : { height: maxSide })
      : image;
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/jpeg",
      data: scaled.toJPEG(85).toString("base64"),
    },
  };
}

export interface ClaudeCodeAnswer {
  text: string;
  /** Claude Code's API-price estimate. Not charged per call on a subscription. */
  notionalCostUsd: number | null;
  durationMs: number | null;
}

/** One question, optional images, no tools. */
export async function askClaudeCode(input: {
  system: string;
  prompt: string;
  imagePaths?: string[];
  /** Prefix each image with "Ảnh n:" so the answer can refer to it. */
  numberImages?: boolean;
  maxImageSide?: number;
  model?: string;
  effort?: string;
  timeoutMs?: number;
}): Promise<ClaudeCodeAnswer> {
  const bin = await findClaude();
  if (!bin) throw new Error("Chưa cài Claude Code trên máy này");

  // An empty working folder, so no project instructions or files are picked up.
  const cwd = join(dataDir(), "claude-code");
  await mkdir(cwd, { recursive: true });

  const blocks = await Promise.all(
    (input.imagePaths ?? []).map((p) => imageBlock(p, input.maxImageSide ?? 1024)),
  );
  // Numbered images let the answer refer to "Ảnh 3" unambiguously.
  const content = [
    ...blocks.flatMap((block, i) =>
      input.numberImages ? [{ type: "text", text: `Ảnh ${i + 1}:` }, block] : [block],
    ),
    { type: "text", text: input.prompt },
  ];
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--model",
    input.model ?? "sonnet",
    ...(input.effort ? ["--effort", input.effort] : []),
    "--system-prompt",
    input.system,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Claude Code không phản hồi kịp"));
    }, input.timeoutMs ?? 120_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const messages = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        });
      const limits = messages.findLast((m) => m?.type === "rate_limit_event");
      if (limits) void saveClaudeLimits(toLimits(limits.rate_limit_info)).catch(() => {});
      const result = messages.find((m) => m?.type === "result");
      if (!result) {
        reject(new Error(stderr.trim().split("\n").at(-1) || "Claude Code không trả về kết quả"));
      } else if (result.is_error) {
        reject(new Error(String(result.result ?? "Claude Code báo lỗi")));
      } else {
        resolve({
          text: String(result.result ?? "").trim(),
          notionalCostUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
          durationMs: typeof result.duration_ms === "number" ? result.duration_ms : null,
        });
      }
    });

    child.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`);
  });
}
