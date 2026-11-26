import type { Series } from "@shared/ipc";
import {
  directionText,
  effectiveMention,
  GUIDE_SLOT_LABEL,
  GUIDE_SLOTS,
  type GuideQuestion,
  type GuideSlot,
  missingCast,
  PRODUCT_MENTION_LABEL,
  type SeriesGuide,
  summaryLine,
} from "@shared/series-guide";
import { X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useGuideDraft } from "@/lib/guide-draft";
import { useAction } from "@/lib/use-action";
import { refreshWorkspace } from "@/lib/workspace";

export function SeriesDirection({ series, onEdit }: { series: Series; onEdit: () => void }) {
  const { draft, retry } = useGuideDraft(series);
  const { error, run } = useAction();
  const [busy, setBusy] = useState(false);
  const focusLine = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const { guide } = series;
  const missing = missingCast(guide, series.characterIds.length);

  const act = async (call: () => Promise<unknown>) => {
    setBusy(true);
    const done = await run(async () => {
      await call();
      await refreshWorkspace();
    });
    setBusy(false);
    return done;
  };

  const confirm = async () => {
    focusLine.current = true;
    if (
      !(await act(() => api.invoke("series:update", { id: series.id, guide: { confirm: true } })))
    )
      focusLine.current = false;
  };

  const answer = async (questionId: string, option: number | null) => {
    if (await act(() => api.invoke("series:answer-guide", { id: series.id, questionId, option })))
      requestAnimationFrame(() => confirmButton.current?.focus());
  };

  const line = (
    <SummaryButton
      text={summaryLine(series)}
      title={directionText(series) || "Sửa định hướng"}
      onEdit={onEdit}
      focusOnMount={focusLine}
    />
  );
  const missingLine = missing > 0 && (
    <MissingCast
      mentioned={guide?.castMentioned ?? 0}
      chosen={series.characterIds.length}
      onAdd={onEdit}
    />
  );
  const errorLine = error && <p className="mt-1 text-destructive-foreground">{error}</p>;

  let body: ReactNode;
  if (guide && !guide.confirmedAt)
    body = (
      <GuideCard
        guide={guide}
        productCount={series.productIds.length}
        missing={missingLine}
        busy={busy}
        onAnswer={answer}
        onEdit={onEdit}
        onConfirm={confirm}
        confirmRef={confirmButton}
      />
    );
  else if (draft?.state === "drafting")
    body = <p className="shimmer-text py-0.5">Đang đọc mô tả…</p>;
  else if (draft?.state === "failed")
    body = (
      <>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Chưa đọc được mô tả</span>
          <Button variant="ghost" size="xs" onClick={retry}>
            Thử lại
          </Button>
        </div>
        <p className="text-destructive-foreground">{draft.error}</p>
        {line}
      </>
    );
  else
    body = (
      <>
        {line}
        {missingLine}
      </>
    );

  return (
    <div className="mt-0.5 mb-5">
      {body}
      {errorLine}
    </div>
  );
}

function SummaryButton({
  text,
  title,
  onEdit,
  focusOnMount,
}: {
  text: string;
  title: string;
  onEdit: () => void;
  focusOnMount: { current: boolean };
}) {
  return (
    <button
      type="button"
      ref={(node) => {
        if (!node || !focusOnMount.current) return;
        focusOnMount.current = false;
        node.focus();
      }}
      className="block max-w-full cursor-pointer truncate rounded-sm text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      title={title}
      onClick={onEdit}
    >
      {text || "Thêm định hướng"}
    </button>
  );
}

function MissingCast({
  mentioned,
  chosen,
  onAdd,
}: {
  mentioned: number;
  chosen: number;
  onAdd: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2">
      <span className="text-muted-foreground">
        Mô tả có {mentioned} nhân vật, mới chọn {chosen}
      </span>
      <Button variant="ghost" size="xs" onClick={onAdd}>
        Thêm nhân vật
      </Button>
    </div>
  );
}

function GuessedTag() {
  return (
    <span className="mt-0.5 shrink-0 rounded border px-1 text-2xs leading-4 text-muted-foreground">
      Tự điền
    </span>
  );
}

function GuideRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">{children}</dd>
    </>
  );
}

function RowText({ text, guessed }: { text: string; guessed?: boolean }) {
  return (
    <span className="flex min-w-0 items-start gap-2">
      <span
        className="line-clamp-3 min-w-0 flex-1 whitespace-pre-line [overflow-wrap:anywhere]"
        title={text}
      >
        {text}
      </span>
      {guessed && <GuessedTag />}
    </span>
  );
}

function Question({
  question,
  busy,
  onAnswer,
}: {
  question: GuideQuestion;
  busy: boolean;
  onAnswer: (questionId: string, option: number | null) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-0.5">{question.ask}</span>
      {question.options.map((option, i) => (
        <Button
          key={option.text}
          variant="outline"
          size="xs"
          disabled={busy}
          title={option.text}
          onClick={() => onAnswer(question.id, i)}
        >
          {option.label}
        </Button>
      ))}
      <Button
        variant="ghost-muted"
        size="icon-xs"
        disabled={busy}
        aria-label="Bỏ qua câu hỏi"
        title="Bỏ qua câu hỏi"
        onClick={() => onAnswer(question.id, null)}
      >
        <X />
      </Button>
    </div>
  );
}

function slotsShown(guide: SeriesGuide): GuideSlot[] {
  return GUIDE_SLOTS.filter(
    (slot) => guide.lines[slot]?.text.trim() || guide.questions?.some((q) => q.slot === slot),
  );
}

function GuideCard({
  guide,
  productCount,
  missing,
  busy,
  onAnswer,
  onEdit,
  onConfirm,
  confirmRef,
}: {
  guide: SeriesGuide;
  productCount: number;
  missing: ReactNode;
  busy: boolean;
  onAnswer: (questionId: string, option: number | null) => void;
  onEdit: () => void;
  onConfirm: () => void;
  confirmRef: { current: HTMLButtonElement | null };
}) {
  return (
    <section aria-label="Định hướng" className="mt-1.5 flex flex-col gap-2 rounded-lg border p-3">
      <h2 className="font-medium">Định hướng</h2>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        {slotsShown(guide).map((slot) => {
          const line = guide.lines[slot];
          return (
            <GuideRow key={slot} label={GUIDE_SLOT_LABEL[slot]}>
              {line?.text.trim() && <RowText text={line.text} guessed={line.guessed} />}
              {guide.questions
                ?.filter((q) => q.slot === slot)
                .map((q) => (
                  <Question key={q.id} question={q} busy={busy} onAnswer={onAnswer} />
                ))}
            </GuideRow>
          );
        })}
        {productCount > 0 && (
          <GuideRow label="Sản phẩm">
            <RowText
              text={PRODUCT_MENTION_LABEL[effectiveMention(guide, productCount)]}
              guessed={guide.productMentionGuessed}
            />
          </GuideRow>
        )}
        <GuideRow label="Độ dài">
          <RowText text={`${guide.targetSec} giây`} guessed={guide.targetSecGuessed} />
        </GuideRow>
      </dl>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="mr-auto min-w-0">{missing}</div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Sửa
        </Button>
        <Button ref={confirmRef} variant="outline" size="sm" disabled={busy} onClick={onConfirm}>
          Đúng rồi
        </Button>
      </div>
    </section>
  );
}
