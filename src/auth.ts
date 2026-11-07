/**
 * OAuth resource-server side: validate RS256 access tokens issued by the
 * Shield API authorization server against its JWKS. The Worker holds no
 * secrets; a bad or absent token degrades to anonymous, never to an error
 * for the free tier.
 */

export interface AuthContext {
  userId: string;
  orgId: string;
  clientId: string;
  scopes: string[];
}

export interface AuthConfig {
  issuer: string;
  resource: string;
  jwksUrl: string;
  enabled: boolean;
}

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

function b64urlToBytes(value: string): Uint8Array {
  let b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  let binary = atob(b64);
  let bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonPart(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function fetchJwks(config: AuthConfig, force: boolean, fetcher: typeof fetch): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  let response = await fetcher(config.jwksUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
  let body = (await response.json()) as { keys?: Jwk[] };
  jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

async function importKey(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/** Validate a bearer token. Returns null for any invalid token. */
export async function validateToken(
  token: string,
  config: AuthConfig,
  fetcher: typeof fetch = fetch,
): Promise<AuthContext | null> {
  try {
    let parts = token.split(".");
    if (parts.length !== 3) return null;
    let header = decodeJsonPart(parts[0]);
    let claims = decodeJsonPart(parts[1]);
    if (header.alg !== "RS256" || claims.type !== "oauth-access") return null;
    if (claims.iss !== config.issuer || claims.aud !== config.resource) return null;
    let now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== "number" || claims.exp < now - 60) return null;
    if (typeof claims.nbf === "number" && claims.nbf > now + 60) return null;

    let keys = await fetchJwks(config, false, fetcher);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      keys = await fetchJwks(config, true, fetcher);
      jwk = keys.find((k) => k.kid === header.kid);
    }
    if (!jwk) return null;
    let key = await importKey(jwk);
    let signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    let signature = b64urlToBytes(parts[2]);
    let ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature as BufferSource, signingInput as BufferSource);
    if (!ok) return null;
    if (typeof claims.sub !== "string" || typeof claims.org_id !== "string") return null;
    return {
      userId: claims.sub,
      orgId: claims.org_id,
      clientId: typeof claims.client_id === "string" ? claims.client_id : "",
      scopes: typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

export function authError(kind: "authorization_required" | "insufficient_scope", resourceMetadataUrl: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: kind,
            message:
              kind === "authorization_required"
                ? "This tool requires signing in with an approved Shield account. Tell the user exactly this: (1) make sure this MCP server is connected as https://mcp.unpkg.com/mcp (a localhost server cannot complete their account login); (2) in the MCP client's server panel/list, open the unpkg server and choose Authenticate (or Sign in); (3) a browser opens at shield.unpkg.com — sign in with their Shield account and Approve; (4) then retry this tool. The account must be email-verified and approved from the Shield beta waitlist. Do not hand the user the resourceMetadata URL; that is for client software, not people. Anonymous free tools keep working without any of this."
                : "Your Shield login does not include the scope this tool needs. Reconnect and approve the requested access.",
            resourceMetadata: resourceMetadataUrl,
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

/** Reset the JWKS cache (tests). */
export function _resetJwksCache() {
  jwksCache = null;
}
