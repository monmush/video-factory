import { ACCENTS, VOICES, type VoiceId, voiceById } from "@shared/voices";
import { ChevronDown, Play, Square } from "lucide-react";
import { useVoiceSample } from "@/lib/voice-samples";
import { Button } from "./ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "./ui/menu";

const GROUPS = [
  { label: "Nam", voices: VOICES.filter((v) => v.gender === "male") },
  { label: "Nữ", voices: VOICES.filter((v) => v.gender === "female") },
];

const AVAILABLE_ACCENT = "north";

export function VoiceField({
  value,
  onChange,
  disabled,
}: {
  value: VoiceId;
  onChange: (id: VoiceId) => void;
  disabled?: boolean;
}) {
  const voice = voiceById(value) ?? VOICES[0];
  const sample = useVoiceSample();
  if (!voice) return null;

  const pick = (id: VoiceId) => {
    if (sample.playing && sample.playing !== id) sample.stop();
    onChange(id);
  };

  const playButton = (id: VoiceId, name: string, size: "icon" | "icon-xs") => {
    const playing = sample.playing === id;
    return (
      <Button
        variant={size === "icon" ? "outline" : "ghost-muted"}
        size={size}
        aria-label={playing ? `Dừng giọng ${name}` : `Nghe giọng ${name}`}
        title={playing ? "Dừng" : "Nghe thử"}
        onClick={() => sample.toggle(id)}
      >
        {playing ? <Square className="fill-current" /> : <Play />}
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Giọng nói</span>
        <div
          role="radiogroup"
          aria-label="Vùng miền"
          className="flex rounded-[var(--control-radius)] border p-0.5"
        >
          {ACCENTS.map((accent) => {
            const available = accent.id === AVAILABLE_ACCENT;
            return (
              <span key={accent.id} title={available ? undefined : "Sắp có"}>
                <Button
                  size="xs"
                  variant={available ? "secondary" : "ghost-muted"}
                  role="radio"
                  aria-checked={available}
                  disabled={!available}
                  className="h-5"
                >
                  {accent.label}
                </Button>
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {playButton(voice.id, voice.name, "icon")}
        <Menu>
          <MenuTrigger
            disabled={disabled}
            render={<Button variant="outline" className="min-w-0 flex-1 justify-start" />}
          >
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="shrink-0">{voice.name}</span>
              <span className="min-w-0 truncate font-normal text-muted-foreground">
                {voice.label}
              </span>
            </span>
            <ChevronDown />
          </MenuTrigger>
          <MenuPopup align="start" className="w-(--anchor-width)">
            <MenuRadioGroup value={voice.id} onValueChange={pick}>
              {GROUPS.map((group) => (
                <MenuGroup key={group.label}>
                  <MenuGroupLabel>{group.label}</MenuGroupLabel>
                  {group.voices.map((v) => (
                    <div key={v.id} className="flex items-center gap-1">
                      <MenuRadioItem value={v.id} closeOnClick className="flex-1">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="shrink-0">{v.name}</span>
                          <span className="min-w-0 truncate text-muted-foreground text-xs">
                            {v.label}
                          </span>
                        </span>
                      </MenuRadioItem>
                      {playButton(v.id, v.name, "icon-xs")}
                    </div>
                  ))}
                </MenuGroup>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}
