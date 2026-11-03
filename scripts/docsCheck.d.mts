export declare const BUDGETS: Record<string, number>;
export declare const SPEC_BUDGET: number;
export declare const READ_FIRST_BUDGET: number;
export declare function decisionsIndex(text: string): string;
export declare function checkDocs(root: string): { fails: string[]; readFirst: number };
export declare const CHANGELOG_MAX_AGE_DAYS: number;
export declare function newestChangelogDate(source: string): string | null;
export declare function checkChangelog(input: {
  source: string;
  title: string;
  today: string;
}): string[];
export declare function pullRequestTitle(env: Record<string, string | undefined>): string;
