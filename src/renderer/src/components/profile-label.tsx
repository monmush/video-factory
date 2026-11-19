import type { DevProfiles } from "@shared/ipc";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ActiveProfileLabel({ className }: { className?: string }) {
  const [profiles, setProfiles] = useState<DevProfiles | null>(null);
  useEffect(() => {
    let live = true;
    api.invoke("dev:profiles").then(
      (result) => live && setProfiles(result),
      () => live && setProfiles(null),
    );
    return () => {
      live = false;
    };
  }, []);
  const current = profiles?.profiles.find((profile) => profile.active && !profile.isDefault);
  if (!current) return null;
  return (
    <span className={cn("max-w-48 truncate text-xs", className)} title="Hồ sơ thử nghiệm">
      Hồ sơ: {current.name}
    </span>
  );
}
