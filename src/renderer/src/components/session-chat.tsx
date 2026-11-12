import { boardOrder } from "@shared/board";
import {
  type ChatAttachment,
  type ChatEffort,
  type ChatInfo,
  type ChatMessage,
  type ChatModelChoice,
  type ChatPart,
  MAX_CHAT_ATTACHMENTS,
  mediaUrl,
  resolveChoice,
  type Script,
} from "@shared/ipc";
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
  useBoard,
  useBoardView,
} from "@/lib/board";
import { useChatInfo, useChatLive } from "@/lib/chat";
import { useDraft } from "@/lib/drafts";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { Composer } from "./composer";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

/**
 * The session's one chat, run by the user's own Claude as an agent that edits
 * the board through typed tools. Replies stream in; tool work shows as short
 * activity rows; a turn's changes undo in one step. Scripts are referenced
 * explicitly: "Nhắc trong chat" on a card, or `#` in the composer; the chips go
 * with the next message. Messages sent during a reply wait their turn.
 */
export function SessionChat({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const [view, setView] = useBoardView(sessionId);
  const session = useWorkspace().sessions.find((s) => s.id === sessionId);
  const live = useChatLive(sessionId);
  const [info, refreshInfo, setInfoLocal] = useChatInfo();
  const [text, setText, clearText] = useDraft(`session-chat:${sessionId}`, "");
  const [files, setFiles, clearFiles] = useDraft<ChatAttachment[]>(
    `session-chat-files:${sessionId}`,
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [dropping, setDropping] = useState(false);
  // A drag cancelled (Esc) or dropped elsewhere never sends "dragleave" here.
  useEffect(() => {
    if (!dropping) return;
    const end = () => setDropping(false);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, [dropping]);

  const messages = board?.messages ?? [];
  const scripts = board ? boardOrder(board.scripts) : [];
  const refs = scripts.filter((s) => view.refs.includes(s.id));
  const running = messages.some((m) => m.pending);
  const locked = Boolean(session?.approvedAt);
  const agent = info?.mode === "agent";
  const blocked = agent && Boolean(info?.problem);
  const scroller = useStickToBottom();
  const input = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [dismissedHash, setDismissedHash] = useState<number | null>(null);

  // After installing or signing in from Terminal, coming back to the app
  // re-checks, so the banner clears without a click. A turn that failed for
  // the same reason re-checks too, so the banner appears.
  const lastError = messages.at(-1)?.error?.kind;
  useEffect(() => {
    if (lastError === "signed-out" || lastError === "not-installed") void refreshInfo();
  }, [lastError, refreshInfo]);
  useEffect(() => {
    if (!info?.problem) return;
    const recheck = () => void refreshInfo();
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [info?.problem, refreshInfo]);

  // A card's "Nhắc trong chat" focuses the composer (after the panel opens).
  useEffect(
    () =>
      onChatFocusRequest(() => {
        if (takeChatFocus(sessionId)) requestAnimationFrame(() => input.current?.focus());
      }),
    [sessionId],
  );

  // `#query` right before the caret opens the script picker.
  const hash = findHash(text, caret);
  const candidates =
    hash && hash.start !== dismissedHash && !locked
      ? matchScripts(scripts, hash.query).filter((s) => !view.refs.includes(s.id))
      : [];
  // The highlighted row starts at the top again whenever the query changes.
  const pickerKey = hash ? `${hash.start}:${hash.query}` : "";
  const [highlight, setHighlight] = useState({ key: "", index: 0 });
  const active = highlight.key === pickerKey ? Math.min(highlight.index, candidates.length - 1) : 0;
  const pickerKeys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (candidates.length === 0 || !hash || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlight({
        key: pickerKey,
        index: (active + step + candidates.length) % candidates.length,
      });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const script = candidates[active];
      if (script) choose(script);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissedHash(hash.start);
    }
  };
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

  const send = async () => {
    // A second Enter or click before the first send returns would send twice.
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
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
      sendingRef.current = false;
      setSending(false);
    }
  };

  const attach = async (picked: Promise<ChatAttachment[]>) => {
    setError(null);
    setAdding(true);
    try {
      const added = await picked;
      // Builds on the latest list: two stagings that overlap both keep their files.
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

  // Dropped files have a path on disk; pasted screenshots only have their bytes.
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

  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // Only the newest turn that can still be undone offers it: undoing an older
  // turn would overwrite what later turns changed.
  const undoId = messages.findLast(canUndo)?.id ?? null;
  const ctx: MessageContext = { sessionId, scripts, locked, running, blocked, undoId, act };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for scripts dragged from the board
    <div
      className="relative flex min-h-0 flex-1 flex-col text-chat"
      onDragOver={(e) => {
        if (!isScriptDrag(e) || locked) return;
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
        if (drag.sessionId !== sessionId || locked) return;
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
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-4 pb-3"
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
        {candidates.length > 0 && hash && (
          <ScriptPicker
            scripts={scripts}
            candidates={candidates}
            active={active}
            onHighlight={(index) => setHighlight({ key: pickerKey, index })}
            onChoose={choose}
          />
        )}
        {error && <p className="px-1 pb-2 text-xs text-destructive-foreground">{error}</p>}
        <Composer
          textareaRef={input}
          onCaret={setCaret}
          onTextKeyDown={pickerKeys}
          value={text}
          onChange={setText}
          onSubmit={send}
          busy={adding || sending}
          disabled={locked || blocked}
          running={running}
          onStop={() => act(() => api.invoke("chat:stop", sessionId))}
          hasAttachments={files.length > 0}
          rows={2}
          placeholder={
            locked
              ? "Kịch bản đã chốt"
              : scripts.length === 0
                ? "Bạn muốn làm video về chủ đề gì"
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
              disabled={locked || adding}
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
  locked: boolean;
  running: boolean;
  /** The setup banner is showing; messages don't repeat its actions. */
  blocked: boolean;
  /** The one assistant message whose changes can be undone now. */
  undoId: string | null;
  act: (run: () => Promise<unknown>) => void;
}

const undoChanges = (m: ChatMessage) => (m.undo?.before.length ?? 0) + (m.undo?.added?.length ?? 0);

/** An assistant turn whose changes are still on the board. Pipeline replies always record some. */
const canUndo = (m: ChatMessage) =>
  m.role === "assistant" &&
  !m.pending &&
  Boolean(m.undo) &&
  !m.undo?.undone &&
  (!m.parts || undoChanges(m) > 0);

/** Follows new content only while the reader is already at the bottom. */
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
  // After every render: new messages and streamed text both re-render the panel.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  });
  return ref;
}

// ---------------------------------------------------------------- setup

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

// ---------------------------------------------------------------- model

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
  /** The choice was saved; it is also the default for new sessions. */
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
                // Keep the effort when the new model has it.
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

// ---------------------------------------------------------------- # picker

/** A `#query` that ends at the caret and starts a word, or null. */
function findHash(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)#([^\s#]{0,40})$/.exec(text.slice(0, caret));
  const query = match?.[1];
  if (query === undefined) return null;
  return { start: caret - query.length - 1, query };
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

/** Digits match the script number; words match the title. */
function matchScripts(scripts: Script[], query: string): Script[] {
  const q = fold(query.trim());
  if (!q) return scripts;
  return scripts.filter((script, i) =>
    /^\d+$/.test(q) ? String(i + 1).startsWith(q) : fold(script.title).includes(q),
  );
}

/** Scripts to reference, above the composer. Keys are handled by the composer. */
function ScriptPicker({
  scripts,
  candidates,
  active,
  onHighlight,
  onChoose,
}: {
  scripts: Script[];
  candidates: Script[];
  active: number;
  onHighlight: (index: number) => void;
  onChoose: (script: Script) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Kịch bản"
      className="absolute right-3 bottom-full left-3 z-20 mb-1 max-h-60 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      {candidates.map((script, i) => (
        // Picked with the mouse or the composer's keys; focus stays in the composer.
        // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled by the composer
        <div
          key={script.id}
          data-index={i}
          role="option"
          aria-selected={i === active}
          tabIndex={-1}
          className={cn(
            "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm",
            i === active && "bg-accent",
          )}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHighlight(i)}
          onClick={() => onChoose(script)}
        >
          <span className="text-xs text-muted-foreground tabular-nums">
            #{scripts.indexOf(script) + 1}
          </span>
          <span className="truncate">{script.title || "…"}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- chips

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

// ---------------------------------------------------------------- messages

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
              disabled={ctx.locked}
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
  // Replies from the fal pipeline: one line of text.
  if (!message.parts) return <PipelineMessage message={message} ctx={ctx} />;

  const parts = message.parts;
  // Something visible always moves while a reply runs: streamed text, a
  // running tool row, or this line (thinking, or waiting for Claude).
  const toolRunning = parts.some((p) => p.type === "tool" && p.status === "running");
  const thinking = message.pending && !liveText && !toolRunning;
  const undo = message.undo;
  const changes = undoChanges(message);

  return (
    <div className="flex flex-col gap-1.5 leading-relaxed">
      {parts.map((part, i) => (
        <Part
          // Parts are only ever appended, so the index is stable.
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
          key={i}
          part={part}
          message={message}
          ctx={ctx}
        />
      ))}
      {liveText && (
        <p className="whitespace-pre-wrap" data-selectable>
          {liveText}
        </p>
      )}
      {thinking && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <span className="shimmer-text">Đang nghĩ</span>
          <Elapsed since={message.at} />
        </p>
      )}
      {message.outcome === "stopped" && <p className="text-muted-foreground">Đã dừng.</p>}
      {message.error && (
        <TurnError
          error={message.error}
          waiting={Boolean(message.pending)}
          showSetup={!ctx.blocked}
          canRetry={Boolean(request) && !ctx.locked && !ctx.blocked && !message.pending}
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
                disabled={ctx.running || ctx.locked}
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
  return (
    <div className="flex flex-col gap-1.5">
      <p data-selectable>{part.question}</p>
      <div className="flex flex-wrap gap-1.5">
        {part.options.map((option) => (
          <Button
            key={option}
            variant="outline"
            size="sm"
            className={cn(part.chosen === option && "border-ring bg-accent")}
            disabled={Boolean(part.chosen) || ctx.locked}
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

function TurnError({
  error,
  waiting,
  showSetup,
  canRetry,
  onRetry,
}: {
  error: NonNullable<ChatMessage["error"]>;
  /** The turn is still running: Claude Code holds it until the limit reopens. */
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

/** Seconds since the turn started, ticked in the DOM so nothing re-renders. */
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
              disabled={ctx.running || ctx.locked}
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
