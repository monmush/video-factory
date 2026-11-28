import { VOICE_SAMPLE_USD } from "@shared/cost/rates";
import { estimateText } from "@shared/cost/table";
import type { UploadedVoice, VoiceSuggestion } from "@shared/ipc";
import { cleanVoiceText, guessVoiceTraits, MAX_VOICE_CHARS, spokenTraits } from "@shared/voices";
import { LoaderCircle, Play, Square, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { Button } from "./ui/button";
import { ButtonPrice, HoldButton } from "./ui/hold-button";
import { Textarea } from "./ui/textarea";

const SUGGEST_AFTER_MS = 1000;
const SAMPLE_CHECK_AFTER_MS = 250;

export function VoiceField({
  value,
  shown,
  fallback,
  name,
  description,
  disabled,
  onChange,
  uploaded,
  onUploadedChange,
}: {
  value: string;
  shown: string;
  fallback: string;
  name: string;
  description: string;
  disabled?: boolean;
  onChange: (typed: string | null) => void;
  uploaded: string | null;
  onUploadedChange: (file: string | null) => void;
}) {
  const suggestions = useVoiceSuggestions(name, description);
  const player = usePlayer();
  const upload = useUploadedVoice(uploaded);
  const [picking, setPicking] = useState(false);
  const [pickFailed, setPickFailed] = useState<string | null>(null);
  const changeLocked = disabled || picking;

  const pick = async () => {
    setPicking(true);
    setPickFailed(null);
    try {
      const picked = await api.invoke("voices:pick-upload");
      if (!picked) return;
      upload.remember(picked);
      onUploadedChange(picked.file);
      player.toggle(picked.url);
    } catch (e) {
      setPickFailed(errorMessage(e));
    } finally {
      setPicking(false);
    }
  };

  const remove = () => {
    player.stop();
    setPickFailed(null);
    onUploadedChange(null);
  };

  const playing = upload.url ? player.playing === upload.url : false;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <label htmlFor="character-voice" className="font-medium">
          Giọng nói
        </label>
        <span className="flex items-center gap-2">
          {pickFailed && <span className="text-xs text-destructive-foreground">{pickFailed}</span>}
          {upload.url ? (
            <>
              <Button variant="outline" size="xs" disabled={changeLocked} onClick={pick}>
                Đổi
              </Button>
              <Button variant="outline" size="xs" disabled={changeLocked} onClick={remove}>
                Gỡ
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() => upload.url && player.toggle(upload.url)}
              >
                {playing ? <Square className="fill-current" /> : <Play />}
                {playing ? "Dừng" : "Nghe thử"}
              </Button>
            </>
          ) : (
            upload.url === null && (
              <>
                <Button variant="outline" size="xs" disabled={changeLocked} onClick={pick}>
                  <Upload />
                  Tải lên
                </Button>
                <ListenControl text={value} name={name} description={description} player={player} />
              </>
            )
          )}
        </span>
      </div>
      <Textarea
        id="character-voice"
        rows={2}
        maxLength={MAX_VOICE_CHARS}
        value={shown}
        placeholder={fallback}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.trim() ? e.target.value : "")}
        onBlur={(e) => {
          if (!e.target.value.trim()) onChange(null);
        }}
      />
      {suggestions.waiting ? (
        <span className="shimmer-text text-xs">Đang gợi ý giọng…</span>
      ) : (
        suggestions.list.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.list.map((s) => (
              <Button
                key={s.text}
                variant="outline"
                size="xs"
                disabled={disabled}
                title={s.text}
                onClick={() => onChange(s.text)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function useVoiceSuggestions(name: string, description: string) {
  const [list, setList] = useState<VoiceSuggestion[]>([]);
  const [waiting, setWaiting] = useState(false);
  const latest = useRef({ name, description });
  latest.current = { name, description };
  const asked = useRef<string | null>(null);
  const opened = useRef(true);

  useEffect(() => {
    const wanted = description.trim();
    const first = opened.current;
    opened.current = false;
    if (!wanted) return;
    const ask = () => {
      if (asked.current === wanted) return;
      asked.current = wanted;
      setWaiting(true);
      api
        .invoke("voices:suggest", { name: latest.current.name, description: wanted })
        .then((found) => {
          if (asked.current === wanted) setList(found);
        })
        .catch(() => {
          if (asked.current === wanted) setList([]);
        })
        .finally(() => {
          if (asked.current === wanted) setWaiting(false);
        });
    };
    if (first) {
      ask();
      return;
    }
    const timer = window.setTimeout(ask, SUGGEST_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [description]);

  return { list, waiting };
}

function sampleKey(text: string, name: string, description: string): string {
  const clean = cleanVoiceText(text);
  if (!clean) return "";
  const { gender, age } = spokenTraits(clean, guessVoiceTraits(name, description));
  return JSON.stringify([clean, gender, age ?? null]);
}

function useUploadedVoice(file: string | null) {
  const [known, setKnown] = useState<{ file: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!file || known?.file === file) return;
    let live = true;
    api
      .invoke("voices:sample", { text: "", name: "", description: "", uploaded: file })
      .then((r) => live && setKnown({ file, url: r.url }))
      .catch(() => live && setKnown({ file, url: null }));
    return () => {
      live = false;
    };
  }, [file, known]);

  const remember = useCallback((picked: UploadedVoice) => setKnown(picked), []);
  const url = !file ? null : known?.file === file ? known.url : undefined;
  return { url, remember };
}

type Player = ReturnType<typeof usePlayer>;

function ListenControl({
  text,
  name,
  description,
  player,
}: {
  text: string;
  name: string;
  description: string;
  player: Player;
}) {
  const [known, setKnown] = useState<{ key: string; url: string | null } | null>(null);
  const [making, setMaking] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key = sampleKey(text, name, description);
  const latestKey = useRef(key);
  latestKey.current = key;

  useEffect(() => {
    if (!key) return;
    let live = true;
    const timer = window.setTimeout(() => {
      api
        .invoke("voices:sample", { text, name, description })
        .then((r) => live && setKnown({ key, url: r.url }))
        .catch(() => live && setKnown({ key, url: null }));
    }, SAMPLE_CHECK_AFTER_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [key, text, name, description]);

  const { stop } = player;
  useEffect(() => {
    if (key) stop();
  }, [key, stop]);

  if (!key) return null;
  if (making === key) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Đang tạo giọng…
      </span>
    );
  }
  const url = known?.key === key ? known.url : undefined;
  if (url === undefined) return null;

  const make = async (channel: "voices:make" | "voices:remake") => {
    const madeKey = key;
    player.stop();
    setFailed(null);
    setMaking(madeKey);
    try {
      const made = await api.invoke(channel, { text, name, description });
      setKnown({ key: madeKey, url: made.url });
      if (latestKey.current === madeKey) player.toggle(made.url);
    } catch {
      setFailed(madeKey);
    } finally {
      setMaking((current) => (current === madeKey ? null : current));
    }
  };

  const price = <ButtonPrice>{estimateText(VOICE_SAMPLE_USD)}</ButtonPrice>;
  const playing = url !== null && player.playing === url;

  return (
    <span className="flex items-center gap-2">
      {failed === key && (
        <span className="text-xs text-destructive-foreground">Không tạo được giọng</span>
      )}
      {url ? (
        <>
          <HoldButton tone="outline" size="xs" onHold={() => make("voices:remake")}>
            Tạo lại
            {price}
          </HoldButton>
          <Button variant="outline" size="xs" onClick={() => player.toggle(url)}>
            {playing ? <Square className="fill-current" /> : <Play />}
            {playing ? "Dừng" : "Nghe thử"}
          </Button>
        </>
      ) : (
        <HoldButton tone="outline" size="xs" onHold={() => make("voices:make")}>
          Giữ để nghe
          {price}
        </HoldButton>
      )}
    </span>
  );
}

function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = useRef<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    current.current = null;
    setPlaying(null);
  }, []);

  const toggle = useCallback(
    (url: string) => {
      const wasPlaying = current.current === url;
      stop();
      if (wasPlaying) return;
      const clip = new Audio(url);
      clip.onended = () => {
        if (audio.current === clip) stop();
      };
      audio.current = clip;
      current.current = url;
      setPlaying(url);
      clip.play().catch(() => {
        if (audio.current === clip) stop();
      });
    },
    [stop],
  );

  useEffect(() => () => audio.current?.pause(), []);

  return { playing, toggle, stop };
}
