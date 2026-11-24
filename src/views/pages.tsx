import type { PublicCard } from "../public/build";
import type { Change } from "../review/compare";
import { Layout, Status } from "./layout";

type Row = Record<string, any>;

const optionsOf = (json: string | null): string[] => {
  try { return json ? (JSON.parse(json) as string[]) : []; } catch { return []; }
};

/** "Same as before" or "Changed: Halal → Haram", against the old system's status. */
export const Comparison = ({ r }: { r: Row }) =>
  !r.old_status ? <span class="muted">No earlier status</span>
    : r.old_status === r.status ? <span class="same">Same as before</span>
    : <span class="changed">Changed: {r.old_status} → {r.status}</span>;

/** One open question with its answer box. `back` is where the desk returns after saving. */
export const QuestionBox = ({ q, back }: { q: Row; back?: string }) => (
  <div class="card question">
    <p><b>{q.asset_name ? `${q.asset_name} (${q.asset_id})` : q.asset_id ?? "General"}</b></p>
    <p>{q.question}</p>
    {q.context && <p class="muted">{q.context}</p>}
    {optionsOf(q.options).length > 0 && <p class="muted">Options offered: {optionsOf(q.options).join(" · ")}</p>}
    <form method="post" action={`/desk/questions/${q.id}/answer`}>
      {back && <input type="hidden" name="back" value={back} />}
      <textarea name="answer" rows={3} required placeholder="Your answer"></textarea>
      <p><button>Save answer</button></p>
    </form>
  </div>
);

const DraftTable = ({ rows }: { rows: Row[] }) => (
  <table>
    <tr><th>Token</th><th>New result</th><th>Old system</th><th>Compared</th><th>Confidence</th><th></th></tr>
    {rows.map((r) => (
      <tr>
        <td><a href={`/desk/rulings/${r.id}`}>{r.name} ({r.ticker})</a><br /><span class="muted">{r.review_type} · {r.id}</span></td>
        <td><Status status={r.status} code={r.code} /></td>
        <td><Status status={r.old_status} code={r.old_code} /></td>
        <td><Comparison r={r} />{r.open_questions > 0 && <><br /><span class="flag">Question waiting</span></>}</td>
        <td>{r.confidence}</td>
        <td><a href={`/desk/rulings/${r.id}`}>Open</a></td>
      </tr>
    ))}
  </table>
);

export const QueuePage = ({ drafts, returned, questions, approved, eligible }: {
  drafts: Row[]; returned: Row[]; questions: Row[]; approved: number; eligible: number;
}) => {
  const changed = drafts.filter((r) => r.old_status !== r.status);
  const same = drafts.filter((r) => r.old_status === r.status);
  return (
    <Layout title="To do" active="/desk/queue">
      <div class="tiles">
        <div class="tile"><b>{questions.length}</b><span>Questions waiting</span></div>
        <div class="tile"><b>{changed.length}</b><span>Changed or new</span></div>
        <div class="tile"><b>{same.length}</b><span>Drafts that match</span></div>
        <div class="tile"><b>{approved}</b><span><a href="/desk/library">Approved tokens</a></span></div>
      </div>

      <h2>1. Questions waiting for your answer ({questions.length})</h2>
      <p class="muted">Answer these first: a draft with an open question cannot be settled until you do.</p>
      {questions.length === 0 ? <p>Nothing here.</p> : questions.map((q) => <QuestionBox q={q} back="/desk/queue" />)}

      <h2>2. Drafts that changed, or are new ({changed.length})</h2>
      <p class="muted">Open each one and approve or return it.</p>
      {changed.length === 0 ? <p>Nothing here.</p> : <DraftTable rows={changed} />}

      <h2>3. Drafts that match the old system ({same.length})</h2>
      {same.length === 0 ? <p>Nothing here.</p> : (
        <>
          <form method="post" action="/desk/approve-matching" class="card">
            <p><b>{eligible}</b> of these have High confidence and no open question.</p>
            <button disabled={eligible === 0}>Approve these ({eligible})</button>
          </form>
          <DraftTable rows={same} />
        </>
      )}

      <h2>Returned, waiting for a new draft ({returned.length})</h2>
      {returned.length === 0 ? <p>Nothing here.</p> : (
        <table>
          <tr><th>Token</th><th>Your note</th></tr>
          {returned.map((r) => <tr><td>{r.name} ({r.ticker})<br /><span class="muted">{r.id}</span></td><td>{r.detail}</td></tr>)}
        </table>
      )}
    </Layout>
  );
};

