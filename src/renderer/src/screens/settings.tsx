import type {
  AiStatus,
  AppInfo,
  ClaudeCodeStatus,
  DevProfile,
  DevProfiles,
  ProviderId,
  ProviderStatus,
  ProvidersInfo,
  TextProvider,
  ThemePreference,
} from "@shared/ipc";
import { LoaderCircle, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { DeleteProfileDialog } from "@/components/delete-profile-dialog";
import { NotesList } from "@/components/notes-list";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { refreshChatInfo } from "@/lib/chat";
import { useClaudeInstall } from "@/lib/claude-setup";
import { useTheme } from "@/lib/theme";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { setNativeVoice, useNativeVoice } from "@/lib/voice-mode";
import { useWorkspace } from "@/lib/workspace";

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
  const notes = useWorkspace().notes ?? [];
  const { error, run } = useAction();

  const load = useCallback(
    () =>
      run(async () => {
        const [app, keys] = await Promise.all([
          api.invoke("app:info"),
          api.invoke("providers:status"),
        ]);
        setInfo(app);
        setProviders(keys);
      }),
    [run],
  );
  useEffect(() => {
    void load();
  }, [load]);

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

      {notes.length > 0 && (
        <Section title="Ghi nhớ cho mọi series">
          <div className="-mx-3">
            <NotesList notes={notes} />
          </div>
        </Section>
      )}

      <Section title="Khóa API">
        {error && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-destructive-foreground">{error}</span>
            <Button variant="ghost-muted" size="sm" onClick={load}>
              Thử lại
            </Button>
          </div>
        )}
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => run(() => api.invoke("app:open-data-dir"))}
            >
              Mở thư mục
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Phiên bản {info.version}</p>
        </Section>
      )}

      <DevProfilesSection />
      <TrialSection />
    </Page>
  );
}

function DevProfilesSection() {
  const [state, setState] = useState<DevProfiles | null>(null);
  const [name, setName] = useState("");
  const [switching, setSwitching] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DevProfile | null>(null);
  const { error, run } = useAction();

  useEffect(() => {
    void run(async () => setState(await api.invoke("dev:profiles")));
  }, [run]);

  if (!state) return null;

  const switchTo = async (id: string) => {
    setSwitching(id);
    if (!(await run(() => api.invoke("dev:switch-profile", id)))) setSwitching(null);
  };

  return (
    <Section title="Hồ sơ thử nghiệm">
      {state.fixed ? (
        <p className="text-muted-foreground">Thư mục dữ liệu do HYAN_DATA_DIR đặt.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {state.profiles.map((profile) => (
              <div key={profile.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={profile.active}
                  disabled={profile.active || switching !== null}
                  onClick={() => void switchTo(profile.id)}
                  className={cn(
                    "flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left disabled:cursor-default",
                    profile.active ? "border-ring bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                  {profile.active && (
                    <span className="text-xs text-muted-foreground">Đang dùng</span>
                  )}
                  {switching === profile.id && (
                    <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                  )}
                </button>
                {!profile.isDefault && !profile.active && (
                  <Button
                    variant="ghost-muted"
                    size="icon-sm"
                    aria-label={`Xóa ${profile.name}`}
                    title="Xóa"
                    disabled={switching !== null}
                    onClick={() => setDeleting(profile)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                setState(await api.invoke("dev:create-profile", name));
                setName("");
              });
            }}
          >
            <Input placeholder="Tên hồ sơ" value={name} onValueChange={setName} />
            <Button type="submit" variant="outline" disabled={!name.trim() || switching !== null}>
              Tạo
            </Button>
          </form>
        </>
      )}
      {error && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>}
      <DeleteProfileDialog
        profile={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onDeleted={setState}
      />
    </Section>
  );
}

function TrialSection() {
  const native = useNativeVoice();
  const { error, run } = useAction();
  if (native === null) return null;
  return (
    <Section title="Thử nghiệm">
      <Checkbox
        checked={native}
        onChange={(event) => {
          const on = event.currentTarget.checked;
          void run(() => setNativeVoice(on));
        }}
      >
        Video tự tạo giọng nói
      </Checkbox>
      {error && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>}
    </Section>
  );
}

function TextAiSection() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const { error, run } = useAction();
  const installer = useClaudeInstall(
    useCallback(
      (claudeCode: ClaudeCodeStatus) =>
        setStatus((current) => current && { ...current, claudeCode }),
      [],
    ),
  );

  const refresh = useCallback(async () => {
    setChecking(true);
    await run(async () => setStatus(await api.invoke("ai:status")));
    setChecking(false);
  }, [run]);
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
              onClick={() =>
                run(async () => {
                  setStatus(await api.invoke("ai:set-text-provider", option.value));
                  void refreshChatInfo();
                })
              }
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
        {!ccReady &&
          (cc.installed ? (
            <Button size="sm" onClick={() => void api.invoke("ai:open-terminal", "login")}>
              Đăng nhập Claude
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={installer.installing}
              onClick={() => void installer.install()}
            >
              {installer.installing && <LoaderCircle className="animate-spin" />}
              {installer.installing ? "Đang cài…" : "Cài Claude"}
            </Button>
          ))}
        {!cc.installed && installer.error && (
          <Button variant="outline" size="sm" onClick={installer.openTerminal}>
            Mở Terminal để cài
          </Button>
        )}
        <Button variant="ghost-muted" size="sm" onClick={refresh} disabled={checking}>
          {checking ? "Đang kiểm tra…" : "Kiểm tra lại"}
        </Button>
      </div>
      {!cc.installed && installer.error && (
        <p className="mt-2 text-xs text-destructive-foreground">{installer.error}</p>
      )}
      {errorLine}
    </Section>
  );
}

function ProviderKeyRow(props: {
  id: ProviderId;
  source: ProviderStatus["source"];
  canStore: boolean;
  onChange: (info: ProvidersInfo) => void;
}) {
  const [value, setValue] = useState("");
  const { error, run } = useAction();

  const save = () =>
    run(async () => {
      props.onChange(await api.invoke("providers:set-key", props.id, value));
      setValue("");
    });

  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex-1 font-medium">{PROVIDER_NAMES[props.id]}</span>
        <span className="text-xs text-muted-foreground">
          {props.source === "env"
            ? "Đã cấu hình (.env.local)"
            : props.source === "stored"
              ? "Đã lưu"
              : props.source === "bundled"
                ? "Có sẵn"
                : "Chưa cấu hình"}
        </span>
        {props.source === "stored" && (
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={() =>
              run(async () => props.onChange(await api.invoke("providers:clear-key", props.id)))
            }
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
