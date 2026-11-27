import type {
  AiStatus,
  AppInfo,
  ClaudeCodeStatus,
  DevProfile,
  DevProfiles,
  ProductKeyStatus,
  ThemePreference,
} from "@shared/ipc";
import { LoaderCircle, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { DeleteProfileDialog } from "@/components/delete-profile-dialog";
import { NotesList } from "@/components/notes-list";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useClaudeInstall } from "@/lib/claude-setup";
import { useTheme } from "@/lib/theme";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Sáng" },
  { value: "dark", label: "Tối" },
  { value: "system", label: "Theo hệ thống" },
];

export function SettingsPage() {
  const { preference, setPreference } = useTheme();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const notes = useWorkspace().notes ?? [];
  const { run } = useAction();
  const devFeatures = info?.devFeatures === true;

  useEffect(() => {
    void run(async () => setInfo(await api.invoke("app:info")));
  }, [run]);

  return (
    <Page className="max-w-2xl">
      <Tabs defaultValue="general">
        <h1 className="mb-4 text-2xl font-semibold">Cài đặt</h1>
        <TabsList className="mb-8">
          <TabsTab value="general">Chung</TabsTab>
          <TabsTab value="system">Hệ thống</TabsTab>
          {devFeatures && <TabsTab value="developer">Nhà phát triển</TabsTab>}
        </TabsList>

        <TabsPanel value="general">
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

          <ProductKeySection />

          <TextAiSection />

          {notes.length > 0 && (
            <Section title="Ghi nhớ cho mọi series">
              <div className="-mx-3">
                <NotesList notes={notes} />
              </div>
            </Section>
          )}

          <ShareSetupSection />
        </TabsPanel>

        <TabsPanel value="system">
          <ProblemReportSection />

          <ActivityExportSection />

          {info && (
            <Section title="Dữ liệu">
              <div className="flex items-center gap-3">
                <code
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                  data-selectable
                >
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
        </TabsPanel>

        {devFeatures && (
          <TabsPanel value="developer">
            <ProviderModeSection />

            <DevProfilesSection />
          </TabsPanel>
        )}
      </Tabs>
    </Page>
  );
}

function ProviderModeSection() {
  const [status, setStatus] = useState<ProductKeyStatus | null>(null);
  const { error, run } = useAction();

  useEffect(() => {
    void run(async () => setStatus(await api.invoke("product-key:status")));
  }, [run]);

  return (
    <Section title="Chế độ">
      {status && (
        <p className="text-muted-foreground">
          {status.mode === "fixture"
            ? "Chế độ thử: dùng kết quả mẫu, không gọi API trả phí."
            : "Gọi API thật: mỗi lần tạo có thể tốn phí."}
        </p>
      )}
      {error && <p className="text-xs text-destructive-foreground">{error}</p>}
    </Section>
  );
}

function importOutcome(added: { series: number; assets: number; skipped: number }): string {
  if (added.series === 0 && added.assets === 0) return "Mọi thứ trong tệp đã có sẵn.";
  const kept = added.skipped > 0 ? ` ${added.skipped} mục đã có, giữ nguyên.` : "";
  return `Đã thêm ${added.series} series, ${added.assets} mục thư viện.${kept}`;
}

function ShareSetupSection() {
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const { error, run } = useAction();
  const empty = ws.series.length === 0 && ws.assets.length === 0;

  const act = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setOutcome(null);
    await run(async () => setOutcome(await action()));
    setBusy(false);
  };
  const exportSetup = () =>
    act(async () => {
      await api.invoke("setup:export");
      return "Đã lưu vào thư mục Tải về.";
    });
  const importSetup = () =>
    act(async () => {
      const added = await api.invoke("setup:import");
      return added ? importOutcome(added) : null;
    });

  return (
    <Section title="Chia sẻ thiết lập">
      <p className="mb-3 text-muted-foreground">Series và thư viện, không gồm video.</p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || empty}
          onClick={() => void exportSetup()}
        >
          Xuất
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void importSetup()}>
          Nhập
        </Button>
      </div>
      {outcome && <p className="mt-2 text-xs text-muted-foreground">{outcome}</p>}
      {error && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>}
    </Section>
  );
}

