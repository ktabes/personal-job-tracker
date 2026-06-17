import cron, { type ScheduledTask } from "node-cron";
import type { Client } from "discord.js";
import { config } from "./config.js";
import type { JobTrackerRepository } from "./db/repositories.js";
import { logger } from "./logger.js";
import { buildActiveApplicationsDigest } from "./reports/applications-report.js";
import { buildOpenRolesReport } from "./reports/open-roles-report.js";
import { scanTargets } from "./scraper/scanner.js";
import { sendMessagesToConfiguredChannel } from "./discord/send.js";
import { currentReportWindowKey } from "./time.js";

export class ReportScheduler {
  private tasks: ScheduledTask[] = [];

  constructor(
    private readonly client: Client,
    private readonly repository: JobTrackerRepository
  ) {}

  start(): void {
    this.tasks.push(
      cron.schedule(
        "0 9 * * 1-5",
        () => {
          void this.postOpenRolesReport();
        },
        { timezone: config.reportTimezone }
      ),
      cron.schedule(
        "0 17 * * 1-5",
        () => {
          void this.postActiveApplicationsDigest();
        },
        { timezone: config.reportTimezone }
      )
    );

    logger.info(`Scheduled reports in timezone ${config.reportTimezone}`);
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
  }

  private async postOpenRolesReport(): Promise<void> {
    try {
      const summary = await scanTargets(this.repository);
      const reportWindow = currentReportWindowKey(config.reportTimezone);
      const reportableRoles = this.repository.listReportableOpenRolesWithTargets(reportWindow);
      const report = buildOpenRolesReport(summary, reportableRoles);
      await sendMessagesToConfiguredChannel(this.client, report.messages);
      this.repository.markRolesReported(report.reportedRoles, reportWindow);
      logger.info("Posted scheduled open roles report");
    } catch (error) {
      logger.error("Scheduled open roles report failed", error);
    }
  }

  private async postActiveApplicationsDigest(): Promise<void> {
    try {
      await sendMessagesToConfiguredChannel(
        this.client,
        buildActiveApplicationsDigest(this.repository.listActiveApplications())
      );
      logger.info("Posted scheduled active applications digest");
    } catch (error) {
      logger.error("Scheduled active applications digest failed", error);
    }
  }
}
