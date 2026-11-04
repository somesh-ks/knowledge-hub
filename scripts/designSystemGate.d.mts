export declare const LABEL: string;
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
}): string[];
