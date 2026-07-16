import * as Sentry from "@sentry/node";
import { env } from "./env";

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  release: env.APP_VERSION,
  serverName: "orderlli-backend",
  enabled: !!env.SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
  ignoreErrors: [
    "ECONNRESET",
    "EPIPE",
    "ERR_STREAM_PREMATURE_CLOSE",
    "socket hang up",
    "Request aborted"
  ],
});

export { Sentry };
