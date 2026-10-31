// Adapted from Rakazo (Apache-2.0); see third_party/README.md.
/** Longest a server's Retry-After may park a client loop. */
const MAX_RETRY_AFTER_MS = 5 * 60_000;

/** The HTTP status a failed request carried, if it got a response at all. */
function errorStatus(error) {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const { status } = error;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

/**
 * Whether asking again can succeed. A failure without a response (the network, a timeout, a
 * dropped stream) can, as can 5xx, 429, and 408. Any other status is the server's answer to this
 * request — signed out, forbidden, gone, or this build no longer supported — and repeating the
 * request only polls the server.
 */
function isRetryableError(error) {
  const status = errorStatus(error);
  if (status === undefined || status < 400) return true;
  return status >= 500 || status === 429 || status === 408;
}

/** Retry-After as delta-seconds or an HTTP date, in milliseconds from `now`. */
function parseRetryAfter(
  value,
  now = Date.now(),
) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : undefined;
}

/** Wait the server asked for (an error's `retryAfterMs`), otherwise the caller's own backoff. */
function retryDelayMs(error, backoffMs) {
  const asked =
    typeof error === "object" && error !== null && "retryAfterMs" in error
      ? error.retryAfterMs
      : undefined;
  return typeof asked === "number" && Number.isFinite(asked) && asked >= 0
    ? Math.min(Math.max(asked, backoffMs), MAX_RETRY_AFTER_MS)
    : backoffMs;
}

module.exports = { isRetryableError, parseRetryAfter, retryDelayMs };
