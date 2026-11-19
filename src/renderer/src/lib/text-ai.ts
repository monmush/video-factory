import { useEffect, useState } from "react";
import { api } from "./api";

export function usePaidTextAi(): boolean {
  const [paid, setPaid] = useState(true);
  useEffect(() => {
    let live = true;
    api.invoke("ai:status").then(
      (status) => live && setPaid(status.textProvider !== "claude-code"),
      () => live && setPaid(true),
    );
    return () => {
      live = false;
    };
  }, []);
  return paid;
}
