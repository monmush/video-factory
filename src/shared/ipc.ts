// The single contract between the renderer and the main process.
// The renderer never touches Node, the file system or provider keys directly;
// every capability it needs is a channel listed here.

export type ThemePreference = "light" | "dark" | "system";

export interface Series {
  id: string;
  name: string;
  /**
   * Saved, human-readable direction every session inherits. Starts as the
   * description typed when the series is created; edited on the series page.
   */
  guidance: string;
  /** Library characters, products and environments this series uses (asset ids). */
  characterIds: string[];
  productIds: string[];
  environmentIds: string[];
  /** Set when pinned to the top of the sidebar. */
  pinnedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  seriesId: string;
  name: string;
  /** What the operator asked for when starting the session, if anything. */
  request?: string;
  /** Session-level script approval. Videos can only be generated after this is set. */
  approvedAt: string | null;
  /** Set when pinned to the top of its series in the sidebar. */
  pinnedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** One spoken line of a script. */
export interface ScriptLine {
  /** Character asset id; null when the writer named someone not in the series. */
  characterId: string | null;
  /** Name as written, shown when the character cannot be found. */
  speaker: string;
  text: string;
}

/** What a card's writer was asked, so "Thử lại" can ask again. */
export type ScriptBrief = (
  | { kind: "topic"; direction?: string }
  | { kind: "variant"; sourceId: string; direction?: string }
) & {
  /** Length the request asked for, in seconds; about 45 when it named none. */
  targetSec?: number;
};

/**
 * A script on a session's board. Variants are independent scripts; nothing
 * links them to their source after writing (the brief is only for retries).
 */
export interface Script {
  id: string;
  /** The philosophy line the story is about. Empty while a variant is being planned. */
  title: string;
  /** One sentence: why a viewer keeps watching. */
  hook: string;
  lines: ScriptLine[];
  /** Products the story features (asset ids). */
  productIds: string[];
  /** Short staff-facing note on setting, staging and product placement. */
  staging: string;
  /** "writing" with existing lines means an in-place edit is running. */
  status: "writing" | "ready" | "failed";
  brief: ScriptBrief;
  /** Result of the latest request; cleared when the next request starts. */
  mark: "new" | "edited" | null;
  pinned: boolean;
  /** Deleted scripts stay in place until the session ends, so undo restores them exactly. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Files attached to a chat message, copied into the session folder. */
export interface ChatAttachment {
  /** File name inside <session>/chat-files/. */
  id: string;
  /** Original file name, shown on the chip. */
  name: string;
  kind: "image" | "pdf" | "text";
  bytes: number;
}

export const MAX_CHAT_ATTACHMENTS = 10;

/** What an agent turn did, in order. */
export type ChatPart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      /** The provider's tool-call id. */
      id: string;
      name: string;
      /** Short Vietnamese label, e.g. "Sửa #3". */
      label: string;
      status: "running" | "done" | "error";
    }
  | {
      /** Buttons the agent offers; clicking one sends it as the next message. */
      type: "choices";
      id: string;
      question: string;
      options: string[];
      chosen?: string;
    };

export interface ChatError {
  kind: "not-installed" | "signed-out" | "usage-limit" | "provider";
  message: string;
  /** Usage limits: when the window reopens. */
  resetsAt?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** User text. Assistant replies from the fal pipeline also use it. */
  text: string;
  /** User messages: the scripts attached as references. */
  refs?: string[];
  attachments?: ChatAttachment[];
  /** User messages: waiting for the running turn to finish. */
  queued?: boolean;
  /** User messages: still queued when the app quit, so never sent. */
  unsent?: boolean;
  /** Assistant messages from the agent: text, tool activity and choices, in order. */
  parts?: ChatPart[];
  /** Assistant messages: the request is still running. */
  pending?: boolean;
  /** Assistant messages from the agent: how the turn ended. */
  outcome?: "done" | "stopped" | "failed";
  error?: ChatError;
  /**
   * Assistant messages that changed scripts: each changed script as it was
   * before the turn first touched it, and scripts the turn added. One undo
   * restores them all.
   */
  undo?: { before: Script[]; added?: string[]; undone: boolean };
  /** Model that answered (agent turns). */
  model?: string;
  at: string;
}

export type ChatEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatModelChoice {
  /** Claude Code model alias or id; "default" lets Claude Code choose. */
  model: string;
  /** null: the model's default. */
  effort: ChatEffort | null;
}

/**
 * Models the chat never offers: "default" hides which model runs, and Fable
 * uses up a plan's limits far too fast for batch writing.
 */
export const HIDDEN_CHAT_MODELS = ["default", "fable"];

/** New chats start here: Claude Code's recommended model at medium effort. */
export const DEFAULT_CHAT_CHOICE: ChatModelChoice = { model: "opus", effort: "medium" };

/**
 * Always a named model and effort, so the composer can show exactly what runs.
 * Earlier saves used "default" and null (Claude Code decides); they map to the default.
 */
export function resolveChoice(choice?: Partial<ChatModelChoice> | null): {
  model: string;
  effort: ChatEffort;
} {
  return {
    model:
      choice?.model && !HIDDEN_CHAT_MODELS.includes(choice.model)
        ? choice.model
        : DEFAULT_CHAT_CHOICE.model,
    effort: choice?.effort ?? (DEFAULT_CHAT_CHOICE.effort as ChatEffort),
  };
}

export interface ChatModelOption {
  value: string;
  label: string;
  efforts: ChatEffort[];
}

/** The chat's AI and the models it offers. */
export interface ChatInfo {
  /** "agent": the user's own Claude; "fixture": sample turns; "pipeline": fal's one-shot writer. */
  mode: "agent" | "fixture" | "pipeline";
  /** Agent mode: why it cannot run yet, if it cannot. */
  problem: "not-installed" | "signed-out" | null;
  models: ChatModelOption[];
  /** Last choice, used for new sessions. */
  choice: ChatModelChoice;
}

/** Work in progress that is not saved yet: streamed text and scripts being written by a tool. */
export interface ChatLive {
  messageId: string;
  /** Text of the reply block being streamed. */
  text: string;
  /** Scripts a tool call is writing right now. */
  writingIds: string[];
}

/** A session's scripts and its chat, saved in the session's folder. */
export interface Board {
  version: 1;
  scripts: Script[];
  messages: ChatMessage[];
  /** The session's agent conversation, resumed across restarts. */
  agent?: { sessionId: string; started: boolean } & ChatModelChoice;
}

/** Styles and scenes join this union later. */
export type AssetKind = "character" | "product" | "environment";

/** The Series field holding the assets of each kind. */
export const SERIES_ASSET_FIELD = {
  character: "characterIds",
  product: "productIds",
  environment: "environmentIds",
} as const satisfies Record<AssetKind, keyof Series>;

export interface AssetImage {
  id: string;
  /** File name inside the asset's folder (<data>/assets/<assetId>/). */
  file: string;
  /** "ai" for images generated from the references; originals stay authoritative. */
  origin?: ImageOrigin;
  angle?: AngleId;
}

export type ImageOrigin = "upload" | "ai";

/**
 * What view an image shows. The three core views form a generic character sheet
 * (face, depth, outfit) useful in any series; "other" covers anything else.
 * Staging-specific views (seated, opposite side…) belong to series setup later.
 */
export type AngleId = CoreAngle | "other";
export type CoreAngle = "closeup" | "three-quarter" | "full-body";
export const CORE_ANGLES: CoreAngle[] = ["closeup", "three-quarter", "full-body"];

/** Reference images per asset, uploads and AI-generated together (pilot limit). */
export const MAX_CHARACTER_IMAGES = 4;

/** Image models available for generating angles (both hosted on fal). */
export type AngleModel = "gpt-image" | "nano-banana-pro";

export interface GeneratedAngle extends StagedImage {
  angle: CoreAngle;
}

export interface GenerateAnglesResult {
  images: GeneratedAngle[];
  failed: { angle: CoreAngle; message: string }[];
  source: "fixture" | "fal";
  /** Estimated USD for the images produced; null in fixture mode. */
  cost: number | null;
}

/** A reusable workspace asset, e.g. a character with reference images from several angles. */
export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  /** Unique tag for prompts, written as @handle. Lowercase a–z, 0–9 and "-". */
  handle: string;
  /** Visual description in Vietnamese. */
  description: string;
  /** Reference images; the first is the cover. */
  images: AssetImage[];
  /**
   * Products only: other products this one contains (a gift box and its
   * sachets). One level: a contained product never contains others itself.
   */
  contains?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SeriesInput {
  /** Empty: named after the first line of the guidance. */
  name: string;
  guidance: string;
  characterIds: string[];
  productIds: string[];
  environmentIds: string[];
}

export interface Workspace {
  version: 1;
  series: Series[];
  sessions: Session[];
  assets: Asset[];
}

/** An image copied into the staging folder, waiting to be saved with an asset. */
export interface StagedImage {
  id: string;
  url: string;
}

/** Points at an image that is either staged or already saved with an asset. */
export type ImageRef =
  | { source: "staged"; id: string; origin?: ImageOrigin; angle?: AngleId }
  | { source: "asset"; assetId: string; id: string; angle?: AngleId };

export interface AssetInput {
  kind: AssetKind;
  name: string;
  handle: string;
  description: string;
  images: ImageRef[];
  /** Products only. Omit on update to keep the current set contents. */
  contains?: string[];
}

/** Batch product import: photos grouped into products by AI (or by hand). */
export interface GroupedProduct {
  /** Copied from the label; empty when unreadable. */
  name: string;
  description: string;
  /** Indexes into the staged photo list sent for grouping. */
  images: number[];
  /** Indexes of other products in this result that this one contains. */
  contains: number[];
  /** Why the AI is unsure, if it is. */
  note?: string;
}

export interface ProductGroupingResult {
  products: GroupedProduct[];
  skipped: { image: number; reason: string }[];
  source: "fixture" | "fal" | "claude-code";
  cost: number | null;
}

/** One product in a batch create; set membership refers to other items by index. */
export interface BatchProductItem {
  input: AssetInput;
  containsIndexes: number[];
}

/** Photos per batch import (pilot limit). */
export const MAX_IMPORT_PHOTOS = 20;

/**
 * Who handles text and image-understanding tasks (descriptions, later scripts
 * and orchestration). "claude-code" runs the user's own installed, signed-in
 * Claude Code CLI, so usage counts against their Claude plan.
 */
export type TextProvider = "fal" | "claude-code";

export interface ClaudeCodeStatus {
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  /** e.g. "pro", "max"; null when signed in with an API key or unknown. */
  plan: string | null;
}

export interface AiStatus {
  textProvider: TextProvider;
  claudeCode: ClaudeCodeStatus;
}

export interface DescribeResult {
  description: string;
  /** What actually answered: the sample text, fal, or the user's Claude Code. */
  source: "fixture" | "fal" | "claude-code";
  /** USD charged by fal; null for fixture and Claude Code (billed to the user's own plan). */
  cost: number | null;
}

/** One logged AI request (usage.jsonl in the data folder). */
export interface UsageEntry {
  at: string;
  provider: "fal" | "claude-code";
  /** What the app was doing, e.g. "describe-character". */
  purpose: string;
  model?: string;
  /** Provider-reported USD for fal; null when unknown. */
  cost?: number | null;
  /** Claude Code's API-price estimate; not charged per call on a subscription. */
  notionalCostUsd?: number | null;
}

export interface ClaudeLimitWindow {
  /** 0–1 share of the window already used. */
  utilization: number;
  /** ISO time the window resets. */
  resetsAt: string;
}

export interface ClaudeLimits {
  session: ClaudeLimitWindow | null;
  weekly: ClaudeLimitWindow | null;
  /** When the app last saw these numbers (they arrive with each Claude call). */
  capturedAt: string;
}

/** A provider balance read live, or why it could not be read. */
export type BalanceResult<T> =
  | ({ status: "ok" } & T)
  | { status: "no-key" }
  | { status: "no-permission" }
  | { status: "error"; message: string };

/** Live balances of the app's AI providers. */
export interface Balances {
  /** Prepaid fal credits, in USD. */
  fal: BalanceResult<{ balance: number; currency: string }>;
  /** ElevenLabs plan credits for the current billing period. */
  elevenlabs: BalanceResult<{ used: number; limit: number; resetsAt: string | null; plan: string }>;
  /** The user's own Claude plan limits (last reading; arrives with each Claude call). */
  claude: ClaudeLimits | null;
  checkedAt: string;
}

/** URLs the renderer can load local media from (served by the hyan-media protocol). */
export const mediaUrl = {
  asset: (assetId: string, file: string) => `hyan-media://asset/${assetId}/${file}`,
  chat: (sessionId: string, file: string) => `hyan-media://chat/${sessionId}/${file}`,
  staged: (file: string) => `hyan-media://staging/${file}`,
};

/** "fal-billing" is an optional read-only fal key, used only to read the credit balance. */
export type ProviderId = "fal" | "fal-billing" | "elevenlabs";

export interface ProviderStatus {
  id: ProviderId;
  configured: boolean;
  /** Where the key came from: `.env.local`/environment in development, or the OS-encrypted store. */
  source: "env" | "stored" | null;
}

/**
 * `fixture` replays saved experiment outputs and never makes paid calls.
 * `live` is required before any real provider request is sent.
 */
export type ProviderMode = "fixture" | "live";

export interface ProvidersInfo {
  mode: ProviderMode;
  canStoreKeys: boolean;
  providers: ProviderStatus[];
}

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  dataDir: string;
}

