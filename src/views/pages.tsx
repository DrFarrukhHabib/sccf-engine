import type { PublicCard } from "../public/build";
import type { Change } from "../review/compare";
import { Layout } from "./layout";

type Row = Record<string, any>;

export const QueuePage = ({ drafts, returned }: { drafts: Row[]; returned: Row[] }) => (
  <Layout title="Queue">
    <h2>Awaiting your decision ({drafts.length})</h2>
    <table>
      <tr><th>Ruling</th><th>Asset</th><th>Result</th><th>Type</th><th>Confidence</th><th>Scholar item</th></tr>
      {drafts.map((r) => (
        <tr>
          <td><a href={`/desk/rulings/${r.id}`}>{r.id}</a></td>
          <td>{r.name} ({r.ticker})</td>
          <td>{r.status}, {r.code}</td>
          <td>{r.review_type}</td>
          <td>{r.confidence}</td>
          <td>{r.send_to_scholar ? "Yes" : ""}</td>
        </tr>
      ))}
    </table>
    <h2>Returned, awaiting a new draft ({returned.length})</h2>
    <table>
      <tr><th>Ruling</th><th>Asset</th><th>Your note</th></tr>
      {returned.map((r) => (
        <tr><td>{r.id}</td><td>{r.name} ({r.ticker})</td><td>{r.detail}</td></tr>
      ))}
    </table>
  </Layout>
);

export const RulingPage = ({ r, checks, changes, previous, isOpen }: { r: Row; checks: Row[]; changes: Change[] | null; previous: Row | null; isOpen: boolean }) => (
  <Layout title={`${r.name} (${r.ticker})`}>
    <table>
      <tr><td>Ruling</td><td>{r.id} · {r.review_type} · criteria {r.criteria_version}</td></tr>
      <tr><td>Result</td><td>{r.status}, {r.code} (deciding check {r.deciding_check})</td></tr>
      <tr><td>Confidence</td><td>{r.confidence}</td></tr>
      {previous && <tr><td>Earlier ruling</td><td>{previous.status}, {previous.code} ({previous.id})</td></tr>}
      <tr><td>Card</td><td><a href={`/desk/rulings/${r.id}/card`}>Public card and print view</a>{r.card_url && <> · <a href={r.card_url}>Ruling card</a></>}</td></tr>
    </table>
    {changes && (
      <>
        <h2>Changes since the earlier ruling</h2>
        <table id="changes">
          <tr><th>Check</th><th>Before</th><th>Now</th><th>Source</th></tr>
          {changes.map((c) => <tr><td>{c.checkId}</td><td>{c.from ?? "—"}</td><td>{c.to ?? "—"}</td><td>{c.source ?? ""}</td></tr>)}
        </table>
        {changes.length === 0 && <p>No answer changed.</p>}
      </>
    )}
    <h2>All answers</h2>
    <table>
      <tr><th>Check</th><th>Answer</th><th>Evidence</th><th>Source</th></tr>
      {checks.map((c) => <tr><td>{c.check_id}</td><td>{c.answer}</td><td>{c.evidence ?? ""}</td><td>{c.source_url ? <a href={c.source_url}>{c.source_url}</a> : ""}</td></tr>)}
    </table>
    {isOpen && (
      <>
        <form class="inline" method="post" action={`/desk/rulings/${r.id}/approve`}><button>Approve</button></form>
        <form method="post" action={`/desk/rulings/${r.id}/return`}>
          <h3>Return with a note</h3>
          <textarea name="note" rows={3} required></textarea>
          <button>Return</button>
        </form>
      </>
    )}
  </Layout>
);

export const CardPage = ({ r, card }: { r: Row; card: PublicCard }) => (
  <Layout title={`${r.name} (${r.ticker}): ${card.statusLabel}`}>
    <p><b>{card.usageLine}</b></p>
    <table>
      {card.tiles.map((t) => <tr><td>{t.title}</td><td class={t.result.replace(/ /g, "")}>{t.result}</td><td>{t.line}</td></tr>)}
    </table>
    <h3>What you can do with it</h3>
    <table>
      <tr><th>Hold</th><th>Buy and sell</th><th>Payments</th><th>Rewards or staking</th><th>Lend for a return</th><th>Provide liquidity</th></tr>
      <tr><td>{card.activity.hold}</td><td>{card.activity.buySell}</td><td>{card.activity.payments}</td><td>{card.activity.rewards}</td><td>{card.activity.lend}</td><td>{card.activity.liquidity}</td></tr>
    </table>
    <p><i>{card.footer}</i></p>
    <h3>Internal</h3>
    <table>
      <tr><td>Code</td><td>{r.status}, {r.code}</td></tr>
      <tr><td>Deciding check</td><td>{r.deciding_check}</td></tr>
      <tr><td>Confidence</td><td>{r.confidence}</td></tr>
      <tr><td>Asset</td><td>{r.asset_id}</td></tr>
    </table>
  </Layout>
);

export const ListPage = ({ title, cols, rows }: { title: string; cols: string[]; rows: Row[] }) => (
  <Layout title={title}>
    <table>
      <tr>{cols.map((c) => <th>{c}</th>)}</tr>
      {rows.map((r) => <tr>{cols.map((c) => <td>{String(r[c] ?? "")}</td>)}</tr>)}
    </table>
    {rows.length === 0 && <p>Nothing here.</p>}
  </Layout>
);

export const KeysPage = ({ clients, newKey, name }: { clients: Row[]; newKey?: string; name?: string }) => (
  <Layout title="Client keys">
    {newKey && (
      <div class="note">
        <p>Key for <b>{name}</b>. Copy it now and send it to the client securely: it is shown only this once.</p>
        <p class="key">{newKey}</p>
      </div>
    )}
    <form method="post" action="/desk/keys">
      <label>Client name <input name="name" required /></label>{" "}
      <label><input type="checkbox" name="preliminary" /> May see preliminary rulings</label>{" "}
      <button>Create key</button>
    </form>
    <table>
      <tr><th>Client</th><th>Preliminary</th><th>Created</th><th>Revoked</th><th></th></tr>
      {clients.map((c) => (
        <tr>
          <td>{c.name}</td><td>{c.preliminary ? "Yes" : "No"}</td><td>{c.created_at}</td><td>{c.revoked_at ?? ""}</td>
          <td>{!c.revoked_at && <form class="inline" method="post" action={`/desk/keys/${c.id}/revoke`}><button>Revoke</button></form>}</td>
        </tr>
      ))}
    </table>
  </Layout>
);
