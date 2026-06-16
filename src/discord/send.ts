import type { Client, MessageCreateOptions, TextBasedChannel } from "discord.js";
import { config } from "../config.js";

type SendableTextChannel = TextBasedChannel & {
  send(options: MessageCreateOptions): Promise<unknown>;
};

export async function sendMessagesToConfiguredChannel(
  client: Client,
  messages: MessageCreateOptions[]
): Promise<void> {
  const channel = await getConfiguredChannel(client);
  for (const message of messages) {
    await channel.send(message);
  }
}

async function getConfiguredChannel(client: Client): Promise<SendableTextChannel> {
  const channel = await client.channels.fetch(config.discordChannelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Configured Discord channel ${config.discordChannelId} is not a text channel`);
  }
  return channel as SendableTextChannel;
}
