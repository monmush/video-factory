import type { Script } from "../shared/ipc";
import * as board from "./board";
import * as writer from "./script-writer";
import { updateSeries } from "./store";
import * as video from "./video/runner";

export interface ProductChange {
  script: Script;
  copied: boolean;
  changedLines: number;
  stagingChanged: boolean;
}

export async function setProduct(
  sessionId: string,
  scriptId: string,
  productId: string | null,
  log?: board.TurnLog,
): Promise<ProductChange | null> {
  const { ws, session } = await board.findSession(sessionId);
  const product = productId
    ? ws.assets.find((a) => a.id === productId && a.kind === "product")
    : null;
  if (productId && !product) throw new Error("Không tìm thấy sản phẩm");
  const series = ws.series.find((s) => s.id === session.seriesId);
  if (series && productId && !series.productIds.includes(productId)) {
    await updateSeries({ id: series.id, productIds: [...series.productIds, productId] });
  }
  const sent = (await board.sentScriptIds(sessionId)).has(scriptId);
  const started = !(await video.changesInPlace(sessionId, scriptId, sent));
  const begun = await board.beginProductChange(sessionId, scriptId, productId, {
    copy: started,
    log,
  });
  if (!begun) return null;
  const { before, targetId, created } = begun;
  let written: writer.WrittenScript | null = null;
  try {
    const ctx = await board.writerContext(sessionId);
    const from = ws.assets.find((a) => a.id === before.productIds[0]) ?? null;
    written = await writer.reviseProduct(
      ctx,
      before,
      from,
      product ?? null,
      before.brief.targetSec,
    );
  } finally {
    await board.finishProductChange(sessionId, targetId, written, { created, log });
  }
  if (!written) throw new Error("Chưa đổi được sản phẩm");
  if (!started) await video.followScript(sessionId, targetId);
  const script = (await board.getBoard(sessionId)).scripts.find((s) => s.id === targetId);
  if (!script) throw new Error("Không tìm thấy kịch bản");
  const sameCount = before.lines.length === script.lines.length;
  return {
    script,
    copied: started,
    changedLines: sameCount
      ? script.lines.filter((l, i) => l.text !== before.lines[i]?.text).length
      : script.lines.length,
    stagingChanged: script.staging !== before.staging,
  };
}

export async function undoChange(sessionId: string, scriptId: string): Promise<null> {
  const sent = (await board.sentScriptIds(sessionId)).has(scriptId);
  if (!(await video.changesInPlace(sessionId, scriptId, sent))) {
    throw new Error("Video đã bắt đầu tạo nên không hoàn tác được");
  }
  const { inPlace } = await board.undoChange(sessionId, scriptId);
  if (inPlace) await video.followScript(sessionId, scriptId);
  return null;
}

export async function undoTurn(sessionId: string, messageId: string): Promise<null> {
  const sent = await board.sentScriptIds(sessionId);
  const editable = new Set<string>();
  for (const id of sent) if (!(await video.videoStarted(sessionId, id))) editable.add(id);
  const restored = await board.undo(sessionId, messageId, editable);
  for (const id of restored) await video.dropPlan(sessionId, id);
  return null;
}
