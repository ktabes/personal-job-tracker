import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { config, requireDiscordConfig } from "./config.js";
import { closeDb, getDb } from "./db/database.js";
import { JobTrackerRepository } from "./db/repositories.js";
import { InteractionHandler } from "./discord/interactions.js";
import { registerCommands } from "./discord/register.js";
import { logger } from "./logger.js";
import { ReportScheduler } from "./scheduler.js";

requireDiscordConfig();

const db = getDb();
const repository = new JobTrackerRepository(db);
repository.regenerateCsv();

await registerCommands();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const interactions = new InteractionHandler(client, repository);
const scheduler = new ReportScheduler(client, repository);

client.once(Events.ClientReady, (readyClient) => {
  logger.info(`Logged in as ${readyClient.user.tag}`);
  scheduler.start();
});

client.on(Events.InteractionCreate, (interaction) => {
  interactions.handle(interaction).catch(async (error) => {
    logger.error("Interaction handling failed", error);
    const message = error instanceof Error ? error.message : "Interaction failed. Check logs for details.";
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => undefined);
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  });
});

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await client.login(config.discordToken);

async function shutdown(): Promise<void> {
  logger.info("Shutting down job-search tracker");
  scheduler.stop();
  client.destroy();
  closeDb();
  process.exit(0);
}
