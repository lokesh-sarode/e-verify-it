export type Category = "valid" | "invalid" | "risky" | "unknown";
export type BulkStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export type Admin = {
  id: string;
  email: string;
};

export type VerificationResult = {
  id: string;
  email: string;
  normalizedEmail: string;
  category: Category;
  isReachable: boolean | null;
  syntaxStatus: string | null;
  mxStatus: string | null;
  smtpStatus: string | null;
  smtpResult: string | null;
  catchAll?: boolean | null;
  disposable?: boolean | null;
  roleAccount?: boolean | null;
  freeProvider?: boolean | null;
  reason: string | null;
  rawJson: unknown;
  createdAt: string;
};

export type BulkJob = {
  id: string;
  filename: string;
  status: BulkStatus;
  mode: "reacher_bulk" | "local_worker" | null;
  originalRows: number;
  emptyRows: number;
  duplicateRows: number;
  syntaxInvalidRows: number;
  uniqueEmails: number;
  processed: number;
  validCount: number;
  invalidCount: number;
  riskyCount: number;
  unknownCount: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type BulkProgress = {
  jobId: string;
  status: BulkStatus;
  mode: "reacher_bulk" | "local_worker" | null;
  reacherJobId: string | null;
  totalRows: number;
  uniqueEmails: number;
  processed: number;
  valid: number;
  invalid: number;
  risky: number;
  unknown: number;
  syntaxInvalid: number;
  duplicatesRemoved: number;
  progressPercentage: number;
  startedAt: string | null;
  completedAt: string | null;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number;
  recordsPerSecond: number;
  errorMessage: string | null;
};

export type Stats = {
  totalJobs: number;
  totalUploadedEmails: number;
  uniqueEmailsVerified: number;
  validCount: number;
  invalidCount: number;
  riskyCount: number;
  unknownCount: number;
  latestJobs: BulkJob[];
};

export type AppConfig = {
  maxUploadMb: number;
  uploadExtensions: string[];
  reacherBaseUrlConfigured: boolean;
};
