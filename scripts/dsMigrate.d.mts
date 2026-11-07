export declare const PACKAGE: string;
export declare const PACKAGE_NAME: string;
/** Old path to new path; a key ending in "/" moves a folder. */
export declare const PATH_MAP: Record<string, string>;
export declare function movedPath(path: string): string;
export declare function originalPath(path: string): string;
export declare function resolveFile(
  target: string,
  exists: (path: string) => boolean,
): string | undefined;
export declare function packageSpecifier(file: string): string;
/** `text` of the repo file `file` with each import of an old system path pointed at the new one. */
export declare function rewriteSource(
  text: string,
  file: string,
  exists: (path: string) => boolean,
  options?: { packageImports?: boolean },
): string;
