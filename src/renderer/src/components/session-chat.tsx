import { boardOrder } from "@shared/board";
import { formatCost } from "@shared/credits";
import {
  type ChatAttachment,
  type ChatEffort,
  type ChatError,
  type ChatInfo,
  type ChatMessage,
  type ChatModelChoice,
  type ChatPart,
  MAX_CHAT_ATTACHMENTS,
  mediaUrl,
  resolveChoice,
  type Script,
} from "@shared/ipc";
import { findHash, matchScripts } from "@shared/mentions";
import { canFix } from "@shared/video-fix";
import { useMatches } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  LoaderCircle,
  Paperclip,
  X,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  addRefs,
  isScriptDrag,
  onChatFocusRequest,
  readScriptDrag,
  takeChatFocus,
  takeChatInsert,
  useBoard,
  useBoardView,
} from "@/lib/board";
import { useChatInfo, useChatLive } from "@/lib/chat";
import { useDraft } from "@/lib/drafts";
import { errorMessage } from "@/lib/errors";
import { withOccurrenceKeys } from "@/lib/occurrence-keys";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useVideoJobs } from "@/lib/video-jobs";
import { useWorkspace } from "@/lib/workspace";
import { agentWork } from "@/lib/wow-mode";
import { Composer } from "./composer";
import { PickerList, usePicker, useProductMention } from "./mention-picker";
import { Button } from "./ui/button";
import { ButtonPrice, HoldButton } from "./ui/hold-button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

const isSetupFailure = (kind: ChatError["kind"] | undefined) =>
  kind === "signed-out" || kind === "not-installed";

