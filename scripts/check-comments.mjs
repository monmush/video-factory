import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";
import { skipTrivia } from "typescript/unstable/ast/scanner";
import { API } from "typescript/unstable/sync";

const root = resolve(import.meta.dirname, "..");
const projectConfigs = ["tsconfig.node.json", "tsconfig.web.json"];
const allowedDirectivePrefixes = ["// biome-ignore lint/a11y/", "/* biome-ignore lint/a11y/"];

const literalKinds = new Set([
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
  SyntaxKind.RegularExpressionLiteral,
]);

function literalRanges(sourceFile) {
  const ranges = [];
  const visit = (node) => {
    if (node.kind === SyntaxKind.JsxText) {
      ranges.push([node.pos, node.end]);
    } else if (literalKinds.has(node.kind)) {
      ranges.push([skipTrivia(sourceFile.text, node.pos), node.end]);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return ranges.sort((a, b) => a[0] - b[0]);
}

function lineEnd(text, from) {
  let at = from;
  while (at < text.length && text[at] !== "\n" && text[at] !== "\r") at++;
  return at;
}

export function commentRanges(sourceFile) {
  const text = sourceFile.text;
  const literals = literalRanges(sourceFile);
  const comments = [];
  let next = 0;
  let at = 0;
  while (at < text.length) {
    const literal = literals[next];
    if (literal && at >= literal[0]) {
      at = Math.max(at, literal[1]);
      next++;
      continue;
    }
    if (text[at] === "/" && text[at + 1] === "/") {
      const end = lineEnd(text, at);
      comments.push({ start: at, end });
      at = end;
    } else if (text[at] === "/" && text[at + 1] === "*") {
      const close = text.indexOf("*/", at + 2);
      const end = close === -1 ? text.length : close + 2;
      comments.push({ start: at, end });
      at = end;
    } else {
      at++;
    }
  }
  return comments;
}

function sourceFilesOnDisk() {
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(root, entry.name));
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  walk(join(root, "src"));
  return files;
}

export function withParsedFiles(filter, use) {
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({
      openProjects: projectConfigs.map((config) => join(root, config)),
    });
    const programs = snapshot.getProjects().map((project) => project.program);
    const parsed = [];
    const unparsed = [];
    for (const path of sourceFilesOnDisk().filter(filter)) {
      const sourceFile = programs
        .map((program) => program.getSourceFile(path))
        .find((file) => file !== undefined);
      if (sourceFile) parsed.push({ path, sourceFile });
      else unparsed.push(path);
    }
    return use(parsed, unparsed);
  } finally {
    api.close();
  }
}

function lineOf(text, offset) {
  let line = 1;
  for (let at = 0; at < offset; at++) if (text[at] === "\n") line++;
  return line;
}

function isAllowedDirective(comment) {
  return allowedDirectivePrefixes.some((prefix) => comment.startsWith(prefix));
}

function main() {
  const scopes = process.argv.slice(2).map((arg) => resolve(root, arg));
  const inScope = (path) =>
    scopes.length === 0 || scopes.some((scope) => path === scope || path.startsWith(scope + sep));
  const problems = withParsedFiles(inScope, (parsed, unparsed) => {
    const found = unparsed.map((path) => `${relative(root, path)}: not in any tsconfig project`);
    for (const { path, sourceFile } of parsed) {
      for (const { start, end } of commentRanges(sourceFile)) {
        const comment = sourceFile.text.slice(start, end);
        if (isAllowedDirective(comment)) continue;
        const firstLine = comment.split("\n", 1)[0].trim();
        found.push(`${relative(root, path)}:${lineOf(sourceFile.text, start)}: ${firstLine}`);
      }
    }
    return found;
  });
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\n${problems.length} comment(s) found. Code carries no comments.`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
