import { chmod, writeFile } from "node:fs/promises";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import type { ActivityEvent } from "../shared/activity";
import {
  type IpcChannel,
  type IpcContract,
  MAX_IMPORT_PHOTOS,
  mediaUrl,
  type Series,
  type VoiceSampleAsk,
} from "../shared/ipc";
import { directionText, seriesTargetSec } from "../shared/series-guide";
import { usageData } from "../shared/usage-stats";
import { guessVoiceTraits } from "../shared/voices";
import { appAbout, installId, record, recordDerived } from "./activity";
import { readCostReport, writeActivityExport } from "./activity-export";
import { estimateAngles, generateAngles } from "./angles";
import { createAsset, createProductBatch, deleteAsset, refPaths, updateAsset } from "./assets";
import { balances, readMediaBalance } from "./balances";
import * as board from "./board";
import { pickBookend, saveSeriesBookends } from "./bookends";
import { CHAT_FILE_EXTENSIONS, stageChatFiles } from "./chat/files";
import { chatInfo, rememberChoice } from "./chat/models";
import * as chat from "./chat/runtime";
import { claudeCodeStatus, findClaude, installClaude } from "./claude-code";
import { advanceFakeClaude, fakeClaudeActive } from "./claude-fake";
import { describeAsset } from "./describe";
import { devFeatures } from "./dev";
import { actionEvent, QUIET_CHANNELS } from "./ipc-activity";
import { editLine, removeLine } from "./line-edit";
import {
  addMaterialToCharacter,
  listMaterial,
  removeMaterial,
  setMaterialReusable,
} from "./material";
import { IMAGE_EXTENSIONS, imageRefPath, stageImages } from "./media";
import { dataDir } from "./paths";
import {
  acceptPlaceFinding,
  checkPlace,
  checkPlaceImages,
  cleanPlacePhoto,
  estimateClean,
  placePhotoPath,
} from "./place-check";
import { writeProblemReport } from "./problem-report";
import * as products from "./product-change";
import { cutOutProductPhoto } from "./product-cutout";
import { groupProducts } from "./product-grouping";
import { createProfile, deleteProfile, listProfiles, switchProfile } from "./profiles";
import { productKeyStatus, saveKey } from "./providers";
import { childPath } from "./safe-path";
import { draftGuide } from "./series-guide";
import { readSettings, writeSettings } from "./settings";
import { exportSetup, importSetup, SETUP_EXTENSION } from "./setup-file";
import {
  answerSeriesQuestion,
  approveSession,
  createSeries,
  createSession,
  deleteSeries,
  deleteSession,
  getWorkspace,
  mutate,
  removeNote,
  updateNote,
  updateSeries,
  updateSession,
} from "./store";
import * as video from "./video/runner";
import { makeSample, remakeSample, sampleFile, sampleVersion } from "./voice-maker";
import { suggestVoices } from "./voice-suggestions";

type Handler<C extends IpcChannel> = (
  ...args: IpcContract[C]["args"]
) => IpcContract[C]["result"] | Promise<IpcContract[C]["result"]>;

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>) {
  if (QUIET_CHANNELS.has(channel)) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as IpcContract[C]["args"])));
    return;
  }
  ipcMain.handle(channel, async (_event, ...args) => {
    const started = Date.now();
    try {
      const result = await handler(...(args as IpcContract[C]["args"]));
      record(actionEvent(channel, args, Date.now() - started, null));
      return result;
    } catch (error) {
      record(actionEvent(channel, args, Date.now() - started, { error }));
      throw error;
    }
  });
}

const seriesSaved = (series: Series, created: boolean): ActivityEvent => ({
  name: "series-saved",
  created,
  seriesId: series.id,
  seriesName: series.name,
  guidance: series.guidance,
  direction: directionText(series),
  targetSec: seriesTargetSec(series),
  ...(series.models ? { models: series.models } : {}),
  characters: series.characterIds.length,
  products: series.productIds.length,
  places: series.environmentIds.length,
});

