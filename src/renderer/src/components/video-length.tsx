import { formatSeconds } from "@shared/board";
import { BOOKEND_LABEL, BOOKEND_SLOTS, type SeriesBookends } from "@shared/bookends";
import type { FinishedLength } from "@shared/tempo";
import { formatClock } from "@shared/video-export";

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

export function BookendsNote({ bookends }: { bookends: SeriesBookends | undefined }) {
  return BOOKEND_SLOTS.map((slot) => {
    const bookend = bookends?.[slot];
    return (
      bookend && (
        <span key={slot} className="text-muted-foreground/70 tabular-nums">
          + {BOOKEND_LABEL[slot]} {formatClock(bookend.seconds)}
        </span>
      )
    );
  });
}
