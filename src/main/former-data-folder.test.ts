import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adoptFormerFolder } from "./former-data-folder";

const FORMER = "Hy An Video Factory";
const NOW = "M5 Studio";

function appData(formerSuffix: string | null) {
  const root = mkdtempSync(join(tmpdir(), "former-folder-"));
  if (formerSuffix !== null) {
    mkdirSync(join(root, `${FORMER}${formerSuffix}`));
    writeFileSync(join(root, `${FORMER}${formerSuffix}`, "workspace.json"), "old work");
  }
  return root;
}

describe("adoptFormerFolder", () => {
  it("brings the work saved under the former app name to the new name", () => {
    const root = appData("");
    adoptFormerFolder(join(root, NOW), NOW);
    expect(readFileSync(join(root, NOW, "workspace.json"), "utf8")).toBe("old work");
    expect(existsSync(join(root, FORMER))).toBe(false);
  });

  it("replaces an empty folder the system already made under the new name", () => {
    const root = appData("");
    mkdirSync(join(root, NOW));
    adoptFormerFolder(join(root, NOW), NOW);
    expect(readFileSync(join(root, NOW, "workspace.json"), "utf8")).toBe("old work");
  });

  it("never replaces work already saved under the new name", () => {
    const root = appData("");
    mkdirSync(join(root, NOW));
    writeFileSync(join(root, NOW, "workspace.json"), "new work");
    adoptFormerFolder(join(root, NOW), NOW);
    expect(readFileSync(join(root, NOW, "workspace.json"), "utf8")).toBe("new work");
    expect(readFileSync(join(root, FORMER, "workspace.json"), "utf8")).toBe("old work");
  });

  it("matches the development and profile folders by their suffix", () => {
    const root = appData(" (dev) profiles");
    adoptFormerFolder(join(root, `${NOW} (dev)`), NOW);
    expect(existsSync(join(root, `${NOW} (dev)`))).toBe(false);
    adoptFormerFolder(join(root, `${NOW} (dev) profiles`), NOW);
    expect(existsSync(join(root, `${NOW} (dev) profiles`, "workspace.json"))).toBe(true);
  });
});
