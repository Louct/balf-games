export function createRateLimiter({ maxEntries = 20000, now = Date.now } = {}) {
  const entries = new Map();
  return function consume(key, limit, windowMs) {
    const time = now();
    let entry = entries.get(key);
    if (!entry || entry.reset <= time) {
      if (entries.size >= maxEntries) {
        for (const [name, item] of entries)
          if (item.reset <= time) entries.delete(name);
        if (entries.size >= maxEntries && !entries.has(key))
          return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
      }
      entry = { used: 0, reset: time + windowMs };
      entries.set(key, entry);
    }
    entry.used++;
    return {
      allowed: entry.used <= limit,
      retryAfter: Math.max(1, Math.ceil((entry.reset - time) / 1000)),
    };
  };
}
