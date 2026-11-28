import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { BrowserWindow, dialog } from "electron";
import { mediaUrl, type UploadedVoice } from "../shared/ipc";
import { uploadedSampleName } from "../shared/voices";
import { voicesDir } from "./paths";
import { probeSeconds, probeStreams, voiceSample } from "./video/ffmpeg";
import { SHORTEST_SAMPLE_SEC, samplePath, sampleVersion } from "./voice-maker";

const VOICE_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "mp4", "mov", "m4v", "webm"];
const NO_SOUND = "Tệp này không có âm thanh";
const TOO_SHORT = `Giọng mẫu cần dài ít nhất ${SHORTEST_SAMPLE_SEC} giây`;

async function pickedVoiceFile(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Chọn tệp giọng nói",
    properties: ["openFile"],
    filters: [{ name: "Âm thanh hoặc video", extensions: VOICE_EXTENSIONS }],
  };
  const win = BrowserWindow.getFocusedWindow();
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function assertHasSound(path: string): Promise<void> {
  const streams = await probeStreams(path).catch(() => null);
  if (!streams?.audio) throw new Error(NO_SOUND);
}

async function keepUpload(source: string): Promise<string> {
  await mkdir(voicesDir(), { recursive: true });
  const tmp = samplePath(`upload.${randomUUID()}.tmp.mp3`);
  try {
    await voiceSample(source, tmp);
    if ((await probeSeconds(tmp)) < SHORTEST_SAMPLE_SEC) throw new Error(TOO_SHORT);
    const hash = createHash("sha256")
      .update(await readFile(tmp))
      .digest("hex");
    const file = uploadedSampleName(hash);
    await rename(tmp, samplePath(file));
    return file;
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function pickUploadedVoice(): Promise<UploadedVoice | null> {
  const source = await pickedVoiceFile();
  if (!source) return null;
  await assertHasSound(source);
  const file = await keepUpload(source);
  const version = await sampleVersion(file);
  if (version === null) throw new Error("Không tìm thấy giọng đã tải lên");
  return { file, url: mediaUrl.voice(file, version) };
}
