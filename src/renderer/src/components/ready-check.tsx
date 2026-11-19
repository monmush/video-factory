import { batchMediaLevel, type OutputResolution } from "@shared/batch-settings";
import { boardOrder, estimateUsd, formatSeconds } from "@shared/board";
import { formatCost } from "@shared/credits";
import type { Asset, Script } from "@shared/ipc";
import { type MediaLevelId, mediaLevel } from "@shared/media-level";
import { findingLabel, placeFinding } from "@shared/place-check";
import { cutoutUsd } from "@shared/product-shot";
import { needsAttention, readyCheck, type ScriptCheck } from "@shared/ready-check";
import { DEFAULT_VIDEO_MODEL, fitResolution } from "@shared/video-models";
import { voiceById } from "@shared/voices";
import { ChevronDown, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "@/lib/api";
import { addRefs, requestChatFocus, useBoard } from "@/lib/board";
import { useAction } from "@/lib/use-action";
import { useWorkspace } from "@/lib/workspace";
import { AssetDialog } from "./asset-dialog";
import { AssetThumb } from "./asset-picker";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { ButtonPrice, HoldButton } from "./ui/hold-button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

/**
 * Whether the series needs new start frames (it has an environment with
 * photos), so estimates include them.
 */
export function useNeedsFrames(sessionId: string): boolean {
  const { sessions, series, assets } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const own = series.find((s) => s.id === session?.seriesId);
  return Boolean(own?.environmentIds.some((id) => assets.find((a) => a.id === id)?.images.length));
}

/** The series' places, for the warning about photos showing people or packaging. */
export function useSeriesPlaceIds(sessionId: string): string[] {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  return series.find((s) => s.id === session?.seriesId)?.environmentIds ?? [];
}

export function useBatchMediaLevel(sessionId: string): { id: MediaLevelId; inherited: boolean } {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  return batchMediaLevel(
    session,
    series.find((s) => s.id === session?.seriesId),
  );
}

function useBatchResolution(sessionId: string): OutputResolution {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const level = batchMediaLevel(
    session,
    series.find((s) => s.id === session?.seriesId),
  );
  return fitResolution(DEFAULT_VIDEO_MODEL, mediaLevel(level.id).output);
}

function useEstimateOpts(sessionId: string) {
  const { assets } = useWorkspace();
  const frames = useNeedsFrames(sessionId);
  const resolution = useBatchResolution(sessionId);
  const level = useBatchMediaLevel(sessionId).id;
  const placeIds = useSeriesPlaceIds(sessionId);
  const opts = { frames, model: DEFAULT_VIDEO_MODEL, resolution, level, placeIds };
  const estimate = (script: Pick<Script, "lines" | "productIds">) =>
    estimateUsd(script.lines, { ...opts, cutoutUsd: cutoutUsd(script.productIds, assets) });
  return { opts, estimate };
}

export interface Spend {
  extraUsd: number;
  extraCount: number;
  run: (ids: string[]) => Promise<unknown>;
}

/**
 * Making videos from a set of scripts. `needsCheck` says whether the ready
 * check must open first; otherwise the caller shows a hold button whose hold
 * calls `make`.
 */
export function useMakeVideos({
  sessionId,
  waiting,
  onStarted,
  approveOnly,
}: {
  sessionId: string;
  /** Writing or a chat turn is still running: the scripts may change. */
  waiting?: boolean;
  onStarted?: () => void | Promise<void>;
  /** The board's use: the dialog only approves scripts and sends them to the Video tab. */
  approveOnly?: boolean;
}) {
  const board = useBoard(sessionId);
  const { assets } = useWorkspace();
  const { opts, estimate } = useEstimateOpts(sessionId);
  const batch = { model: opts.model, resolution: opts.resolution, level: opts.level };
  const [scope, setScope] = useState<string[] | null>(null);
  const action = useAction();

  const checkFor = (ids: string[]) =>
    board ? readyCheck(board.scripts, ids, assets, null, opts) : null;

  const needsCheck = (ids: string[]) => {
    const check = checkFor(ids);
    return !check || needsAttention(check) || check.toMake.length === 0;
  };

  const open = (ids: string[]) => {
    action.clear();
    setScope(ids);
  };

  const close = () => setScope(null);

  const make = async (ids: string[]) => {
    const check = checkFor(ids);
    if (!check || waiting) return;
    if (needsAttention(check) || check.toMake.length === 0) {
      open(ids);
      return;
    }
    const ok = await action.run(() =>
      api.invoke(
        "session:approve",
        sessionId,
        check.toMake.map((c) => c.script.id),
      ),
    );
    if (ok) await action.run(async () => onStarted?.());
  };

  const dialog = (
    <ReadyCheckDialog
      sessionId={sessionId}
      scope={scope ?? []}
      waiting={waiting}
      approveOnly={approveOnly}
      open={scope !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      onApproved={() => onStarted?.()}
    />
  );

  return {
    needsCheck,
    open,
    close,
    scope,
    make,
    error: action.error,
    estimate,
    level: opts.level,
    batch,
    dialog,
  };
}

/**
 * `remaining`: some scripts on the board already have videos, so the label
 * says which this makes ("video #2", "2 video còn lại"); `number` is the
 * board number of the one script a single make uses.
 */
export function makeLabel(
  count: number,
  opts: { test?: boolean; hold?: boolean; remaining?: boolean; number?: number } = {},
) {
  const verb = opts.hold === false ? "Tạo" : "Giữ để tạo";
  if (opts.test) return `${verb} thử`;
  if (count > 1)
    return opts.remaining ? `${verb} ${count} video còn lại` : `${verb} cả ${count} video`;
  if (opts.remaining && opts.number) return `${verb} video #${opts.number}`;
  return opts.hold === false ? "Tạo video" : verb;
}

export function ReadyCheckDialog({
  sessionId,
  scope,
  open,
  onOpenChange,
  onApproved,
  waiting,
  approveOnly,
  spend,
}: {
  sessionId: string;
  /** Script ids this click would make. */
  scope: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved?: () => void | Promise<void>;
  /** Writing or a chat turn is still running: the scripts may change. */
  waiting?: boolean;
  /** Reads "Duyệt N kịch bản": the click only sends scripts to the Video tab. */
  approveOnly?: boolean;
  spend?: Spend;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        {open && (
          <ReadyCheckBody
            sessionId={sessionId}
            scope={scope}
            waiting={waiting}
            approveOnly={approveOnly}
            spend={spend}
            onDone={async () => {
              onOpenChange(false);
              await onApproved?.();
            }}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function ReadyCheckBody({
  sessionId,
  scope,
  waiting,
  approveOnly,
  spend,
  onDone,
}: {
  sessionId: string;
  scope: string[];
  waiting?: boolean;
  approveOnly?: boolean;
  spend?: Spend;
  onDone: () => Promise<void>;
}) {
  const board = useBoard(sessionId);
  const { assets, sessions } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const { opts, estimate } = useEstimateOpts(sessionId);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const { error, run } = useAction();
  if (!board || !session) return null;

  const order = boardOrder(board.scripts).map((s) => s.id);
  const number = (c: ScriptCheck) => `#${order.indexOf(c.script.id) + 1}`;
  const check = readyCheck(board.scripts, scope, assets, null, opts);
  const make = check.toMake.length;
  const toMakeIds = check.toMake.map((c) => c.script.id);
  const characters = assets.filter((a) => a.kind === "character");
  const name = (id: string) => check.characters.get(id)?.name ?? "?";

  const linkSpeaker = (speaker: string, characterId: string) =>
    run(() => api.invoke("board:link-speaker", { sessionId, speaker, characterId }));

  const approve = async () => {
    const ok = await run(() => api.invoke("session:approve", sessionId, toMakeIds));
    if (ok) await run(onDone);
  };

  const total = spend ? make + spend.extraCount : 0;
  const spendUsd = spend
    ? check.toMake.reduce((n, c) => n + estimate(c.script), 0) + spend.extraUsd
    : 0;
  const makeAll = async () => {
    if (!spend) return;
    const ok = await run(() => spend.run(toMakeIds));
    if (ok) await run(onDone);
  };

  const editInChat = (scriptId: string) => {
    addRefs(sessionId, [scriptId]);
    requestChatFocus(sessionId);
  };

  const overTarget = check.makeable.filter((c) => c.overTarget);
  const shared = check.cast.filter((m) => m.sharesVoice);
  const sharedGroups = [...new Set(shared.map((m) => m.voiceId))].map((voiceId) =>
    shared.filter((m) => m.voiceId === voiceId),
  );
  const title = approveOnly
    ? make
      ? `Duyệt ${make} kịch bản`
      : "Duyệt kịch bản"
    : make + (spend?.extraCount ?? 0)
      ? `Tạo ${make + (spend?.extraCount ?? 0)} video`
      : "Tạo video";
  const hasProblems =
    check.blocked.length + overTarget.length + sharedGroups.length + check.places.length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
        {hasProblems && (
          <div className="flex flex-col gap-2">
            {check.blocked.length > 0 && (
              <p className="font-medium">Chưa tạo được {check.blocked.length} video</p>
            )}
            {check.blocked.map((c) =>
              c.blockers.map((b) =>
                b.kind === "unknown-speaker" ? (
                  <Problem
                    key={`${c.script.id}-${b.speaker}`}
                    number={number(c)}
                    text={`${b.speaker} chưa có trong thư viện`}
                  >
                    <Menu>
                      <MenuTrigger render={<Button variant="outline" size="xs" />}>
                        Chọn nhân vật
                        <ChevronDown />
                      </MenuTrigger>
                      <MenuPopup>
                        {characters.map((a) => (
                          <MenuItem key={a.id} onClick={() => linkSpeaker(b.speaker, a.id)}>
                            <AssetThumb asset={a} className="size-5 rounded-full" />
                            {a.name}
                          </MenuItem>
                        ))}
                        <MenuItem onClick={() => setCreatingFor(b.speaker)}>
                          <Plus />
                          Nhân vật mới
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  </Problem>
                ) : (
                  <Problem
                    key={`${c.script.id}-${b.characterId}`}
                    number={number(c)}
                    text={`${name(b.characterId)} chưa có ảnh`}
                  >
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setEditing(check.characters.get(b.characterId) ?? null)}
                    >
                      Thêm ảnh
                    </Button>
                  </Problem>
                ),
              ),
            )}
            {overTarget.map((c) => (
              <Problem
                key={c.script.id}
                number={number(c)}
                warning
                text={`Dài ${formatSeconds(c.seconds)}, dự kiến ${formatSeconds(c.script.brief.targetSec ?? 0)}`}
              >
                <DialogClose
                  render={<Button variant="outline" size="xs" />}
                  onClick={() => editInChat(c.script.id)}
                >
                  Sửa trong chat
                </DialogClose>
              </Problem>
            ))}
            {sharedGroups.map((group) => (
              <Problem
                key={group[0]?.voiceId}
                warning
                text={`${group.map((m) => m.character.name).join(", ")} cùng giọng ${voiceById(group[0]?.voiceId)?.name ?? ""}`}
              >
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setEditing(group[1]?.character ?? null)}
                >
                  Đổi giọng
                </Button>
              </Problem>
            ))}
            {check.places.map((place) => (
              <Problem
                key={place.id}
                warning
                text={`${place.name}: ${findingLabel(placeFinding(place))?.toLocaleLowerCase("vi")}`}
              >
                <Button variant="outline" size="xs" onClick={() => setEditing(place)}>
                  Làm sạch ảnh
                </Button>
              </Problem>
            ))}
          </div>
        )}

        {waiting && <p className="text-muted-foreground">Đang viết kịch bản…</p>}
        {error && <p className="text-destructive-foreground">{error}</p>}
      </div>
      <DialogFooter className="justify-end">
        <DialogClose render={<Button variant="ghost" />}>Hủy</DialogClose>
        {spend ? (
          <HoldButton disabled={waiting || total === 0} onHold={makeAll}>
            {makeLabel(total)}
            <ButtonPrice>~{formatCost(spendUsd)}</ButtonPrice>
          </HoldButton>
        ) : (
          <Button disabled={waiting || make === 0} onClick={approve}>
            {approveOnly ? title : "Tiếp tục"}
          </Button>
        )}
      </DialogFooter>

      {editing && (
        <AssetDialog
          kind="character"
          asset={editing}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      )}
      <AssetDialog
        kind="character"
        open={creatingFor !== null}
        onOpenChange={(next) => {
          if (!next) setCreatingFor(null);
        }}
        onCreated={(asset) => {
          if (creatingFor) void linkSpeaker(creatingFor, asset.id);
        }}
      />
    </>
  );
}

function Problem({
  number,
  text,
  warning,
  children,
}: {
  number?: string;
  text: string;
  warning?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {number && <span className="text-xs text-muted-foreground tabular-nums">{number}</span>}
      <span className={warning ? "min-w-0 flex-1 text-warning-foreground" : "min-w-0 flex-1"}>
        {text}
      </span>
      {children}
    </div>
  );
}
