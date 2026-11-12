// Runs synchronously before the app bundle. Keep in sync with src/lib/theme.ts.
(() => {
  let preference = "system";
  try {
    preference = localStorage.getItem("hyan:theme") || "system";
  } catch {}
  const dark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  if (window.hyan?.platform) document.documentElement.dataset.platform = window.hyan.platform;
})();
