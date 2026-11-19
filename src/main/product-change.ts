import type { Script } from "../shared/ipc";
import * as board from "./board";
import * as writer from "./script-writer";
import { updateSeries } from "./store";
import * as video from "./video/runner";

// One product per video, changed on the card or by the chat
// (docs/SCRIPT_BOARD_DECISIONS.md, "Product per video"). Only what is about
// the product is rewritten: the lines that name or describe it, and its place
// in the staging. A script whose video has started changes on a new version
// (src/shared/versions.ts); one sent to video but not started changes in
// place. Its Dàn dựng follows in code when the words are unchanged or only
// renamed the product (src/shared/product-follow.ts), else it is staged
// again. A change while the staging is still being made is applied: the
// staging follows it when it lands.

export interface ProductChange {
  script: Script;
  /** Made on a new version because the script already has a video. */
  copied: boolean;
  /** Lines whose words changed (same count), else every line counted as changed. */
  changedLines: number;
  stagingChanged: boolean;
}

/** Sets a script's product (null: none). Null when it already had that product. */
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
  // A library product picked for a script joins its series, so the writer knows it.
  const series = ws.series.find((s) => s.id === session.seriesId);
  if (series && productId && !series.productIds.includes(productId)) {
    await updateSeries({ id: series.id, productIds: [...series.productIds, productId] });
  }
  const committed = (await board.sentScriptIds(sessionId)).has(scriptId);
  // Staging still being made is not a started video: the change applies in place.
  const started = committed && (await video.videoMade(sessionId, scriptId));
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
    // Writing failed: the script stays as it was (a new version made for it goes again).
    await board.finishProductChange(sessionId, targetId, written, { created, log });
  }
  if (!written) throw new Error("Chưa đổi được sản phẩm");
  // Nothing made: the staging follows the new product.
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

/** "Hoàn tác" on the card: back to the product, lines and staging before the change. */
export async function undoProduct(sessionId: string, scriptId: string): Promise<null> {
  const committed = (await board.sentScriptIds(sessionId)).has(scriptId);
  // Changed in place while sent to video: only while its video has not started.
  if (committed && (await video.videoMade(sessionId, scriptId))) {
    throw new Error("Video đã bắt đầu tạo nên không hoàn tác được");
  }
  const { inPlace } = await board.undoProductChange(sessionId, scriptId);
  if (inPlace) await video.followScript(sessionId, scriptId);
  return null;
}

/** A chat turn's undo, also on scripts sent to video whose video has not started. */
export async function undoTurn(sessionId: string, messageId: string): Promise<null> {
  const sent = await board.sentScriptIds(sessionId);
  const editable = new Set<string>();
  for (const id of sent) if (!(await video.videoStarted(sessionId, id))) editable.add(id);
  const restored = await board.undo(sessionId, messageId, editable);
  for (const id of restored) await video.dropPlan(sessionId, id);
  return null;
}
