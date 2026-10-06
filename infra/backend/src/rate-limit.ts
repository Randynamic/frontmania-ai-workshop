/** Fixed-window limiter for the unauthenticated pick endpoint. State is process-local and bounded by window. */
export interface RateLimiter {
  readonly allow: (key: string, now?: number) => boolean;
}

export const createRateLimiter = (max: number, windowMs: number): RateLimiter => {
  const hits = new Map<string, readonly number[]>();
  return {
    allow: (key, now = Date.now()) => {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      hits.set(key, [...recent, now]);
      return true;
    },
  };
};