function ProblemReportSection() {
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState(false);
  const { error, run } = useAction();

  const create = async () => {
    setCreating(true);
    setSaved(false);
    setSaved(await run(() => api.invoke("app:problem-report")));
    setCreating(false);
  };

  return (
    <Section title="Báo lỗi">
      <Button variant="outline" size="sm" disabled={creating} onClick={() => void create()}>
        Tạo tệp báo lỗi
      </Button>
      {saved && <p className="mt-2 text-xs text-muted-foreground">Đã lưu vào thư mục Tải về.</p>}
      {error && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>}
    </Section>
  );
}

function ActivityExportSection() {
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(false);
  const { error, run } = useAction();

  const exportActivity = async () => {
    setExporting(true);
    setSaved(false);
    setSaved(await run(() => api.invoke("app:activity-export")));
    setExporting(false);
  };

  return (
    <Section title="Dữ liệu sử dụng">
      <p className="mb-3 text-xs text-muted-foreground">
        Gồm thao tác, yêu cầu, kịch bản, chi phí và lỗi. Không gồm ảnh hay video.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={exporting}
        onClick={() => void exportActivity()}
      >
        Xuất dữ liệu sử dụng
      </Button>
      {saved && <p className="mt-2 text-xs text-muted-foreground">Đã lưu vào thư mục Tải về.</p>}
      {error && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>}
    </Section>
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
  const claudeState = ccReady
    ? `Claude Code ${cc.version ?? ""} đã đăng nhập${cc.plan ? ` · gói ${cc.plan.charAt(0).toUpperCase()}${cc.plan.slice(1)}` : ""}.`
    : cc.installed
      ? "Claude Code đã cài nhưng chưa đăng nhập."
      : "Chưa cài Claude Code trên máy này.";

  return (
    <Section title="AI viết văn bản">
      <p className="text-muted-foreground" data-selectable>
        {claudeState}
      </p>
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

function ProductKeySection() {
  const [status, setStatus] = useState<ProductKeyStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { error: loadError, run } = useAction();

  const load = useCallback(
    () => run(async () => setStatus(await api.invoke("product-key:status"))),
    [run],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const close = () => {
    setEditing(false);
    setValue("");
    setSaveError(null);
  };
  const save = async () => {
    setSaving(true);
    setSaveError(null);
    await run(async () => {
      const saved = await api.invoke("product-key:save", value);
      if (!saved.ok) {
        setSaveError(saved.error);
        return;
      }
      setStatus(saved.status);
      close();
    });
    setSaving(false);
  };

  return (
    <Section title="Mã sản phẩm">
      {loadError && !status && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-destructive-foreground">{loadError}</span>
          <Button variant="ghost-muted" size="sm" onClick={load}>
            Thử lại
          </Button>
        </div>
      )}
      {status && (
        <div className="rounded-lg border px-4 py-3">
          <div className="flex items-center gap-3">
            <span className={cn("flex-1 tabular-nums", !status.tail && "text-muted-foreground")}>
              {status.tail ?? "Chưa nhập"}
            </span>
            {status.source !== "env" && !editing && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {status.present ? "Đổi mã" : "Nhập mã"}
              </Button>
            )}
          </div>
          {editing && status.source !== "env" && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Input
                type="password"
                placeholder="Dán mã sản phẩm"
                value={value}
                onValueChange={setValue}
                autoComplete="off"
                autoFocus
              />
              <Button type="submit" variant="outline" disabled={saving || !value.trim()}>
                {saving && <LoaderCircle className="animate-spin" />}
                Lưu
              </Button>
              <Button type="button" variant="ghost-muted" disabled={saving} onClick={close}>
                Hủy
              </Button>
            </form>
          )}
          {(saveError ?? loadError) && (
            <p className="mt-2 text-xs text-destructive-foreground">{saveError ?? loadError}</p>
          )}
        </div>
      )}
    </Section>
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
