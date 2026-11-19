// Google Sheets writer using a service account (secret GOOGLE_SA_JSON). Writes one tab in full.
const b64url = (b: ArrayBuffer | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google token: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export function sheetWriter(saJson: string, spreadsheetId: string, tab: string) {
  return async (rows: unknown[][]) => {
    const token = await accessToken(JSON.parse(saJson));
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values`;
    const range = encodeURIComponent(`${tab}!A:Z`);
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const clear = await fetch(`${base}/${range}:clear`, { method: "POST", headers: auth });
    if (!clear.ok) throw new Error(`Sheets clear: ${clear.status}`);
    const header = ["Asset ID", "Name", "Ticker", "Status", "Code", "Usage line", "Approved"];
    const put = await fetch(`${base}/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`, {
      method: "PUT", headers: auth, body: JSON.stringify({ values: [header, ...rows] }),
    });
    if (!put.ok) throw new Error(`Sheets write: ${put.status}`);
  };
}
