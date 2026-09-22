import type { ApplyResult, JobCard } from "./types.js";

export const createRun =
  (
    searchJobs: (keywords: string, location?: string | string[]) => Promise<JobCard[]>,
    applyToJob: (job: JobCard) => Promise<ApplyResult>,
  ) =>
  async (
    keywords: string,
    location: string | string[] | undefined,
    limit: number,
  ): Promise<ApplyResult[]> => {
    const jobs = await searchJobs(keywords, location);
    const sliced = jobs.slice(0, limit);
    const results: ApplyResult[] = [];
    for (const job of sliced) {
      results.push(await applyToJob(job));
    }
    return results;
  };