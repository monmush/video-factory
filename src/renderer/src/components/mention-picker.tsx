import type { Asset } from "@shared/ipc";
import { findAt, insertMention, matchProducts, type Token } from "@shared/mentions";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { AssetThumb, thumbShape } from "./asset-picker";

/**
 * A picker opened by a token typed right before the caret (`#` scripts, `@`
 * products). Keys come from the prompt box, so focus stays in the textarea:
 * ↑/↓ move, Enter or Tab choose, Esc dismisses it for that token.
 */
export function usePicker<T>(token: Token | null, items: T[], onChoose: (item: T) => void) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  const candidates = token && token.start !== dismissed ? items : [];
  // The highlighted row starts at the top again whenever the query changes.
  const key = token ? `${token.start}:${token.query}` : "";
  const [highlight, setHighlight] = useState({ key: "", index: 0 });
  const active = highlight.key === key ? Math.min(highlight.index, candidates.length - 1) : 0;
  const open = candidates.length > 0;
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || !token || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlight({ key, index: (active + step + candidates.length) % candidates.length });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const item = candidates[active];
      if (item !== undefined) onChoose(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(token.start);
    }
  };
  return {
    open,
    candidates,
    active,
    keys,
    highlight: (index: number) => setHighlight({ key, index }),
  };
}

/** The rows of an open picker, above (or below) the prompt box. */
export function PickerList<T>({
  label,
  candidates,
  active,
  onHighlight,
  onChoose,
  itemKey,
  children,
  below,
  className,
}: {
  label: string;
  candidates: T[];
  active: number;
  onHighlight: (index: number) => void;
  onChoose: (item: T) => void;
  itemKey: (item: T) => string;
  children: (item: T) => ReactNode;
  /** Opens under the box, for one near the top of a page. */
  below?: boolean;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      className={cn(
        "absolute z-20 max-h-60 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg",
        below ? "top-full mt-1" : "bottom-full mb-1",
        className,
      )}
    >
      {candidates.map((item, i) => (
        // Picked with the mouse or the composer's keys; focus stays in the composer.
        // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled by the composer
        <div
          key={itemKey(item)}
          data-index={i}
          role="option"
          aria-selected={i === active}
          tabIndex={-1}
          className={cn(
            "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm",
            i === active && "bg-accent",
          )}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHighlight(i)}
          onClick={() => onChoose(item)}
        >
          {children(item)}
        </div>
      ))}
    </div>
  );
}

/**
 * `@` in a prompt box picks a library product (the series' own first) and
 * writes its `@handle` into the text. `off`: another picker owns the caret.
 */
export function useProductMention({
  text,
  caret,
  onText,
  input,
  seriesProductIds,
  off,
}: {
  text: string;
  caret: number;
  /** The new text and where the caret goes. */
  onText: (text: string, caret: number) => void;
  input: RefObject<HTMLTextAreaElement | null>;
  seriesProductIds: readonly string[];
  off?: boolean;
}) {
  const assets = useWorkspace().assets;
  const token = off ? null : findAt(text, caret);
  const matches = token ? matchProducts(assets, seriesProductIds, token.query) : [];
  const choose = (product: Asset) => {
    if (!token) return;
    const next = insertMention(text, caret, token, product.handle);
    onText(next.text, next.caret);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const picker = usePicker(token, matches, choose);
  const popup = (className?: string, below?: boolean) =>
    picker.open && (
      <PickerList
        label="Sản phẩm"
        candidates={picker.candidates}
        active={picker.active}
        onHighlight={picker.highlight}
        onChoose={choose}
        itemKey={(p) => p.id}
        below={below}
        className={className}
      >
        {(product) => (
          <>
            <AssetThumb asset={product} className={cn("border-0", thumbShape("product", "sm"))} />
            {/* In a narrow box the name stays whole; the handle gives way. */}
            <span className="max-w-full shrink-0 truncate">{product.name}</span>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
              @{product.handle}
            </span>
          </>
        )}
      </PickerList>
    );
  return { open: picker.open, keys: picker.keys, popup };
}
