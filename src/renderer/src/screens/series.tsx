import { boardOrder } from "@shared/board";
import type { Asset, Series, Session } from "@shared/ipc";
import type { SeriesModels } from "@shared/models";
import {
  GUIDE_LENGTH_CHOICES,
  GUIDE_SLOT_LABEL,
  GUIDE_SLOTS,
  type GuideSlot,
  guideFromText,
  PRODUCT_MENTION_LABEL,
  PRODUCT_MENTIONS,
  type SeriesGuide,
} from "@shared/series-guide";
import { Link, useParams } from "@tanstack/react-router";
import { Ellipsis, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  AssetThumb,
  SeriesAssetFields,
  type SeriesAssetIds,
  thumbShape,
} from "@/components/asset-picker";
import { Composer } from "@/components/composer";
import { DeleteSeriesDialog } from "@/components/delete-series-dialog";
import { useProductMention } from "@/components/mention-picker";
import { ModelsChip } from "@/components/models-chip";
import { NotesList } from "@/components/notes-list";
import { Page } from "@/components/page";
import {
  bookendChanges,
  SeriesBookendFields,
  unchangedBookends,
} from "@/components/series-bookends";
import { SeriesDirection } from "@/components/series-direction";
import { SeriesMaterial } from "@/components/series-material";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@/components/ui/menu";
import { SettingChip } from "@/components/ui/setting-chip";
import { Textarea } from "@/components/ui/textarea";
import { SeriesOutputFields } from "@/components/video-model-menu";
import { useCreateActions } from "@/lib/actions";
import { api } from "@/lib/api";
import { useBoard } from "@/lib/board";
import { useDraft } from "@/lib/drafts";
import { errorMessage } from "@/lib/errors";
import { useMaterial } from "@/lib/material";
import { onSeriesFocusRequest, takeSeriesFocus } from "@/lib/series-focus";
import { cn } from "@/lib/utils";
import { refreshWorkspace, useWorkspace } from "@/lib/workspace";
import { NotFound } from "./not-found";

const VISIBLE_SESSIONS = 8;

export function SeriesPage() {
  const { seriesId } = useParams({ from: "/series/$seriesId" });
  return <SeriesView key={seriesId} seriesId={seriesId} />;
}

