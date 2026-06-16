import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optionalPath(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) return fallback;
  return path.resolve(value);
}

const localDataDir = path.join(process.cwd(), "data");

export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? "",
  discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID,
  discordChannelId: process.env.DISCORD_CHANNEL_ID ?? "",
  databasePath: optionalPath("DATABASE_PATH", path.join(localDataDir, "job-search-tracker.sqlite")),
  csvExportPath: optionalPath("CSV_EXPORT_PATH", path.join(localDataDir, "applications.csv")),
  reportTimezone: process.env.REPORT_TIMEZONE ?? "America/New_York"
};

export function requireDiscordConfig(): void {
  required("DISCORD_TOKEN");
  required("DISCORD_CLIENT_ID");
  required("DISCORD_CHANNEL_ID");
}
