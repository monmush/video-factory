import type { ClaudeCodeStatus } from "@shared/ipc";
import { Check, LoaderCircle } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActiveProfileLabel } from "@/components/profile-label";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { finishOnboarding, isPaidPlan, planLabel, useClaudeInstall } from "@/lib/claude-setup";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const POLL_MS = 3_000;

type StepState = "done" | "current" | "pending";

export function OnboardingScreen() {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitingForLogin, setWaitingForLogin] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const { installing, error: installError, install, openTerminal } = useClaudeInstall(setStatus);
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      setStatus((await api.invoke("ai:status")).claudeCode);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const ready = Boolean(status?.installed && status.loggedIn);
  const polling = status !== null && !ready && !installing;
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => void check(), POLL_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [polling, check]);

  const finish = async (useClaude: boolean) => {
    setFinishing(true);
    setError(null);
    try {
      await finishOnboarding(useClaude);
    } catch (e) {
      setError(errorMessage(e));
      setFinishing(false);
    }
  };

  const login = () => {
    setError(null);
    setWaitingForLogin(true);
    api.invoke("ai:open-terminal", "login").catch((e) => {
      setWaitingForLogin(false);
      setError(errorMessage(e));
    });
  };

  const installed = Boolean(status?.installed);
  const stepState = (index: number): StepState => {
    const current = !installed ? 0 : !ready ? 1 : 2;
    return index < current ? "done" : index === current ? "current" : "pending";
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-foreground">
      <div className="app-drag flex h-[var(--titlebar-height)] shrink-0 items-center justify-end px-4">
        <ActiveProfileLabel className="text-muted-foreground" />
      </div>
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-[var(--titlebar-height)]">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border bg-background p-8 shadow-xs">
            <h1 className="text-xl font-semibold">Kết nối Claude của bạn</h1>
            <p className="mt-2 text-muted-foreground">
              Ứng dụng dùng tài khoản Claude của bạn để viết kịch bản và trò chuyện. Cần gói Pro
              hoặc Max.
            </p>

            {status ? (
              <ol className="mt-7 flex flex-col">
                <Step index={0} title="Cài Claude" state={stepState(0)}>
                  {installing ? (
                    <div className="flex items-center gap-3">
                      <Button disabled>
                        <LoaderCircle className="animate-spin" />
                        Đang cài…
                      </Button>
                      <Hint>Có thể mất một phút.</Hint>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <Button onClick={() => void install()}>Cài Claude</Button>
                        {installError && (
                          <Button variant="outline" onClick={openTerminal}>
                            Mở Terminal để cài
                          </Button>
                        )}
                      </div>
                      {installError && <ErrorLine>{installError}</ErrorLine>}
                    </>
                  )}
                </Step>
                <Step index={1} title="Đăng nhập" state={stepState(1)}>
                  <Hint>Đăng nhập trên trình duyệt rồi quay lại đây.</Hint>
                  <Button className="mt-3" onClick={login}>
                    {waitingForLogin && <LoaderCircle className="animate-spin" />}
                    Đăng nhập
                  </Button>
                </Step>
                <Step index={2} title="Sẵn sàng" state={stepState(2)} last>
                  {status.plan && isPaidPlan(status.plan) ? (
                    <Hint>{planLabel(status.plan)}</Hint>
                  ) : (
                    <p className="text-warning-foreground text-xs">
                      Tài khoản này cần gói Pro hoặc Max.
                    </p>
                  )}
                  <Button className="mt-3" disabled={finishing} onClick={() => void finish(true)}>
                    Bắt đầu
                  </Button>
                </Step>
              </ol>
            ) : (
              <div className="mt-7 flex h-40 items-center justify-center text-muted-foreground">
                {!error && <LoaderCircle className="size-5 animate-spin" />}
              </div>
            )}
            {error && <ErrorLine>{error}</ErrorLine>}
          </div>
          <div className="mt-4 text-center">
            <button
              type="button"
              disabled={finishing}
              onClick={() => void finish(false)}
              className="cursor-pointer rounded-sm text-muted-foreground text-xs underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Để sau
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function Step({
  index,
  title,
  state,
  last,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3.5" aria-current={state === "current" ? "step" : undefined}>
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full border font-medium text-xs tabular-nums",
            state === "done" && "border-primary bg-primary text-primary-foreground",
            state === "current" && "border-primary text-primary",
            state === "pending" && "text-muted-foreground",
          )}
        >
          {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
        </span>
        {!last && <span className="my-1 w-px flex-1 bg-border" />}
      </div>
      <div className={cn("min-w-0 flex-1 pt-0.5", !last && "pb-5")}>
        <div
          className={cn(
            "font-medium",
            state === "pending" && "text-muted-foreground",
            state === "done" && "text-muted-foreground",
          )}
        >
          {title}
        </div>
        {state === "current" && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs">{children}</p>;
}

function ErrorLine({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-destructive-foreground text-xs">{children}</p>;
}
