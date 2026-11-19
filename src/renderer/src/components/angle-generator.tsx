import { formatCost } from "@shared/credits";
import { DEFAULT_IMAGE_MODEL } from "@shared/image-models";
import {
  type AngleId,
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
import { ButtonPrice, HoldButton } from "./ui/hold-button";

export const ANGLE_LABELS: Record<AngleId, string> = {
  closeup: "Cận mặt",
  "three-quarter": "Góc 3/4",
  "full-body": "Toàn thân",
  other: "Khác",
};

const ANGLE_HINTS: Record<CoreAngle, string> = {
  closeup: "Giữ khuôn mặt nhất quán khi nói và ở cận cảnh",
  "three-quarter": "Khuôn mặt và dáng khi quay nghiêng",
  "full-body": "Trang phục và tỉ lệ cơ thể cho cảnh rộng",
};

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
  maxNew: number;
  onStart: (angles: CoreAngle[]) => void;
  onResult: (result: GenerateAnglesResult | null, error?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<CoreAngle>>(new Set());
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const openPanel = () => {
    setSelected(new Set(CORE_ANGLES.filter((a) => !covered.has(a)).slice(0, maxNew)));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEstimate(null);
    setEstimateError(null);
    api.invoke("assets:estimate-angles", { model: DEFAULT_IMAGE_MODEL, count: selected.size }).then(
      (r) => !cancelled && setEstimate(r.cost),
      (e) => !cancelled && setEstimateError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [open, selected.size]);

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
          model: DEFAULT_IMAGE_MODEL,
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
        <span className="flex-1 text-xs text-destructive-foreground">{estimateError}</span>
        <Button variant="ghost-muted" size="sm" onClick={() => setOpen(false)}>
          Hủy
        </Button>
        <HoldButton
          tone="outline"
          size="sm"
          disabled={selected.size === 0 || estimate === null || disabled}
          onHold={generate}
        >
          Giữ để tạo {selected.size} ảnh
          {estimate !== null && <ButtonPrice>~{formatCost(estimate)}</ButtonPrice>}
        </HoldButton>
      </div>
    </div>
  );
}

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
