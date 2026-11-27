import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Asset, AssetKind, Series, Workspace } from "../shared/ipc";
import { buildShare } from "../shared/setup-share";
import { exportSetup, importSetup } from "./setup-file";
import { openStoredZip, writeStoredZip } from "./stored-zip";

const at = "2026-11-01T00:00:00.000Z";
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((f) => rm(f, { recursive: true, force: true })));
});

async function tempFolder() {
  const folder = await mkdtemp(join(tmpdir(), "setup-file-"));
  folders.push(folder);
  return folder;
}

async function put(root: string, path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

const asset = (id: string, kind: AssetKind, handle: string, name = id): Asset => ({
  id,
  kind,
  name,
  handle,
  description: "",
  images: [{ id: `${id}-img`, file: "photo.png" }],
  ...(kind === "character" ? { voice: "Giọng nữ trẻ" } : {}),
  createdAt: at,
  updatedAt: at,
});

const series: Series = {
  id: "series-1",
  name: "Series một",
  guidance: "",
  characterIds: ["hero"],
  productIds: ["soap"],
  environmentIds: ["shop"],
  pinnedAt: at,
  createdAt: at,
  updatedAt: at,
};

async function senderFolder(): Promise<{ dataDir: string; ws: Workspace }> {
  const dataDir = await tempFolder();
  const ws: Workspace = {
    version: 1,
    series: [series],
    sessions: [
      {
        id: "batch-1",
        seriesId: "series-1",
        name: "b",
        approvedAt: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
    assets: [
      asset("hero", "character", "lan", "Lan gốc"),
      asset("soap", "product", "xa-phong"),
      asset("shop", "environment", "cua-hang"),
    ],
  };
  await put(dataDir, "workspace.json", JSON.stringify(ws));
  await put(dataDir, "secrets.json", '{"fal":"key"}');
  for (const a of ws.assets) await put(dataDir, `assets/${a.id}/photo.png`, `image of ${a.id}`);
  await put(dataDir, "voices/abc.mp3", "voice sample");
  await put(dataDir, "media/series-1/_material/material.json", "[]");
  await put(dataDir, "media/series-1/_material/clip.mp4", "clip bytes");
  await put(dataDir, "media/series-1/_look/look.json", "{}");
  await put(dataDir, "media/series-1/_look/still.png", "still bytes");
  await put(dataDir, "media/series-1/_bookends/outro-1.mp4", "outro bytes");
  await put(dataDir, "media/series-1/batch-1/videos/v/final.mp4", "video bytes");
  return { dataDir, ws };
}

async function receiverFolder(): Promise<{ dataDir: string; ws: Workspace }> {
  const dataDir = await tempFolder();
  const ws: Workspace = {
    version: 1,
    series: [],
    sessions: [],
    assets: [
      asset("hero", "character", "lan", "Lan đã sửa"),
      asset("other", "product", "xa-phong"),
    ],
  };
  await put(dataDir, "assets/hero/photo.png", "local edit");
  return { dataDir, ws };
}

async function listFiles(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(root.length + 1))
    .sort();
}

describe("share a setup", () => {
  it("carries series and library to another data folder without batches, videos or keys", async () => {
    const sender = await senderFolder();
    const receiver = await receiverFolder();
    const downloads = await tempFolder();
    const file = await exportSetup({
      dataDir: sender.dataDir,
      destination: downloads,
      ws: sender.ws,
      appVersion: "1.0.0",
      now: new Date(2026, 10, 27, 9, 5),
    });
    expect(file).toBe(join(downloads, "thiet-lap-2026-11-27-0905.vfsetup"));

    const zip = await openStoredZip(file);
    const travelled = zip.entries.map((e) => e.path).sort();
    await zip.close();
    expect(travelled).toEqual([
      "assets/hero/photo.png",
      "assets/shop/photo.png",
      "assets/soap/photo.png",
      "media/series-1/_bookends/outro-1.mp4",
      "media/series-1/_look/look.json",
      "media/series-1/_look/still.png",
      "media/series-1/_material/clip.mp4",
      "media/series-1/_material/material.json",
      "share.json",
      "voices/abc.mp3",
    ]);

    const result = await importSetup({ file, dataDir: receiver.dataDir, ws: receiver.ws });
    expect(result).toEqual({ series: 1, assets: 2, skipped: 1 });

    expect(await listFiles(receiver.dataDir)).toEqual([
      "assets/hero/photo.png",
      "assets/shop/photo.png",
      "assets/soap/photo.png",
      "media/series-1/_bookends/outro-1.mp4",
      "media/series-1/_look/look.json",
      "media/series-1/_look/still.png",
      "media/series-1/_material/clip.mp4",
      "media/series-1/_material/material.json",
      "voices/abc.mp3",
    ]);
    expect(await readFile(join(receiver.dataDir, "assets/hero/photo.png"), "utf8")).toBe(
      "local edit",
    );
    expect(
      await readFile(join(receiver.dataDir, "media/series-1/_material/clip.mp4"), "utf8"),
    ).toBe("clip bytes");

    expect(receiver.ws.sessions).toEqual([]);
    expect(receiver.ws.assets.find((a) => a.id === "hero")?.name).toBe("Lan đã sửa");
    expect(receiver.ws.assets.find((a) => a.id === "soap")?.handle).toBe("xa-phong-2");
    const imported = receiver.ws.series[0];
    expect(imported).toMatchObject({
      id: "series-1",
      characterIds: ["hero"],
      productIds: ["soap"],
    });
    expect(imported).not.toHaveProperty("pinnedAt");
  });

  it("creates the folder of an added series that has no material", async () => {
    const sender = await senderFolder();
    sender.ws.series.push({ ...series, id: "bare" });
    const file = await exportSetup({
      dataDir: sender.dataDir,
      destination: await tempFolder(),
      ws: sender.ws,
      appVersion: "1",
    });
    const receiver = await receiverFolder();
    await importSetup({ file, dataDir: receiver.dataDir, ws: receiver.ws });
    expect(await readdir(join(receiver.dataDir, "media/bare"))).toEqual([]);
  });

  it("writes only entries for what was just added, whatever else the file holds", async () => {
    const work = await tempFolder();
    const receiver = await receiverFolder();
    const share = buildShare(
      { version: 1, series: [], sessions: [], assets: [asset("new", "product", "moi")] },
      { createdAt: at, appVersion: "1" },
    );
    await put(work, "share.json", JSON.stringify(share));
    await put(work, "payload", "planted");
    const payload = join(work, "payload");
    const file = join(work, "evil.vfsetup");
    await writeStoredZip(file, [
      { path: "share.json", file: join(work, "share.json") },
      { path: "assets/new/photo.png", file: payload },
      { path: "assets/new/../../x", file: payload },
      { path: "assets/new/sub/deep.png", file: payload },
      { path: "assets/hero/photo.png", file: payload },
      { path: "secrets.json", file: payload },
      { path: "media/series-1/batch-1/final.mp4", file: payload },
      { path: "workspace.json", file: payload },
    ]);
    await importSetup({ file, dataDir: receiver.dataDir, ws: receiver.ws });
    expect(await listFiles(receiver.dataDir)).toEqual([
      "assets/hero/photo.png",
      "assets/new/photo.png",
    ]);
    expect(await readFile(join(receiver.dataDir, "assets/hero/photo.png"), "utf8")).toBe(
      "local edit",
    );
  });

  it("leaves the workspace unchanged when files cannot be written", async () => {
    const sender = await senderFolder();
    const file = await exportSetup({
      dataDir: sender.dataDir,
      destination: await tempFolder(),
      ws: sender.ws,
      appVersion: "1",
    });
    const receiver = await receiverFolder();
    await put(receiver.dataDir, "media", "a file where a folder belongs");
    const before = structuredClone(receiver.ws);
    await expect(
      importSetup({ file, dataDir: receiver.dataDir, ws: receiver.ws }),
    ).rejects.toThrow();
    expect(receiver.ws).toEqual(before);
    expect(await readdir(join(receiver.dataDir, "assets"))).toEqual(["hero"]);
  });

  it("refuses a file that is not a setup", async () => {
    const work = await tempFolder();
    await put(work, "photo.vfsetup", "not a zip at all, just text");
    const receiver = await receiverFolder();
    await expect(
      importSetup({
        file: join(work, "photo.vfsetup"),
        dataDir: receiver.dataDir,
        ws: receiver.ws,
      }),
    ).rejects.toThrow("Tệp không hợp lệ.");
  });
});
