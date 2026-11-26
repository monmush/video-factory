import type { SeriesModels } from "@shared/models";
import { MODELS_LABEL, ModelsChip } from "./models-chip";

export function SeriesOutputFields({
  models,
  onModels,
}: {
  models: SeriesModels | undefined;
  onModels: (value: SeriesModels) => void;
}) {
  return (
    <div className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
      <span className="text-xs leading-tight text-muted-foreground">{MODELS_LABEL}</span>
      <div className="flex min-w-0">
        <ModelsChip value={models} onChange={onModels} labelled={false} />
      </div>
    </div>
  );
}
