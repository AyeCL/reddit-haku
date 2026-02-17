import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  Partials,
  TextChannel,
  type User
} from "discord.js";
import { env } from "../config/env";
import { logger } from "../config/logger";

export type DiscordReactionInput = {
  channelId: string;
  messageId: string;
  userId: string;
  emoji: string;
};

export type DiscordReplyInput = {
  message: Message;
  referencedMessageId: string;
};

export type DiscordBotHandlers = {
  onMention?: (message: Message) => Promise<void>;
  onReply?: (input: DiscordReplyInput) => Promise<void>;
  onReaction?: (input: DiscordReactionInput) => Promise<void>;
};

type DiscordBotOptions = {
  handlers?: DiscordBotHandlers;
  listenForEvents?: boolean;
};

export class DiscordBot {
  private readonly handlers: DiscordBotHandlers;
  private readonly listenForEvents: boolean;
  private readonly client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
  });

  constructor(options: DiscordBotOptions = {}) {
    this.handlers = options.handlers ?? {};
    this.listenForEvents = options.listenForEvents ?? true;
  }

  async start(): Promise<void> {
    this.client.once(Events.ClientReady, (readyClient) => {
      logger.info({ tag: readyClient.user.tag }, "Discord bot connected");
    });

    if (this.listenForEvents) {
      this.client.on(Events.MessageCreate, async (message) => {
        try {
          await this.handleMessage(message);
        } catch (error) {
          logger.error({ err: error, messageId: message.id }, "Error handling message event");
        }
      });

      this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
        try {
          await this.handleReactionAdd(reaction, user);
        } catch (error) {
          logger.error({ err: error }, "Error handling reaction event");
        }
      });
    }

    await this.client.login(env.DISCORD_BOT_TOKEN);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  isReady(): boolean {
    return this.client.isReady();
  }

  async postApprovalCandidate(content: string): Promise<{ messageId: string; channelId: string }> {
    const channel = await this.getApprovalChannel();
    const msg = await channel.send(content);
    await msg.react("👍");
    await msg.react("👎");

    return {
      messageId: msg.id,
      channelId: msg.channelId
    };
  }

  async postLearningUpdate(content: string): Promise<void> {
    const channel = await this.getApprovalChannel();
    await channel.send(content);
  }

  async replyToMessage(channelId: string, messageId: string, content: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error("replyToMessage called with non-text channel");
    }

    const target = await channel.messages.fetch(messageId);
    await target.reply(content);
  }

  async postStatus(content: string): Promise<void> {
    const channel = await this.getApprovalChannel();
    await channel.send(content);
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) {
      return;
    }

    const botId = this.client.user?.id;
    if (!botId) {
      return;
    }

    const mentionsBot = message.mentions.users.has(botId);
    if (mentionsBot) {
      logger.info({ authorId: message.author.id, messageId: message.id }, "Received bot mention command");
      await this.handlers.onMention?.(message);
      return;
    }

    const referencedMessageId = message.reference?.messageId;
    if (referencedMessageId) {
      await this.handlers.onReply?.({ message, referencedMessageId });
    }
  }

  private async handleReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    if (user.bot) {
      return;
    }

    if (reaction.partial) {
      await reaction.fetch();
    }

    if (reaction.message.partial) {
      await reaction.message.fetch();
    }

    const emoji = reaction.emoji.name;
    if (!emoji) {
      return;
    }

    await this.handlers.onReaction?.({
      channelId: reaction.message.channelId,
      messageId: reaction.message.id,
      userId: user.id,
      emoji
    });
  }

  private async getApprovalChannel(): Promise<TextChannel> {
    const channel = await this.client.channels.fetch(env.DISCORD_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error("Configured DISCORD_CHANNEL_ID is not a text channel");
    }
    return channel;
  }
}
