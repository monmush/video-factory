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

const BUILDS = {
  arm64: {
    version: "9.0.2",
    base: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2",
    binaries: {
      ffmpeg: {
        zip: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
        binary: "2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384",
      },
      ffprobe: {
        zip: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
        binary: "2738aa46a7f9acbc8ab09a6715554c90f7de603171ac403726765685df6a0059",
      },
    },
  },
  x64: {
    version: "9.1",
    base: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1795212433_9.1",
    binaries: {
      ffmpeg: {
        zip: "35b3d82cccc2c1d644d49d15f5e57eb913a08ef68f798042c90eecec62c51f1e",
        binary: "1d6e304464619a50c36dfc9a6a2f08bc124cef7f7901fa66158b9d5df1da9be2",
      },
      ffprobe: {
        zip: "41ca7b7cba7992e33f1da3f1bf54db8ec103a4d387b1bfac3162062e8b1074ad",
        binary: "08628babfba2b69c83f5071586d75207feb698594304e4bee0c5c134a258f1d1",
      },
    },
  },
};

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const license = (
  arch,
  { version, base },
) => `FFmpeg ${version}, static macOS ${arch} build by Martin Riedl
Binaries: ${base}/
Source code: https://ffmpeg.org/releases/ffmpeg-${version}.tar.xz
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

async function fetchBuild(arch) {
  const build = BUILDS[arch];
  if (!build)
    throw new Error(`No FFmpeg build for ${arch}; known: ${Object.keys(BUILDS).join(", ")}`);
  const target = resolve(import.meta.dirname, "..", "resources", "bin", `darwin-${arch}`);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "FFMPEG-LICENSE.txt"), license(arch, build));

  const missing = Object.keys(build.binaries).filter((name) => {
    const path = join(target, name);
    return !existsSync(path) || sha256(path) !== build.binaries[name].binary;
  });
  if (missing.length === 0) {
    console.log(`FFmpeg ${build.version} already in ${target}`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "hyan-ffmpeg-"));
  try {
    for (const name of missing) {
      const zip = join(work, `${name}.zip`);
      console.log(`Downloading ${name} ${build.version} (${arch})`);
      await download(`${build.base}/${name}.zip`, zip);
      if (sha256(zip) !== build.binaries[name].zip)
        throw new Error(`${name}.zip checksum mismatch`);
      const unpacked = join(work, name);
      execFileSync("ditto", ["-x", "-k", zip, unpacked]);
      const binary = join(unpacked, name);
      if (sha256(binary) !== build.binaries[name].binary)
        throw new Error(`${name} checksum mismatch`);
      copyFileSync(binary, join(target, name));
      chmodSync(join(target, name), 0o755);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`FFmpeg ${build.version} ready in ${target}`);
}

const requested = process.argv.slice(2);
for (const arch of requested.length > 0 ? requested : Object.keys(BUILDS)) await fetchBuild(arch);
