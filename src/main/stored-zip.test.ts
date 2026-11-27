import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openStoredZip, writeStoredZip } from "./stored-zip";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((f) => rm(f, { recursive: true, force: true })));
});

async function tempFolder() {
  const folder = await mkdtemp(join(tmpdir(), "stored-zip-"));
  folders.push(folder);
  return folder;
}

function bytesWithSignatures(size: number): Buffer {
  const bytes = randomBytes(size);
  for (let at = 0; at + 8 < size; at += 65_537) {
    bytes.write("PK\x03\x04", at, "latin1");
    bytes.write("PK\x07\x08", at + 4, "latin1");
  }
  return bytes;
}

async function zipOf(folder: string, files: Record<string, Buffer>) {
  const sources = await Promise.all(
    Object.entries(files).map(async ([path, bytes], index) => {
      const file = join(folder, `source-${index}`);
      await writeFile(file, bytes);
      return { path, file };
    }),
  );
  const target = join(folder, "out.zip");
  await writeStoredZip(target, sources);
  return target;
}

describe("stored zip", () => {
  it("extracts every file byte for byte, including large binary and UTF-8 paths", async () => {
    const folder = await tempFolder();
    const files = {
      "share.json": Buffer.from('{"hello":"xin chào"}'),
      "media/series/_material/clip.mp4": bytesWithSignatures(3 * 1024 * 1024 + 17),
      "assets/a/ảnh nhân vật.png": randomBytes(1000),
      "voices/empty.mp3": Buffer.alloc(0),
    };
    const archive = await zipOf(folder, files);
    const zip = await openStoredZip(archive);
    try {
      expect(zip.entries.map((e) => e.path).sort()).toEqual(Object.keys(files).sort());
      expect(await zip.readText("share.json")).toBe('{"hello":"xin chào"}');
      for (const entry of zip.entries) {
        const target = join(folder, `extracted-${zip.entries.indexOf(entry)}`);
        await zip.extract(entry, target);
        expect((await readFile(target)).equals(files[entry.path as keyof typeof files])).toBe(true);
      }
    } finally {
      await zip.close();
    }
  });

  it("rejects a file that is not a zip", async () => {
    const folder = await tempFolder();
    const file = join(folder, "not.vfsetup");
    await writeFile(file, "PK\x03\x04 just some text that looks like a zip start".repeat(10));
    await expect(openStoredZip(file)).rejects.toThrow("Tệp không hợp lệ.");
  });

  it("rejects a truncated zip instead of returning part of it", async () => {
    const folder = await tempFolder();
    const archive = await zipOf(folder, {
      "a.bin": randomBytes(200_000),
      "b.bin": randomBytes(200_000),
    });
    await truncate(archive, 300_000);
    await expect(openStoredZip(archive)).rejects.toThrow("Tệp không hợp lệ.");
  });
});