function SeriesView({ seriesId }: { seriesId: string }) {
  const workspace = useWorkspace();
  const { createSession } = useCreateActions();
  const [request, setRequest, clearRequest] = useDraft(`series-request:${seriesId}`, "");
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () =>
      onSeriesFocusRequest(() => {
        if (!takeSeriesFocus(seriesId)) return;
        requestAnimationFrame(() => input.current?.focus());
      }),
    [seriesId],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [caret, setCaret] = useState(0);
  const series = workspace.series.find((s) => s.id === seriesId);
  const material = useMaterial(seriesId);
  const hasMaterial = material.length > 0;
  const [chosenTab, setTab] = useDraft<SeriesTab>(`series-tab:${seriesId}`, "recent");
  const tab = hasMaterial ? chosenTab : "recent";
  const mention = useProductMention({
    text: request,
    caret,
    onText: (next, at) => {
      setRequest(next);
      setCaret(at);
    },
    input,
    seriesProductIds: series?.productIds ?? [],
  });
  if (!series) return <NotFound />;

  const sessions = workspace.sessions
    .filter((s) => s.seriesId === series.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const setModels = async (models: SeriesModels) => {
    setError(null);
    try {
      await api.invoke("series:update", { id: series.id, models });
      await refreshWorkspace();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createSession(series.id, request);
      clearRequest();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page className="max-w-3xl">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{series.name}</h1>
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost-muted" size="icon" aria-label="Tùy chọn series" />}
          >
            <Ellipsis />
          </MenuTrigger>
          <MenuPopup>
            <MenuItem onClick={() => setEditing(true)}>
              <Pencil />
              Sửa
            </MenuItem>
            <MenuItem destructive onClick={() => setDeleting(true)}>
              <Trash2 />
              Xóa
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <SeriesDirection series={series} onEdit={() => setEditing(true)} />

      <div className="relative">
        <Composer
          textareaRef={input}
          onCaret={setCaret}
          onTextKeyDown={mention.keys}
          value={request}
          onChange={setRequest}
          onSubmit={start}
          busy={busy}
          rows={2}
          autoFocus
          placeholder="Hôm nay làm video gì? Ví dụ: 5 video về sự kiên nhẫn"
          submitLabel="Tạo video"
        >
          <SeriesAssetSummary series={series} onEdit={() => setEditing(true)} />
          <ModelsChip value={series.models} onChange={setModels} />
        </Composer>
        {mention.popup("inset-x-0", true)}
      </div>
      {error && <p className="mt-2 px-1 text-destructive-foreground">{error}</p>}

      {hasMaterial && (
        <section className="mt-8">
          <SeriesTabs seriesId={series.id} tab={tab} onTab={setTab} />
          <div role="tabpanel" id={`${seriesId}-${tab}`} aria-labelledby={`${seriesId}-${tab}-tab`}>
            {tab === "recent" ? (
              <RecentSessions sessions={sessions} />
            ) : (
              <SeriesMaterial series={series} items={material} />
            )}
          </div>
        </section>
      )}

      {!hasMaterial && sessions.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 px-3 font-semibold">Gần đây</h2>
          <RecentSessions sessions={sessions} />
        </section>
      )}

      {tab === "recent" && series.notes?.length ? (
        <section className="mt-8">
          <h2 className="mb-1 px-3 font-semibold">Ghi nhớ</h2>
          <NotesList notes={series.notes} />
        </section>
      ) : null}

      <EditSeriesDialog series={series} open={editing} onOpenChange={setEditing} />
      <DeleteSeriesDialog series={series} open={deleting} onOpenChange={setDeleting} />
    </Page>
  );
}

type SeriesTab = "recent" | "material";

const SERIES_TABS: { id: SeriesTab; label: string }[] = [
  { id: "recent", label: "Gần đây" },
  { id: "material", label: "Tư liệu" },
];

function SeriesTabs({
  seriesId,
  tab,
  onTab,
}: {
  seriesId: string;
  tab: SeriesTab;
  onTab: (tab: SeriesTab) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const switchTab = () => {
    const other: SeriesTab = tab === "recent" ? "material" : "recent";
    onTab(other);
    list.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${seriesId}-${other}-tab`)}`)
      ?.focus();
  };
  return (
    <div
      ref={list}
      role="tablist"
      className="mb-1 flex gap-4 px-3"
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        switchTab();
        e.preventDefault();
      }}
    >
      {SERIES_TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`${seriesId}-${id}-tab`}
          aria-selected={tab === id}
          aria-controls={`${seriesId}-${id}`}
          tabIndex={tab === id ? 0 : -1}
          className={cn(
            "cursor-pointer rounded-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onTab(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RecentSessions({ sessions }: { sessions: Session[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? sessions : sessions.slice(0, VISIBLE_SESSIONS);
  return (
    <>
      {visible.map((session, i) => (
        <SessionRow
          key={session.id}
          session={session}
          showDate={dayLabel(visible[i - 1]?.createdAt) !== dayLabel(session.createdAt)}
        />
      ))}
      {sessions.length > VISIBLE_SESSIONS && (
        <button
          type="button"
          className="cursor-pointer px-3 py-2.5 text-muted-foreground hover:text-foreground"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Thu gọn" : "Xem thêm"}
        </button>
      )}
    </>
  );
}

const MAX_PRODUCT_THUMBS = 4;

function SeriesAssetSummary({ series, onEdit }: { series: Series; onEdit: () => void }) {
  const assets = useWorkspace().assets;
  const pick = (ids: string[] | undefined) =>
    (ids ?? []).flatMap((id) => assets.find((a) => a.id === id) ?? []);
  const characters = pick(series.characterIds);
  const products = pick(series.productIds);
  const environments = pick(series.environmentIds);
  const all = [...characters, ...products, ...environments];

  if (all.length === 0) {
    return (
      <Button variant="ghost-muted" size="sm" onClick={onEdit}>
        <Plus />
        Nhân vật, sản phẩm, bối cảnh
      </Button>
    );
  }

  const group = (list: Asset[], max = list.length) =>
    list.length > 0 && (
      <span className="flex items-center gap-1">
        {list.slice(0, max).map((asset) => (
          <AssetThumb key={asset.id} asset={asset} className={thumbShape(asset.kind, "md")} />
        ))}
        {list.length > max && (
          <span className="grid h-7 min-w-7 place-items-center rounded-md bg-muted px-1.5 text-2xs text-muted-foreground">
            +{list.length - max}
          </span>
        )}
      </span>
    );

  return (
    <button
      type="button"
      className="flex cursor-pointer items-center gap-3 rounded-[var(--control-radius)] p-1 hover:bg-accent"
      aria-label="Nhân vật, sản phẩm và bối cảnh của series"
      title={all.map((a) => a.name).join(", ")}
      onClick={onEdit}
    >
      {group(characters)}
      {group(products, MAX_PRODUCT_THUMBS)}
      {group(environments)}
    </button>
  );
}

function SessionRow({ session, showDate }: { session: Session; showDate: boolean }) {
  const board = useBoard(session.id);
  const scripts = board ? boardOrder(board.scripts) : [];
  const titles = scripts.map((s) => s.title).filter(Boolean);
  const writing = scripts.some((s) => s.status === "writing");
  const failed = scripts.filter((s) => s.status === "failed").length;
  const ready = scripts.length - failed;
  const needsYou = !session.approvedAt && !writing && ready > 0;

  let state: ReactNode = null;
  if (writing)
    state = (
      <>
        <LoaderCircle className="size-3.5 animate-spin" />
        Đang viết
      </>
    );
  else if (session.approvedAt) state = `Đã duyệt ${ready} kịch bản`;
  else if (ready > 0)
    state = (
      <>
        <span className="size-1.5 rounded-full bg-foreground" />
        Duyệt {ready} kịch bản
      </>
    );

  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: session.id }}
      className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-lg px-3 py-2.5 hover:bg-accent"
    >
      <span className="text-xs text-muted-foreground">
        {showDate && dayLabel(session.createdAt)}
      </span>
      <span className={cn("truncate", needsYou && "font-medium")}>
        {titles.length > 0 ? titles.join(" · ") : session.request || session.name}
      </span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs whitespace-nowrap",
          needsYou ? "font-medium" : "text-muted-foreground",
        )}
      >
        {state}
        {failed > 0 && <span className="text-destructive-foreground">· {failed} lỗi</span>}
      </span>
    </Link>
  );
}

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function dayLabel(iso: string | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(date)) / 86_400_000);
  if (days === 0) return "Hôm nay";
  if (days === 1) return "Hôm qua";
  const dm = `${date.getDate()}/${date.getMonth() + 1}`;
  if (date.getFullYear() !== new Date().getFullYear()) return `${dm}/${date.getFullYear() % 100}`;
  return `${WEEKDAYS[date.getDay()]} ${dm}`;
}

