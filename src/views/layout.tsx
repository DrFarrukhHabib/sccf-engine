import type { Child } from "hono/jsx";

const css = `
:root{
  --ink:#1c2433;--muted:#5d6779;--line:#e2e6ee;--bg:#eef2f7;--card:#fff;
  --brand:#0f766e;--brand-2:#14b8a6;--brand-ink:#0b4f4a;
  --halal:#0f7a3d;--halal-bg:#dcf3e5;--doubt:#8a5300;--doubt-bg:#fdefcf;--haram:#b42318;--haram-bg:#fde3e1;--check:#1d4ed8;--check-bg:#e0e9fd;
  --q:#d97706;--q-bg:#fff7e8;--chg:#be123c;--chg-bg:#fff1f3;--ok:#059669;--ok-bg:#ecfdf5;--ret:#475569;--ret-bg:#f1f5f9;--lib:#4338ca;--lib-bg:#eef0ff
}
*{box-sizing:border-box}
body{font-family:Aptos,Calibri,Verdana,Roboto,sans-serif;font-size:12pt;margin:0;color:var(--ink);background:var(--bg);line-height:1.5}
a{color:var(--brand)}
.topline{height:6px;background:linear-gradient(90deg,var(--brand),var(--brand-2),#6366f1)}
header{background:#fff;border-bottom:1px solid var(--line);box-shadow:0 2px 10px rgba(16,24,40,.06);margin-bottom:8px}
header .bar{max-width:1120px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;gap:24px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:13pt;color:var(--brand-ink);text-decoration:none}
.brand .logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--brand),var(--brand-2));color:#fff;display:grid;place-items:center;font-size:14pt}
.brand small{display:block;font-weight:400;color:var(--muted);font-size:10pt}
nav{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
nav a{color:var(--ink);text-decoration:none;padding:8px 16px;border-radius:999px;border:1px solid var(--line);background:#f8fafc;font-weight:600;font-size:11pt}
nav a:hover{border-color:var(--brand-2);background:#f0fdfa}
nav a.on{background:var(--brand);border-color:var(--brand);color:#fff}
main{max-width:1120px;margin:0 auto;padding:16px 24px 48px}
h1{font-size:20pt;margin:8px 0 16px}h2{font-size:16pt;margin:0}h3{font-size:14pt;margin:14px 0 6px}
.back{display:inline-flex;align-items:center;gap:6px;margin-bottom:10px;text-decoration:none;font-weight:600;font-size:11pt;padding:6px 12px;border-radius:999px;background:#fff;border:1px solid var(--line)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:4px 0 22px}
.tile{display:block;text-decoration:none;color:var(--ink);background:var(--card);border-radius:14px;padding:16px 18px;border:1px solid var(--line);border-top:5px solid var(--c,#94a3b8);box-shadow:0 1px 3px rgba(16,24,40,.05)}
.tile b{display:block;font-size:24pt;line-height:1.1;color:var(--c,var(--ink))}.tile span{color:var(--muted);font-size:11pt}
.tile:hover{box-shadow:0 4px 14px rgba(16,24,40,.10)}
.section{background:var(--card);border-radius:16px;border:1px solid var(--line);margin:0 0 22px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.05)}
.section .head{display:flex;align-items:center;gap:12px;padding:14px 18px;background:var(--sbg,#f8fafc);border-bottom:1px solid var(--line);border-left:6px solid var(--sc,#94a3b8)}
.section .head .num{width:30px;height:30px;border-radius:50%;background:var(--sc);color:#fff;display:grid;place-items:center;font-weight:700;font-size:11pt;flex:none}
.section .head h2{color:var(--sc)}
.section .head .count{margin-left:auto;background:#fff;border:1px solid var(--line);border-radius:999px;padding:2px 12px;font-weight:700;color:var(--sc)}
.section .body{padding:14px 18px}
.section .body .hint{color:var(--muted);margin:0 0 10px;font-size:11pt}
.s-q{--sc:var(--q);--sbg:var(--q-bg)}.s-chg{--sc:var(--chg);--sbg:var(--chg-bg)}.s-ok{--sc:var(--ok);--sbg:var(--ok-bg)}
.s-ret{--sc:var(--ret);--sbg:var(--ret-bg)}.s-lib{--sc:var(--lib);--sbg:var(--lib-bg)}.s-main{--sc:var(--brand);--sbg:#f0fdfa}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}
.qcard{border-left:5px solid var(--q);background:#fffdf8}
.qcard .who{font-weight:700;margin:0 0 4px}.qcard .ask{font-size:12.5pt;margin:0 0 6px}
.qcard .ctx{color:var(--muted);font-size:11pt;margin:0 0 10px}.qcard .ctx p{margin:0 0 6px}.qcard .ctx ul{margin:0 0 8px;padding-left:20px}.qcard .ctx .lbl{font-weight:700;color:var(--ink);margin:8px 0 2px}
.acts{white-space:nowrap}.acts form.inline{display:inline;margin:0 0 0 6px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
.chip{font:inherit;font-size:11pt;cursor:pointer;padding:8px 14px;border-radius:10px;border:2px solid #cbd5e1;background:#fff;color:var(--ink);text-align:left}
.chip:hover{border-color:var(--q);background:var(--q-bg)}
.chip.sel{border-color:var(--q);background:var(--q);color:#fff}
.chip.other{border-style:dashed}
table{border-collapse:separate;border-spacing:0;width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:6px 0}
td,th{padding:10px 12px;text-align:left;vertical-align:top;font-size:11pt;border-bottom:1px solid var(--line)}
th{background:#f8fafc;color:var(--muted);font-weight:700;font-size:10.5pt;text-transform:uppercase;letter-spacing:.3px}
tr:last-child td{border-bottom:0}tbody tr:nth-child(even) td{background:#fbfcfe}
.kv td:first-child{width:200px;color:var(--muted);font-weight:600}
.badge{display:inline-block;padding:3px 12px;border-radius:999px;font-size:10.5pt;font-weight:700;white-space:nowrap}
.badge.big{font-size:13pt;padding:6px 16px}
.Halal{color:var(--halal);background:var(--halal-bg)}.Doubtful{color:var(--doubt);background:var(--doubt-bg)}
.Haram{color:var(--haram);background:var(--haram-bg)}.Check{color:var(--check);background:var(--check-bg)}
.code{color:var(--muted);font-size:10.5pt;margin-left:6px;font-weight:600}
.same{color:var(--ok);font-weight:700}.changed{color:var(--chg);font-weight:700}.muted{color:var(--muted)}
.flag{display:inline-block;margin-top:4px;color:var(--q);background:var(--q-bg);border-radius:999px;padding:1px 10px;font-size:10pt;font-weight:700}
.token a{font-weight:700;text-decoration:none}.token .muted{font-size:10pt}
button,.btn{font:inherit;font-size:11pt;font-weight:700;padding:9px 18px;border-radius:10px;border:1px solid var(--brand);background:var(--brand);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}
button:hover,.btn:hover{filter:brightness(1.08)}
button.approve{background:var(--ok);border-color:var(--ok)}
button.ghost{background:#fff;color:var(--ink);border-color:#cbd5e1}
button:disabled{opacity:.45;cursor:default}
form.inline{display:inline}
textarea,input{font:inherit;font-size:11pt;width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:10px;background:#fff}
textarea:focus,input:focus{outline:2px solid var(--brand-2);border-color:transparent}
input[type=checkbox]{width:auto}
.hero{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.arrow{font-size:16pt;color:var(--muted)}
.actions{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
.pbar{display:flex;height:16px;border-radius:999px;background:#e5e9f0;overflow:hidden;margin:6px 0 10px}
.pbar span{display:block;height:100%}
.b-ok{background:var(--ok)}.b-dr{background:var(--q)}.b-to{background:#cbd5e1}
.legend{display:flex;gap:22px;flex-wrap:wrap;font-size:11pt}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
.forms{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:6px}
.row2{display:flex;gap:8px}.row2 input[name=ticker],.row2 input[name=size]{max-width:140px}
.note{background:var(--q-bg);padding:12px 16px;border-radius:10px;border:1px solid #fcd9a0}
.key{font-family:monospace;font-size:12pt;background:#eef;padding:8px;word-break:break-all}
.empty{color:var(--muted);font-style:italic;margin:4px 0}
.Pass{color:var(--halal);font-weight:700}.Concern{color:var(--doubt);font-weight:700}.Fail{color:var(--haram);font-weight:700}
@media print{header,.topline,form,button,.back,nav{display:none}body{background:#fff}main{padding:0}.section,.card{box-shadow:none}}
`;

