// The single contract between the renderer and the main process.
// The renderer never touches Node, the file system or provider keys directly;
// every capability it needs is a channel listed here.

import type { Note } from "./notes";
import type { ProductMix } from "./product-mix";
import type { FixChange } from "./video-fix";
import type { StepAverages, VideoJob } from "./video-job";

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
  /**
   * Speaking-shot model (src/shared/video-models.ts), chosen as a quality
   * level: the default for this series' batches, which may set their own.
   * Missing or unknown: the default. Each video keeps the one it was made with.
   */
  videoModel?: string;
  /** Output size ("720p" | "1080p") for this series' batches; missing: 720p. */
  resolution?: string;
  /** Experiment branch: the Media level for this series' batches (src/shared/media-level.ts). */
  mediaLevel?: string;
  /** Set when pinned to the top of the sidebar. */
  pinnedAt?: string;
  /** Learned preferences for this series (src/shared/notes.ts), saved from the chat. */
  notes?: Note[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Output settings of one batch (src/shared/batch-settings.ts). Missing
 * fields take the series' value, else the default.
 */
export interface SessionSettings {
  /** Speaking-shot model (src/shared/video-models.ts). */
  videoModel?: string;
  /** Output size of the final video: "720p" or "1080p". */
  resolution?: string;
  /** Experiment branch: the Media level (src/shared/media-level.ts). */
  mediaLevel?: string;
  /**
   * Products the batch's new scripts feature, in shares summing to 100
   * (src/shared/product-mix.ts). Missing: the series' products are shared evenly.
   */
  productMix?: ProductMix;
}

export interface Session {
  id: string;
  seriesId: string;
  name: string;
  /** What the operator asked for when starting the session, if anything. */
  request?: string;
  /** Session-level script approval. Videos can only be generated after this is set. */
  approvedAt: string | null;
  /**
   * Scripts committed to video, in the order they were committed. Missing on an
   * approved session saved before this existed: every script was committed.
   * A test approval commits one; "make the rest" adds the others later.
   */
  committedScriptIds?: string[];
  /** Set when pinned to the top of its series in the sidebar. */
  pinnedAt?: string;
  /** This batch's own output settings; missing: the series'. */
  settings?: SessionSettings;
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
  | {
      kind: "topic";
      direction?: string;
      /** The product given to it (the batch's mix or the chat); null: none. Missing: the writer chooses. */
      productId?: string | null;
    }
  | { kind: "variant"; sourceId: string; direction?: string }
  /** A new version of a script already sent to video: copied, never written. */
  | { kind: "copy"; sourceId: string }
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
  /**
   * New versions of a script sent to video (src/shared/versions.ts): the id
   * of the chain's first script, and this copy's number ("bản 2"). Missing on
   * the first version.
   */
  versionOf?: string;
  version?: number;
  /** While `status` is "writing": what is being done, when it is not a whole rewrite. */
  changing?: "product";
  /**
   * The product was changed on the card (src/main/product-change.ts): what
   * "Hoàn tác" brings back, or `copy` when the change made this new version.
   * Cleared by the next change to the board.
   */
  productUndo?:
    | { copy: true }
    | { copy?: false; productIds: string[]; lines: ScriptLine[]; staging: string };
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
    }
  | {
      /**
       * A fix the agent proposes for a video: what is made again and what it
       * costs. Nothing happens until the operator holds its button.
       */
      type: "fix";
      id: string;
      scriptId: string;
      /** One short line in the operator's language. */
      summary: string;
      changes: FixChange[];
      priceUsd: number;
      /** How much is made again. */
      shots: number;
      stills: number;
      voice: boolean;
      /** The video's revision the proposal was made for; stale once it moves on. */
      rev: number;
      applied?: boolean;
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
  /**
   * Products only: the photo's background removed once, kept in the asset's
   * folder and reused by every video. `usable`: the product stands alone in
   * it, so it can be placed in a scene (src/shared/product-shot.ts). When the
   * user puts the cut-out in the photo's place, `file` is the same file.
   */
  cutout?: { file: string; usable: boolean };
  /**
   * Places only: what the user's own AI saw in the photo
   * (src/shared/place-check.ts). Missing: never checked.
   */
  placeCheck?: PlaceFinding;
  /**
   * This photo replaced another, which stays on disk here and can be
   * restored: a cleaned place photo (people or packaging removed by the
   * image model) or a product photo with its background removed.
   */
  original?: { file: string; origin?: ImageOrigin; placeCheck?: PlaceFinding };
}

/** What a check of a place photo found. */
export interface PlaceFinding {
  people: boolean;
  /** Packaging or lettered box, bag, label or sign, in a few words; null if none. */
  packaging: string | null;
  checkedAt: string;
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
  /**
   * Characters only: our voice catalogue id (src/shared/voices.ts). Missing
   * or unknown means no voice chosen; generation then uses resolveVoice.
   */
  voiceId?: string;
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
  /** Omit to keep the current choice (on create: the default). */
  videoModel?: string;
  resolution?: string;
  mediaLevel?: string;
}

export interface Workspace {
  version: 1;
  series: Series[];
  sessions: Session[];
  assets: Asset[];
  /** Learned preferences for every series (src/shared/notes.ts). */
  notes?: Note[];
}

/** An image copied into the staging folder, waiting to be saved with an asset. */
export interface StagedImage {
  id: string;
  url: string;
}

/** Points at an image that is either staged or already saved with an asset. */
export type ImageRef =
  | {
      source: "staged";
      id: string;
      origin?: ImageOrigin;
      angle?: AngleId;
      /**
       * A cleaned place photo or a product cut-out made from this photo, which
       * it replaces (the original is kept).
       */
      cleanOf?: ImageRef;
      /** Products: this is `cleanOf` with its background removed. */
      cutout?: boolean;
    }
  | {
      source: "asset";
      assetId: string;
      id: string;
      angle?: AngleId;
      /** A cleaned photo or a cut-out goes back to the original it replaced. */
      restore?: boolean;
    };

export interface AssetInput {
  kind: AssetKind;
  name: string;
  handle: string;
  description: string;
  images: ImageRef[];
  /** Products only. Omit on update to keep the current set contents. */
  contains?: string[];
  /** Characters only. Omit on update to keep the current voice. */
  voiceId?: string;
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
  provider: "fal" | "claude-code" | "elevenlabs";
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
  /** A file in a video job's folder (voice, frames, clips, final). */
  video: (sessionId: string, scriptId: string, file: string) =>
    `hyan-media://video/${sessionId}/${scriptId}/${file}`,
};

/** The session's video jobs and the step averages the time estimate uses. */
export interface VideoJobs {
  jobs: VideoJob[];
  averages: StepAverages;
}

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
  /** Edits the text of a learned preference ("Ghi nhớ"), series or all-series. */
  "notes:update": { args: [input: { id: string; text: string }]; result: null };
  "notes:remove": { args: [id: string]; result: null };
  /** With a request, also starts writing it on the new session's board. */
  "session:create": {
    /** `mediaLevel`: the batch's own level; omitted (or the series' own) follows the series. */
    args: [input: { seriesId: string; request?: string; mediaLevel?: string }];
    result: Session;
  };
  "session:update": {
    /** `settings` fields set to null go back to the series' value. */
    args: [
      input: {
        id: string;
        name?: string;
        pinned?: boolean;
        settings?: { [K in keyof SessionSettings]?: SessionSettings[K] | null };
      },
    ];
    result: Session;
  };
  /** Removes the session; its media folder goes to the system Trash. */
  "session:delete": { args: [id: string]; result: null };
  /**
   * Commits scripts to video: the given ones, or every finished script when
   * none are given. Committed scripts lock; the rest of the board stays
   * editable. Called again to commit more.
   */
  "session:approve": { args: [sessionId: string, scriptIds?: string[]]; result: Session };
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
  /** The operator accepts a proposed video fix (held: it spends money). */
  "chat:apply-fix": {
    args: [input: { sessionId: string; messageId: string; partId: string }];
    result: null;
  };
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
  /** A new editable version of a script sent to video, after its chain. Returns its id. */
  "board:copy": { args: [input: { sessionId: string; scriptId: string }]; result: string };
  "board:delete": { args: [input: { sessionId: string; ids: string[] }]; result: null };
  "board:restore": { args: [input: { sessionId: string; ids: string[] }]; result: null };
  "board:pin": {
    args: [input: { sessionId: string; scriptId: string; pinned: boolean }];
    result: null;
  };
  /**
   * Gives lines spoken by `speaker` (not in the library) to a library
   * character and adds it to the series. Only on scripts not yet committed.
   */
  "board:link-speaker": {
    args: [input: { sessionId: string; speaker: string; characterId: string }];
    result: null;
  };
  /** Restores every script an in-place edit changed. */
  "board:undo": { args: [input: { sessionId: string; messageId: string }]; result: null };
  /**
   * One product for a script (null: none): only the lines and staging about
   * the product are rewritten. A script with a video changes on a new version.
   */
  /** The script that changed (a new version when the original has a video); null when nothing did. */
  "board:set-product": {
    args: [input: { sessionId: string; scriptId: string; productId: string | null }];
    result: { scriptId: string } | null;
  };
  /** Takes back the card's last product change. */
  "board:undo-product": { args: [input: { sessionId: string; scriptId: string }]; result: null };
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
  /**
   * Places: the user's own AI looks at each photo for people and packaging.
   * Saved photos record the finding. Null where the check cannot run.
   */
  "assets:check-place": { args: [input: { images: ImageRef[] }]; result: (PlaceFinding | null)[] };
  /** Price of one cleaned place photo. */
  "assets:estimate-clean": { args: []; result: { cost: number } };
  /** Removes what the check found from a place photo (held: it spends). The result is staged. */
  "assets:clean-place-photo": {
    args: [input: { image: ImageRef; finding: PlaceFinding }];
    result: {
      image: StagedImage;
      /** The cleaned photo checked again; null when the check cannot run. */
      finding: PlaceFinding | null;
      source: "fixture" | "fal";
      cost: number | null;
    };
  };
  /**
   * Products: the photo with its background removed (held: it spends, unless
   * a video already made this photo's cut-out). The result is staged.
   */
  "assets:cut-out-product-photo": {
    args: [input: { image: ImageRef }];
    result: {
      image: StagedImage;
      /** The product stands free of the photo's edges, so videos can place it. */
      usable: boolean;
      /** "kept": a video made it before, nothing was spent. */
      source: "fixture" | "fal" | "kept";
      cost: number | null;
    };
  };
  "usage:balances": { args: []; result: Balances };
  "providers:status": { args: []; result: ProvidersInfo };
  "providers:set-key": { args: [id: ProviderId, key: string]; result: ProvidersInfo };
  "providers:clear-key": { args: [id: ProviderId]; result: ProvidersInfo };
  "ai:status": { args: []; result: AiStatus };
  "ai:set-text-provider": { args: [provider: TextProvider]; result: AiStatus };
  "video:jobs": { args: [sessionId: string]; result: VideoJobs };
  /** Starts a committed script with no job yet, or continues a stopped or failed one. */
  "video:start": { args: [input: { sessionId: string; scriptId: string }]; result: null };
  /**
   * Plans a script now, before any hold (free: the user's own AI); also a
   * written script not committed yet. The video then waits for its hold.
   */
  "video:plan": { args: [input: { sessionId: string; scriptId: string }]; result: null };
  /** Experiment branch: throws away a plan nothing was made from and plans again at the batch's level. */
  "video:replan": { args: [input: { sessionId: string; scriptId: string }]; result: null };
  /**
   * The operator's wish for how a moment (`words`: the exact words of a shot)
   * or the whole video is filmed; an empty `want` removes it, `at` names the
   * whole-video wish it replaces or removes. While nothing is spent, the video
   * is planned again with it (free). Refused while planning or once started.
   */
  "video:direct": {
    args: [
      input: { sessionId: string; scriptId: string; words?: string; want: string; at?: string },
    ];
    result: null;
  };
  /**
   * "Make everything" on the Video tab: commits `scriptIds` (not yet sent) and
   * runs every unfinished video of the session to the end, with no stop.
   */
  "video:make-all": { args: [input: { sessionId: string; scriptIds: string[] }]; result: null };
  /** Unsent shots are never sent; shots with the provider finish and are kept. */
  "video:stop": { args: [input: { sessionId: string; scriptId: string }]; result: null };
  "video:retry-shot": {
    args: [input: { sessionId: string; scriptId: string; shot: number }];
    result: null;
  };
  /** Fixes a video in place: only what the changes touch is made again. */
  /** `take`: fix that take (a model id), worked on first; default the one worked on. */
  "video:fix": {
    args: [input: { sessionId: string; scriptId: string; changes: FixChange[]; take?: string }];
    result: null;
  };
  /** Swaps the video with the cut before its last fix. Free. */
  "video:restore": {
    args: [input: { sessionId: string; scriptId: string; take?: string }];
    result: null;
  };
  /** This video's own model, before any shot is sent (it then no longer follows the batch). */
  "video:set-model": {
    args: [input: { sessionId: string; scriptId: string; model: string }];
    result: null;
  };
  /**
   * Takes with another model (src/shared/video-takes.ts): start one (held: it
   * spends), make one "the video", delete one, or make one the take worked on.
   */
  "video:take": {
    args: [
      input: {
        sessionId: string;
        scriptId: string;
        action: "start" | "use" | "delete" | "focus";
        model: string;
      },
    ];
    result: null;
  };
  /** Saves final.mp4 through a save dialog; null when cancelled. */
  "video:save": { args: [input: { sessionId: string; scriptId: string }]; result: string | null };
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
  "notes:update",
  "notes:remove",
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
  "chat:apply-fix",
  "chat:stage-files",
  "chat:pick-files",
  "chat:info",
  "chat:set-model",
  "ai:open-terminal",
  "board:variant",
  "board:retry",
  "board:copy",
  "board:delete",
  "board:restore",
  "board:pin",
  "board:undo",
  "board:set-product",
  "board:undo-product",
  "board:link-speaker",
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
  "assets:check-place",
  "assets:estimate-clean",
  "assets:clean-place-photo",
  "assets:cut-out-product-photo",
  "usage:balances",
  "providers:status",
  "providers:set-key",
  "providers:clear-key",
  "ai:status",
  "ai:set-text-provider",
  "video:jobs",
  "video:start",
  "video:plan",
  "video:replan",
  "video:direct",
  "video:make-all",
  "video:stop",
  "video:retry-shot",
  "video:fix",
  "video:restore",
  "video:take",
  "video:set-model",
  "video:save",
] as const satisfies readonly IpcChannel[];

/** Main → renderer notifications, for work that finishes after the request returned. */
export interface IpcEvents {
  /** Sent after every saved workspace change, whoever made it. */
  "workspace:changed": Workspace;
  "board:changed": { sessionId: string; board: Board };
  /** Streamed, unsaved progress of a running turn; null when it ends. */
  "chat:live": { sessionId: string; live: ChatLive | null };
  /** A video job changed (progress, a finished step, stop). */
  "video:job": { job: VideoJob; averages: StepAverages };
  /** A job nothing was spent on went with its script. */
  "video:job-removed": { sessionId: string; scriptId: string };
}

export type IpcEvent = keyof IpcEvents;

export const IPC_EVENTS = [
  "workspace:changed",
  "board:changed",
  "chat:live",
  "video:job",
  "video:job-removed",
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