export const RulingPage = ({ r, checks, changes, previous, isOpen, questions, decidingText }: {
  r: Row; checks: Row[]; changes: Change[] | null; previous: Row | null; isOpen: boolean; questions: Row[]; decidingText: string | null;
}) => (
  <Layout title={`${r.name} (${r.ticker})`} active="/desk/queue">
    <a class="back" href="/desk/queue">← Back to To do</a>
    <div class="card">
      <table>
        <tr><td>New result</td><td><Status status={r.status} code={r.code} /></td></tr>
        <tr><td>Old system</td><td><Status status={r.old_status} code={r.old_code} /> · <Comparison r={r} /></td></tr>
        {r.earlier_status && <tr><td>Earlier published</td><td>{r.earlier_status}</td></tr>}
        <tr><td>Decided by</td><td>{r.deciding_check}{decidingText && <>: <span class="muted">{decidingText}</span></>}</td></tr>
        <tr><td>Confidence</td><td>{r.confidence}</td></tr>
        <tr><td>Type</td><td>{r.review_type} · class {r.class ?? ""} · criteria {r.criteria_version} · {r.id}</td></tr>
        {previous && <tr><td>Earlier ruling</td><td><Status status={previous.status} code={previous.code} /> ({previous.id})</td></tr>}
        <tr><td>Public card</td><td><a href={`/desk/rulings/${r.id}/card`}>See the card as users will</a>{r.card_url && <> · <a href={r.card_url}>Ruling report</a></>}</td></tr>
      </table>
    </div>

    {questions.length > 0 && (
      <>
        <h2>Question waiting for your answer</h2>
        {questions.map((q) => <QuestionBox q={q} back={`/desk/rulings/${r.id}`} />)}
      </>
    )}

    {isOpen && (
      <div class="card">
        <form class="inline" method="post" action={`/desk/rulings/${r.id}/approve`}><button>Approve</button></form>
        <form method="post" action={`/desk/rulings/${r.id}/return`}>
          <h3>Or return it with a note</h3>
          <textarea name="note" rows={3} required placeholder="What should the analyst fix?"></textarea>
          <p><button class="ghost">Return</button></p>
        </form>
      </div>
    )}

    {changes && (
      <>
        <h2>Changes since the earlier ruling</h2>
        {changes.length === 0 ? <p>No answer changed.</p> : (
          <table id="changes">
            <tr><th>Check</th><th>Before</th><th>Now</th><th>Source</th></tr>
            {changes.map((c) => <tr><td>{c.checkId}</td><td>{c.from ?? "—"}</td><td>{c.to ?? "—"}</td><td>{c.source ?? ""}</td></tr>)}
          </table>
        )}
      </>
    )}

    <h2>The analyst's answers</h2>
    <table>
      <tr><th>Check</th><th>Answer</th><th>Evidence</th><th>Source</th></tr>
      {checks.map((c) => (
        <tr>
          <td>{c.check_id}{c.question && <><br /><span class="muted">{c.question}</span></>}</td>
          <td>{c.answer}</td><td>{c.evidence ?? ""}</td>
          <td>{c.source_url ? <a href={c.source_url}>source</a> : ""}</td>
        </tr>
      ))}
    </table>
  </Layout>
);

