import { batchResolution, batchVideoModel, type OutputResolution } from "@shared/batch-settings";
import { boardOrder, formatSeconds } from "@shared/board";
import { formatCost } from "@shared/credits";
import type { Asset, Script } from "@shared/ipc";
import { findingLabel, placeFinding } from "@shared/place-check";
import { cutoutUsd } from "@shared/product-shot";
import { needsAttention, readyCheck, type ScriptCheck } from "@shared/ready-check";
import { videoModel } from "@shared/video-models";
import { voiceById } from "@shared/voices";
import { ChevronDown, Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { addRefs, requestChatFocus, useBoard } from "@/lib/board";
import { errorMessage } from "@/lib/errors";
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

// The ready check (docs/VIDEO_COMMIT_DECISIONS.md) opens only when something
// needs the operator: a video that cannot be made, a warning, or a balance
// that does not cover the batch. Each problem is fixable here. With nothing
// to fix, the make button is held for three seconds instead and no dialog
// opens. Committing starts the videos.

/**
 * Prepaid balance in USD, or null when unknown (no key, no permission, error,
 * still loading). Read once per opening; never blocks the check.
 */
export function useBalance(): number | null {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api
      .invoke("usage:balances")
      .then(({ fal }) => {
        if (live && fal.status === "ok" && fal.currency.toUpperCase() === "USD") {
          setBalance(fal.balance);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return balance;
}

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

/**
 * The batch's speaking-shot model (its own, else the series', else the
 * default), so every price before spending uses its rate.
 */
export function useBatchVideoModel(sessionId: string): { id: string; inherited: boolean } {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  return batchVideoModel(
    session,
    series.find((s) => s.id === session?.seriesId),
  );
}

/** The batch's output size (its own, else the series', else 720p): some models cost more at 1080p. */
export function useBatchResolution(sessionId: string): {
  id: OutputResolution;
  inherited: boolean;
} {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const own = series.find((s) => s.id === session?.seriesId);
  return batchResolution(session, own, batchVideoModel(session, own).id);
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
}: {
  sessionId: string;
  /** Writing or a chat turn is still running: the scripts may change. */
  waiting?: boolean;
  onStarted?: () => void | Promise<void>;
}) {
  const board = useBoard(sessionId);
  const { assets } = useWorkspace();
  const balance = useBalance();
  const frames = useNeedsFrames(sessionId);
  const model = useBatchVideoModel(sessionId).id;
  const resolution = useBatchResolution(sessionId).id;
  const placeIds = useSeriesPlaceIds(sessionId);
  // The batch as videos that have not sent a shot yet follow it: its model and its own size.
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const batch = {
    model,
    resolution: batchResolution(
      session,
      series.find((s) => s.id === session?.seriesId),
    ).id,
  };
  const [scope, setScope] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkFor = (ids: string[]) =>
    board
      ? readyCheck(board.scripts, ids, assets, balance, { frames, model, resolution, placeIds })
      : null;

  const needsCheck = (ids: string[]) => {
    const check = checkFor(ids);
    return !check || needsAttention(check) || check.toMake.length === 0;
  };

  /** Opens the ready check for these scripts. */
  const open = (ids: string[]) => {
    setError(null);
    setScope(ids);
  };

  /** Commits what the check allows (after a completed hold). */
  const make = async (ids: string[]) => {
    const check = checkFor(ids);
    if (!check || waiting) return;
    if (needsAttention(check) || check.toMake.length === 0) {
      open(ids);
      return;
    }
    setError(null);
    try {
      await api.invoke(
        "session:approve",
        sessionId,
        check.toMake.map((c) => c.script.id),
      );
      await onStarted?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const dialog = (
    <ReadyCheckDialog
      sessionId={sessionId}
      scope={scope ?? []}
      waiting={waiting}
      open={scope !== null}
      onOpenChange={(next) => {
        if (!next) setScope(null);
      }}
      onApproved={() => onStarted?.()}
    />
  );

  /** What a script's products still need cut out (once ever), for its price. */
  const cutouts = (script: Pick<Script, "productIds">) => cutoutUsd(script.productIds, assets);

  return { needsCheck, open, make, error, frames, model, resolution, batch, cutouts, dialog };
}

/** "Giữ để tạo ~$X", "Giữ để tạo cả N video ~$X", "Giữ để tạo thử ~$X". */
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
}: {
  sessionId: string;
  /** Script ids this click would make. */
  scope: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved: () => void | Promise<void>;
  /** Writing or a chat turn is still running: the scripts may change. */
  waiting?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        {open && (
          <ReadyCheckBody
            sessionId={sessionId}
            scope={scope}
            waiting={waiting}
            onApproved={async () => {
              onOpenChange(false);
              await onApproved();
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
  onApproved,
}: {
  sessionId: string;
  scope: string[];
  waiting?: boolean;
  onApproved: () => Promise<void>;
}) {
  const board = useBoard(sessionId);
  const { assets, sessions } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const balance = useBalance();
  const frames = useNeedsFrames(sessionId);
  const model = useBatchVideoModel(sessionId).id;
  const resolution = useBatchResolution(sessionId).id;
  const placeIds = useSeriesPlaceIds(sessionId);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!board || !session) return null;

  const order = boardOrder(board.scripts).map((s) => s.id);
  const number = (c: ScriptCheck) => `#${order.indexOf(c.script.id) + 1}`;
  const check = readyCheck(board.scripts, scope, assets, balance, {
    frames,
    model,
    resolution,
    placeIds,
  });
  const make = check.toMake.length;
  const characters = assets.filter((a) => a.kind === "character");
  const name = (id: string) => check.characters.get(id)?.name ?? "?";

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const linkSpeaker = (speaker: string, characterId: string) =>
    run(() => api.invoke("board:link-speaker", { sessionId, speaker, characterId }));

  const approve = async () => {
    await run(async () => {
      await api.invoke(
        "session:approve",
        sessionId,
        check.toMake.map((c) => c.script.id),
      );
      await onApproved();
    });
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
  const hasProblems =
    check.blocked.length + overTarget.length + sharedGroups.length + check.places.length > 0;
  const short = check.balance !== null && check.balance.affordable < check.makeable.length;
  const cost = formatCost(check.toMake.reduce((sum, c) => sum + c.usd, 0));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{make ? `Tạo ${make} video` : "Tạo video"}</DialogTitle>
      </DialogHeader>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
        {short && check.balance && (
          <p className="tabular-nums text-destructive-foreground">
            Số dư {formatCost(check.balance.before)} · đủ cho {check.balance.affordable}/
            {check.makeable.length} video
          </p>
        )}

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
        <span className="mr-auto text-xs text-muted-foreground">{videoModel(model).name}</span>
        <DialogClose render={<Button variant="ghost" />}>Hủy</DialogClose>
        <HoldButton disabled={waiting || make === 0} onHold={approve}>
          {makeLabel(make)}
          {make > 0 && <ButtonPrice>~{cost}</ButtonPrice>}
        </HoldButton>
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
