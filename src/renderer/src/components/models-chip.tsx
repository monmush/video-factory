import {
  AUTO_LABEL,
  AUTO_MODELS,
  MODEL_KINDS,
  modelName,
  pickedLabel,
  type SeriesModels,
  withModel,
} from "@shared/models";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "./ui/menu";
import { SettingChip } from "./ui/setting-chip";

const AUTO = "auto";

export const MODELS_LABEL = "Mô hình";

export function ModelsChip({
  value,
  onChange,
  labelled = true,
}: {
  value: SeriesModels | undefined;
  onChange: (next: SeriesModels) => void;
  labelled?: boolean;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <SettingChip
            {...(labelled ? { label: MODELS_LABEL } : { "aria-label": MODELS_LABEL })}
            value={pickedLabel(value)}
          />
        }
      />
      <MenuPopup align="start" className="min-w-56">
        {MODEL_KINDS.map(({ kind, label, models }) => (
          <MenuGroup key={kind}>
            <MenuGroupLabel>{label}</MenuGroupLabel>
            <MenuRadioGroup
              value={value?.[kind] ?? AUTO}
              onValueChange={(id) =>
                onChange(withModel(value, kind, id === AUTO ? null : String(id)))
              }
            >
              <MenuRadioItem value={AUTO}>
                <span className="flex items-baseline gap-3">
                  {AUTO_LABEL}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {modelName(kind, AUTO_MODELS[kind])}
                  </span>
                </span>
              </MenuRadioItem>
              {models.map((model) => (
                <MenuRadioItem key={model.id} value={model.id}>
                  {model.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        ))}
      </MenuPopup>
    </Menu>
  );
}