export function SessionChat({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const [view, setView] = useBoardView(sessionId);
  const onStaging = useMatches().some((m) => m.routeId === "/sessions/$sessionId/staging");
  const live = useChatLive(sessionId);
  const [info, refreshInfo, setInfoLocal] = useChatInfo();
  const [text, setText, clearText] = useDraft(`session-chat:${sessionId}`, "");
  const [files, setFiles, clearFiles] = useDraft<ChatAttachment[]>(
    `session-chat-files:${sessionId}`,
    [],
  );
  const [ownError, setError] = useState<string | null>(null);
  const action = useAction();
  const error = ownError ?? action.error;
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const sendInFlight = useRef(false);
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    if (!dropping) return;
    const endWhenDragEndsElsewhere = () => setDropping(false);
    window.addEventListener("dragend", endWhenDragEndsElsewhere);
    window.addEventListener("drop", endWhenDragEndsElsewhere);
    return () => {
      window.removeEventListener("dragend", endWhenDragEndsElsewhere);
      window.removeEventListener("drop", endWhenDragEndsElsewhere);
    };
  }, [dropping]);

  const messages = board?.messages ?? [];
  const scripts = board ? boardOrder(board.scripts) : [];
  const refs = scripts.filter((s) => view.refs.includes(s.id));
  const running = messages.some((m) => m.pending);
  const agent = info?.mode === "agent";
  const blocked = agent && Boolean(info?.problem);
  const scroller = useStickToBottom();
  const input = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const workspace = useWorkspace();
  const seriesId = workspace.sessions.find((s) => s.id === sessionId)?.seriesId;
  const seriesProductIds = workspace.series.find((s) => s.id === seriesId)?.productIds ?? [];

  const lastError = messages.at(-1)?.error?.kind;
  useEffect(() => {
    if (isSetupFailure(lastError)) void refreshInfo();
  }, [lastError, refreshInfo]);
  useEffect(() => {
    if (!info?.problem) return;
    const recheckOnReturnFromTerminal = () => void refreshInfo();
    window.addEventListener("focus", recheckOnReturnFromTerminal);
    return () => window.removeEventListener("focus", recheckOnReturnFromTerminal);
  }, [info?.problem, refreshInfo]);

  const latestSetText = useRef(setText);
  latestSetText.current = setText;
  useEffect(
    () =>
      onChatFocusRequest(() => {
        if (!takeChatFocus(sessionId)) return;
        const insert = takeChatInsert(sessionId);
        if (insert) {
          latestSetText.current((current) =>
            current.startsWith(insert) ? current : insert + current,
          );
        }
        requestAnimationFrame(() => {
          input.current?.focus();
          const end = input.current?.value.length ?? 0;
          input.current?.setSelectionRange(end, end);
        });
      }),
    [sessionId],
  );

  const hash = findHash(text, caret);
  const choose = (script: Script) => {
    if (!hash) return;
    const next = text.slice(0, hash.start) + text.slice(caret);
    setText(next);
    setCaret(hash.start);
    setView((v) => ({ refs: v.refs.includes(script.id) ? v.refs : [...v.refs, script.id] }));
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(hash.start, hash.start);
    });
  };
  const scriptPicker = usePicker(
    hash,
    hash ? matchScripts(scripts, hash.query).filter((s) => !view.refs.includes(s.id)) : [],
    choose,
  );
  const mention = useProductMention({
    text,
    caret,
    onText: (next, at) => {
      setText(next);
      setCaret(at);
    },
    input,
    seriesProductIds,
    off: Boolean(hash),
  });
  const pickerKeys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (scriptPicker.open) scriptPicker.keys(e);
    else mention.keys(e);
  };

  const send = async () => {
    if (sendInFlight.current) return;
    sendInFlight.current = true;
    setSending(true);
    setError(null);
    action.clear();
    try {
      await api.invoke("chat:send", {
        sessionId,
        text,
        refs: refs.map((s) => s.id),
        attachments: files,
      });
      clearText();
      clearFiles();
      setView({ refs: [] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      sendInFlight.current = false;
      setSending(false);
    }
  };

  const attach = async (picked: Promise<ChatAttachment[]>) => {
    setError(null);
    action.clear();
    setAdding(true);
    try {
      const added = await picked;
      let tooMany = false;
      setFiles((current) => {
        const next = [...current, ...added];
        tooMany = next.length > MAX_CHAT_ATTACHMENTS;
        return tooMany ? current : next;
      });
      if (tooMany) throw new Error(`Tối đa ${MAX_CHAT_ATTACHMENTS} tệp mỗi tin nhắn`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAdding(false);
    }
  };

  const stage = (list: File[]) =>
    attach(
      Promise.all(
        list.map(async (file) => {
          const path = api.pathsForFiles([file])[0];
          return path
            ? { name: file.name, path }
            : { name: file.name || "anh-dan.png", data: new Uint8Array(await file.arrayBuffer()) };
        }),
      ).then((items) => api.invoke("chat:stage-files", { sessionId, files: items })),
    );

  const act = action.run;

  const onlyNewestUndoableId = messages.findLast(canUndo)?.id ?? null;
  const ctx: MessageContext = {
    sessionId,
    scripts,
    running,
    blocked,
    undoId: onlyNewestUndoableId,
    act,
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for scripts dragged from the board
    <div
      className="relative flex min-h-0 flex-1 flex-col text-chat"
      onDragOver={(e) => {
        if (!isScriptDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        const drag = readScriptDrag(e);
        if (!drag) return;
        e.preventDefault();
        setDropping(false);
        if (drag.sessionId !== sessionId) return;
        addRefs(sessionId, drag.ids);
        input.current?.focus();
      }}
    >
      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-xl border-2 border-dashed border-ring bg-background/85 font-medium">
          Thả để nhắc trong chat
        </div>
      )}
      {agent && info?.problem && <SetupBanner problem={info.problem} onCheck={refreshInfo} />}
      <div
        ref={scroller}
        className="scroll-fade-top flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-4 pb-3"
      >
        {messages.map((m, i) =>
          m.role === "user" ? (
            <UserMessage key={m.id} message={m} ctx={ctx} />
          ) : (
            <AssistantMessage
              key={m.id}
              message={m}
              liveText={live?.messageId === m.id ? live.text : ""}
              request={messages[i - 1]?.role === "user" ? messages[i - 1] : undefined}
              ctx={ctx}
            />
          ),
        )}
      </div>
      <div className="relative px-3 pb-3">
        {scriptPicker.open && (
          <PickerList
            label="Kịch bản"
            candidates={scriptPicker.candidates}
            active={scriptPicker.active}
            onHighlight={scriptPicker.highlight}
            onChoose={choose}
            itemKey={(script) => script.id}
            className="right-3 left-3"
          >
            {(script) => (
              <>
                <span className="text-xs text-muted-foreground tabular-nums">
                  #{scripts.indexOf(script) + 1}
                </span>
                <span className="truncate">{script.title || "…"}</span>
              </>
            )}
          </PickerList>
        )}
        {mention.popup("right-3 left-3")}
        {error && <p className="px-1 pb-2 text-xs text-destructive-foreground">{error}</p>}
        <Composer
          textareaRef={input}
          onCaret={setCaret}
          onTextKeyDown={pickerKeys}
          value={text}
          onChange={setText}
          onSubmit={send}
          busy={adding || sending}
          disabled={blocked}
          running={running}
          onStop={() => act(() => api.invoke("chat:stop", sessionId))}
          hasAttachments={files.length > 0}
          rows={2}
          placeholder={
            scripts.length === 0
              ? "Bạn muốn làm video về chủ đề gì"
              : onStaging
                ? "Hỏi hoặc yêu cầu thay đổi dàn dựng"
                : "Hỏi hoặc yêu cầu thay đổi kịch bản"
          }
          submitLabel={running ? "Gửi sau khi xong" : "Gửi"}
          onDropFiles={info?.mode === "pipeline" ? undefined : stage}
          onPasteFiles={info?.mode === "pipeline" ? undefined : stage}
          dropHint="Thả tệp để đính kèm"
          header={
            (refs.length > 0 || files.length > 0) && (
              <div className="flex flex-wrap gap-1 px-2.5 pt-2.5">
                {refs.map((script) => (
                  <RefChip
                    key={script.id}
                    script={script}
                    number={scripts.indexOf(script) + 1}
                    onRemove={() =>
                      setView((v) => ({ refs: v.refs.filter((id) => id !== script.id) }))
                    }
                  />
                ))}
                {files.map((file) => (
                  <FileChip
                    key={file.id}
                    sessionId={sessionId}
                    file={file}
                    onRemove={() => setFiles((current) => current.filter((f) => f.id !== file.id))}
                  />
                ))}
              </div>
            )
          }
        >
          {info?.mode !== "pipeline" && (
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label="Đính kèm tệp"
              title="Đính kèm tệp"
              disabled={adding}
              onClick={() => attach(api.invoke("chat:pick-files", sessionId))}
            >
              <Paperclip />
            </Button>
          )}
          {agent && info && (
            <ModelPicker
              sessionId={sessionId}
              info={info}
              current={resolveChoice(board?.agent ?? info.choice)}
              onError={setError}
              onChosen={(choice) => setInfoLocal({ choice })}
            />
          )}
        </Composer>
      </div>
    </div>
  );
}

interface MessageContext {
  sessionId: string;
  scripts: Script[];
  running: boolean;
  blocked: boolean;
  undoId: string | null;
  act: (run: () => Promise<unknown>) => void;
}

const undoChanges = (m: ChatMessage) => (m.undo?.before.length ?? 0) + (m.undo?.added?.length ?? 0);

const canUndo = (m: ChatMessage) =>
  m.role === "assistant" &&
  !m.pending &&
  Boolean(m.undo) &&
  !m.undo?.undone &&
  (!m.parts || undoChanges(m) > 0);

function useStickToBottom() {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(function followNewContentAfterEveryRender() {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  });
  return ref;
}

function SetupBanner({
  problem,
  onCheck,
}: {
  problem: NonNullable<ChatInfo["problem"]>;
  onCheck: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const action = problem === "not-installed" ? "install" : "login";
  return (
    <div className="mx-3 mt-3 flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <p>
        {problem === "not-installed" ? "Chưa cài Claude trên máy này." : "Claude chưa đăng nhập."}
      </p>
      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => void api.invoke("ai:open-terminal", action)}>
          {problem === "not-installed" ? "Cài đặt" : "Đăng nhập"}
        </Button>
        <Button
          size="sm"
          variant="ghost-muted"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await onCheck();
            setChecking(false);
          }}
        >
          {checking ? "Đang kiểm tra…" : "Kiểm tra lại"}
        </Button>
      </div>
    </div>
  );
}

