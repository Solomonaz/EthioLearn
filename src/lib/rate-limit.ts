// In-memory sliding window rate limiter
// Note: resets on server restart — acceptable for dev/single-instance prod

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
function cleanup() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number; // unix ms
  retryAfter: number; // seconds
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  cleanup();
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || now > existing.resetAt) {
    // New window
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      success: true,
      remaining: limit - 1,
      reset: resetAt,
      retryAfter: 0,
    };
  }

  if (existing.count >= limit) {
    return {
      success: false,
      remaining: 0,
      reset: existing.resetAt,
      retryAfter: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;
  return {
    success: true,
    remaining: limit - existing.count,
    reset: existing.resetAt,
    retryAfter: 0,
  };
}
