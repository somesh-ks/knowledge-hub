import type { FunctionComponent } from "react";

/**
 * Agentation: the toolbar for pointing at an element and leaving a note for the coding agent.
 * Development only. Everything, the imports included, sits behind import.meta.env.DEV, which a
 * production build replaces with false, so none of it is built into the site; checkBundle fails
 * the build if it ever is.
 *
 * Notes stay in the browser until they are copied. When the Agentation MCP server is running
 * (`npx agentation-mcp server`, port 4747) they are also sent there for the agent to read.
 */
if (import.meta.env.DEV) {
  const host = document.createElement("div");
  host.id = "singularity-agentation";
  document.body.append(host);
  // A client-side navigation replaces the body; the toolbar moves to the new one, still mounted.
  document.addEventListener("astro:after-swap", () => document.body.append(host));

  void Promise.all([import("react"), import("react-dom/client"), import("agentation")]).then(
    ([{ createElement }, { createRoot }, { Agentation }]) => {
      const Toolbar: FunctionComponent<{ endpoint?: string }> = Agentation;
      createRoot(host).render(createElement(Toolbar, { endpoint: "http://localhost:4747" }));
    },
  );
}
