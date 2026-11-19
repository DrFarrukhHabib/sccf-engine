/** API client keys: shown once, stored only as a SHA-256 hash. */
export async function hashKey(key: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "sccf_" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
