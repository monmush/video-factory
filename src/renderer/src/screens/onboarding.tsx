import type { ClaudeCodeStatus, ProductKeyStatus } from "@shared/ipc";
import { Check, LoaderCircle } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import heroPhoto from "@/assets/start/hero.webp";
import { BrandMark } from "@/components/brand-mark";
import { ActiveProfileLabel } from "@/components/profile-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { finishOnboarding, isPaidPlan, planLabel, useClaudeInstall } from "@/lib/claude-setup";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const POLL_MS = 3_000;

type StepState = "done" | "current" | "pending";

export function OnboardingScreen() {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [productKey, setProductKey] = useState<ProductKeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitingForLogin, setWaitingForLogin] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
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
    api
      .invoke("product-key:status")
      .then(setProductKey)
      .catch((e) => setError(errorMessage(e)));
    api
      .invoke("app:info")
      .then((info) => setVersion(info.version))
      .catch(() => setVersion(null));
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
    const current = !productKey?.present ? 0 : !installed ? 1 : !ready ? 2 : 3;
    return index < current ? "done" : index === current ? "current" : "pending";
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-foreground">
      <div className="app-drag flex h-[var(--titlebar-height)] shrink-0 items-center justify-end px-4">
        <ActiveProfileLabel className="text-muted-foreground" />
      </div>
      <div className="flex min-h-0 flex-1 gap-2 pr-2 pb-2">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
          <div className="m-auto w-full max-w-md py-4">
            <div className="mb-6 flex items-center justify-center gap-3">
              <BrandMark className="size-10" />
              <span className="select-none font-semibold text-2xl tracking-tight">M5 Studio</span>
            </div>
            <div className="rounded-2xl border bg-background p-8 shadow-xs">
              <h1 className="text-xl font-semibold">Thiết lập</h1>
              <p className="mt-2 text-muted-foreground">
                Nhập mã sản phẩm, rồi kết nối Claude của bạn để viết kịch bản. Claude cần gói Pro
                hoặc Max.
              </p>

              {status && productKey ? (
                <ol className="mt-7 flex flex-col">
                  <Step index={0} title="Mã sản phẩm" state={stepState(0)}>
                    <ProductKeyForm onSaved={setProductKey} />
                  </Step>
                  <Step index={1} title="Cài Claude" state={stepState(1)}>
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
                  <Step index={2} title="Đăng nhập" state={stepState(2)}>
                    <Hint>Đăng nhập trên trình duyệt rồi quay lại đây.</Hint>
                    <Button className="mt-3" onClick={login}>
                      {waitingForLogin && <LoaderCircle className="animate-spin" />}
                      Đăng nhập
                    </Button>
                  </Step>
                  <Step index={3} title="Sẵn sàng" state={stepState(3)} last>
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
          <footer className="flex h-[var(--titlebar-height)] shrink-0 items-center justify-center text-muted-foreground text-xs tabular-nums">
            {version && `Phiên bản ${version}`}
          </footer>
        </main>
        <img
          src={heroPhoto}
          alt=""
          draggable={false}
          className="hidden w-[44%] max-w-xl min-w-0 rounded-xl object-cover object-[78%_50%] ring-1 ring-black/5 ring-inset md:block dark:brightness-90 dark:ring-white/5"
        />
      </div>
    </div>
  );
}

function ProductKeyForm({ onSaved }: { onSaved: (status: ProductKeyStatus) => void }) {
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setChecking(true);
    setError(null);
    try {
      const saved = await api.invoke("product-key:save", value);
      if (saved.ok) onSaved(saved.status);
      else setError(saved.error);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder="Dán mã sản phẩm"
          value={value}
          onValueChange={setValue}
          autoComplete="off"
          autoFocus
        />
        <Button type="submit" disabled={checking || !value.trim()}>
          {checking && <LoaderCircle className="animate-spin" />}
          Tiếp tục
        </Button>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </form>
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
            state === "done" && "border-transparent bg-muted text-muted-foreground",
            state === "current" && "border-foreground text-foreground",
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
