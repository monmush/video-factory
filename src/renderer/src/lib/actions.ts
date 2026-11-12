import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { api } from "./api";
import { refreshWorkspace } from "./workspace";

/** Shared create actions used by the sidebar and screens. */
export function useCreateActions() {
  const navigate = useNavigate();

  // Opens the creation page; the series is only saved once it is described there.
  const createSeries = useCallback(() => navigate({ to: "/series/new" }), [navigate]);

  // A new production session opens directly in the script workspace; no creation dialog.
  const createSession = useCallback(
    async (seriesId: string, request?: string) => {
      const session = await api.invoke("session:create", { seriesId, request });
      await refreshWorkspace();
      await navigate({ to: "/sessions/$sessionId/scripts", params: { sessionId: session.id } });
    },
    [navigate],
  );

  return { createSeries, createSession };
}