function EditSeriesDialog({
  series,
  open,
  onOpenChange,
}: {
  series: Series;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-5xl">
        <EditSeriesForm series={series} onDone={() => onOpenChange(false)} />
      </DialogPopup>
    </Dialog>
  );
}

function EditSeriesForm({ series, onDone }: { series: Series; onDone: () => void }) {
  const [name, setName] = useState(series.name);
  const [startGuide] = useState(() => series.guide ?? guideFromText(series.guidance));
  const [lines, setLines] = useState(() => guideTexts(startGuide));
  const [productMention, setProductMention] = useState(startGuide.productMention);
  const [targetSec, setTargetSec] = useState(startGuide.targetSec);
  const [assets, setAssets] = useState<SeriesAssetIds>({
    characterIds: series.characterIds ?? [],
    productIds: series.productIds ?? [],
    environmentIds: series.environmentIds ?? [],
  });
  const [models, setModels] = useState<SeriesModels>(series.models ?? {});
  const [bookends, setBookends] = useState(unchangedBookends);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const save = async () => {
    const start = guideTexts(startGuide);
    const changedBookends = bookendChanges(bookends);
    try {
      await api.invoke("series:update", {
        id: series.id,
        name,
        guide: {
          lines: Object.fromEntries(
            GUIDE_SLOTS.flatMap((slot) =>
              lines[slot] === start[slot] ? [] : [[slot, lines[slot]]],
            ),
          ),
          ...(productMention !== startGuide.productMention ? { productMention } : {}),
          ...(targetSec !== startGuide.targetSec ? { targetSec } : {}),
          confirm: true,
        },
        ...assets,
        models,
        ...(changedBookends ? { bookends: changedBookends } : {}),
      });
      await refreshWorkspace();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Sửa series</DialogTitle>
      </DialogHeader>
      <div className="grid min-h-0 gap-x-8 gap-y-5 overflow-y-auto p-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-name`} className="text-xs font-medium">
              Tên
            </label>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-xs font-medium">Định hướng</legend>
            <div className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
              {GUIDE_SLOTS.map((slot) => (
                <div key={slot} className="contents">
                  <label
                    htmlFor={`${id}-${slot}`}
                    className="pt-2 text-xs leading-tight text-muted-foreground"
                  >
                    {GUIDE_SLOT_LABEL[slot]}
                  </label>
                  <Textarea
                    id={`${id}-${slot}`}
                    value={lines[slot]}
                    rows={1}
                    className="field-sizing-content max-h-[30vh] min-h-0"
                    onChange={(e) => setLines({ ...lines, [slot]: e.target.value })}
                  />
                </div>
              ))}
              <div className="col-start-2 flex flex-wrap gap-1.5">
                {assets.productIds.length > 0 && (
                  <ChoiceChip
                    label="Sản phẩm"
                    value={productMention}
                    choices={PRODUCT_MENTIONS.map((m) => ({
                      value: m,
                      label: PRODUCT_MENTION_LABEL[m],
                    }))}
                    onChange={setProductMention}
                  />
                )}
                <ChoiceChip
                  label="Độ dài"
                  value={targetSec}
                  choices={lengthChoices(targetSec).map((sec) => ({
                    value: sec,
                    label: `${sec} giây`,
                  }))}
                  onChange={setTargetSec}
                />
              </div>
            </div>
          </fieldset>
        </div>
        <div className="flex min-w-0 flex-col gap-5 md:border-l md:pl-8">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-xs font-medium">Thành phần</legend>
            <SeriesAssetFields value={assets} onChange={setAssets} />
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-xs font-medium">Video</legend>
            <SeriesOutputFields models={models} onModels={setModels} />
            <SeriesBookendFields
              seriesId={series.id}
              saved={series.bookends}
              value={bookends}
              onChange={setBookends}
              onError={setError}
            />
          </fieldset>
          {error && <p className="text-destructive-foreground">{error}</p>}
        </div>
      </div>
      <DialogFooter className="justify-end">
        <DialogClose render={<Button variant="ghost" />}>Hủy</DialogClose>
        <Button disabled={!name.trim()} onClick={save}>
          Lưu
        </Button>
      </DialogFooter>
    </>
  );
}

function guideTexts(guide: SeriesGuide): Record<GuideSlot, string> {
  return Object.fromEntries(
    GUIDE_SLOTS.map((slot) => [slot, guide.lines[slot]?.text ?? ""]),
  ) as Record<GuideSlot, string>;
}

function lengthChoices(current: number): number[] {
  const offered: number[] = [...GUIDE_LENGTH_CHOICES];
  return offered.includes(current) ? offered : [...offered, current].sort((a, b) => a - b);
}

function ChoiceChip<T extends string | number>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <SettingChip
            label={label}
            value={choices.find((c) => c.value === value)?.label ?? String(value)}
          />
        }
      />
      <MenuPopup align="start">
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {choices.map((choice) => (
            <MenuRadioItem key={choice.value} value={choice.value}>
              {choice.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
