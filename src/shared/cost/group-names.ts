export const SPEAKING_SCENES = "Cảnh nói";

const RENAMED: Record<string, string> = {
  "Khẩu hình": SPEAKING_SCENES,
  "Lời nói": SPEAKING_SCENES,
  "Cảnh nói (có tiếng)": SPEAKING_SCENES,
};

export const withCurrentNames = <T>(groups: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(groups).map(([name, usd]) => [RENAMED[name] ?? name, usd]));
