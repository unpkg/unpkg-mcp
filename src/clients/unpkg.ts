export interface MetaFile {
  path: string;
  size: number;
  type: string;
  integrity?: string;
}

export interface MetaListing {
  package: string;
  version: string;
  prefix: string;
  files: MetaFile[];
}

import { VERSION } from "../version.ts";

const USER_AGENT = `unpkg-mcp/${VERSION} (+https://mcp.unpkg.com)`;

export class UnpkgClient {
  constructor(
    readonly origin: string,
    private fetchFn: typeof fetch = ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)) as typeof fetch,
  ) {}

  fileUrl(name: string, versionSpec: string, file = ""): string {
    let clean = file.replace(/^\//, "");
    return `${this.origin}/${name}@${versionSpec}${clean ? `/${clean}` : ""}`;
  }

  async listFiles(name: string, version: string, prefix = "/"): Promise<MetaListing | null> {
    let cleanPrefix = prefix.startsWith("/") ? prefix : `/${prefix}`;
    if (!cleanPrefix.endsWith("/")) cleanPrefix += "/";
    let url = `${this.origin}/${name}@${version}${cleanPrefix}?meta`;
    let response = await this.fetchFn(url, { redirect: "follow", headers: { "User-Agent": USER_AGENT } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`UNPKG ?meta returned ${response.status} for ${name}@${version}`);
    return (await response.json()) as MetaListing;
  }

  /** Fetch a file's text (entry-point sniffing). Returns null when absent. */
  async fetchText(name: string, version: string, file: string, maxBytes = 64_000): Promise<string | null> {
    let response = await this.fetchFn(this.fileUrl(name, version, file), { redirect: "follow", headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) return null;
    let text = await response.text();
    return text.slice(0, maxBytes);
  }

  async verifyUrl(url: string): Promise<{ ok: boolean; status: number; finalUrl: string; contentType: string | null }> {
    let response = await this.fetchFn(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": USER_AGENT } });
    // Some origins answer HEAD poorly; fall back to a ranged GET once.
    if (response.status === 405 || response.status === 501) {
      response = await this.fetchFn(url, { headers: { Range: "bytes=0-0", "User-Agent": USER_AGENT }, redirect: "follow" });
    }
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
      contentType: response.headers.get("Content-Type"),
    };
  }
}
