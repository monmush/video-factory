export const MAX_PENDING_CHARS = 8 * 1024 * 1024;

export interface StreamResult {
  type: "result";
  is_error?: boolean;
  result?: unknown;
  total_cost_usd?: unknown;
  duration_ms?: unknown;
}

export interface StreamLimits {
  type: "rate_limit_event";
  rate_limit_info?: {
    unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }>;
  };
}

export function streamReader(onText?: (soFar: string) => void, maxPending = MAX_PENDING_CHARS) {
  let pending = "";
  let soFar = "";
  let result: StreamResult | null = null;
  let limits: StreamLimits | null = null;

  const read = (line: string) => {
    if (!line.trim()) return false;
    let message: { type?: string; event?: { delta?: { type?: string; text?: unknown } } };
    try {
      message = JSON.parse(line);
    } catch {
      return false;
    }
    if (message?.type === "result") result ??= message as StreamResult;
    else if (message?.type === "rate_limit_event") limits = message as StreamLimits;
    const delta = message?.event?.delta;
    if (onText && delta?.type === "text_delta" && typeof delta.text === "string") {
      soFar += delta.text;
      return true;
    }
    return false;
  };

  const report = () => {
    try {
      onText?.(soFar);
    } catch {}
  };

  return {
    push(chunk: string): boolean {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      let grew = false;
      for (const line of lines) grew = read(line) || grew;
      if (grew) report();
      return pending.length <= maxPending;
    },
    end(): { result: StreamResult | null; limits: StreamLimits | null } {
      if (read(pending)) report();
      pending = "";
      return { result, limits };
    },
  };
}
