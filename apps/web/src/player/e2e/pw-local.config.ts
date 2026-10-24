import base from "./playwright.config";

const executablePath = "/opt/pw-browsers/chromium";
const withPath = (use: Record<string, unknown> = {}) => ({
  ...use,
  launchOptions: { ...((use.launchOptions as object) ?? {}), executablePath },
});

export default {
  ...base,
  use: withPath(base.use as Record<string, unknown>),
  projects: (base.projects ?? []).map((project) => ({
    ...project,
    use: withPath({ ...(base.use as object), ...(project.use as object) }),
  })),
};
