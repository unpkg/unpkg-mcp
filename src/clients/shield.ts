import { VERSION } from "../version.ts";

/** Thin client for the user-scoped Shield API endpoints. The caller's OAuth
 * bearer is forwarded per call; nothing is stored. Tenant scoping is enforced
 * by the Shield API from that token — this client names no org or user. */

export class ShieldError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class ShieldClient {
  readonly origin: string;
  private readonly fetcher: typeof fetch;

  constructor(origin: string, fetcher: typeof fetch = fetch) {
    this.origin = origin;
    // Workers' fetch throws "illegal invocation" when called off an
    // arbitrary object; bind it to the global scope.
    this.fetcher = fetcher.bind(globalThis);
  }

  private async request<T>(bearer: string | null, path: string, init?: RequestInit): Promise<T> {
    let controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), 10_000);
    try {
      let response = await this.fetcher(`${this.origin}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          // Identify as MCP traffic for Shield API metrics.
          "User-Agent": `unpkg-mcp/${VERSION} (+https://mcp.unpkg.com)`,
          "X-Client-Source": "mcp",
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
      });
      if (!response.ok) {
        let detail = "";
        try {
          let body = (await response.json()) as { detail?: unknown };
          detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? "");
        } catch {
          // Non-JSON error body; status alone is the signal.
        }
        throw new ShieldError(detail || `Shield API returned ${response.status}`, response.status);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ShieldError) throw error;
      throw new ShieldError(`Shield API unreachable: ${(error as Error).message}`, 0);
    } finally {
      clearTimeout(timer);
    }
  }

  me(bearer: string) {
    return this.request<Record<string, unknown>>(bearer, "/v1/auth/me");
  }

  simulate(
    bearer: string,
    body: { package: string; version: string; path?: string; referer?: string; origin?: string },
  ) {
    return this.request<Record<string, unknown>>(bearer, "/v1/edge/simulate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  bulkAnalyses(bearer: string, items: { name: string; version: string }[]) {
    return this.request<Record<string, unknown>[]>(bearer, "/v1/monitor/packages/bulk-analyses", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  }

  myPackages(bearer: string) {
    return this.request<Record<string, unknown>[]>(bearer, "/v1/monitor/my-packages");
  }

  blocklist(bearer: string) {
    return this.request<Record<string, unknown>[]>(bearer, "/v1/monitor/blocklist");
  }

  pinPolicies(bearer: string) {
    return this.request<Record<string, unknown>[]>(bearer, "/v1/monitor/pin-policy");
  }

  /** Public intel: release verdicts for named packages. No account data;
   * the underlying endpoints serve global package intel without auth. */
  publicAnalyses(items: { name: string; version: string }[]) {
    return this.request<Record<string, unknown>[]>(null, "/v1/monitor/packages/bulk-analyses", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  }

  /** Public intel: advisories already matched server-side to one version. */
  publicVersionAdvisories(name: string, version: string) {
    let pathName = name.split("/").map(encodeURIComponent).join("/");
    return this.request<Record<string, unknown>[]>(
      null,
      `/v1/monitor/packages/${pathName}/advisories/${encodeURIComponent(version)}`,
    );
  }

  domainPackages(bearer: string, domain: string) {
    return this.request<Record<string, unknown>>(
      bearer,
      `/v1/domains/domains/${encodeURIComponent(domain)}/packages`,
    );
  }

  domainThreats(bearer: string, domain: string, days = 30) {
    return this.request<Record<string, unknown>>(
      bearer,
      `/v1/domains/domains/${encodeURIComponent(domain)}/threats?days=${days}`,
    );
  }

  /** Domain counts, UNPKG-scoped at this layer too: the API returns an
   * all-source total to admins, but that cross-source number must never
   * transit the MCP. Every caller gets the UNPKG-only count. */
  async domainsSummary(bearer: string) {
    let rows = await this.request<Record<string, unknown>[]>(bearer, "/v1/domains/package_summary");
    return rows.map((row) => ({ ...row, package_count: row.unpkg_package_count }));
  }
}

/** Map a ShieldError to an agent-readable tool error message. */
export function shieldErrorMessage(error: unknown): string {
  if (error instanceof ShieldError) {
    if (error.status === 401) return "Shield login expired or invalid. Reconnect via OAuth.";
    if (error.status === 403) {
      return /pending/i.test(error.message)
        ? "Shield account is pending beta approval; MCP Shield tools unlock once approved."
        : `Shield denied this request: ${error.message}`;
    }
    if (error.status === 429) return "Shield API rate limit; retry shortly.";
    if (error.status === 0 || error.status >= 500) return "Shield API is unavailable right now; the anonymous tools still work.";
    return `Shield API error (${error.status}): ${error.message}`;
  }
  return `Shield API error: ${(error as Error).message}`;
}
