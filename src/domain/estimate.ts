/**
 * Rough migration impact estimation. Deliberately range-based: anyone
 * promising an exact dollar or millisecond figure from byte counts alone
 * is making it up. What byte counts CAN support: bandwidth offload in
 * GB/month, and a transfer-time equivalent under a stated bandwidth
 * assumption. Latency in the real world depends on request count,
 * connection reuse, geography, and what the user's current hosting is —
 * the output says so, every time.
 */
export interface ImpactInput {
  monthlyPageViews: number;
  /** Raw (uncompressed) bytes per page load that would move to UNPKG. */
  unpkgBytesPerPageLoad: number;
  /** Share of page loads served from the browser cache (0..1). Default 0.5. */
  browserCacheRate?: number;
  /** Current hosting bandwidth cost, USD per GB. Omit to skip dollars. */
  bandwidthCostPerGbUsd?: number;
}

export interface ImpactEstimate {
  monthlyGbOffloaded: { low: number; high: number };
  monthlySavingsUsd: { low: number; high: number } | null;
  perLoadWireBytes: { low: number; high: number };
  transferTimeEquivalentMs: { at1_6Mbps: number; at10Mbps: number; at50Mbps: number };
  assumptions: string[];
  caveats: string[];
  betterMetrics: string[];
}

const GB = 1_000_000_000;

export function estimateMigrationImpact(input: ImpactInput): ImpactEstimate {
  let cacheRate = Math.min(0.95, Math.max(0, input.browserCacheRate ?? 0.5));
  let fetchedLoads = input.monthlyPageViews * (1 - cacheRate);
  // JS/CSS text compresses to roughly 25–50% on the wire (gzip/brotli).
  let wireLow = input.unpkgBytesPerPageLoad * 0.25;
  let wireHigh = input.unpkgBytesPerPageLoad * 0.5;
  let gbLow = (fetchedLoads * wireLow) / GB;
  let gbHigh = (fetchedLoads * wireHigh) / GB;

  return {
    monthlyGbOffloaded: { low: round(gbLow), high: round(gbHigh) },
    monthlySavingsUsd:
      input.bandwidthCostPerGbUsd != null
        ? { low: round(gbLow * input.bandwidthCostPerGbUsd, 2), high: round(gbHigh * input.bandwidthCostPerGbUsd, 2) }
        : null,
    perLoadWireBytes: { low: Math.round(wireLow), high: Math.round(wireHigh) },
    transferTimeEquivalentMs: {
      at1_6Mbps: ms(wireHigh, 1.6),
      at10Mbps: ms(wireHigh, 10),
      at50Mbps: ms(wireHigh, 50),
    },
    assumptions: [
      `Monthly page views: ${input.monthlyPageViews} (caller-provided).`,
      `${input.unpkgBytesPerPageLoad} raw bytes per load move to UNPKG (from audit entry sizes; excludes transitive files unless included by the caller).`,
      `Browser cache serves ${Math.round(cacheRate * 100)}% of loads without a network fetch.`,
      "Wire size is 25–50% of raw bytes (gzip/brotli on text assets).",
    ],
    caveats: [
      "This is an order-of-magnitude planning estimate, not a forecast. Do not quote the dollar figure without the bandwidth-offload range next to it.",
      "Transfer-time equivalent is not an LCP prediction: real page latency depends on request count, connection reuse, geography, server response time, and what hosts the bytes today. If the site already serves from a good CDN, expect latency to be a wash and treat bandwidth/build simplification as the win.",
      "Import maps can increase request count versus one bundle; converting only makes sense where the audit said convert_now.",
    ],
    betterMetrics: [
      "KB removed from the first-party bundle (measurable today, no traffic assumptions).",
      "Share of runtime dependencies on permanent, year-cached URLs (cacheability).",
      "Patch latency: time from an npm patch publishing to users receiving it (deploys vs automatic).",
      "Build/deploy simplification: bundler config and externals removed.",
    ],
  };
}

function round(value: number, digits = 3): number {
  let factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ms(bytes: number, mbps: number): number {
  return Math.round((bytes * 8) / (mbps * 1_000_000) * 1000);
}