/** Clicking an offered option writes it into that question's answer box; "Other" clears the box for a written answer. */
const js = `
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-fill],[data-other]');
  if (!b) return;
  var form = b.closest('form');
  var box = form.querySelector('textarea');
  form.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('sel'); });
  b.classList.add('sel');
  if (b.hasAttribute('data-fill')) { box.value = b.getAttribute('data-fill'); } else { box.value = ''; }
  box.focus();
});
`;

const MENU: [string, string][] = [
  ["/desk/queue", "To do"],
  ["/desk/questions", "Questions"],
  ["/desk/library", "Approved"],
  ["/desk/rules", "Rule changes"],
  ["/desk/keys", "API keys"],
];

export function Layout({ title, active, children }: { title: string; active?: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · Scholar's Desk · Najm Screener</title>
        <style>{css}</style>
      </head>
      <body>
        <div class="topline"></div>
        <header>
          <div class="bar">
            <a class="brand" href="/desk/queue">
              <span class="logo">S</span>
              <span>Scholar's Desk<small>Najm Screener</small></span>
            </a>
            <nav>{MENU.map(([href, label]) => <a href={href} class={href === active ? "on" : ""}>{label}</a>)}</nav>
          </div>
        </header>
        <main>
          <h1>{title}</h1>
          {children}
        </main>
        <script dangerouslySetInnerHTML={{ __html: js }} />
      </body>
    </html>
  );
}

/** A coloured status pill with the code beside it. */
export const Status = ({ status, code, big }: { status: string | null; code?: string | null; big?: boolean }) =>
  status ? (
    <span>
      <span class={`badge ${status.split(" ")[0]}${big ? " big" : ""}`}>{status}</span>
      {code && <span class="code">{code}</span>}
    </span>
  ) : <span class="muted">—</span>;

/** A coloured, numbered section panel. */
export const Section = ({ cls, num, title, count, hint, children, id }: {
  cls: string; num?: string; title: string; count?: number; hint?: string; children: Child; id?: string;
}) => (
  <section class={`section ${cls}`} id={id}>
    <div class="head">
      {num && <span class="num">{num}</span>}
      <h2>{title}</h2>
      {count !== undefined && <span class="count">{count}</span>}
    </div>
    <div class="body">
      {hint && <p class="hint">{hint}</p>}
      {children}
    </div>
  </section>
);
