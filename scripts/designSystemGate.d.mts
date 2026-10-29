export declare const LABEL: string;
export declare const SYSTEM_PATHS: string[];
export declare const SYSTEM_NAMES: RegExp;
export declare function checkDesignSystemPr(input: {
  files: string[];
  labels: string[];
  /** Whether an app file names the system; a labelled pull request may only touch one that does. */
  namesSystem?: (file: string) => boolean;
}): string[];
