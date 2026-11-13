// Runs once when this Next.js server instance starts up — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md.
// Used here to start the in-process daily birthday-email scheduler
// (src/lib/birthday-scheduler.ts), the daily event-lapse social-media/event-report task scheduler
// (src/lib/event-social-scheduler.ts), and the daily task-deadline-reminder
// scheduler (src/lib/task-deadline-scheduler.ts), plus the event-pass retention,
// certificate and pass-email schedulers, rather than requiring an
// external VPS crontab entry, since this app runs continuously under PM2.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Re-arm any buffered emails and start the 30s sweeper at boot (the /api/data poll used to do this implicitly).
    const { restoreBufferedQueue } = await import('./lib/email-service');
    restoreBufferedQueue().catch(() => {});

    const { startBirthdayScheduler } = await import('./lib/birthday-scheduler');
    startBirthdayScheduler();



    const { startTaskDeadlineScheduler } = await import('./lib/task-deadline-scheduler');
    startTaskDeadlineScheduler();




    const { startPassRetentionScheduler } = await import('./lib/pass-retention-scheduler');
    startPassRetentionScheduler();

    const { startCertificateScheduler } = await import('./lib/certificate-scheduler');
    startCertificateScheduler();

    const { startPassEmailScheduler } = await import('./lib/pass-email-scheduler');
    startPassEmailScheduler();

    const { startEmailBackgroundScheduler } = await import('./lib/email-background-retention');
    startEmailBackgroundScheduler();
  }
}
