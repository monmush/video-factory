import { TEMPOS, type Tempo, tempoLabel, tempoOf } from "@shared/tempo";
import { ChevronDown } from "lucide-react";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";

export function TempoMenu({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (tempo: Tempo) => void;
}) {
  const current = tempoOf(value);
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">Tốc độ</span>
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={`Tốc độ: ${tempoLabel(current)}`}
              className="-mx-1 inline-flex h-6 cursor-pointer items-center gap-0.5 rounded-md px-1 text-xs font-medium text-foreground tabular-nums outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent/60"
            >
              {tempoLabel(current)}
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
            </button>
          }
        />
        <MenuPopup align="start" className="min-w-24">
          <MenuRadioGroup value={current} onValueChange={(next) => onChange(tempoOf(next))}>
            {TEMPOS.map((tempo) => (
              <MenuRadioItem key={tempo} value={tempo} className="tabular-nums">
                {tempoLabel(tempo)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    </span>
  );
}
