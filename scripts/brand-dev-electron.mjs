import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const productName = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).productName;
const appIcon = join(root, "build", "icon.icns");
const brandedFolder = join(root, "node_modules", ".m5-studio-dev");
const brandedBundle = join(brandedFolder, `${productName}.app`);
const stampFile = join(brandedFolder, "stamp.json");
const LAUNCH_SERVICES_REGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

function stockElectron() {
  const electronPackage = createRequire(join(root, "package.json")).resolve(
    "electron/package.json",
  );
  return {
    bundle: join(dirname(electronPackage), "dist", "Electron.app"),
    version: JSON.parse(readFileSync(electronPackage, "utf8")).version,
  };
}

function brandingStamp(electronVersion) {
  const iconHash = createHash("sha256").update(readFileSync(appIcon)).digest("hex");
  return JSON.stringify({ electronVersion, productName, iconHash });
}

function setPlistValue(plist, key, value) {
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
}

function buildBrandedBundle(stockBundle) {
  rmSync(brandedFolder, { recursive: true, force: true });
  mkdirSync(brandedFolder, { recursive: true });
  execFileSync("cp", ["-cR", stockBundle, brandedBundle]);
  const plist = join(brandedBundle, "Contents", "Info.plist");
  setPlistValue(plist, "CFBundleName", productName);
  setPlistValue(plist, "CFBundleDisplayName", productName);
  copyFileSync(appIcon, join(brandedBundle, "Contents", "Resources", "electron.icns"));
  execFileSync(LAUNCH_SERVICES_REGISTER, ["-f", brandedBundle]);
}

function brandedExecutable() {
  const stock = stockElectron();
  const wanted = brandingStamp(stock.version);
  const current = existsSync(stampFile) ? readFileSync(stampFile, "utf8") : "";
  if (current !== wanted || !existsSync(brandedBundle)) {
    buildBrandedBundle(stock.bundle);
    writeFileSync(stampFile, wanted);
    console.error(`[dev] ${productName}.app prepared from Electron ${stock.version}`);
  }
  return join(brandedBundle, "Contents", "MacOS", "Electron");
}

if (process.platform === "darwin") process.stdout.write(brandedExecutable());
