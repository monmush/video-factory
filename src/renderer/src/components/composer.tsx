import { ArrowUp, Square } from "lucide-react";
import { type DragEvent, type KeyboardEvent, type ReactNode, type Ref, useState } from "react";
import { isImeComposing } from "@/lib/ime";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  busy,
  disabled,
  rows = 3,
  autoFocus,
  header,
  children,
  className,
  onDropFiles,
  dropHint,
  onPasteFiles,
  running,
  onStop,
  hasAttachments,
  textareaRef,
  onTextKeyDown,
  onCaret,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  submitLabel: string;
  busy?: boolean;
  disabled?: boolean;
  rows?: number;
  autoFocus?: boolean;
  header?: ReactNode;
  children?: ReactNode;
  className?: string;
  onDropFiles?: (files: File[]) => void;
  dropHint?: string;
  onPasteFiles?: (files: File[]) => void;
  running?: boolean;
  onStop?: () => void;
  hasAttachments?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  onTextKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCaret?: (position: number) => void;
}) {
  const canSubmit = (value.trim().length > 0 || Boolean(hasAttachments)) && !busy && !disabled;
  const showStop = Boolean(running && onStop && !canSubmit);
  const [dragging, setDragging] = useState(false);
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target only; the textarea and buttons inside are the interactive parts
    <div
      className={cn(
        "relative rounded-2xl border bg-card shadow-xs/5 has-[textarea:disabled]:opacity-64 ring-ring/24 transition-shadow focus-within:border-ring focus-within:ring-[3px]",
        dragging && "border-ring ring-[3px]",
        className,
      )}
      onDragOver={(e) => {
        if (!onDropFiles || !hasFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!onDropFiles || !hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        onDropFiles([...e.dataTransfer.files]);
      }}
    >
      {dragging && dropHint && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-card/90 font-medium">
          {dropHint}
        </div>
      )}
      {header}
      <textarea
        ref={textareaRef}
        value={value}
        rows={rows}
        disabled={disabled}
        style={{ minHeight: `${rows * 1.625 + 1.2}em` }}
        // biome-ignore lint/a11y/noAutofocus: the composer is the purpose of the screens that ask for it
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        className="block field-sizing-content max-h-72 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 leading-relaxed outline-none placeholder:text-placeholder"
        onChange={(e) => {
          onChange(e.target.value);
          onCaret?.(e.target.selectionStart);
        }}
        onSelect={(e) => onCaret?.(e.currentTarget.selectionStart)}
        onPaste={(e) => {
          if (!onPasteFiles) return;
          const files = [...e.clipboardData.files];
          if (files.length === 0) return;
          e.preventDefault();
          onPasteFiles(files);
        }}
        onKeyDown={(e) => {
          onTextKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key !== "Enter" || e.shiftKey || isImeComposing(e)) {
            return;
          }
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
      />
      <div className="flex items-end gap-2 p-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
        {showStop ? (
          <Button
            size="icon"
            variant="outline"
            className="rounded-full"
            aria-label="Dừng"
            title="Dừng"
            onClick={onStop}
          >
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="rounded-full"
            disabled={!canSubmit}
            aria-label={submitLabel}
            title={submitLabel}
            onClick={onSubmit}
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  );
}