export function registerIpc() {
  handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    devFeatures: devFeatures(),
    dataDir: dataDir(),
  }));
  handle("app:open-data-dir", async () => {
    await shell.openPath(dataDir());
    return null;
  });
  handle("app:problem-report", async () => {
    const file = await writeProblemReport({
      dataDir: dataDir(),
      destination: app.getPath("downloads"),
      about: { version: app.getVersion(), packaged: app.isPackaged },
    });
    shell.showItemInFolder(file);
    return { file };
  });
  handle("setup:export", async () => {
    const file = await exportSetup({
      dataDir: dataDir(),
      destination: app.getPath("downloads"),
      ws: await getWorkspace(),
      appVersion: app.getVersion(),
    });
    shell.showItemInFolder(file);
    return { file };
  });
  handle("setup:import", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Nhập thiết lập",
      properties: ["openFile"],
      filters: [{ name: "Thiết lập", extensions: [SETUP_EXTENSION, "zip"] }],
    };
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const file = result.filePaths[0];
    if (result.canceled || !file) return null;
    return mutate((ws) => importSetup({ file, dataDir: dataDir(), ws }));
  });
  handle("app:activity-export", async () => {
    const file = await writeActivityExport({
      dataDir: dataDir(),
      destination: app.getPath("downloads"),
      about: { install: installId(), ...appAbout() },
      workspace: await getWorkspace(),
    });
    shell.showItemInFolder(file);
    return { file };
  });
  handle("activity:screen", ({ route, params }) => {
    record({ name: "screen", route, params });
    return null;
  });
  handle("dev:profiles", listProfiles);
  handle("dev:create-profile", createProfile);
  handle("dev:switch-profile", switchProfile);
  handle("dev:delete-profile", deleteProfile);
  handle("theme:set", async (preference) => {
    if (!["system", "light", "dark"].includes(preference)) throw new Error("Unknown theme");
    nativeTheme.themeSource = preference;
    await writeSettings({ theme: preference });
    return null;
  });

  handle("workspace:get", getWorkspace);
  handle("series:create", async (input) => {
    const series = await createSeries(input);
    recordDerived(() => [seriesSaved(series, true)]);
    void draftGuide(series.id).catch((e) => console.warn("[series] draft failed:", e.message));
    return series;
  });
  handle("series:draft-guide", draftGuide);
  handle("series:pick-bookend", pickBookend);
  handle("series:answer-guide", answerSeriesQuestion);
  handle("series:update", async ({ bookends, ...input }) => {
    if (bookends) await saveSeriesBookends(input.id, bookends);
    const series = await updateSeries(input);
    recordDerived(() => [seriesSaved(series, false)]);
    if (input.models !== undefined) {
      void video.followModels(series.id).catch((e) => console.warn("[video] models:", e.message));
    }
    return series;
  });
  handle("notes:update", ({ id, text }) => updateNote(id, text));
  handle("notes:remove", removeNote);
  handle("series:delete", async (id) => {
    const ws = await getWorkspace();
    const sessions = await Promise.all(
      ws.sessions
        .filter((s) => s.seriesId === id)
        .map(async (s) => ({
          sessionId: s.id,
          agentId: (await board.getBoard(s.id).catch(() => null))?.agent?.sessionId,
        })),
    );
    await chat.forget(sessions);
    await video.abandonSessions(sessions.map((s) => s.sessionId));
    return deleteSeries(id);
  });
  handle("session:create", async (input) => {
    const session = await createSession(input);
    record({
      name: "session-created",
      sessionId: session.id,
      seriesId: session.seriesId,
      sessionName: session.name,
      request: session.request ?? "",
    });
    if (session.request) await chat.startFromRequest(session.id);
    return session;
  });
  handle("session:update", async (input) => {
    return updateSession(input);
  });
  handle("session:delete", async (id) => {
    const agentId = (await board.getBoard(id).catch(() => null))?.agent?.sessionId;
    await chat.forget([{ sessionId: id, agentId }]);
    await video.abandonSessions([id]);
    return deleteSession(id);
  });
  const staged = async (sessionId: string, scriptIds?: string[]) => {
    const ids = await board.scriptsToCommit(sessionId, scriptIds);
    await video.assertStaged(sessionId, ids);
    return ids;
  };
  handle("session:approve", async (sessionId, scriptIds) =>
    approveSession(sessionId, await staged(sessionId, scriptIds)),
  );

  handle("board:get", board.getBoard);
  handle("chat:send", chat.send);
  handle("chat:stop", chat.stop);
  handle("chat:discard", ({ sessionId, messageId }) => chat.discard(sessionId, messageId));
  handle("chat:resend", ({ sessionId, messageId }) => chat.resend(sessionId, messageId));
  handle("chat:choose", ({ sessionId, messageId, partId, option }) =>
    chat.choose(sessionId, messageId, partId, option),
  );
  handle("chat:apply-fix", ({ sessionId, messageId, partId }) =>
    chat.applyFix(sessionId, messageId, partId),
  );
  handle("chat:stage-files", ({ sessionId, files }) => stageChatFiles(sessionId, files));
  handle("chat:pick-files", async (sessionId) => {
    const options: Electron.OpenDialogOptions = {
      title: "Đính kèm tệp",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Ảnh, PDF, văn bản", extensions: CHAT_FILE_EXTENSIONS }],
    };
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    return stageChatFiles(
      sessionId,
      result.filePaths.map((path) => ({ name: path.split("/").at(-1) ?? "tệp", path })),
    );
  });
  handle("chat:info", ({ refresh }) => chatInfo(refresh));
  handle("chat:set-model", async ({ sessionId, choice }) => {
    await rememberChoice(choice);
    await chat.setSessionModel(sessionId, choice);
    return null;
  });
  handle("board:variant", ({ sessionId, scriptId, direction }) =>
    board.variant(sessionId, scriptId, direction),
  );
  handle("board:retry", ({ sessionId, scriptId }) => board.retry(sessionId, scriptId));
  handle("board:copy", ({ sessionId, scriptId }) => board.copy(sessionId, scriptId));
  handle("board:delete", async ({ sessionId, ids }) => {
    const active = (await video.jobsFor(sessionId)).some(
      (j) => ids.includes(j.scriptId) && (j.status === "running" || j.status === "waiting"),
    );
    if (active) throw new Error("Video của kịch bản này đang được tạo. Dừng video trước khi xóa.");
    return board.remove(sessionId, ids);
  });
  handle("board:restore", ({ sessionId, ids }) => board.restore(sessionId, ids));
  handle("board:pin", ({ sessionId, scriptId, pinned }) => board.pin(sessionId, scriptId, pinned));
  handle("board:undo", ({ sessionId, messageId }) => products.undoTurn(sessionId, messageId));
  handle("board:set-product", async ({ sessionId, scriptId, productId }) => {
    const change = await products.setProduct(sessionId, scriptId, productId);
    return change ? { scriptId: change.script.id } : null;
  });
  handle("board:undo-change", ({ sessionId, scriptId }) =>
    products.undoChange(sessionId, scriptId),
  );
  handle("board:edit-line", ({ sessionId, scriptId, index, was, text }) =>
    editLine(sessionId, scriptId, { index, was, text }),
  );
  handle("board:remove-line", ({ sessionId, scriptId, index, was }) =>
    removeLine(sessionId, scriptId, { index, was }),
  );
  handle("board:link-speaker", async ({ sessionId, speaker, characterId }) => {
    await board.linkSpeaker(sessionId, speaker, characterId);
    const { ws, session } = await board.findSession(sessionId);
    const series = ws.series.find((s) => s.id === session.seriesId);
    if (series && !series.characterIds.includes(characterId)) {
      await updateSeries({ id: series.id, characterIds: [...series.characterIds, characterId] });
    }
    return null;
  });

  handle("assets:pick-images", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Chọn ảnh tham chiếu",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Ảnh", extensions: IMAGE_EXTENSIONS }],
    };
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : stageImages(result.filePaths);
  });
  handle("assets:stage-paths", stageImages);
  const followVoices = () =>
    void video.followVoices().catch((e) => console.warn("[video] voices:", e.message));
  const checkSaved = <T extends { id: string; kind: string }>(asset: T): T => {
    if (asset.kind === "environment") {
      void checkPlace(asset.id).catch((e) => console.warn("[place] check failed:", e));
    }
    if (asset.kind === "character") followVoices();
    return asset;
  };
  handle("assets:create", async (input) => checkSaved(await createAsset(input)));
  handle("assets:create-batch", createProductBatch);
  handle("products:group", ({ stagedIds }) => {
    if (stagedIds.length > MAX_IMPORT_PHOTOS) {
      throw new Error(`Tối đa ${MAX_IMPORT_PHOTOS} ảnh mỗi lần nhập`);
    }
    return groupProducts(stagedIds.map((id) => imageRefPath({ source: "staged", id })));
  });
  handle("assets:update", async (id, input) => checkSaved(await updateAsset(id, input)));
  handle("assets:delete", async (id) => {
    const using = await board.approvedSessionsUsing(id);
    if (using.length) {
      throw new Error(`Đang dùng trong kịch bản đã duyệt: ${using.join(", ")}`);
    }
    return deleteAsset(id);
  });
  handle("assets:describe", async ({ kind, name, images }) =>
    describeAsset(kind, name, refPaths(await getWorkspace(), images)),
  );

  handle("voices:suggest", suggestVoices);
  const sampleUrl = async (file: string) => {
    const version = await sampleVersion(file);
    return version === null ? null : mediaUrl.voice(file, version);
  };
  const madeSampleUrl = async (file: string) => {
    followVoices();
    const url = await sampleUrl(file);
    if (!url) throw new Error("Không tìm thấy giọng vừa tạo");
    return { url };
  };
  const characterOf = (ask: VoiceSampleAsk) => guessVoiceTraits(ask.name, ask.description);
  handle("voices:sample", async (ask) => ({
    url: await sampleUrl(sampleFile(ask.text, characterOf(ask))),
  }));
  handle("voices:make", async (ask) => madeSampleUrl(await makeSample(ask.text, characterOf(ask))));
  handle("voices:remake", async (ask) =>
    madeSampleUrl(await remakeSample(ask.text, characterOf(ask))),
  );

  handle("assets:check-place", ({ images }) => checkPlaceImages(images));
  handle("assets:estimate-clean", estimateClean);
  handle("assets:accept-place-finding", acceptPlaceFinding);
  handle("assets:cut-out-product-photo", ({ image }) => cutOutProductPhoto(image));
  handle("assets:clean-place-photo", async ({ image, finding }) =>
    cleanPlacePhoto(await placePhotoPath(image), finding),
  );
  handle("assets:estimate-angles", ({ model, count }) => estimateAngles(model, count));
  handle("assets:generate-angles", async ({ model, angles, description, images }) =>
    generateAngles({
      model,
      angles,
      description,
      referencePaths: refPaths(await getWorkspace(), images),
    }),
  );

  handle("material:list", listMaterial);
  handle("material:set-reusable", ({ seriesId, itemId, reusable }) =>
    setMaterialReusable(seriesId, itemId, reusable),
  );
  handle("material:remove", ({ seriesId, itemId }) => removeMaterial(seriesId, itemId));
  handle("material:add-to-character", ({ seriesId, itemId }) =>
    addMaterialToCharacter(seriesId, itemId),
  );

  handle("video:jobs", async (sessionId) => ({
    jobs: await video.jobsFor(sessionId),
    averages: video.currentAverages(),
  }));
  handle("video:paid-work", (sessionIds) =>
    video.paidWorkOf(
      Array.isArray(sessionIds) ? sessionIds.filter((id) => typeof id === "string") : [],
    ),
  );
  handle("video:making", video.videosBeingMadeNow);
  handle("video:start", ({ sessionId, scriptId }) => video.start(sessionId, scriptId));
  handle("video:stage", ({ sessionId, scriptIds, again }) =>
    video.stage(
      sessionId,
      Array.isArray(scriptIds) ? scriptIds.filter((id) => typeof id === "string") : [],
      again === true,
    ),
  );
  handle("video:stage-stop", ({ sessionId, scriptId }) => video.stopStaging(sessionId, scriptId));
  handle("video:direct", ({ sessionId, scriptId, words, want, at }) =>
    video.direct(sessionId, scriptId, {
      ...(words ? { words } : {}),
      want,
      ...(at ? { at } : {}),
    }),
  );
  handle("video:make-all", async ({ sessionId, scriptIds }) => {
    if (scriptIds.length) {
      await approveSession(sessionId, await staged(sessionId, scriptIds));
    }
    return video.runAll(sessionId);
  });
  handle("video:stop", ({ sessionId, scriptId }) => video.stop(sessionId, scriptId));
  handle("video:retry-shot", ({ sessionId, scriptId, shot }) =>
    video.retryShot(sessionId, scriptId, shot),
  );
  handle("video:fix", ({ sessionId, scriptId, changes }) =>
    video.fix(sessionId, scriptId, changes),
  );
  handle("video:restore", ({ sessionId, scriptId }) => video.restore(sessionId, scriptId));
  handle("video:remake", ({ sessionId, scriptId }) => video.remake(sessionId, scriptId));
  handle("video:fresh-picture", ({ sessionId, scriptId, frameId, fresh }) =>
    video.setFreshPicture(sessionId, scriptId, frameId, fresh === true),
  );
  handle("video:tempo", ({ sessionId, scriptId, tempo }) =>
    video.setTempo(sessionId, scriptId, tempo),
  );
  handle("video:save", ({ sessionId, scriptId }) => video.saveFinal(sessionId, scriptId));
  handle("video:save-many", async ({ sessionId, picks }) => {
    const saved = await video.saveFinals(sessionId, picks);
    if (saved && saved.failed.length === 0) {
      const error = await shell.openPath(saved.folder);
      if (error) console.warn("[video] could not open the folder:", error);
    }
    return saved;
  });

  handle("usage:balances", balances);
  handle("usage:media-balance", readMediaBalance);
  handle("usage:stats", async () =>
    usageData(await readCostReport(dataDir(), await getWorkspace())),
  );

  handle("product-key:status", productKeyStatus);
  handle("product-key:save", async (key) => {
    if (video.isMakingVideo() && (await productKeyStatus()).present) {
      return { ok: false, error: "Đang tạo video. Đợi xong rồi đổi mã." };
    }
    const saved = await saveKey(typeof key === "string" ? key : "");
    if (saved.ok) void readMediaBalance();
    return saved;
  });

  const aiStatus = async () => ({
    textProvider: readSettings().textProvider,
    claudeCode: await claudeCodeStatus(),
  });
  handle("ai:status", aiStatus);
  handle("ai:open-terminal", async (action) => {
    if (action !== "install" && action !== "login") throw new Error("Unknown action");
    if (fakeClaudeActive()) {
      void advanceFakeClaude();
      return null;
    }
    const claude = (await findClaude()) ?? "claude";
    const command =
      action === "install"
        ? "curl -fsSL https://claude.ai/install.sh | bash"
        : `'${claude.replace(/'/g, "'\\''")}' auth login`;
    const configDir = process.env.CLAUDE_CONFIG_DIR;
    const exportConfig = configDir
      ? `export CLAUDE_CONFIG_DIR='${configDir.replace(/'/g, "'\\''")}'\n`
      : "";
    const script = childPath(dataDir(), `claude-${action}.command`);
    await writeFile(script, `#!/bin/zsh -l\n${exportConfig}${command}\n`, "utf8");
    await chmod(script, 0o755);
    const error = await shell.openPath(script);
    if (error) throw new Error(error);
    return null;
  });
  handle("ai:install-claude", installClaude);
  handle("ai:onboarded", () => readSettings().onboarded);
  handle("ai:finish-onboarding", async (input) => {
    await writeSettings({
      onboarded: true,
      ...(input?.useClaude === true && { textProvider: "claude-code" as const }),
    });
    return null;
  });
  handle("ai:set-text-provider", async (provider) => {
    if (provider !== "fal" && provider !== "claude-code") throw new Error("Unknown provider");
    if (provider === "fal" && !devFeatures()) throw new Error("Unknown provider");
    await writeSettings({ textProvider: provider });
    return aiStatus();
  });
}