/** Channel name → argument tuple and resolved result. */
export interface IpcContract {
  "app:info": { args: []; result: AppInfo };
  "app:open-data-dir": { args: []; result: null };
  "theme:set": { args: [preference: ThemePreference]; result: null };
  "workspace:get": { args: []; result: Workspace };
  "series:create": { args: [input: SeriesInput]; result: Series };
  "series:update": {
    args: [input: { id: string; pinned?: boolean } & Partial<SeriesInput>];
    result: Series;
  };
  /** Removes the series and its sessions; their media folder goes to the system Trash. */
  "series:delete": { args: [id: string]; result: null };
  /** With a request, also starts writing it on the new session's board. */
  "session:create": { args: [input: { seriesId: string; request?: string }]; result: Session };
  "session:update": {
    args: [input: { id: string; name?: string; pinned?: boolean }];
    result: Session;
  };
  /** Removes the session; its media folder goes to the system Trash. */
  "session:delete": { args: [id: string]; result: null };
  /** Locks the script board; videos follow from the scripts on it. */
  "session:approve": { args: [sessionId: string]; result: Session };
  "board:get": { args: [sessionId: string]; result: Board };
  /** A chat message. Runs in the background; queued while a turn is running. */
  "chat:send": {
    args: [
      input: {
        sessionId: string;
        text: string;
        refs: string[];
        attachments: ChatAttachment[];
      },
    ];
    result: null;
  };
  /** Stops the running turn. Changes it already made stay, with undo. */
  "chat:stop": { args: [sessionId: string]; result: null };
  /** Removes a queued or unsent message. */
  "chat:discard": { args: [input: { sessionId: string; messageId: string }]; result: null };
  /** Sends a user message's content again as a new message. */
  "chat:resend": { args: [input: { sessionId: string; messageId: string }]; result: null };
  /** Picks one of the choices an agent turn offered. */
  "chat:choose": {
    args: [input: { sessionId: string; messageId: string; partId: string; option: string }];
    result: null;
  };
  /** Copies dropped, pasted or picked files into the session folder. */
  "chat:stage-files": {
    args: [
      input: { sessionId: string; files: { name: string; path?: string; data?: Uint8Array }[] },
    ];
    result: ChatAttachment[];
  };
  "chat:pick-files": { args: [sessionId: string]; result: ChatAttachment[] };
  "chat:info": { args: [input: { refresh?: boolean }]; result: ChatInfo };
  /** Sets the model for the session and as the default for new ones. */
  "chat:set-model": {
    args: [input: { sessionId: string; choice: ChatModelChoice }];
    result: null;
  };
  /** Opens Terminal on Anthropic's own install or sign-in command. */
  "ai:open-terminal": { args: [action: "install" | "login"]; result: null };
  /** A new independent script beside the source, optionally steered by a direction. */
  "board:variant": {
    args: [input: { sessionId: string; scriptId: string; direction?: string }];
    result: null;
  };
  "board:retry": { args: [input: { sessionId: string; scriptId: string }]; result: null };
  "board:delete": { args: [input: { sessionId: string; ids: string[] }]; result: null };
  "board:restore": { args: [input: { sessionId: string; ids: string[] }]; result: null };
  "board:pin": {
    args: [input: { sessionId: string; scriptId: string; pinned: boolean }];
    result: null;
  };
  /** Restores every script an in-place edit changed. */
  "board:undo": { args: [input: { sessionId: string; messageId: string }]; result: null };
  "assets:pick-images": { args: []; result: StagedImage[] };
  "assets:stage-paths": { args: [paths: string[]]; result: StagedImage[] };
  "assets:create": { args: [input: AssetInput]; result: Asset };
  "assets:update": { args: [id: string, input: AssetInput]; result: Asset };
  "assets:delete": { args: [id: string]; result: null };
  "assets:describe": {
    args: [input: { kind: AssetKind; name: string; images: ImageRef[] }];
    result: DescribeResult;
  };
  "products:group": {
    args: [input: { stagedIds: string[] }];
    result: ProductGroupingResult;
  };
  "assets:create-batch": { args: [items: BatchProductItem[]]; result: Asset[] };
  "assets:estimate-angles": {
    args: [input: { model: AngleModel; count: number }];
    result: { cost: number };
  };
  "assets:generate-angles": {
    args: [
      input: { model: AngleModel; angles: CoreAngle[]; description: string; images: ImageRef[] },
    ];
    result: GenerateAnglesResult;
  };
  "usage:balances": { args: []; result: Balances };
  "providers:status": { args: []; result: ProvidersInfo };
  "providers:set-key": { args: [id: ProviderId, key: string]; result: ProvidersInfo };
  "providers:clear-key": { args: [id: ProviderId]; result: ProvidersInfo };
  "ai:status": { args: []; result: AiStatus };
  "ai:set-text-provider": { args: [provider: TextProvider]; result: AiStatus };
}

