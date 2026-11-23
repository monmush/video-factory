import { batchMediaLevel } from "@shared/batch-settings";
import { boardOrder, formatSeconds } from "@shared/board";
import type { Asset } from "@shared/ipc";
import { type MediaLevelId, mediaLevel } from "@shared/media-level";
import { isFlagged, placeFinding, placeWarning } from "@shared/place-check";
import { needsAttention, readyCheck, type ScriptCheck } from "@shared/ready-check";
import { fitResolution } from "@shared/video-models";
import { voiceById } from "@shared/voices";
import { ArrowRight, ChevronDown, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "@/lib/api";
import { addRefs, requestChatFocus, useBoard } from "@/lib/board";
import { useVideoLevel } from "@/lib/staging";
import { useAction } from "@/lib/use-action";
import { useVoiceMode } from "@/lib/voice-mode";
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

export function useSeriesPlaceIds(sessionId: string): string[] {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  return series.find((s) => s.id === session?.seriesId)?.environmentIds ?? [];
}

function useBatchMediaLevel(sessionId: string): { id: MediaLevelId; inherited: boolean } {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  return batchMediaLevel(
    session,
    series.find((s) => s.id === session?.seriesId),
  );
}

function useCheckOpts(sessionId: string) {
  const level = useBatchMediaLevel(sessionId).id;
  const levelOf = useVideoLevel(sessionId);
  const placeIds = useSeriesPlaceIds(sessionId);
  const voiceMode = useVoiceMode();
  return { opts: { placeIds, voiceMode }, level, levelOf };
}

export const stagingText = (count: number) => `${count} video đang dàn dựng`;

export function useMakeVideos({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const { assets } = useWorkspace();
  const { opts, level, levelOf } = useCheckOpts(sessionId);
  const batchFor = (scriptId: string) => {
    const at = mediaLevel(levelOf(scriptId));
    return { model: at.speaker, resolution: fitResolution(at.speaker, at.output) };
  };
  const [scope, setScope] = useState<string[] | null>(null);

  const needsCheck = (ids: string[]) => {
    const check = board ? readyCheck(board.scripts, ids, assets, opts) : null;
    return !check || needsAttention(check) || check.toMake.length === 0;
  };

  return {
    needsCheck,
    open: (ids: string[]) => setScope(ids),
    close: () => setScope(null),
    scope,
    level,
    levelOf,
    batchFor,
  };
}

export function ReadyCheckDialog({
  sessionId,
  scope,
  open,
  onOpenChange,
  onCommit,
}: {
  sessionId: string;
  scope: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (ids: string[]) => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        {open && (
          <ReadyCheckBody
            sessionId={sessionId}
            scope={scope}
            onCommit={onCommit}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function ReadyCheckBody({
  sessionId,
  scope,
  onCommit,
  onDone,
}: {
  sessionId: string;
  scope: string[];
  onCommit: (ids: string[]) => Promise<unknown>;
  onDone: () => void;
}) {
  const board = useBoard(sessionId);
  const { assets } = useWorkspace();
  const { opts } = useCheckOpts(sessionId);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const { error, run } = useAction();
  if (!board) return null;

  const order = boardOrder(board.scripts).map((s) => s.id);
  const number = (c: ScriptCheck) => `#${order.indexOf(c.script.id) + 1}`;
  const check = readyCheck(board.scripts, scope, assets, opts);
  const toMakeIds = check.toMake.map((c) => c.script.id);
  const characters = assets.filter((a) => a.kind === "character");
  const name = (id: string) => check.characters.get(id)?.name ?? "?";

  const linkSpeaker = (speaker: string, characterId: string) =>
    run(() => api.invoke("board:link-speaker", { sessionId, speaker, characterId }));

  const commit = async () => {
    if (await run(() => onCommit(toMakeIds))) onDone();
  };

  const keepPlacePhotos = (place: Asset) =>
    run(() =>
      api.invoke("assets:accept-place-finding", {
        assetId: place.id,
        imageIds: place.images.filter((i) => isFlagged(i.placeCheck)).map((i) => i.id),
        accepted: true,
      }),
    );

  const editInChat = (scriptId: string) => {
    addRefs(sessionId, [scriptId]);
    requestChatFocus(sessionId);
  };

  const overTarget = check.makeable.filter((c) => c.overTarget);
  const shared = check.cast.filter((m) => m.sharesVoice);
  const sharedGroups = [...new Set(shared.map((m) => m.voiceId))].map((voiceId) =>
    shared.filter((m) => m.voiceId === voiceId),
  );
  const title = toMakeIds.length ? `Tạo ${toMakeIds.length} video` : "Tạo video";
  const hasProblems =
    check.blocked.length + overTarget.length + sharedGroups.length + check.places.length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      {(hasProblems || error) && (
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
              {check.places.map((place) => {
                const warning = placeWarning(place.name, placeFinding(place));
                return (
                  <Problem
                    key={place.id}
                    warning
                    text={warning?.what ?? place.name}
                    detail={warning?.why}
                  >
                    <Button variant="ghost-muted" size="xs" onClick={() => keepPlacePhotos(place)}>
                      Giữ nguyên
                    </Button>
                    <Button variant="outline" size="xs" onClick={() => setEditing(place)}>
                      Làm sạch ảnh
                    </Button>
                  </Problem>
                );
              })}
            </div>
          )}

          {error && <p className="text-destructive-foreground">{error}</p>}
        </div>
      )}
      <DialogFooter className="justify-end">
        <DialogClose render={<Button variant="ghost" />}>Hủy</DialogClose>
        <Button disabled={toMakeIds.length === 0} onClick={commit}>
          {title}
          <ArrowRight />
        </Button>
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
  detail,
  children,
}: {
  number?: string;
  text: string;
  warning?: boolean;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {number && <span className="text-xs text-muted-foreground tabular-nums">{number}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={warning ? "text-warning-foreground" : undefined}>{text}</span>
        {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      </span>
      {children}
    </div>
  );
}
