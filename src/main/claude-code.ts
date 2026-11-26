import { type ChildProcess, execFile, spawn } from "node:child_process";
import { access, constants, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { nativeImage } from "electron";
import type { ClaudeCodeStatus, ClaudeLimits, ClaudeLimitWindow } from "../shared/ipc";
import { advanceFakeClaude, fakeClaudeActive, fakeClaudeStatus } from "./claude-fake";
import { streamReader } from "./claude-stream";
import { dataDir } from "./paths";
import { saveClaudeLimits } from "./usage";

interface RawWindow {
  utilization?: number;
  resetsAt?: number;
}

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

const run = promisify(execFile);

const APP_KEYS_CLAUDE_NEVER_NEEDS = ["FAL_KEY", "FAL_BILLING_KEY"];

const ANSWER_ONLY_NO_TOOLS_MCP_OR_SETTINGS = [
  "--tools",
  "",
  "--strict-mcp-config",
  "--setting-sources",
  "",
];

export function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of APP_KEYS_CLAUDE_NEVER_NEEDS) delete env[name];
  return env;
}

const INSTALL_DIRS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".claude", "local"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

let shellPath: Promise<string[]> | null = null;

function loginShellPath(): Promise<string[]> {
  shellPath ??= run(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "%s" "$PATH"'], {
    timeout: 5_000,
    env: claudeEnv(),
  })
    .then(({ stdout }) => stdout.trim().split("\n").at(-1)?.split(delimiter).filter(Boolean) ?? [])
    .catch(() => []);
  return shellPath;
}

let cachedPath: string | null | undefined;

export async function findClaude(): Promise<string | null> {
  if (cachedPath !== undefined) return cachedPath;
  const dirs = [
    ...(await loginShellPath()),
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    ...INSTALL_DIRS,
  ];
  for (const dir of new Set(dirs)) {
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
  const fake = fakeClaudeStatus();
  if (fake) return fake;
  cachedPath = undefined;
  shellPath = null;
  const bin = await findClaude();
  if (!bin) return { installed: false, version: null, loggedIn: false, plan: null };
  const version = await run(bin, ["--version"], { timeout: 10_000, env: claudeEnv() })
    .then((r) => r.stdout.trim().split(" ")[0] ?? null)
    .catch(() => null);
  try {
    const { stdout } = await run(bin, ["auth", "status", "--json"], {
      timeout: 10_000,
      env: claudeEnv(),
    });
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

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const INSTALL_COMMAND = "set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash";

let installing: Promise<ClaudeCodeStatus> | null = null;

export function installClaude(): Promise<ClaudeCodeStatus> {
  installing ??= runInstaller().finally(() => {
    installing = null;
  });
  return installing;
}

async function runInstaller(): Promise<ClaudeCodeStatus> {
  if (fakeClaudeActive()) {
    await advanceFakeClaude();
    return claudeCodeStatus();
  }
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", INSTALL_COMMAND], {
      env: claudeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    let tail = "";
    const keep = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-MAX_STDERR_CHARS);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, INSTALL_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      children.delete(child);
      console.error("[claude] installer failed to start", error);
      reject(new Error("Không cài được Claude"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      if (code === 0) return resolve(tail);
      console.error("[claude] installer failed", { code, timedOut, tail });
      reject(new Error(installFailure(tail, timedOut)));
    });
  });
  const status = await claudeCodeStatus();
  if (!status.installed) {
    console.error("[claude] installer finished but claude was not found", output);
    throw new Error("Không cài được Claude");
  }
  return status;
}

function installFailure(tail: string, timedOut: boolean): string {
  if (timedOut) return "Cài quá lâu nên đã dừng";
  if (/could not resolve host|failed to connect|network is unreachable|timed out/i.test(tail)) {
    return "Không kết nối được mạng";
  }
  return "Không cài được Claude";
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
  notionalCostUsd: number | null;
  durationMs: number | null;
}

export async function askClaudeCode(input: {
  system: string;
  prompt: string;
  imagePaths?: string[];
  numberImages?: boolean;
  maxImageSide?: number;
  model?: string;
  effort?: string;
  timeoutMs?: number;
  onText?: (soFar: string) => void;
  signal?: AbortSignal;
}): Promise<ClaudeCodeAnswer> {
  const { signal } = input;
  const bin = await findClaude();
  if (!bin) throw new Error("Chưa cài Claude Code trên máy này");

  const folderWithoutProjectInstructions = join(dataDir(), "claude-code");
  await mkdir(folderWithoutProjectInstructions, { recursive: true });

  const blocks = await Promise.all(
    (input.imagePaths ?? []).map((p) => imageBlock(p, input.maxImageSide ?? 1024)),
  );
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
    ...(input.onText ? ["--include-partial-messages"] : []),
    ...ANSWER_ONLY_NO_TOOLS_MCP_OR_SETTINGS,
    "--no-session-persistence",
    "--model",
    input.model ?? "sonnet",
    ...(input.effort ? ["--effort", input.effort] : []),
    "--system-prompt",
    input.system,
  ];

  if (signal?.aborted) throw new Error("Đã dừng");
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: folderWithoutProjectInstructions,
      env: claudeEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);
    let settled = false;
    const finish = (error: Error | null, answer?: ClaudeCodeAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (child.exitCode === null && child.signalCode === null) child.kill();
      if (error) reject(error);
      else resolve(answer as ClaudeCodeAnswer);
    };
    const timer = setTimeout(
      () => finish(new Error("Claude Code không phản hồi kịp")),
      input.timeoutMs ?? 120_000,
    );
    const stop = () => finish(new Error("Đã dừng"));
    signal?.addEventListener("abort", stop, { once: true });
    const reader = streamReader(input.onText);
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (!reader.push(chunk.toString())) finish(new Error("Claude Code trả về quá nhiều dữ liệu"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_STDERR_CHARS);
    });
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      children.delete(child);
      finish(error);
    });
    child.on("close", () => {
      children.delete(child);
      const { result, limits } = reader.end();
      if (limits) void saveClaudeLimits(toLimits(limits.rate_limit_info)).catch(() => {});
      if (!result) {
        finish(new Error(stderr.trim().split("\n").at(-1) || "Claude Code không trả về kết quả"));
      } else if (result.is_error) {
        finish(new Error(String(result.result ?? "Claude Code báo lỗi")));
      } else {
        finish(null, {
          text: String(result.result ?? "").trim(),
          notionalCostUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
          durationMs: typeof result.duration_ms === "number" ? result.duration_ms : null,
        });
      }
    });

    child.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`);
  });
}

const MAX_STDERR_CHARS = 4_000;

const children = new Set<ChildProcess>();

export function stopClaudeProcesses() {
  for (const child of children) child.kill();
  children.clear();
}
