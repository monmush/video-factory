import type { LineEdit, LineRemoval } from "../shared/line-edit";
import * as board from "./board";
import * as video from "./video/runner";

async function savesAsCopy(sessionId: string, scriptId: string): Promise<boolean> {
  const sent = (await board.sentScriptIds(sessionId)).has(scriptId);
  return !(await video.changesInPlace(sessionId, scriptId, sent));
}

export async function editLine(
  sessionId: string,
  scriptId: string,
  edit: LineEdit,
): Promise<{ scriptId: string; copied: boolean } | null> {
  const copy = await savesAsCopy(sessionId, scriptId);
  return board.editLine(sessionId, scriptId, edit, { copy });
}

export async function removeLine(
  sessionId: string,
  scriptId: string,
  removal: LineRemoval,
): Promise<{ scriptId: string; copied: boolean }> {
  const copy = await savesAsCopy(sessionId, scriptId);
  return board.removeLine(sessionId, scriptId, removal, { copy });
}
