import { requireDiscordConfig } from "./config.js";
import { registerCommands } from "./discord/register.js";

requireDiscordConfig();
await registerCommands();
