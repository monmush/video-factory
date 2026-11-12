import { formatCost } from "@shared/credits";
import {
  type AngleId,
  type AngleModel,
  CORE_ANGLES,
  type CoreAngle,
  type GenerateAnglesResult,
  type ImageRef,
} from "@shared/ipc";
import { Check, LoaderCircle, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export const ANGLE_LABELS: Record<AngleId, string> = {
  closeup: "Cận mặt",
  "three-quarter": "Góc 3/4",
  "full-body": "Toàn thân",
  other: "Khác",
};

// Shown as a tooltip only; the panel itself stays short.
const ANGLE_HINTS: Record<CoreAngle, string> = {
  closeup: "Giữ khuôn mặt nhất quán khi nói và ở cận cảnh",
  "three-quarter": "Khuôn mặt và dáng khi quay nghiêng",
  "full-body": "Trang phục và tỉ lệ cơ thể cho cảnh rộng",
};

const MODELS: { id: AngleModel; label: string }[] = [
  { id: "gpt-image", label: "GPT Image 2.6" },
  { id: "nano-banana-pro", label: "Nano Banana Pro" },
];

/**
 * "Tạo thêm góc nhìn": completes the generic core character sheet. Angles the
 * character already has (by image label) start unticked.
 */
export function AngleGenerator({
  references,
  covered,
  description,
  disabled,
  maxNew,
  onStart,
  onResult,
}: {
  references: ImageRef[];
  covered: Set<AngleId>;
  description: string;
  disabled?: boolean;
  /** Free image slots left on the character; never generate more than this. */
  maxNew: number;
  onStart: (angles: CoreAngle[]) => void;
  onResult: (result: GenerateAnglesResult | null, error?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<CoreAngle>>(new Set());
  const [model, setModel] = useState<AngleModel>("gpt-image");
  const [estimate, setEstimate] = useState<number | null>(null);

  const openPanel = () => {
    setSelected(new Set(CORE_ANGLES.filter((a) => !covered.has(a)).slice(0, maxNew)));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEstimate(null);
    void api
      .invoke("assets:estimate-angles", { model, count: selected.size })
      .then((r) => !cancelled && setEstimate(r.cost));
    return () => {
      cancelled = true;
    };
  }, [open, model, selected.size]);

  const toggle = (angle: CoreAngle) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(angle)) next.delete(angle);
      else if (next.size < maxNew) next.add(angle);
      return next;
    });

  const generate = async () => {
    const angles = CORE_ANGLES.filter((a) => selected.has(a));
    setOpen(false);
    onStart(angles);
    try {
      onResult(
        await api.invoke("assets:generate-angles", {
          model,
          angles,
          description,
          images: references,
        }),
      );
    } catch (e) {
      onResult(null, errorMessage(e));
    }
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || references.length === 0 || maxNew === 0}
        title={
          references.length === 0
            ? "Cần ít nhất một ảnh gốc (không phải ảnh AI)"
            : maxNew === 0
              ? "Đã đủ 4 ảnh. Bỏ bớt ảnh để tạo thêm."
              : undefined
        }
        onClick={openPanel}
      >
        <Wand2 />
        Tạo thêm góc nhìn
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border bg-popover p-4 shadow-xs">
      <div className="font-medium">Tạo thêm góc nhìn</div>

      <div className="flex flex-wrap gap-2">
        {CORE_ANGLES.map((angle) => {
          const on = selected.has(angle);
          return (
            <button
              key={angle}
              type="button"
              aria-pressed={on}
              title={ANGLE_HINTS[angle]}
              disabled={!on && selected.size >= maxNew}
              onClick={() => toggle(angle)}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 disabled:cursor-default disabled:opacity-50",
                on ? "border-foreground/24 bg-accent" : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              <span
                className={cn(
                  "grid size-4 place-items-center rounded border",
                  on && "border-foreground bg-foreground text-background",
                )}
              >
                {on && <Check className="size-3" />}
              </span>
              {ANGLE_LABELS[angle]}
              {covered.has(angle) && (
                <span className="text-2xs text-muted-foreground">· đã có</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <fieldset className="inline-flex rounded-lg border p-0.5 text-xs">
          <legend className="sr-only">Mô hình</legend>
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={model === m.id}
              onClick={() => setModel(m.id)}
              className={cn(
                "cursor-pointer rounded-md px-2.5 py-1 text-muted-foreground",
                model === m.id && "bg-accent text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </fieldset>
        <span className="flex-1 text-xs text-muted-foreground tabular-nums">
          {selected.size > 0 && (estimate === null ? "…" : `~${formatCost(estimate)}`)}
        </span>
        <Button variant="ghost-muted" size="sm" onClick={() => setOpen(false)}>
          Hủy
        </Button>
        {/* Neutral on purpose: the dialog's single primary action is saving. */}
        <Button variant="outline" size="sm" disabled={selected.size === 0} onClick={generate}>
          Tạo {selected.size} ảnh
        </Button>
      </div>
    </div>
  );
}

/** Placeholder tile while an angle is being generated. */
export function PendingAngleTile({ angle }: { angle: CoreAngle }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-background text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
        <span className="text-xs">Đang tạo…</span>
      </div>
      <div className="text-xs text-muted-foreground">{ANGLE_LABELS[angle]}</div>
    </div>
  );
}