export const CardPage = ({ r, card }: { r: Row; card: PublicCard }) => (
  <Layout title={`${r.name} (${r.ticker})`} active="/desk/queue">
    <a class="back" href={`/desk/rulings/${r.id}`}>← Back to the draft</a>
    <div class="card">
      <p><Status status={card.statusLabel} /></p>
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
    </div>
    <h3>Internal</h3>
    <table>
      <tr><td>Code</td><td><Status status={r.status} code={r.code} /></td></tr>
      <tr><td>Deciding check</td><td>{r.deciding_check}</td></tr>
      <tr><td>Confidence</td><td>{r.confidence}</td></tr>
      <tr><td>Asset</td><td>{r.asset_id}</td></tr>
    </table>
  </Layout>
);

export const LibraryPage = ({ rows }: { rows: Row[] }) => {
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <Layout title="Approved tokens" active="/desk/library">
      <div class="tiles">
        <div class="tile"><b>{rows.length}</b><span>Approved in total</span></div>
        <div class="tile"><b>{count("Halal")}</b><span>Halal</span></div>
        <div class="tile"><b>{count("Doubtful")}</b><span>Doubtful</span></div>
        <div class="tile"><b>{count("Haram")}</b><span>Haram</span></div>
      </div>
      <table>
        <tr><th>Token</th><th>Class</th><th>Result</th><th>Approved</th></tr>
        {rows.map((r) => (
          <tr>
            <td>{r.name} ({r.ticker})<br /><span class="muted">{r.id}</span></td>
            <td>{r.class}</td>
            <td><Status status={r.status} code={r.code} /></td>
            <td>{String(r.approved ?? "").slice(0, 10)}</td>
          </tr>
        ))}
      </table>
      {rows.length === 0 && <p>Nothing here.</p>}
    </Layout>
  );
};

export const ListPage = ({ title, cols, rows, active }: { title: string; cols: string[]; rows: Row[]; active?: string }) => (
  <Layout title={title} active={active}>
    <table>
      <tr>{cols.map((c) => <th>{c}</th>)}</tr>
      {rows.map((r) => <tr>{cols.map((c) => <td>{String(r[c] ?? "")}</td>)}</tr>)}
    </table>
    {rows.length === 0 && <p>Nothing here.</p>}
  </Layout>
);

export const QuestionsPage = ({ open, answered }: { open: Row[]; answered: Row[] }) => (
  <Layout title="Questions" active="/desk/questions">
    <h2>Waiting for your answer ({open.length})</h2>
    {open.length === 0 ? <p>Nothing here.</p> : open.map((q) => <QuestionBox q={q} />)}
    <h2>Answered ({answered.length})</h2>
    {answered.length === 0 ? <p>Nothing here.</p> : (
      <table>
        <tr><th>Token</th><th>Question</th><th>Your answer</th><th>Answered</th><th>Acted on by the analyst</th></tr>
        {answered.map((q) => (
          <tr><td>{q.asset_name ?? q.asset_id}</td><td>{q.question}</td><td>{q.answer}</td><td>{String(q.answered_at ?? "").slice(0, 10)}</td><td>{q.applied ? "Yes" : "Not yet"}</td></tr>
        ))}
      </table>
    )}
  </Layout>
);

export const KeysPage = ({ clients, newKey, name }: { clients: Row[]; newKey?: string; name?: string }) => (
  <Layout title="Client keys" active="/desk/keys">
    {newKey && (
      <div class="note">
        <p>Key for <b>{name}</b>. Copy it now and send it to the client securely: it is shown only this once.</p>
        <p class="key">{newKey}</p>
      </div>
    )}
    <form method="post" action="/desk/keys" class="card">
      <label>Client name <input name="name" required /></label>
      <p><label><input type="checkbox" name="preliminary" /> May see preliminary rulings</label></p>
      <button>Create key</button>
    </form>
    <table>
      <tr><th>Client</th><th>Preliminary</th><th>Created</th><th>Revoked</th><th></th></tr>
      {clients.map((c) => (
        <tr>
          <td>{c.name}</td><td>{c.preliminary ? "Yes" : "No"}</td><td>{c.created_at}</td><td>{c.revoked_at ?? ""}</td>
          <td>{!c.revoked_at && <form class="inline" method="post" action={`/desk/keys/${c.id}/revoke`}><button class="ghost">Revoke</button></form>}</td>
        </tr>
      ))}
    </table>
  </Layout>
);
