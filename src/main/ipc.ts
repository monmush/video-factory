import { chmod, writeFile } from "node:fs/promises";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { type IpcChannel, type IpcContract, MAX_IMPORT_PHOTOS } from "../shared/ipc";
import { estimateAngles, generateAngles } from "./angles";
import { createAsset, createProductBatch, deleteAsset, refPaths, updateAsset } from "./assets";
import { balances } from "./balances";
import * as board from "./board";
import { CHAT_FILE_EXTENSIONS, stageChatFiles } from "./chat/files";
import { chatInfo, rememberChoice } from "./chat/models";
import * as chat from "./chat/runtime";
import { claudeCodeStatus, findClaude } from "./claude-code";
import { describeAsset } from "./describe";
import { IMAGE_EXTENSIONS, imageRefPath, stageImages } from "./media";
import { dataDir, dataFile } from "./paths";
import {
  checkPlace,
  checkPlaceImages,
  cleanPlacePhoto,
  estimateClean,
  placePhotoPath,
} from "./place-check";
import * as products from "./product-change";
import { groupProducts } from "./product-grouping";
import { clearKey, providersInfo, setKey } from "./providers";
import { readSettings, writeSettings } from "./settings";
import {
  approveSession,
  createSeries,
  createSession,
  deleteSeries,
  deleteSession,
  getWorkspace,
  removeNote,
  updateNote,
  updateSeries,
  updateSession,
} from "./store";
import * as video from "./video/runner";

type Handler<C extends IpcChannel> = (
  ...args: IpcContract[C]["args"]
) => IpcContract[C]["result"] | Promise<IpcContract[C]["result"]>;

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>) {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as IpcContract[C]["args"])));
}

export function registerIpc() {
  handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    dataDir: dataDir(),
  }));
  handle("app:open-data-dir", async () => {
    await shell.openPath(dataDir());
    return null;
  });
  handle("theme:set", async (preference) => {
    nativeTheme.themeSource = preference;
    await writeSettings({ theme: preference });
    return null;
  });

  handle("workspace:get", getWorkspace);
  handle("series:create", createSeries);
  handle("series:update", updateSeries);
  handle("notes:update", ({ id, text }) => updateNote(id, text));
  handle("notes:remove", removeNote);
  handle("series:delete", async (id) => {
    // Claude transcripts of the series' sessions go with it.
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
    for (const s of sessions) video.forgetSession(s.sessionId);
    return deleteSeries(id);
  });
  handle("session:create", async (input) => {
    const session = await createSession(input);
    if (session.request) await chat.startFromRequest(session.id);
    return session;
  });
  handle("session:update", updateSession);
  handle("session:delete", async (id) => {
    // The session's Claude transcript goes with it.
    const agentId = (await board.getBoard(id).catch(() => null))?.agent?.sessionId;
    await chat.forget([{ sessionId: id, agentId }]);
    video.forgetSession(id);
    return deleteSession(id);
  });
  handle("session:approve", async (sessionId, scriptIds) => {
    const ids = await board.scriptsToCommit(sessionId, scriptIds);
    // Experiment branch: committing only sends the scripts to the Video tab.
    // Each video is planned there at the batch's Media level and made by its own hold.
    return approveSession(sessionId, ids);
  });

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
    // A video still being made keeps its script; stopping it comes first.
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
    await products.setProduct(sessionId, scriptId, productId);
    return null;
  });
  handle("board:undo-product", ({ sessionId, scriptId }) =>
    products.undoProduct(sessionId, scriptId),
  );
  handle("board:link-speaker", async ({ sessionId, speaker, characterId }) => {
    await board.linkSpeaker(sessionId, speaker, characterId);
    // The character now speaks in this series, so the writer should know it.
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
  // A saved place's photos are checked in the background (free; never blocks saving).
  const checkSaved = <T extends { id: string; kind: string }>(asset: T): T => {
    if (asset.kind === "environment") {
      void checkPlace(asset.id).catch((e) => console.warn("[place] check failed:", e));
    }
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

  handle("assets:check-place", ({ images }) => checkPlaceImages(images));
  handle("assets:estimate-clean", estimateClean);
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

  handle("video:jobs", async (sessionId) => ({
    jobs: await video.jobsFor(sessionId),
    averages: video.currentAverages(),
  }));
  handle("video:start", ({ sessionId, scriptId }) => video.start(sessionId, scriptId));
  handle("video:plan", ({ sessionId, scriptId }) => video.planOnly(sessionId, scriptId));
  handle("video:replan", ({ sessionId, scriptId }) => video.replan(sessionId, scriptId));
  handle("video:make-all", async ({ sessionId, scriptIds }) => {
    if (scriptIds.length) {
      const ids = await board.scriptsToCommit(sessionId, scriptIds);
      await approveSession(sessionId, ids);
    }
    return video.runAll(sessionId);
  });
  handle("video:stop", ({ sessionId, scriptId }) => video.stop(sessionId, scriptId));
  handle("video:retry-shot", ({ sessionId, scriptId, shot }) =>
    video.retryShot(sessionId, scriptId, shot),
  );
  handle("video:fix", ({ sessionId, scriptId, changes, take }) =>
    video.fix(sessionId, scriptId, changes, undefined, take),
  );
  handle("video:restore", ({ sessionId, scriptId, take }) =>
    video.restore(sessionId, scriptId, take),
  );
  handle("video:set-model", ({ sessionId, scriptId, model }) =>
    video.setModel(sessionId, scriptId, model),
  );
  handle("video:take", ({ sessionId, scriptId, action, model }) =>
    video.take(sessionId, scriptId, action, model),
  );
  handle("video:save", ({ sessionId, scriptId }) => video.saveFinal(sessionId, scriptId));

  handle("usage:balances", balances);

  handle("providers:status", providersInfo);
  handle("providers:set-key", setKey);
  handle("providers:clear-key", clearKey);

  const aiStatus = async () => ({
    textProvider: readSettings().textProvider,
    claudeCode: await claudeCodeStatus(),
  });
  handle("ai:status", aiStatus);
  // Anthropic's own install and sign-in, run visibly in the user's Terminal.
  // The app never sees the credentials.
  handle("ai:open-terminal", async (action) => {
    const claude = (await findClaude()) ?? "claude";
    const command =
      action === "install"
        ? "curl -fsSL https://claude.ai/install.sh | bash"
        : `'${claude.replace(/'/g, "'\\''")}' auth login`;
    const script = dataFile(`claude-${action}.command`);
    await writeFile(script, `#!/bin/zsh -l\n${command}\n`, "utf8");
    await chmod(script, 0o755);
    const error = await shell.openPath(script);
    if (error) throw new Error(error);
    return null;
  });
  handle("ai:set-text-provider", async (provider) => {
    if (provider !== "fal" && provider !== "claude-code") throw new Error("Unknown provider");
    await writeSettings({ textProvider: provider });
    return aiStatus();
  });
}
