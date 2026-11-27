import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Zippable, zip } from "fflate";

const pad = (n: number) => String(n).padStart(2, "0");

export const dateStamp = (now: Date) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

const nthName = (base: string, attempt: number) => `${base}${attempt > 1 ? `-${attempt}` : ""}.zip`;

export async function writeZipUnderFreeName(
  destination: string,
  base: string,
  bytes: Uint8Array,
): Promise<string> {
  await mkdir(destination, { recursive: true });
  for (let attempt = 1; ; attempt++) {
    const file = join(destination, nthName(base, attempt));
    try {
      await writeFile(file, bytes, { flag: "wx" });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

export const zipped = (files: Zippable) =>
  new Promise<Uint8Array>((resolve, reject) =>
    zip(files, (error, data) => (error ? reject(error) : resolve(data))),
  );

export const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
