import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const customFontSizes = ["2xs"];
const twMerge = extendTailwindMerge({
  extend: { theme: { text: customFontSizes } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
