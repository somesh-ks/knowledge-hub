export declare const LABEL: string;
export declare const MIGRATION_LABEL: string;
export declare const SYSTEM_PATHS: string[];
export declare const SYSTEM_NAMES: RegExp;
/** The lists that excuse code from a design-system check, by the file that holds them. */
export declare const ALLOWLISTS: Record<string, string[]>;
export declare function listEntries(text: string, name: string): string[] | undefined;
export declare function allowlistAdditions(
  before: string,
  after: string,
  lists: string[],
): string[];
export declare function checkDesignSystemPr(input: {
  files: string[];
  labels: string[];
  /** Whether an app file names the system; a labelled pull request may only touch one that does. */
  namesSystem?: (file: string) => boolean;
  /** What the pull request adds to the allowlists, as "LIST: entry". */
  added?: string[];
  /** Open ds-migration pull requests other than this one; while any is open, system paths are frozen. */
  frozenBy?: number[];
}): string[];
/** Relative imports in design-system/ that leave it for app code, as "file: specifier". */
export declare function boundaryProblems(sources: { file: string; text: string }[]): string[];
/** Every source file under design-system/ (read from `root`), as boundaryProblems takes them. */
export declare function systemSources(root: string): { file: string; text: string }[];
