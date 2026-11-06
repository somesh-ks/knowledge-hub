/**
 * A failed ask, said once at the top of the page as a DS banner with a "Copy details" button. The
 * details are plain text an AI agent can act on: the page, the request, the answer's status and body,
 * and Vercel's request id, which finds the server's own log line (2026-11-04, the owner: "detailed
 * error messages that can be used for sharing with the AI agent, for all errors on this admin
 * portal"). The banner is drawn the way the design system's banner part says an island draws one
 * (banner.ts); its icon comes from the page's template (Shell.astro).
 */
import { bannerClass, bannerText } from "../../../web/src/design-system/banner";
import { buttonClass } from "../../../web/src/design-system/button";

export interface Problem {
  /** The banner's title: what did not happen, in the page's words. */
  title: string;
  method: string;
  url: string;
  /** 0 when no answer came: offline, a timeout, a refused connection. */
  status: number;
  statusText: string;
  /** The answer's body as sent, cut to a length that pastes. */
  body: string;
  /** Vercel's id for the request (`x-vercel-id`), "" when there was no answer. */
  requestId: string;
  /** The browser's own error when no answer came. */
  error: string;
  at: number;
  /** When the answer still on the page arrived, if one is. */
  keptAt?: number;
}

const BODY_LIMIT = 1500;

/** The routes' own error codes in plain words; any other code is shown as sent. */
const SAID: Record<string, string> = {
  no_store: "no database connected",
  store_unavailable: "the database didn't answer",
  unavailable: "a service didn't answer",
};

/** A problem from an answer that was not ok. */
export async function answerProblem(
  title: string,
  url: string,
  method: string,
  response: Response,
): Promise<Problem> {
  let body = "";
  try {
    body = (await response.clone().text()).slice(0, BODY_LIMIT);
  } catch {
    // The body could not be read; the status still says what happened.
  }
  return {
    title,
    method,
    url: new URL(url, location.href).href,
    status: response.status,
    statusText: response.statusText,
    body,
    requestId: response.headers.get("x-vercel-id") ?? "",
    error: "",
    at: Date.now(),
  };
}

/** A problem from a request that got no answer at all. */
export function requestProblem(
  title: string,
  url: string,
  method: string,
  error: unknown,
): Problem {
  return {
    title,
    method,
    url: new URL(url, location.href).href,
    status: 0,
    statusText: "",
    body: "",
    requestId: "",
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    at: Date.now(),
  };
}

const time = (at: number): string =>
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The banner's one line: what came back, in a few words. */
function line(problem: Problem): string {
  const said = (() => {
    try {
      const error = (JSON.parse(problem.body) as { error?: unknown }).error;
      return typeof error === "string" ? (SAID[error] ?? error.replaceAll("_", " ")) : "";
    } catch {
      return "";
    }
  })();
  const what =
    problem.status === 0
      ? problem.error.startsWith("TimeoutError")
        ? "No answer in time."
        : "No connection to the server."
      : problem.status === 401 || problem.status === 403
        ? "Signed out. Sign in again."
        : problem.status === 429
          ? "Asked too often this minute. Try again in a minute."
          : `Error ${problem.status}${said ? `: ${said}` : ""}.`;
  return problem.keptAt ? `${what} Showing the answer from ${time(problem.keptAt)}.` : what;
}

/** The details for an AI agent: everything needed to find the failure, nothing secret. */
export function problemText(problem: Problem): string {
  return [
    `Singularity admin error: ${problem.title}`,
    `Page: ${location.href}`,
    `Request: ${problem.method} ${problem.url}`,
    problem.status
      ? `Answer: HTTP ${problem.status}${problem.statusText ? ` ${problem.statusText}` : ""}`
      : `Answer: none (${problem.error || "unknown"})`,
    problem.body && `Body: ${problem.body}`,
    problem.requestId &&
      `Vercel request id: ${problem.requestId} (find it with npm run vercel:logs)`,
    `When: ${new Date(problem.at).toISOString()}`,
    `On screen instead: ${problem.keptAt ? `the answer kept on this device from ${new Date(problem.keptAt).toISOString()}` : "nothing"}`,
    `Browser: ${navigator.userAgent}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const COPIED_MS = 2000;

/**
 * A DS text button that copies `text()` when pressed and says so for a moment: "Copied", or "Copy
 * blocked" when the browser refuses the clipboard.
 */
export function copyButton(label: string, text: () => string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = buttonClass("text");
  button.textContent = label;
  button.addEventListener("click", () => {
    navigator.clipboard.writeText(text()).then(
      () => {
        button.textContent = "Copied";
        setTimeout(() => {
          button.textContent = label;
        }, COPIED_MS);
      },
      () => {
        button.textContent = "Copy blocked";
      },
    );
  });
  return button;
}

/** The problems on screen now, by title: what a page's own prompts add (Health's Actions). */
const shown = new Map<string, Problem>();
export const currentProblems = (): Problem[] => [...shown.values()];
/** Sent on the document when a banner goes up or comes down, so a page's prompts follow it. */
export const PROBLEMS_CHANGED = "admin:problems";
const changed = (): boolean => document.dispatchEvent(new Event(PROBLEMS_CHANGED));

/** Draws, or redraws, the banner for this problem's title in the page's problem slot (AdminHead). */
export function reportProblem(problem: Problem): void {
  const slot = document.querySelector<HTMLElement>("[data-problems]");
  if (!slot) return;
  const key = problem.title;
  shown.set(key, problem);
  const banner = document.createElement("div");
  banner.className = bannerClass();
  // An older answer still on the page: the page works in part (warning). Nothing on it: danger.
  banner.dataset.tone = problem.keptAt ? "warning" : "danger";
  banner.dataset.problem = key;
  banner.setAttribute("role", problem.keptAt ? "status" : "alert");
  const icon = document
    .querySelector<HTMLTemplateElement>("template[data-problem-icon]")
    ?.content.firstElementChild?.cloneNode(true);
  const column = document.createElement("div");
  column.className = bannerText.column;
  const title = document.createElement("p");
  title.className = bannerText.title;
  title.textContent = problem.title;
  const body = document.createElement("p");
  body.className = bannerText.body;
  body.textContent = line(problem);
  column.append(title, body);
  const copy = copyButton("Copy details", () => problemText(problem));
  banner.append(...(icon ? [icon] : []), column, copy);
  const old = [...slot.children].find((each) => (each as HTMLElement).dataset.problem === key);
  if (old) old.replaceWith(banner);
  else slot.append(banner);
  changed();
}

/** Takes the banner for this title down: the next ask answered. */
export function clearProblem(title: string): void {
  if (shown.delete(title)) changed();
  for (const each of document.querySelectorAll<HTMLElement>("[data-problems] [data-problem]")) {
    if (each.dataset.problem === title) each.remove();
  }
}
