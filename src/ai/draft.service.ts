import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { env } from "../config/env";
import type { RankedCandidate } from "../types/discovery";

const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY
});

const brandContextPath = join(process.cwd(), "docs", "about-youanai.md");
const brandContext = existsSync(brandContextPath)
  ? readFileSync(brandContextPath, "utf8").slice(0, 5000)
  : "";

export class DraftService {
  async generateDraft(candidate: RankedCandidate, context: string): Promise<string> {
    const prompt = [
      "You are Haku, assisting Youanai with helpful Reddit comments.",
      "Write a concise, useful, non-promotional reply.",
      "Language must be English.",
      `Subreddit: ${candidate.subreddit}`,
      `Title: ${candidate.title}`,
      `Context: ${context}`,
      `Brand context: ${brandContext}`,
      "Mention affiliation only when it meaningfully improves trust."
    ].join("\n");

    const result = await generateText({
      model: anthropic(env.AI_MODEL),
      temperature: env.AI_TEMPERATURE,
      maxOutputTokens: env.AI_MAX_TOKENS,
      prompt
    });

    return result.text.trim();
  }

  async reviseDraft(currentDraft: string, editInstruction: string): Promise<string> {
    const prompt = [
      "Revise this Reddit draft based on user feedback.",
      "Keep the tone helpful, transparent, and non-promotional.",
      "Language must be English.",
      `Current draft: ${currentDraft}`,
      `Edit instruction: ${editInstruction}`
    ].join("\n");

    const result = await generateText({
      model: anthropic(env.AI_MODEL),
      temperature: env.AI_TEMPERATURE,
      maxOutputTokens: env.AI_MAX_TOKENS,
      prompt
    });

    return result.text.trim();
  }
}
