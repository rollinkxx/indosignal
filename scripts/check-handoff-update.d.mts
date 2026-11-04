export const HANDOFF_PATH: string;

export interface HandoffCoverageResult {
  required: boolean;
  covered: boolean;
  reason: string;
  implementationFiles: string[];
  taskRowChanged: boolean;
}

export function checkHandoffCoverage(changedFiles: readonly string[], handoffDiff?: string): HandoffCoverageResult;
