export const SPEAKING_SCENES = "Cảnh nói";
export const SPEAKING_SCENES_WITH_VOICE = "Cảnh nói (có tiếng)";

const RENAMED: Record<string, string> = {
  "Khẩu hình": SPEAKING_SCENES,
  "Lời nói": SPEAKING_SCENES_WITH_VOICE,
};

export const withCurrentNames = <T>(groups: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(groups).map(([name, usd]) => [RENAMED[name] ?? name, usd]));
