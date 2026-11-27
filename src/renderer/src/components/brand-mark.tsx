import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="100 100 824 824"
      aria-hidden="true"
      className={cn("shrink-0 rounded-[22.5%] ring-1 ring-white/10 ring-inset", className)}
    >
      <rect x="100" y="100" width="824" height="824" fill="#14171f" />
      <g fill="#fff">
        <rect x="222" y="300" width="84" height="424" rx="42" />
        <rect x="346" y="424" width="84" height="300" rx="42" />
        <rect x="470" y="534" width="84" height="190" rx="42" />
        <rect x="594" y="424" width="84" height="300" rx="42" />
        <rect x="718" y="300" width="84" height="424" rx="42" />
      </g>
    </svg>
  );
}
