import type { MaterialItem } from "./material";
import type { SeriesModels } from "./models";
import type { Note } from "./notes";
import type { PaidWork } from "./paid-work";
import type { ProductMix } from "./product-mix";
import type { GuideEdit, SeriesGuide } from "./series-guide";
import type { ExportPick } from "./video-export";
import type { FixChange } from "./video-fix";
import type { StepAverages, VideoJob } from "./video-job";

export type ThemePreference = "light" | "dark" | "system";

export interface Series {
  id: string;
  name: string;
  guidance: string;
  guide?: SeriesGuide;
  characterIds: string[];
  productIds: string[];
  environmentIds: string[];
  models?: SeriesModels;
  reuseMaterial?: boolean;
  pinnedAt?: string;
  notes?: Note[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionSettings {
  productMix?: ProductMix;
}

export interface Session {
  id: string;
  seriesId: string;
  name: string;
  request?: string;
  approvedAt: string | null;
  committedScriptIds?: string[];
  pinnedAt?: string;
  settings?: SessionSettings;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptLine {
  characterId: string | null;
  speaker: string;
  text: string;
}

export type ScriptBrief = (
  | {
      kind: "topic";
      direction?: string;
      productId?: string | null;
    }
  | { kind: "variant"; sourceId: string; direction?: string }
  | { kind: "copy"; sourceId: string }
) & {
  targetSec?: number;
};

export interface Script {
  id: string;
  title: string;
  hook: string;
  lines: ScriptLine[];
  productIds: string[];
  staging: string;
  status: "writing" | "ready" | "failed";
  brief: ScriptBrief;
  mark: "new" | "edited" | null;
  pinned: boolean;
  deletedAt: string | null;
  versionOf?: string;
  version?: number;
  changing?: "product";
  changeUndo?:
    | { copy: true }
    | { copy?: false; productIds: string[]; lines: ScriptLine[]; staging: string };
  createdAt: string;
  updatedAt: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  kind: "image" | "pdf" | "text";
  bytes: number;
}

export const MAX_CHAT_ATTACHMENTS = 10;

export type ChatPart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      label: string;
      status: "running" | "done" | "error";
    }
  | {
      type: "choices";
      id: string;
      question: string;
      options: string[];
      chosen?: string;
    }
  | {
      type: "fix";
      id: string;
      scriptId: string;
      summary: string;
      changes: FixChange[];
      priceUsd: number;
      shots: number;
      stills: number;
      rev: number;
      applied?: boolean;
    };

export interface ChatError {
  kind: "not-installed" | "signed-out" | "usage-limit" | "provider";
  message: string;
  resetsAt?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  refs?: string[];
  attachments?: ChatAttachment[];
  queued?: boolean;
  unsent?: boolean;
  parts?: ChatPart[];
  pending?: boolean;
  outcome?: "done" | "stopped" | "failed";
  error?: ChatError;
  undo?: { before: Script[]; added?: string[]; undone: boolean };
  model?: string;
  at: string;
}

export type ChatEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatModelChoice {
  model: string;
  effort: ChatEffort | null;
}

export const HIDDEN_CHAT_MODELS = ["default", "fable"];

const DEFAULT_CHAT_CHOICE: ChatModelChoice = { model: "opus", effort: "medium" };

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

export interface ChatInfo {
  mode: "agent" | "fixture" | "pipeline";
  problem: "not-installed" | "signed-out" | null;
  models: ChatModelOption[];
  choice: ChatModelChoice;
}

export interface ChatLive {
  messageId: string;
  text: string;
  writingIds: string[];
}

export interface Board {
  version: 1;
  scripts: Script[];
  messages: ChatMessage[];
  agent?: { sessionId: string; started: boolean } & ChatModelChoice;
  handEdited?: string[];
}

export type AssetKind = "character" | "product" | "environment";

export const SERIES_ASSET_FIELD = {
  character: "characterIds",
  product: "productIds",
  environment: "environmentIds",
} as const satisfies Record<AssetKind, keyof Series>;

export interface AssetImage {
  id: string;
  file: string;
  origin?: ImageOrigin;
  angle?: AngleId;
  cutout?: { file: string; usable: boolean };
  placeCheck?: PlaceFinding;
  original?: { file: string; origin?: ImageOrigin; placeCheck?: PlaceFinding };
}

export interface PlaceFinding {
  people: boolean;
  packaging: string | null;
  checkedAt: string;
  accepted?: boolean;
}

export type ImageOrigin = "upload" | "ai";

export type AngleId = CoreAngle | "other";
export type CoreAngle = "closeup" | "three-quarter" | "full-body";
export const CORE_ANGLES: CoreAngle[] = ["closeup", "three-quarter", "full-body"];

export const MAX_CHARACTER_IMAGES = 4;

export type AngleModel = "gpt-image" | "nano-banana-pro";

export interface GeneratedAngle extends StagedImage {
  angle: CoreAngle;
}

export interface GenerateAnglesResult {
  images: GeneratedAngle[];
  failed: { angle: CoreAngle; message: string }[];
  source: "fixture" | "fal";
  cost: number | null;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  handle: string;
  description: string;
  images: AssetImage[];
  contains?: string[];
  voice?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeriesInput {
  name: string;
  guidance: string;
  characterIds: string[];
  productIds: string[];
  environmentIds: string[];
  models?: SeriesModels;
  reuseMaterial?: boolean;
}

export type SeriesUpdate = {
  id: string;
  pinned?: boolean;
  guide?: GuideEdit;
} & Partial<SeriesInput>;

export interface Workspace {
  version: 1;
  series: Series[];
  sessions: Session[];
  assets: Asset[];
  notes?: Note[];
}

export interface StagedImage {
  id: string;
  url: string;
}

export type ImageRef =
  | {
      source: "staged";
      id: string;
      origin?: ImageOrigin;
      angle?: AngleId;
      cleanOf?: ImageRef;
      cutout?: boolean;
    }
  | {
      source: "asset";
      assetId: string;
      id: string;
      angle?: AngleId;
      restore?: boolean;
    };

export interface AssetInput {
  kind: AssetKind;
  name: string;
  handle: string;
  description: string;
  images: ImageRef[];
  contains?: string[];
  voice?: string;
}

export interface VoiceSuggestion {
  label: string;
  text: string;
}

export interface GroupedProduct {
  name: string;
  description: string;
  images: number[];
  contains: number[];
  note?: string;
}

export interface ProductGroupingResult {
  products: GroupedProduct[];
  skipped: { image: number; reason: string }[];
  source: "fixture" | "fal" | "claude-code";
  cost: number | null;
}

export interface BatchProductItem {
  input: AssetInput;
  containsIndexes: number[];
}

export const MAX_IMPORT_PHOTOS = 20;

export type TextProvider = "fal" | "claude-code";

export interface ClaudeCodeStatus {
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  plan: string | null;
}

export interface AiStatus {
  textProvider: TextProvider;
  claudeCode: ClaudeCodeStatus;
}

export interface DescribeResult {
  description: string;
  source: "fixture" | "fal" | "claude-code";
  cost: number | null;
}

export interface UsageEntry {
  at: string;
  provider: "fal" | "claude-code" | "elevenlabs";
  purpose: string;
  model?: string;
  cost?: number | null;
  notionalCostUsd?: number | null;
}

export interface ClaudeLimitWindow {
  utilization: number;
  resetsAt: string;
}

export interface ClaudeLimits {
  session: ClaudeLimitWindow | null;
  weekly: ClaudeLimitWindow | null;
  capturedAt: string;
}

export type BalanceResult<T> =
  | ({ status: "ok" } & T)
  | { status: "no-key" }
  | { status: "no-permission" }
  | { status: "error"; message: string };

export interface Balances {
  fal: BalanceResult<{ balance: number; currency: string }>;
  claude: ClaudeLimits | null;
  checkedAt: string;
}

export interface VoiceSampleAsk {
  text: string;
  name: string;
  description: string;
}

export const mediaUrl = {
  asset: (assetId: string, file: string) => `hyan-media://asset/${assetId}/${file}`,
  chat: (sessionId: string, file: string) => `hyan-media://chat/${sessionId}/${file}`,
  staged: (file: string) => `hyan-media://staging/${file}`,
  material: (seriesId: string, file: string) => `hyan-media://material/${seriesId}/${file}`,
  voice: (file: string, version: number) => `hyan-media://voice/${file}?v=${version}`,
  video: (sessionId: string, scriptId: string, file: string) =>
    `hyan-media://video/${sessionId}/${scriptId}/${file}`,
};

export interface VideoJobs {
  jobs: VideoJob[];
  averages: StepAverages;
}

export type ProviderId = "fal" | "fal-billing";

export interface ProviderStatus {
  id: ProviderId;
  configured: boolean;
  source: "env" | "stored" | "bundled" | null;
}

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
  devFeatures: boolean;
  dataDir: string;
}

export interface DevProfile {
  id: string;
  name: string;
  active: boolean;
  isDefault: boolean;
}

export interface DevProfiles {
  fixed: boolean;
  profiles: DevProfile[];
}

export type VideosBeingMade = Record<string, number>;

export interface IpcContract {
  "app:info": { args: []; result: AppInfo };
  "app:open-data-dir": { args: []; result: null };
  "app:problem-report": { args: []; result: { file: string } };
  "setup:export": { args: []; result: { file: string } };
  "setup:import": { args: []; result: { series: number; assets: number; skipped: number } | null };
  "dev:profiles": { args: []; result: DevProfiles | null };
  "dev:create-profile": { args: [name: string]; result: DevProfiles | null };
  "dev:switch-profile": { args: [id: string]; result: null };
  "dev:delete-profile": { args: [id: string]; result: DevProfiles | null };
  "theme:set": { args: [preference: ThemePreference]; result: null };
  "workspace:get": { args: []; result: Workspace };
  "series:create": { args: [input: SeriesInput]; result: Series };
  "series:update": {
    args: [input: SeriesUpdate];
    result: Series;
  };
  "series:answer-guide": {
    args: [input: { id: string; questionId: string; option: number | null }];
    result: Series;
  };
  "series:draft-guide": { args: [id: string]; result: Series };
  "series:delete": { args: [id: string]; result: null };
  "notes:update": { args: [input: { id: string; text: string }]; result: null };
  "notes:remove": { args: [id: string]; result: null };
  "session:create": {
    args: [input: { seriesId: string; request?: string }];
    result: Session;
  };
  "session:update": {
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
  "session:delete": { args: [id: string]; result: null };
  "session:approve": { args: [sessionId: string, scriptIds?: string[]]; result: Session };
  "board:get": { args: [sessionId: string]; result: Board };
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
  "chat:stop": { args: [sessionId: string]; result: null };
  "chat:discard": { args: [input: { sessionId: string; messageId: string }]; result: null };
  "chat:resend": { args: [input: { sessionId: string; messageId: string }]; result: null };
  "chat:choose": {
    args: [input: { sessionId: string; messageId: string; partId: string; option: string }];
    result: null;
  };
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
  "chat:set-model": {
    args: [input: { sessionId: string; choice: ChatModelChoice }];
    result: null;
  };
  "ai:open-terminal": { args: [action: "install" | "login"]; result: null };
  "board:variant": {
    args: [input: { sessionId: string; scriptId: string; direction?: string }];
    result: null;
  };
  "board:retry": { args: [input: { sessionId: string; scriptId: string }]; result: null };
  "board:copy": { args: [input: { sessionId: string; scriptId: string }]; result: string };
  "board:delete": { args: [input: { sessionId: string; ids: string[] }]; result: null };
  "board:restore": { args: [input: { sessionId: string; ids: string[] }]; result: null };
  "board:pin": {
    args: [input: { sessionId: string; scriptId: string; pinned: boolean }];
    result: null;
  };
  "board:link-speaker": {
    args: [input: { sessionId: string; speaker: string; characterId: string }];
    result: null;
  };
  "board:undo": { args: [input: { sessionId: string; messageId: string }]; result: null };
  "board:set-product": {
    args: [input: { sessionId: string; scriptId: string; productId: string | null }];
    result: { scriptId: string } | null;
  };
  "board:undo-change": { args: [input: { sessionId: string; scriptId: string }]; result: null };
  "board:edit-line": {
    args: [
      input: { sessionId: string; scriptId: string; index: number; was: string; text: string },
    ];
    result: { scriptId: string; copied: boolean } | null;
  };
  "board:remove-line": {
    args: [input: { sessionId: string; scriptId: string; index: number; was: string }];
    result: { scriptId: string; copied: boolean };
  };
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
  "assets:check-place": { args: [input: { images: ImageRef[] }]; result: (PlaceFinding | null)[] };
  "assets:estimate-clean": { args: []; result: { cost: number } };
  "assets:accept-place-finding": {
    args: [input: { assetId: string; imageIds: string[]; accepted: boolean }];
    result: null;
  };
  "assets:clean-place-photo": {
    args: [input: { image: ImageRef; finding: PlaceFinding }];
    result: {
      image: StagedImage;
      finding: PlaceFinding | null;
      source: "fixture" | "fal";
      cost: number | null;
    };
  };
  "assets:cut-out-product-photo": {
    args: [input: { image: ImageRef }];
    result: {
      image: StagedImage;
      usable: boolean;
      source: "fixture" | "fal" | "kept";
      cost: number | null;
    };
  };
  "voices:suggest": {
    args: [input: { name: string; description: string }];
    result: VoiceSuggestion[];
  };
  "voices:sample": { args: [voice: VoiceSampleAsk]; result: { url: string | null } };
  "voices:make": { args: [voice: VoiceSampleAsk]; result: { url: string } };
  "voices:remake": { args: [voice: VoiceSampleAsk]; result: { url: string } };
  "material:list": { args: [seriesId: string]; result: MaterialItem[] };
  "material:set-reusable": {
    args: [input: { seriesId: string; itemId: string; reusable: boolean }];
    result: null;
  };
  "material:remove": { args: [input: { seriesId: string; itemId: string }]; result: null };
  "material:add-to-character": {
    args: [input: { seriesId: string; itemId: string }];
    result: Asset;
  };
  "usage:balances": { args: []; result: Balances };
  "providers:status": { args: []; result: ProvidersInfo };
  "providers:set-key": { args: [id: ProviderId, key: string]; result: ProvidersInfo };
  "providers:clear-key": { args: [id: ProviderId]; result: ProvidersInfo };
  "ai:status": { args: []; result: AiStatus };
  "ai:set-text-provider": { args: [provider: TextProvider]; result: AiStatus };
  "ai:install-claude": { args: []; result: ClaudeCodeStatus };
  "ai:onboarded": { args: []; result: boolean };
  "ai:finish-onboarding": { args: [input: { useClaude: boolean }]; result: null };
  "video:jobs": { args: [sessionId: string]; result: VideoJobs };
  "video:paid-work": { args: [sessionIds: string[]]; result: PaidWork };
  "video:making": { args: []; result: VideosBeingMade };
  "video:start": { args: [input: { sessionId: string; scriptId: string }]; result: null };
  "video:stage": {
    args: [input: { sessionId: string; scriptIds: string[]; again?: boolean }];
    result: null;
  };
  "video:stage-stop": { args: [input: { sessionId: string; scriptId: string }]; result: null };
  "video:direct": {
    args: [
      input: { sessionId: string; scriptId: string; words?: string; want: string; at?: string },
    ];
    result: null;
  };
  "video:make-all": { args: [input: { sessionId: string; scriptIds: string[] }]; result: null };
  "video:stop": { args: [input: { sessionId: string; scriptId: string }]; result: null };
  "video:retry-shot": {
    args: [input: { sessionId: string; scriptId: string; shot: number }];
    result: null;
  };
  "video:fix": {
    args: [input: { sessionId: string; scriptId: string; changes: FixChange[] }];
    result: null;
  };
  "video:restore": {
    args: [input: { sessionId: string; scriptId: string }];
    result: null;
  };
  "video:remake": {
    args: [input: { sessionId: string; scriptId: string }];
    result: null;
  };
  "video:fresh-picture": {
    args: [input: { sessionId: string; scriptId: string; frameId: string; fresh: boolean }];
    result: null;
  };
  "video:tempo": {
    args: [input: { sessionId: string; scriptId: string; tempo: number }];
    result: null;
  };
  "video:save": { args: [input: { sessionId: string; scriptId: string }]; result: string | null };
  "video:save-many": {
    args: [input: { sessionId: string; picks: ExportPick[] }];
    result: { folder: string; failed: ExportPick[] } | null;
  };
}

export type IpcChannel = keyof IpcContract;

export const IPC_CHANNELS = [
  "app:info",
  "app:open-data-dir",
  "app:problem-report",
  "setup:export",
  "setup:import",
  "dev:profiles",
  "dev:create-profile",
  "dev:switch-profile",
  "dev:delete-profile",
  "theme:set",
  "workspace:get",
  "series:create",
  "series:update",
  "series:answer-guide",
  "series:draft-guide",
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
  "board:undo-change",
  "board:edit-line",
  "board:remove-line",
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
  "assets:accept-place-finding",
  "assets:clean-place-photo",
  "assets:cut-out-product-photo",
  "voices:suggest",
  "voices:sample",
  "voices:make",
  "voices:remake",
  "material:list",
  "material:set-reusable",
  "material:remove",
  "material:add-to-character",
  "usage:balances",
  "providers:status",
  "providers:set-key",
  "providers:clear-key",
  "ai:status",
  "ai:set-text-provider",
  "ai:install-claude",
  "ai:onboarded",
  "ai:finish-onboarding",
  "video:jobs",
  "video:paid-work",
  "video:making",
  "video:start",
  "video:stage",
  "video:stage-stop",
  "video:direct",
  "video:make-all",
  "video:stop",
  "video:retry-shot",
  "video:fix",
  "video:restore",
  "video:remake",
  "video:fresh-picture",
  "video:tempo",
  "video:save",
  "video:save-many",
] as const satisfies readonly IpcChannel[];

export interface IpcEvents {
  "workspace:changed": Workspace;
  "board:changed": { sessionId: string; board: Board };
  "chat:live": { sessionId: string; live: ChatLive | null };
  "video:job": { job: VideoJob; averages: StepAverages };
  "video:job-removed": { sessionId: string; scriptId: string };
  "video:making": VideosBeingMade;
  "material:changed": { seriesId: string };
}

export type IpcEvent = keyof IpcEvents;

export const IPC_EVENTS = [
  "workspace:changed",
  "board:changed",
  "chat:live",
  "video:job",
  "video:job-removed",
  "video:making",
  "material:changed",
] as const satisfies readonly IpcEvent[];

type UnlistedAtCompileTime<All, Listed> =
  Exclude<All, Listed> extends never ? true : Exclude<All, Listed>;
const everyChannelIsListed: UnlistedAtCompileTime<IpcChannel, (typeof IPC_CHANNELS)[number]> = true;
const everyEventIsListed: UnlistedAtCompileTime<IpcEvent, (typeof IPC_EVENTS)[number]> = true;
void everyChannelIsListed;
void everyEventIsListed;

export interface HyanBridge {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcContract[C]["args"]
  ): Promise<IpcContract[C]["result"]>;
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEvents[E]) => void): () => void;
  platform: NodeJS.Platform;
  pathsForFiles(files: File[]): string[];
}
