import type { Child } from "hono/jsx";

const css = `
body{font-family:Aptos,Calibri,Verdana,Roboto,sans-serif;font-size:12pt;margin:24px;color:#1b1b1b;max-width:1000px}
h1{font-size:20pt}h2{font-size:18pt}h3{font-size:16pt}
nav a{margin-right:16px}table{border-collapse:collapse;width:100%;margin:12px 0}
td,th{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;font-size:11pt}
.Pass{color:#11632e}.Concern{color:#8a5a00}.Fail{color:#a11a1a}
form.inline{display:inline}button{font-size:11pt;padding:4px 10px}textarea{width:100%;font-size:11pt}
.note{background:#fff6e0;padding:8px}.key{font-family:monospace;font-size:12pt;background:#eef;padding:8px;word-break:break-all}
@media print{nav,form,button{display:none}body{margin:0}}
`;

export function Layout({ title, children }: { title: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>{title} · SCCF Review Desk</title>
        <style>{css}</style>
      </head>
      <body>
        <nav>
          <a href="/desk/queue">Queue</a>
          <a href="/desk/questions">Questions</a>
          <a href="/desk/rules">Rule proposals</a>
          <a href="/desk/library">Library</a>
          <a href="/desk/keys">Client keys</a>
        </nav>
        <h1>{title}</h1>
        {children}
      </body>
    </html>
  );
}
