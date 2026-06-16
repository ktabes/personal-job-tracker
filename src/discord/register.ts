import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { commandDefinitions } from "./command-definitions.js";

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  if (config.discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId), {
      body: commandDefinitions
    });
    logger.info(`Registered ${commandDefinitions.length} guild commands`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), {
    body: commandDefinitions
  });
  logger.info(`Registered ${commandDefinitions.length} global commands`);
}
