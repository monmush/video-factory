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

/** Live balances and plan limits of the app's AI providers. */
export function UsageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl">
        {open && <BalancesContent onNavigate={() => onOpenChange(false)} />}
      </DialogPopup>
    </Dialog>
  );
}

function BalancesContent({ onNavigate }: { onNavigate: () => void }) {
  const [data, setData] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.invoke("usage:balances"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <DialogHeader className="flex-row items-center gap-2 pr-14">
        <DialogTitle className="flex-1">Số dư và hạn mức</DialogTitle>
        {data && (
          <span className="text-xs text-muted-foreground">Cập nhật {time(data.checkedAt)}</span>
        )}
        <Button
          variant="ghost-muted"
          size="icon-sm"
          aria-label="Làm mới"
          title="Làm mới"
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </DialogHeader>

      {error && (
        <p className="px-6 pt-4 text-center text-destructive-foreground">
          Không kiểm tra được: {error}
        </p>
      )}
      {!data ? (
        !error && <p className="px-6 py-10 text-center text-muted-foreground">Đang kiểm tra…</p>
      ) : (
        <div className="flex min-h-0 flex-col gap-8 overflow-y-auto px-6 py-6">
          <Section title="fal.ai" hint="Tạo ảnh và video. Trả trước, trừ dần theo mỗi lần tạo.">
            <Status result={data.fal} provider="fal" onNavigate={onNavigate}>
              {(fal) => (
                <Card>
                  <div className="text-muted-foreground">Số dư</div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">
                    {fal.currency === "USD"
                      ? formatCost(fal.balance)
                      : `${fal.balance} ${fal.currency}`}
                  </div>
                </Card>
              )}
            </Status>
          </Section>

          <Section title="ElevenLabs" hint="Giọng đọc. Hạn mức theo gói, đặt lại mỗi kỳ.">
            <Status result={data.elevenlabs} provider="elevenlabs" onNavigate={onNavigate}>
              {(el) => (
                <Meter
                  label={el.plan ? `Gói ${capitalize(el.plan)}` : "Hạn mức"}
                  used={el.limit > 0 ? el.used / el.limit : 0}
                  detail={`Còn ${(el.limit - el.used).toLocaleString("vi-VN")} / ${el.limit.toLocaleString("vi-VN")} credit${el.resetsAt ? ` · đặt lại ${untilText(el.resetsAt)}` : ""}`}
                />
              )}
            </Status>
          </Section>

          <Section
            title="Claude trên máy này"
            hint="Hạn mức của cả gói Claude, gồm cả lúc bạn dùng Claude ở nơi khác."
          >
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
                <p className="text-xs text-muted-foreground">
                  Claude không có API xem hạn mức; số liệu đến kèm mỗi lần ứng dụng gọi Claude. Lần
                  cuối: {dateTime(data.claude.capturedAt)}.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Chưa có số liệu. Hạn mức sẽ hiện sau lần đầu ứng dụng dùng Claude.
              </p>
            )}
          </Section>
        </div>
      )}
    </>
  );
}

/** Renders a balance, or explains why it is unavailable and how to fix it. */
function Status<T>({
  result,
  provider,
  onNavigate,
  children,
}: {
  result: BalanceResult<T>;
  provider: "fal" | "elevenlabs";
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
      {result.status === "no-key" && <>Chưa có khóa API. Thêm khóa trong {toSettings}.</>}
      {result.status === "no-permission" &&
        (provider === "fal" ? (
          <>
            Khóa fal hiện tại chỉ dùng để tạo, không được xem số dư. Tạo thêm một khóa loại{" "}
            <b className="font-medium text-foreground">Read-only</b> trên fal.ai (mục API Keys), rồi
            dán vào {toSettings} → “fal.ai · xem số dư”.
          </>
        ) : (
          <>Khóa ElevenLabs không có quyền xem gói. Kiểm tra quyền của khóa trong {toSettings}.</>
        ))}
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
        {/* The percentage is shown as text beside the bar; the bar is decoration. */}
        <div className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn(
              "h-full rounded-full",
              left <= 10 ? "bg-destructive" : left <= 30 ? "bg-warning" : "bg-primary",
            )}
            // Fill shows what is left, matching the large "x% còn lại" figure.
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

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

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