export type IpcChannel = keyof IpcContract;

export const IPC_CHANNELS = [
  "app:info",
  "app:open-data-dir",
  "theme:set",
  "workspace:get",
  "series:create",
  "series:update",
  "series:delete",
  "session:create",
  "session:update",
  "session:delete",
  "session:approve",
  "board:get",
  "chat:send",
  "chat:stop",
  "chat:discard",
  "chat:resend",
  "chat:choose",
  "chat:stage-files",
  "chat:pick-files",
  "chat:info",
  "chat:set-model",
  "ai:open-terminal",
  "board:variant",
  "board:retry",
  "board:delete",
  "board:restore",
  "board:pin",
  "board:undo",
  "assets:pick-images",
  "assets:stage-paths",
  "assets:create",
  "assets:update",
  "assets:delete",
  "assets:describe",
  "products:group",
  "assets:create-batch",
  "assets:estimate-angles",
  "assets:generate-angles",
  "usage:balances",
  "providers:status",
  "providers:set-key",
  "providers:clear-key",
  "ai:status",
  "ai:set-text-provider",
] as const satisfies readonly IpcChannel[];

/** Main → renderer notifications, for work that finishes after the request returned. */
export interface IpcEvents {
  /** Sent after every saved workspace change, whoever made it. */
  "workspace:changed": Workspace;
  "board:changed": { sessionId: string; board: Board };
  /** Streamed, unsaved progress of a running turn; null when it ends. */
  "chat:live": { sessionId: string; live: ChatLive | null };
}

export type IpcEvent = keyof IpcEvents;

export const IPC_EVENTS = [
  "workspace:changed",
  "board:changed",
  "chat:live",
] as const satisfies readonly IpcEvent[];

// Compile-time completeness: a channel or event added to the contract but not
// to its list above fails here instead of at runtime ("Unknown IPC channel").
type Missing<All, Listed> = Exclude<All, Listed> extends never ? true : Exclude<All, Listed>;
const channelsComplete: Missing<IpcChannel, (typeof IPC_CHANNELS)[number]> = true;
const eventsComplete: Missing<IpcEvent, (typeof IPC_EVENTS)[number]> = true;
void channelsComplete;
void eventsComplete;

/** Exposed on `window.hyan` by the preload script. */
export interface HyanBridge {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcContract[C]["args"]
  ): Promise<IpcContract[C]["result"]>;
  /** Subscribes to a main-process event; returns the unsubscribe function. */
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEvents[E]) => void): () => void;
  platform: NodeJS.Platform;
  /** Local paths of dropped files (Electron webUtils), for "assets:stage-paths". */
  pathsForFiles(files: File[]): string[];
}
