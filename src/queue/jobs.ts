export const DEFAULT_QUEUE_NAME = "haku-jobs";

export const JobName = {
  DiscoveryRun: "discovery.run",
  LearningIncremental: "learning.incremental",
  LearningWeekly: "learning.weekly"
} as const;

export type JobNameValue = (typeof JobName)[keyof typeof JobName];

export const RepeatJobId = {
  DiscoveryRun: "repeat:discovery.run",
  LearningIncremental: "repeat:learning.incremental",
  LearningWeekly: "repeat:learning.weekly"
} as const;
