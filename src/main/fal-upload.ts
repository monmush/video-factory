import { readFile } from "node:fs/promises";
import { nativeImage } from "electron";
import type { Fal } from "./fal";

async function toUploadBlob(path: string, maxSide: number): Promise<Blob> {
  const image = nativeImage.createFromPath(path);
  if (!image.isEmpty()) {
    const { width, height } = image.getSize();
    const scaled =
      Math.max(width, height) > maxSide
        ? image.resize(width >= height ? { width: maxSide } : { height: maxSide })
        : image;
    return new Blob([new Uint8Array(scaled.toPNG())], { type: "image/png" });
  }
  return new Blob([new Uint8Array(await readFile(path))]);
}

export function uploadImages(fal: Fal, paths: string[], maxSide = 1536): Promise<string[]> {
  return Promise.all(paths.map(async (p) => fal.storage.upload(await toUploadBlob(p, maxSide))));
}

export async function uploadFile(fal: Fal, path: string, type: string): Promise<string> {
  return fal.storage.upload(new Blob([new Uint8Array(await readFile(path))], { type }));
}
