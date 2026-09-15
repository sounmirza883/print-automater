export interface EnvIssue {
  path: string;
  message: string;
}

export class EnvValidationError extends Error {
  readonly issues: EnvIssue[];

  constructor(issues: EnvIssue[]) {
    super(EnvValidationError.format(issues));
    this.name = "EnvValidationError";
    this.issues = issues;
  }

  private static format(issues: EnvIssue[]): string {
    const lines = issues.map((issue) => `  - ${issue.path}: ${issue.message}`);
    return ["Invalid environment configuration:", ...lines].join("\n");
  }
}