const EFFORT_LABEL: Record<ChatEffort, string> = {
  low: "Thấp",
  medium: "Vừa",
  high: "Cao",
  xhigh: "Rất cao",
  max: "Tối đa",
};

function ModelPicker({
  sessionId,
  info,
  current,
  onError,
  onChosen,
}: {
  sessionId: string;
  info: ChatInfo;
  current: { model: string; effort: ChatEffort };
  onError: (message: string) => void;
  onChosen: (choice: ChatModelChoice) => void;
}) {
  const option = info.models.find((m) => m.value === current.model);
  const label = option?.label ?? current.model;
  const efforts = option?.efforts ?? [];
  const choose = (choice: ChatModelChoice) =>
    api
      .invoke("chat:set-model", { sessionId, choice })
      .then(() => onChosen(choice))
      .catch((e) => onError(errorMessage(e)));

  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost-muted" size="xs" className="max-w-full" title="Mô hình" />}
      >
        <span className="truncate">
          <span className="text-foreground">{label}</span>
          {efforts.includes(current.effort) && ` ${EFFORT_LABEL[current.effort]}`}
        </span>
        <ChevronDown />
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-48">
        {info.models.map((m) => (
          <MenuItem
            key={m.value}
            onClick={() =>
              choose({
                model: m.value,
                effort: m.efforts.includes(current.effort) ? current.effort : "medium",
              })
            }
          >
            <Check className={cn(m.value !== current.model && "invisible")} />
            {m.label}
          </MenuItem>
        ))}
        {efforts.length > 0 && (
          <>
            <div className="mx-1 my-1 border-t" />
            <div className="px-2.5 py-1 text-xs text-muted-foreground">Mức suy nghĩ</div>
            {efforts.map((effort) => (
              <MenuItem key={effort} onClick={() => choose({ ...current, effort })}>
                <Check className={cn(effort !== current.effort && "invisible")} />
                {EFFORT_LABEL[effort]}
              </MenuItem>
            ))}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

function RefChip({
  script,
  number,
  onRemove,
}: {
  script: Script;
  number: number;
  onRemove?: () => void;
}) {
  return (
    <span className="flex max-w-full items-center gap-1 rounded-md bg-accent py-0.5 pr-1 pl-1.5 text-xs">
      <span className="text-muted-foreground tabular-nums">#{number}</span>
      <span className="truncate">{script.title || "…"}</span>
      {onRemove && <RemoveButton label="Bỏ đính kèm" onClick={onRemove} />}
    </span>
  );
}

function FileChip({
  sessionId,
  file,
  onRemove,
}: {
  sessionId: string;
  file: ChatAttachment;
  onRemove?: () => void;
}) {
  return (
    <span className="flex max-w-56 items-center gap-1.5 rounded-md bg-accent py-0.5 pr-1 pl-0.5 text-xs">
      {file.kind === "image" ? (
        <img
          src={mediaUrl.chat(sessionId, file.id)}
          alt=""
          className="size-5 shrink-0 rounded object-cover"
        />
      ) : (
        <FileText className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{file.name}</span>
      {onRemove && <RemoveButton label="Bỏ tệp" onClick={onRemove} />}
    </span>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid size-4 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      <X className="size-3" />
    </button>
  );
}

function UserMessage({ message, ctx }: { message: ChatMessage; ctx: MessageContext }) {
  const refs = ctx.scripts.filter((s) => message.refs?.includes(s.id));
  const waiting = message.queued || message.unsent;
  return (
    <div className="ml-auto flex max-w-[90%] flex-col items-end gap-1">
      {(refs.length > 0 || message.attachments?.length) && (
        <div className="flex flex-wrap justify-end gap-1">
          {refs.map((script) => (
            <RefChip key={script.id} script={script} number={ctx.scripts.indexOf(script) + 1} />
          ))}
          {message.attachments?.map((file) => (
            <FileChip key={file.id} sessionId={ctx.sessionId} file={file} />
          ))}
        </div>
      )}
      {message.text && (
        <p
          className={cn(
            "rounded-2xl bg-message px-3.5 py-2 leading-relaxed whitespace-pre-wrap",
            waiting && "border border-dashed bg-transparent text-muted-foreground",
          )}
          data-selectable
        >
          {message.text}
        </p>
      )}
      {waiting && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {message.unsent ? "Chưa gửi" : "Đang chờ"}
          {message.unsent && (
            <Button
              variant="ghost-muted"
              size="xs"
              onClick={() =>
                ctx.act(() =>
                  api.invoke("chat:resend", { sessionId: ctx.sessionId, messageId: message.id }),
                )
              }
            >
              Gửi
            </Button>
          )}
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Bỏ tin nhắn"
            title="Bỏ tin nhắn"
            onClick={() =>
              ctx.act(() =>
                api.invoke("chat:discard", { sessionId: ctx.sessionId, messageId: message.id }),
              )
            }
          >
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  liveText,
  request,
  ctx,
}: {
  message: ChatMessage;
  liveText: string;
  request?: ChatMessage;
  ctx: MessageContext;
}) {
  if (!message.parts) return <PipelineMessage message={message} ctx={ctx} />;

  const parts = message.parts;
  const toolRunning = parts.some((p) => p.type === "tool" && p.status === "running");
  const thinking = message.pending && !liveText && !toolRunning;
  const undo = message.undo;
  const changes = undoChanges(message);

  return (
    <div className="flex flex-col gap-1.5 leading-relaxed">
      {withOccurrenceKeys(parts, (part) => (part.type === "text" ? "text" : part.id)).map(
        ({ item: part, key }) => (
          <Part key={key} part={part} message={message} ctx={ctx} />
        ),
      )}
      {liveText && (
        <p className="whitespace-pre-wrap" data-selectable>
          {liveText}
        </p>
      )}
      {thinking && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <span className="shimmer-text" {...agentWork("chat", "Suy nghĩ")}>
            Đang nghĩ
          </span>
          <Elapsed since={message.at} />
        </p>
      )}
      {message.outcome === "stopped" && <p className="text-muted-foreground">Đã dừng.</p>}
      {message.error && (
        <TurnError
          error={message.error}
          waiting={Boolean(message.pending)}
          showSetup={!ctx.blocked}
          canRetry={Boolean(request) && !ctx.blocked && !message.pending}
          onRetry={() =>
            request &&
            ctx.act(() =>
              api.invoke("chat:resend", { sessionId: ctx.sessionId, messageId: request.id }),
            )
          }
        />
      )}
      {undo && changes > 0 && !message.pending && (
        <div className="flex items-center gap-2">
          {undo.undone ? (
            <span className="text-muted-foreground">Đã hoàn tác.</span>
          ) : (
            ctx.undoId === message.id && (
              <Button
                variant="outline"
                size="xs"
                disabled={ctx.running}
                onClick={() =>
                  ctx.act(() =>
                    api.invoke("board:undo", { sessionId: ctx.sessionId, messageId: message.id }),
                  )
                }
              >
                Hoàn tác
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function Part({
  part,
  message,
  ctx,
}: {
  part: ChatPart;
  message: ChatMessage;
  ctx: MessageContext;
}) {
  if (part.type === "text") {
    return (
      <p className="whitespace-pre-wrap" data-selectable>
        {part.text}
      </p>
    );
  }
  if (part.type === "tool") {
    return (
      <p className="flex items-center gap-1.5 text-chat-meta text-muted-foreground">
        {part.status === "running" ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        ) : part.status === "error" ? (
          <CircleAlert className="size-3.5" aria-hidden />
        ) : (
          <Check className="size-3.5" aria-hidden />
        )}
        <span className={cn(part.status === "running" && "shimmer-text")}>{part.label}</span>
      </p>
    );
  }
  if (part.type === "fix") return <FixPart part={part} message={message} ctx={ctx} />;
  return (
    <div className="flex flex-col gap-1.5">
      <p data-selectable>{part.question}</p>
      <div className="flex flex-wrap gap-1.5">
        {part.options.map((option) => (
          <Button
            key={option}
            variant="outline"
            size="sm"
            className={cn(
              "h-auto min-h-7 max-w-full shrink justify-start whitespace-normal py-1 text-left",
              part.chosen === option && "border-ring bg-accent",
            )}
            disabled={Boolean(part.chosen)}
            onClick={() =>
              ctx.act(() =>
                api.invoke("chat:choose", {
                  sessionId: ctx.sessionId,
                  messageId: message.id,
                  partId: part.id,
                  option,
                }),
              )
            }
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}

function FixPart({
  part,
  message,
  ctx,
}: {
  part: Extract<ChatPart, { type: "fix" }>;
  message: ChatMessage;
  ctx: MessageContext;
}) {
  const job = useVideoJobs(ctx.sessionId)?.jobs.get(part.scriptId);
  const number = ctx.scripts.findIndex((s) => s.id === part.scriptId) + 1;
  const scope = [
    part.stills ? `${part.stills} khung hình` : "",
    part.shots ? `${part.shots} cảnh` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const apply = () =>
    ctx.act(() =>
      api.invoke("chat:apply-fix", {
        sessionId: ctx.sessionId,
        messageId: message.id,
        partId: part.id,
      }),
    );
  const stale = !job || (job.rev ?? 0) !== part.rev;
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-2.5">
      <p data-selectable>
        {number > 0 && <span className="text-muted-foreground tabular-nums">#{number} </span>}
        {part.summary}
      </p>
      <div className="flex items-center gap-2">
        {part.applied ? (
          <span className="text-chat-meta text-muted-foreground">Đã bắt đầu sửa</span>
        ) : stale ? (
          <span className="text-chat-meta text-muted-foreground">Video đã thay đổi</span>
        ) : part.priceUsd > 0 ? (
          <HoldButton size="sm" disabled={!canFix(job)} onHold={apply}>
            Giữ để sửa
            <ButtonPrice>~{formatCost(part.priceUsd)}</ButtonPrice>
          </HoldButton>
        ) : (
          <Button size="sm" disabled={!canFix(job)} onClick={apply}>
            Sửa
          </Button>
        )}
        {!part.applied && !stale && scope && (
          <span className="text-chat-meta text-muted-foreground">Làm lại {scope}</span>
        )}
      </div>
    </div>
  );
}

function TurnError({
  error,
  waiting,
  showSetup,
  canRetry,
  onRetry,
}: {
  error: NonNullable<ChatMessage["error"]>;
  waiting?: boolean;
  showSetup: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const text =
    error.kind === "not-installed"
      ? "Chưa cài Claude trên máy này."
      : error.kind === "signed-out"
        ? "Claude chưa đăng nhập."
        : error.kind === "usage-limit"
          ? `Hết lượt dùng Claude${
              error.resetsAt
                ? ` đến ${new Date(error.resetsAt).toLocaleTimeString("vi-VN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""
            }.${waiting ? " Claude sẽ tự làm tiếp khi có lượt, hoặc bấm Dừng." : ""}`
          : `Chưa làm được: ${error.message}`;
  const terminal =
    error.kind === "not-installed" ? "install" : error.kind === "signed-out" ? "login" : null;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <p className="text-destructive-foreground" data-selectable>
        {text}
      </p>
      <div className="flex gap-1.5">
        {terminal && showSetup && (
          <Button size="xs" onClick={() => void api.invoke("ai:open-terminal", terminal)}>
            {terminal === "install" ? "Cài đặt" : "Đăng nhập"}
          </Button>
        )}
        {canRetry && (
          <Button variant="outline" size="xs" onClick={onRetry}>
            Thử lại
          </Button>
        )}
      </div>
    </div>
  );
}

function Elapsed({ since }: { since: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const start = new Date(since).getTime();
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
      if (ref.current) {
        ref.current.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)} phút ${s % 60}s`;
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [since]);
  return <span ref={ref} className="text-xs tabular-nums" />;
}

function PipelineMessage({ message, ctx }: { message: ChatMessage; ctx: MessageContext }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-relaxed">
      {message.pending && (
        <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
      )}
      <span className={message.pending ? "text-muted-foreground" : undefined} data-selectable>
        {message.text || "Đang đọc yêu cầu…"}
      </span>
      {message.undo &&
        (message.undo.undone ? (
          <span className="text-muted-foreground">Đã hoàn tác.</span>
        ) : (
          ctx.undoId === message.id && (
            <Button
              variant="outline"
              size="xs"
              disabled={ctx.running}
              onClick={() =>
                ctx.act(() =>
                  api.invoke("board:undo", { sessionId: ctx.sessionId, messageId: message.id }),
                )
              }
            >
              Hoàn tác
            </Button>
          )
        ))}
    </div>
  );
}
