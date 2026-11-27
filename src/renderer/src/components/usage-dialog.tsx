import { formatCost } from "@shared/credits";
import type { BalanceResult, Balances } from "@shared/ipc";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { Tabs, TabsList, TabsPanel, TabsTab } from "./ui/tabs";
import { UsageStatsView } from "./usage-stats-view";

type UsageTab = "balances" | "stats";

function useLoaded<T>(load: () => Promise<T>, active: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const refresh = useCallback(async () => {
    setAsked(true);
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    if (active && !asked) void refresh();
  }, [active, asked, refresh]);
  return { data, loading: loading || (active && !asked), error, refresh };
}

const loadBalances = () => api.invoke("usage:balances");
const loadStats = () => api.invoke("usage:stats");

export function UsageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="h-[88dvh] max-h-[88dvh] w-[90vw] max-w-[1200px]">
        {open && <UsageContent onNavigate={() => onOpenChange(false)} />}
      </DialogPopup>
    </Dialog>
  );
}

function UsageContent({ onNavigate }: { onNavigate: () => void }) {
  const [tab, setTab] = useState<UsageTab>("balances");
  const balances = useLoaded(loadBalances, tab === "balances");
  const stats = useLoaded(loadStats, tab === "stats");
  const shown = tab === "balances" ? balances : stats;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value === "stats" ? "stats" : "balances")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeader className="gap-3 pr-14">
        <div className="flex items-center gap-2">
          <DialogTitle className="flex-1">Mức sử dụng</DialogTitle>
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="Làm mới"
            title="Làm mới"
            disabled={shown.loading}
            onClick={shown.refresh}
          >
            <RefreshCw className={cn(shown.loading && "animate-spin")} />
          </Button>
        </div>
        <TabsList>
          <TabsTab value="balances">Số dư</TabsTab>
          <TabsTab value="stats">Thống kê</TabsTab>
        </TabsList>
      </DialogHeader>

      {shown.error && (
        <p className="px-6 pt-4 text-center text-destructive-foreground">
          Không kiểm tra được: {shown.error}
        </p>
      )}
      <TabsPanel value="balances" className="flex min-h-0 flex-1 flex-col">
        {balances.data ? (
          <BalancesBody data={balances.data} onNavigate={onNavigate} />
        ) : (
          !balances.error && <Checking />
        )}
      </TabsPanel>
      <TabsPanel value="stats" className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {stats.data ? <UsageStatsView data={stats.data} /> : !stats.error && <Checking />}
      </TabsPanel>
    </Tabs>
  );
}

function Checking() {
  return <p className="px-6 py-10 text-center text-muted-foreground">Đang kiểm tra…</p>;
}

function BalancesBody({ data, onNavigate }: { data: Balances; onNavigate: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
        <Section title="Số dư AI">
          <Status result={data.media} onNavigate={onNavigate}>
            {(media) => (
              <div className="text-3xl font-semibold tabular-nums">
                {media.currency === "USD"
                  ? formatCost(media.balance)
                  : `${media.balance} ${media.currency}`}
              </div>
            )}
          </Status>
        </Section>

        <Section title="Claude">
          {data.claude ? (
            <>
              {data.claude.session && (
                <Meter
                  label="Phiên (5 giờ)"
                  used={data.claude.session.utilization}
                  detail={`Đặt lại ${untilText(data.claude.session.resetsAt)}`}
                />
              )}
              {data.claude.weekly && (
                <Meter
                  label="Tuần"
                  used={data.claude.weekly.utilization}
                  detail={`Đặt lại ${untilText(data.claude.weekly.resetsAt)}`}
                />
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Chưa có số liệu.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function Status<T>({
  result,
  onNavigate,
  children,
}: {
  result: BalanceResult<T>;
  onNavigate: () => void;
  children: (value: T) => ReactNode;
}) {
  if (result.status === "ok") return <>{children(result as T)}</>;
  const toSettings = (
    <Link to="/settings" onClick={onNavigate} className="text-primary hover:underline">
      Cài đặt
    </Link>
  );
  return (
    <Card className="text-muted-foreground">
      {result.status === "no-key" && <>Chưa có mã sản phẩm. Nhập trong {toSettings}.</>}
      {result.status === "no-permission" && <>Mã này không xem được số dư.</>}
      {result.status === "error" && <>Không đọc được số dư: {result.message}</>}
    </Card>
  );
}

function Meter({ label, used, detail }: { label: string; used: number; detail: string }) {
  const share = Math.min(1, Math.max(0, used));
  const left = Math.round((1 - share) * 100);
  return (
    <Card className="flex items-center gap-6">
      <div className="w-36 shrink-0">
        <div className="text-muted-foreground">{label}</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span
            className={cn(
              "text-3xl font-semibold tabular-nums",
              left <= 10 && "text-destructive-foreground",
            )}
          >
            {left}%
          </span>
          <span className="text-muted-foreground">còn lại</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn(
              "h-full rounded-full",
              left <= 10 ? "bg-destructive" : left <= 30 ? "bg-warning" : "bg-foreground/60",
            )}
            style={{ width: `${(1 - share) * 100}%` }}
          />
        </div>
        <div className="text-right text-xs text-muted-foreground">{detail}</div>
      </div>
    </Card>
  );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border px-5 py-4", className)}>{children}</div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function untilText(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "ngay bây giờ";
  const minutes = Math.round(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `sau ${days} ngày ${hours} giờ`;
  if (hours > 0) return `sau ${hours} giờ ${mins} phút`;
  return `sau ${mins} phút`;
}
