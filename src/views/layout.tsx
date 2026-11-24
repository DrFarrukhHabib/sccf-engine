import type { Child } from "hono/jsx";

const css = `
:root{--ink:#1d2330;--muted:#5b6475;--line:#e3e6ec;--bg:#f6f7f9;--card:#fff;--accent:#1f5f8b;
--halal:#12703a;--halal-bg:#e5f4ea;--doubt:#8a5a00;--doubt-bg:#fdf1d8;--haram:#a3231f;--haram-bg:#fbe5e4;--check:#1f5f8b;--check-bg:#e3eef7}
*{box-sizing:border-box}
body{font-family:Aptos,Calibri,Verdana,Roboto,sans-serif;font-size:12pt;margin:0;color:var(--ink);background:var(--bg);line-height:1.45}
header{background:var(--ink);color:#fff;padding:0 24px}
header .bar{max-width:1100px;margin:0 auto;display:flex;align-items:center;gap:28px;height:56px}
header .brand{font-weight:700;letter-spacing:.2px}
header nav a{color:#c9d1de;text-decoration:none;margin-right:20px;padding:18px 0;border-bottom:3px solid transparent}
header nav a.on,header nav a:hover{color:#fff;border-bottom-color:#7fb2d6}
main{max-width:1100px;margin:0 auto;padding:24px}
h1{font-size:20pt;margin:4px 0 16px}h2{font-size:16pt;margin:28px 0 10px}h3{font-size:14pt;margin:18px 0 8px}
a{color:var(--accent)}
.back{display:inline-block;margin-bottom:6px;text-decoration:none;font-size:11pt}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:12px 0}
.tiles{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0 4px}
.tile{flex:1;min-width:150px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px}
.tile b{display:block;font-size:20pt}.tile span{color:var(--muted);font-size:11pt}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:8px 0}
td,th{padding:9px 12px;text-align:left;vertical-align:top;font-size:11pt;border-bottom:1px solid var(--line)}
th{background:#fafbfc;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:10.5pt;font-weight:600;white-space:nowrap}
.Halal{color:var(--halal);background:var(--halal-bg)}.Doubtful{color:var(--doubt);background:var(--doubt-bg)}
.Haram{color:var(--haram);background:var(--haram-bg)}.Check{color:var(--check);background:var(--check-bg)}
.code{color:var(--muted);font-size:10.5pt;margin-left:4px}
.same{color:var(--halal)}.changed{color:var(--haram);font-weight:600}.muted{color:var(--muted)}
.flag{color:var(--doubt);font-weight:600}
button{font:inherit;font-size:11pt;padding:7px 16px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button.ghost{background:#fff;color:var(--accent)}
form.inline{display:inline}
textarea,input{font:inherit;font-size:11pt;width:100%;padding:8px;border:1px solid var(--line);border-radius:8px}
input[type=checkbox]{width:auto}
.question p{margin:4px 0}
.note{background:#fff6e0;padding:10px 14px;border-radius:8px}
.key{font-family:monospace;font-size:12pt;background:#eef;padding:8px;word-break:break-all}
.Pass{color:var(--halal)}.Concern{color:var(--doubt)}.Fail{color:var(--haram)}
@media print{header,form,button,.back{display:none}body{background:#fff}main{padding:0}}
`;

const MENU: [string, string][] = [
  ["/desk/queue", "To do"],
  ["/desk/questions", "Questions"],
  ["/desk/library", "Approved"],
  ["/desk/rules", "Rule proposals"],
  ["/desk/keys", "Client keys"],
];

export function Layout({ title, active, children }: { title: string; active?: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · SCCF Review Desk</title>
        <style>{css}</style>
      </head>
      <body>
        <header>
          <div class="bar">
            <span class="brand">SCCF Review Desk</span>
            <nav>{MENU.map(([href, label]) => <a href={href} class={href === active ? "on" : ""}>{label}</a>)}</nav>
          </div>
        </header>
        <main>
          <h1>{title}</h1>
          {children}
        </main>
      </body>
    </html>
  );
}

/** A coloured status pill with the code beside it. */
export const Status = ({ status, code }: { status: string | null; code?: string | null }) =>
  status ? (
    <span>
      <span class={`badge ${status.split(" ")[0]}`}>{status}</span>
      {code && <span class="code">{code}</span>}
    </span>
  ) : <span class="muted">—</span>;
