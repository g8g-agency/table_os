import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://b0d69ee0ceb224c76f5ed42b5f72c751@o4512208763420672.ingest.de.sentry.io/4512223178129488",
});
