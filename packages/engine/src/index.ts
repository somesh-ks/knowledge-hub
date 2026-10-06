// Public surface of the engine package. The CLI entry point is cli.ts; `buildDeps` lives in
// run/buildDeps.ts and is not exported here because it loads the cover renderer.
export { type CliIo, runCli, splitArgs, topLevelHelp } from "./cli.js";
export { COMMANDS, type CommandSpec, findCommand } from "./commandRegistry.js";
export type { CommandContext, CommandRun, Logger } from "./context.js";
export { runPipeline } from "./run/pipeline.js";
export {
  type CommitReport,
  type GateReport,
  type PipelineResult,
  type RunDeps,
  type RunOptions,
  STAGES,
  type StageName,
} from "./run/types.js";
