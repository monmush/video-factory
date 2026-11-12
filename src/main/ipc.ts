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
  updateSeries,
  updateSession,
} from "./store";

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
    return deleteSession(id);
  });
  handle("session:approve", async (sessionId) => {
    await board.assertApprovable(sessionId);
    return approveSession(sessionId);
  });

  handle("board:get", board.getBoard);
  handle("chat:send", chat.send);
  handle("chat:stop", chat.stop);
  handle("chat:discard", ({ sessionId, messageId }) => chat.discard(sessionId, messageId));
  handle("chat:resend", ({ sessionId, messageId }) => chat.resend(sessionId, messageId));
  handle("chat:choose", ({ sessionId, messageId, partId, option }) =>
    chat.choose(sessionId, messageId, partId, option),
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
  handle("board:delete", ({ sessionId, ids }) => board.remove(sessionId, ids));
  handle("board:restore", ({ sessionId, ids }) => board.restore(sessionId, ids));
  handle("board:pin", ({ sessionId, scriptId, pinned }) => board.pin(sessionId, scriptId, pinned));
  handle("board:undo", ({ sessionId, messageId }) => board.undo(sessionId, messageId));

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
  handle("assets:create", createAsset);
  handle("assets:create-batch", createProductBatch);
  handle("products:group", ({ stagedIds }) => {
    if (stagedIds.length > MAX_IMPORT_PHOTOS) {
      throw new Error(`Tối đa ${MAX_IMPORT_PHOTOS} ảnh mỗi lần nhập`);
    }
    return groupProducts(stagedIds.map((id) => imageRefPath({ source: "staged", id })));
  });
  handle("assets:update", updateAsset);
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

  handle("assets:estimate-angles", ({ model, count }) => estimateAngles(model, count));
  handle("assets:generate-angles", async ({ model, angles, description, images }) =>
    generateAngles({
      model,
      angles,
      description,
      referencePaths: refPaths(await getWorkspace(), images),
    }),
  );

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
