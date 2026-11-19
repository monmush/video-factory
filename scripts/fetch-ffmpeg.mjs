import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VERSION = "9.0.2";
const BASE = `https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_${VERSION}`;
const BINARIES = {
  ffmpeg: {
    zip: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
    binary: "2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384",
  },
  ffprobe: {
    zip: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
    binary: "2738aa46a7f9acbc8ab09a6715554c90f7de603171ac403726765685df6a0059",
  },
};

const target = resolve(import.meta.dirname, "..", "resources", "bin", "darwin-arm64");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const isCurrent = (name) => {
  const path = join(target, name);
  return existsSync(path) && sha256(path) === BINARIES[name].binary;
};

const license = `FFmpeg ${VERSION}, static macOS arm64 build by Martin Riedl
Binaries: ${BASE}/
Source code: https://ffmpeg.org/releases/ffmpeg-${VERSION}.tar.xz
Build scripts: https://git.martin-riedl.de/ffmpeg/build-script

This build is configured with --enable-gpl --enable-version3 and includes libx264,
so ffmpeg and ffprobe are distributed under the GNU General Public License, version 3
or later: https://www.gnu.org/licenses/gpl-3.0.txt
`;

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

mkdirSync(target, { recursive: true });
writeFileSync(join(target, "FFMPEG-LICENSE.txt"), license);

const missing = Object.keys(BINARIES).filter((name) => !isCurrent(name));
if (missing.length === 0) {
  console.log(`FFmpeg ${VERSION} already in ${target}`);
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "hyan-ffmpeg-"));
try {
  for (const name of missing) {
    const zip = join(work, `${name}.zip`);
    console.log(`Downloading ${name} ${VERSION}`);
    await download(`${BASE}/${name}.zip`, zip);
    if (sha256(zip) !== BINARIES[name].zip) throw new Error(`${name}.zip checksum mismatch`);
    const unpacked = join(work, name);
    execFileSync("ditto", ["-x", "-k", zip, unpacked]);
    const binary = join(unpacked, name);
    if (sha256(binary) !== BINARIES[name].binary) throw new Error(`${name} checksum mismatch`);
    copyFileSync(binary, join(target, name));
    chmodSync(join(target, name), 0o755);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`FFmpeg ${VERSION} ready in ${target}`);
