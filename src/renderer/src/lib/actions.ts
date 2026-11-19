import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { api } from "./api";
import { refreshWorkspace } from "./workspace";

export function useCreateActions() {
  const navigate = useNavigate();

  const createSeries = useCallback(() => navigate({ to: "/series/new" }), [navigate]);

  const createSession = useCallback(
    async (seriesId: string, request?: string, mediaLevel?: string) => {
      const session = await api.invoke("session:create", { seriesId, request, mediaLevel });
      await refreshWorkspace();
      await navigate({ to: "/sessions/$sessionId/scripts", params: { sessionId: session.id } });
    },
    [navigate],
  );

  return { createSeries, createSession };
}
