import { formatSeconds } from "@shared/board";
import type { FinishedLength } from "@shared/tempo";

export function VideoLength({ length }: { length: FinishedLength }) {
  return (
    <span className="text-muted-foreground tabular-nums">
      {formatSeconds(length.seconds)}
      {length.offScriptSec !== null && (
        <span className="ml-1.5 text-muted-foreground/70">
          kịch bản {formatSeconds(length.offScriptSec)}
        </span>
      )}
    </span>
  );
}
