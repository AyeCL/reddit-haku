import type { Message } from "discord.js";
import { env } from "../config/env";

export class MentionCommandService {
  extractCommandText(message: Message): string {
    const botId = message.client.user?.id;
    if (!botId) {
      return message.content.trim();
    }

    return message.content.replaceAll(`<@${botId}>`, "").replaceAll(`<@!${botId}>`, "").trim();
  }

  async getContextWindow(message: Message): Promise<Message[]> {
    const channel = message.channel;
    const fetched = await channel.messages.fetch({
      limit: env.MENTION_CONTEXT_LOOKBACK_MESSAGES,
      before: message.id
    });

    return Array.from(fetched.values()).reverse();
  }
}
