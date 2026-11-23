export type DirectorSteps = string[];

const PICTURE: Record<string, string> = {
  master: "toàn cảnh",
  action: "cận chi tiết",
  plate: "chỗ đặt sản phẩm",
};

function after(text: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*[[{]`).exec(text);
  return m ? text.slice(m.index + m[0].length) : null;
}

function closedObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) out.push(text.slice(start, i + 1));
    } else if (c === "]" && depth === 0) break;
  }
  return out;
}

const field = (obj: string, key: string): string | null => {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(obj);
  return m ? (m[1] as string) : null;
};

const numberField = (obj: string, key: string): number | null => {
  const m = new RegExp(`"${key}"\\s*:\\s*(\\d+)`).exec(obj);
  return m ? Number(m[1]) : null;
};

function shotLine(n: number | string, obj: string): string {
  const who = field(obj, "character");
  switch (field(obj, "type")) {
    case "speaker":
      return `Cảnh ${n}: ${who ?? "nhân vật"} nói`;
    case "listener":
      return `Cảnh ${n}: ${who ?? "nhân vật"} lắng nghe`;
    case "wide":
      return `Cảnh ${n}: toàn cảnh`;
    default:
      return field(obj, "product") ? `Cảnh ${n}: sản phẩm` : `Cảnh ${n}: cận chi tiết`;
  }
}

function pictureSteps(answer: string): DirectorSteps {
  const pictures = after(answer, "pictures");
  if (!pictures) return [];
  return closedObjects(pictures).flatMap((p) => {
    const kind = field(p, "kind") ?? "";
    const label = kind === "character" ? (field(p, "character") ?? "nhân vật") : PICTURE[kind];
    return label ? [`Khung hình: ${label}`] : [];
  });
}

export function correctionSteps(correction: string): DirectorSteps {
  const steps = pictureSteps(correction);
  const replaced = after(correction, "shots");
  if (replaced) {
    for (const s of closedObjects(replaced)) steps.push(shotLine(numberField(s, "n") ?? "?", s));
  }
  const added = after(correction, "add_shots");
  if (added) for (const s of closedObjects(added)) steps.push(shotLine("mới", s));
  return steps;
}

export function directorSteps(answer: string): DirectorSteps {
  const steps: DirectorSteps = ["Đọc kịch bản, bối cảnh và nhân vật"];
  if (after(answer, "seats")) steps.push("Xếp chỗ ngồi và hướng nhìn");
  if (after(answer, "props")) steps.push("Bày đồ vật trong cảnh");
  steps.push(...pictureSteps(answer));
  const shots = after(answer, "shots");
  if (shots) {
    closedObjects(shots).forEach((s, i) => {
      steps.push(shotLine(i + 1, s));
    });
  }
  return steps;
}
