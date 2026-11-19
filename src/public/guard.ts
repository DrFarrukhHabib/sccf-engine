/** Things that must never reach a public card: codes, figures, names, tools, charity, rulebook versions. */
const FORBIDDEN: [RegExp, string][] = [
  [/\b(H[12]|D[1-5]|R[1-7]|S1)\b/, "a ruling code"],
  [/\d+(\.\d+)?\s?%/, "an exact figure"],
  [/\bFarrukh\b/i, "a name"],
  [/\b(Claude|Gemini|ChatGPT|Anthropic)\b/i, "a tool name"],
  [/\bcharit(y|ies|able)\b/i, "a charity mention"],
  [/\bv\d+(\.\d+)*\b/i, "a version number"],
];

export function assertPublicSafe(text: string): void {
  for (const [re, what] of FORBIDDEN) {
    const m = text.match(re);
    if (m) throw new Error(`Public text contains ${what} ("${m[0]}"): ${text}`);
  }
}
