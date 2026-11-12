import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { ChatAttachment } from "../../shared/ipc";
import { MAX_CHAT_ATTACHMENTS } from "../../shared/ipc";
import { findSession } from "../board";
import { imageBlock } from "../claude-code";
import { mediaDir } from "../paths";

// Files attached to chat messages: images, PDFs and plain text, copied into
// the session folder (media/<series>/<session>/chat-files/) when they are
// added, so a sent message keeps its files even if the originals move.

const KINDS: Record<string, { kind: ChatAttachment["kind"]; maxBytes: number }> = {
  png: { kind: "image", maxBytes: 10 * 1024 * 1024 },
  jpg: { kind: "image", maxBytes: 10 * 1024 * 1024 },
  jpeg: { kind: "image", maxBytes: 10 * 1024 * 1024 },
  webp: { kind: "image", maxBytes: 10 * 1024 * 1024 },
  gif: { kind: "image", maxBytes: 10 * 1024 * 1024 },
  pdf: { kind: "pdf", maxBytes: 20 * 1024 * 1024 },
  txt: { kind: "text", maxBytes: 1024 * 1024 },
  md: { kind: "text", maxBytes: 1024 * 1024 },
  csv: { kind: "text", maxBytes: 1024 * 1024 },
  json: { kind: "text", maxBytes: 1024 * 1024 },
};

export const CHAT_FILE_EXTENSIONS = Object.keys(KINDS);

/** Text sent to the model per text file; longer files are cut. */
const MAX_TEXT_CHARS = 100_000;

export async function chatFilesDir(sessionId: string) {
  const { session } = await findSession(sessionId);
  return join(mediaDir(session.seriesId, session.id), "chat-files");
}

const validId = (id: string) => /^[0-9a-f-]+\.[a-z]+$/.test(id);

export async function chatFilePath(sessionId: string, id: string) {
  if (!validId(id)) throw new Error("Invalid file");
  return join(await chatFilesDir(sessionId), id);
}

export async function stageChatFiles(
  sessionId: string,
  files: { name: string; path?: string; data?: Uint8Array }[],
): Promise<ChatAttachment[]> {
  if (files.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`Tối đa ${MAX_CHAT_ATTACHMENTS} tệp mỗi tin nhắn`);
  }
  const dir = await chatFilesDir(sessionId);
  await mkdir(dir, { recursive: true });
  const staged: ChatAttachment[] = [];
  for (const file of files) {
    const name = basename(file.name || (file.path ? basename(file.path) : "tệp"));
    const ext = extname(name || file.path || "")
      .slice(1)
      .toLowerCase();
    const type = KINDS[ext];
    if (!type) throw new Error(`Chưa hỗ trợ tệp ${name}. Dùng ảnh, PDF hoặc văn bản.`);
    const bytes = file.data ? file.data.byteLength : file.path ? (await stat(file.path)).size : 0;
    if (bytes === 0) throw new Error(`Không đọc được ${name}`);
    if (bytes > type.maxBytes) {
      throw new Error(`${name} quá lớn (tối đa ${Math.round(type.maxBytes / 1024 / 1024)} MB)`);
    }
    const id = `${randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;
    if (file.data) await writeFile(join(dir, id), file.data);
    else if (file.path) await copyFile(file.path, join(dir, id));
    staged.push({ id, name, kind: type.kind, bytes });
  }
  return staged;
}

/** Content blocks for the model, in the order the files were attached. */
export async function attachmentBlocks(sessionId: string, attachments: ChatAttachment[]) {
  const blocks: unknown[] = [];
  for (const a of attachments) {
    const path = await chatFilePath(sessionId, a.id);
    if (a.kind === "image") {
      blocks.push({ type: "text", text: `Ảnh đính kèm: ${a.name}` });
      blocks.push(await imageBlock(path, 1568));
    } else if (a.kind === "pdf") {
      blocks.push({
        type: "document",
        title: a.name,
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: (await readFile(path)).toString("base64"),
        },
      });
    } else {
      const text = await readFile(path, "utf8");
      blocks.push({
        type: "text",
        text: `Tệp đính kèm ${a.name}:\n${text.slice(0, MAX_TEXT_CHARS)}${
          text.length > MAX_TEXT_CHARS ? "\n(…đã cắt bớt)" : ""
        }`,
      });
    }
  }
  return blocks;
}
