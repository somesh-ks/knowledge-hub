import base from "./playwright.config";
const exe = "C:/Users/soke/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe";
export default {
  ...base,
  projects: base.projects?.map((p) => ({ ...p, use: { ...p.use, launchOptions: { ...(p.use as any).launchOptions, executablePath: exe } } })),
};
