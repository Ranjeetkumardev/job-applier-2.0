export interface JobCard {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
}

export interface ApplyResult {
  success: boolean;
  job?: JobCard;
  alreadyApplied?: boolean;
  error?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformInitOptions {
  storageStatePath?: string;
  headless?: boolean;
}