import type { VoiceId } from "@shared/voices";
import { useCallback, useEffect, useRef, useState } from "react";

// Sample clips bundled with the renderer: playback needs no IPC or network.
const files = import.meta.glob<string>("../assets/voices/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
});

const SAMPLES = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.mp3$/g, ""), url]),
) as Partial<Record<VoiceId, string>>;

/**
 * Plays one voice sample at a time. Starting another stops the current one;
 * playing the same one again stops it. Stops when the component unmounts.
 */
export function useVoiceSample() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<VoiceId | null>(null);

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  }, []);

  const toggle = useCallback(
    (id: VoiceId) => {
      const wasPlaying = playing === id;
      stop();
      const url = SAMPLES[id];
      if (wasPlaying || !url) return;
      const clip = new Audio(url);
      clip.onended = () => {
        if (audio.current === clip) stop();
      };
      audio.current = clip;
      setPlaying(id);
      clip.play().catch(() => {
        if (audio.current === clip) stop();
      });
    },
    [playing, stop],
  );

  useEffect(() => () => audio.current?.pause(), []);

  return { playing, toggle, stop };
}
