import { batchResolution, type SessionSettingKey } from "@shared/batch-settings";
import { perVideo } from "@shared/board";
import { finishedScripts } from "@shared/ready-check";
import { fitResolution, videoModel } from "@shared/video-models";
import { type ReactNode, useState } from "react";
import { api } from "@/lib/api";
import { useBoard } from "@/lib/board";
import { errorMessage } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { Page } from "./page";
import { useBatchVideoModel, useNeedsFrames } from "./ready-check";
import { ResolutionPicker, VideoModelMenu } from "./video-model-menu";

// "Thiết lập": the batch's output settings, one row each
// (src/shared/batch-settings.ts). A row the batch has not set shows the
// series' value. Changes apply to videos created afterwards only.

export function BatchSettings({ sessionId }: { sessionId: string }) {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const own = series.find((s) => s.id === session?.seriesId);
  const model = useBatchVideoModel(sessionId);
  // The saved choice, before fitting it to the model: each model is priced at
  // the size it would actually be made at.
  const chosen = batchResolution(session, own).id;
  const resolution = batchResolution(session, own, model.id);
  const frames = useNeedsFrames(sessionId);
  const board = useBoard(sessionId);
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;
  // Priced on this batch's own scripts (average per video), else a typical video.
  const scripts = board ? finishedScripts(board.scripts) : [];

  /** Sets one setting; the series' own value means following the series again. */
  const set = async (key: SessionSettingKey, value: string, seriesValue: string) => {
    setError(null);
    try {
      await api.invoke("session:update", {
        id: sessionId,
        settings: { [key]: value === seriesValue ? null : value },
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Page className="max-w-2xl pt-6">
      <div className="flex flex-col divide-y rounded-lg border">
        <SettingRow label="Mô hình AI" inherited={model.inherited}>
          <VideoModelMenu
            label="Mô hình AI"
            value={model.id}
            onChange={(id) => set("videoModel", id, videoModel(own?.videoModel).id)}
            resolution={chosen}
            price={(m) =>
              perVideo(scripts, { frames, model: m.id, resolution: fitResolution(m.id, chosen) })
            }
          />
        </SettingRow>
        <SettingRow label="Độ phân giải" inherited={resolution.inherited}>
          <ResolutionPicker
            value={chosen}
            model={model.id}
            onChange={(r) => set("resolution", r, batchResolution(undefined, own).id)}
          />
        </SettingRow>
      </div>
      {error && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>}
    </Page>
  );
}

function SettingRow({
  label,
  inherited,
  children,
}: {
  label: string;
  /** The value comes from the series. */
  inherited?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 px-4 py-2">
      <span className="flex-1 font-medium">{label}</span>
      {inherited && <span className="text-xs text-muted-foreground">Theo series</span>}
      {children}
    </div>
  );
}
