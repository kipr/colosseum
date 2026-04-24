import rateLimit, { MemoryStore, Options } from 'express-rate-limit';
import { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Shared stores – exported so tests can call resetAll() between cases
// ---------------------------------------------------------------------------

const oauthStore = new MemoryStore();
const scoreSubmitStore = new MemoryStore();
const accessCodeStore = new MemoryStore();
const chatWriteStore = new MemoryStore();
const chatReadStore = new MemoryStore();
const queueSyncStore = new MemoryStore();
const publicExpensiveReadStore = new MemoryStore();

const allStores = [
  oauthStore,
  scoreSubmitStore,
  accessCodeStore,
  chatWriteStore,
  chatReadStore,
  queueSyncStore,
  publicExpensiveReadStore,
];

/** Reset every limiter's counters. Intended for test teardown only. */
export function resetAllRateLimiters(): void {
  for (const store of allStores) {
    store.resetAll();
  }
}

// ---------------------------------------------------------------------------
// Shared 429 handler
// ---------------------------------------------------------------------------

function rateLimitHandler(
  limiterName: string,
): NonNullable<Options['handler']> {
  return (req: Request, res: Response) => {
    console.warn(
      `Rate limit hit: limiter=${limiterName} method=${req.method} path=${req.path} ip=${req.ip}`,
    );
    res.status(429).json({
      error: 'rate_limit_exceeded',
      message:
        'You have exceeded the request limit. Please wait before trying again.',
      limiter: limiterName,
      retryAfterMs: res.getHeader('Retry-After')
        ? Number(res.getHeader('Retry-After')) * 1000
        : undefined,
    });
  };
}

// ---------------------------------------------------------------------------
// Limiter instances
// ---------------------------------------------------------------------------

/** Coarse OAuth entry-point protection: 20 req / 15 min per IP. */
export const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  store: oauthStore,
  handler: rateLimitHandler('oauth'),
});

/** Score submission: 30 req / 1 min per IP (judges submit rapidly during events). */
export const scoreSubmitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  store: scoreSubmitStore,
  handler: rateLimitHandler('scoreSubmit'),
});

/**
 * Access-code verification: 10 req / 15 min per IP+template.
 * Keyed by IP + template id to isolate brute-force attempts per template.
 */
export const accessCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  store: accessCodeStore,
  keyGenerator: (req: Request) => `${req.ip}:${req.params.id}`,
  validate: { keyGeneratorIpFallback: false },
  handler: rateLimitHandler('accessCode'),
});

/** Chat message posting: 15 req / 1 min per IP. */
export const chatWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  store: chatWriteStore,
  handler: rateLimitHandler('chatWrite'),
});

/** Chat message polling: 120 req / 1 min per IP (clients poll frequently). */
export const chatReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  store: chatReadStore,
  handler: rateLimitHandler('chatRead'),
});

/**
 * Queue sync requests: 90 req / 1 min per IP (expensive DB sync).
 * Only applied when the request includes sync=1|true; plain reads skip it.
 * Kept below chat polling limits but high enough for admin UI (filters, tabs, scoresheet).
 */
export const queueSyncLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  store: queueSyncStore,
  skip: (req: Request) => {
    const sync = req.query.sync;
    return sync !== '1' && sync !== 'true';
  },
  handler: rateLimitHandler('queueSync'),
});

/** Public expensive read endpoints: 30 req / 1 min per IP. */
export const publicExpensiveReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  store: publicExpensiveReadStore,
  handler: rateLimitHandler('publicExpensiveRead'),
});
