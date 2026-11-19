// Cloudflare Access: verify the signed JWT Access adds to every request it lets through.
// A bare email header is not trusted: the Worker may also be reachable without Access.

export interface AccessConfig { teamDomain: string; aud: string; email: string }
export type KeyProvider = () => Promise<JsonWebKey[]>;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

export const certsProvider = (teamDomain: string): KeyProvider => async () => {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: ${res.status}`);
  return ((await res.json()) as { keys: JsonWebKey[] }).keys;
};

/** Returns the authenticated email, or null if the token is missing, invalid, expired, or for someone else. */
export async function verifyAccess(token: string | undefined, cfg: AccessConfig, keys: KeyProvider): Promise<string | null> {
  if (!token || !cfg.aud || !cfg.email || !cfg.teamDomain) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = json(parts[0]);
    const payload = json(parts[1]);
    if (header.alg !== "RS256") return null;
    const jwk = (await keys()).find((k) => (k as { kid?: string }).kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const auds: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(cfg.aud)) return null;
    if (payload.iss !== `https://${cfg.teamDomain}`) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    if (String(payload.email).toLowerCase() !== cfg.email.toLowerCase()) return null;
    return payload.email;
  } catch {
    return null;
  }
}
