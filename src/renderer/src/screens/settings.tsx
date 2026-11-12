import type {
  AiStatus,
  AppInfo,
  ProviderId,
  ProvidersInfo,
  TextProvider,
  ThemePreference,
} from "@shared/ipc";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { refreshChatInfo } from "@/lib/chat";
import { errorMessage } from "@/lib/errors";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Sáng" },
  { value: "dark", label: "Tối" },
  { value: "system", label: "Theo hệ thống" },
];

const PROVIDER_NAMES: Record<ProviderId, string> = {
  fal: "fal.ai",
  "fal-billing": "fal.ai · xem số dư (không bắt buộc)",
  elevenlabs: "ElevenLabs",
};

export function SettingsPage() {
  const { preference, setPreference } = useTheme();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [providers, setProviders] = useState<ProvidersInfo | null>(null);

  useEffect(() => {
    void api.invoke("app:info").then(setInfo);
    void api.invoke("providers:status").then(setProviders);
  }, []);

  return (
    <Page className="max-w-2xl">
      <h1 className="mb-8 text-2xl font-semibold">Cài đặt</h1>

      <Section title="Giao diện">
        <fieldset className="inline-flex rounded-lg border p-0.5">
          <legend className="sr-only">Giao diện</legend>
          {THEMES.map((theme) => (
            <button
              key={theme.value}
              type="button"
              aria-pressed={preference === theme.value}
              onClick={() => setPreference(theme.value)}
              className={cn(
                "rounded-md px-3 py-1 text-muted-foreground",
                preference === theme.value && "bg-accent text-foreground",
              )}
            >
              {theme.label}
            </button>
          ))}
        </fieldset>
      </Section>

      <TextAiSection />

      <Section title="Khóa API">
        {providers && (
          <>
            <p className="mb-4 text-muted-foreground">
              {providers.mode === "fixture"
                ? "Chế độ thử: dùng kết quả mẫu, không gọi API trả phí."
                : "Gọi API thật: mỗi lần tạo có thể tốn phí."}
            </p>
            <div className="flex flex-col gap-3">
              {providers.providers.map((p) => (
                <ProviderKeyRow
                  key={p.id}
                  id={p.id}
                  source={p.source}
                  canStore={providers.canStoreKeys}
                  onChange={setProviders}
                />
              ))}
            </div>
          </>
        )}
      </Section>

      {info && (
        <Section title="Dữ liệu">
          <div className="flex items-center gap-3">
            <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground" data-selectable>
              {info.dataDir}
            </code>
            <Button variant="outline" size="sm" onClick={() => api.invoke("app:open-data-dir")}>
              Mở thư mục
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Phiên bản {info.version}</p>
        </Section>
      )}
    </Page>
  );
}

/**
 * Which AI writes text (descriptions now; scripts and orchestration later).
 * Claude Code runs the user's own installed and signed-in CLI. We never sign in
 * on the user's behalf: Anthropic's terms require their own sign-in flow.
 */
function TextAiSection() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setStatus(await api.invoke("ai:status"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const errorLine = error && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>;
  if (!status) {
    if (!error) return null;
    return (
      <Section title="AI viết văn bản">
        <Button variant="ghost-muted" size="sm" onClick={refresh} disabled={checking}>
          {checking ? "Đang kiểm tra…" : "Kiểm tra lại"}
        </Button>
        {errorLine}
      </Section>
    );
  }
  const cc = status.claudeCode;
  const ccReady = cc.installed && cc.loggedIn;
  const options: { value: TextProvider; label: string; detail: string; disabled?: boolean }[] = [
    {
      value: "fal",
      label: "fal.ai",
      detail: "Dùng khóa fal ở trên. Mỗi lần gọi tính phí nhỏ vào tài khoản fal.",
    },
    {
      value: "claude-code",
      label: "Claude trên máy này",
      detail: ccReady
        ? `Claude Code ${cc.version ?? ""} đã đăng nhập${cc.plan ? ` · gói ${cc.plan.charAt(0).toUpperCase()}${cc.plan.slice(1)}` : ""}. Tính vào gói Claude của bạn.`
        : cc.installed
          ? "Claude Code đã cài nhưng chưa đăng nhập."
          : "Chưa cài Claude Code trên máy này.",
      disabled: !ccReady,
    },
  ];

  return (
    <Section title="AI viết văn bản">
      <p className="mb-3 text-muted-foreground">
        Dùng để mô tả ảnh, viết kịch bản và trả lời trong khung chat.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">AI viết văn bản</legend>
        {options.map((option) => {
          const selected = status.textProvider === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={option.disabled && !selected}
              onClick={async () => {
                setError(null);
                try {
                  setStatus(await api.invoke("ai:set-text-provider", option.value));
                  void refreshChatInfo();
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
              className={cn(
                "flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left disabled:cursor-default",
                selected ? "border-ring bg-accent" : "hover:bg-accent/50",
              )}
            >
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground" data-selectable>
                {option.detail}
              </span>
            </button>
          );
        })}
      </fieldset>
      <div className="mt-2 flex gap-1.5">
        {!ccReady && (
          <Button
            size="sm"
            onClick={() => void api.invoke("ai:open-terminal", cc.installed ? "login" : "install")}
          >
            {cc.installed ? "Đăng nhập Claude" : "Cài Claude"}
          </Button>
        )}
        <Button variant="ghost-muted" size="sm" onClick={refresh} disabled={checking}>
          {checking ? "Đang kiểm tra…" : "Kiểm tra lại"}
        </Button>
      </div>
      {errorLine}
    </Section>
  );
}

function ProviderKeyRow(props: {
  id: ProviderId;
  source: "env" | "stored" | null;
  canStore: boolean;
  onChange: (info: ProvidersInfo) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      props.onChange(await api.invoke("providers:set-key", props.id, value));
      setValue("");
      setError(null);
    } catch {
      setError("Không lưu được khóa.");
    }
  };

  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex-1 font-medium">{PROVIDER_NAMES[props.id]}</span>
        <span className="text-xs text-muted-foreground">
          {props.source === "env"
            ? "Đã cấu hình (.env.local)"
            : props.source === "stored"
              ? "Đã lưu"
              : "Chưa cấu hình"}
        </span>
        {props.source === "stored" && (
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={async () => props.onChange(await api.invoke("providers:clear-key", props.id))}
          >
            Xóa
          </Button>
        )}
      </div>
      {props.source !== "env" && props.canStore && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            type="password"
            placeholder={props.source === "stored" ? "Thay khóa" : "Dán khóa API"}
            value={value}
            onValueChange={setValue}
            autoComplete="off"
          />
          <Button type="submit" variant="outline" disabled={!value.trim()}>
            Lưu
          </Button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}
