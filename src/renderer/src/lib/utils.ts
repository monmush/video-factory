import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Register the extra font size so tailwind-merge does not treat text-2xs as a colour.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["2xs"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
