import type { RankedCandidate } from "../types/discovery";

export function formatCandidateMessage(
  candidateId: string,
  candidate: Pick<RankedCandidate, "subreddit" | "title" | "permalink" | "reason">,
  revisionNumber: number,
  draft: string
): string {
  return [
    "[Haku Candidate]",
    `Candidate ID: ${candidateId}`,
    `Subreddit: r/${candidate.subreddit}`,
    `Title: ${candidate.title}`,
    `Link: ${candidate.permalink}`,
    `Reason: ${candidate.reason}`,
    `Draft v${revisionNumber}:`,
    "```",
    draft,
    "```",
    "React 👍 to send, 👎 to cancel, or reply with edits."
  ].join("\n");
}
