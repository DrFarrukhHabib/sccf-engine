import type { PublicCard } from "../public/build";
import type { Change } from "../review/compare";
import type { WaveProgress } from "../waves";
import { Layout, Section, Status } from "./layout";

type Row = Record<string, any>;

const optionsOf = (json: string | null): string[] => {
  try { return json ? (JSON.parse(json) as string[]) : []; } catch { return []; }
};

/** "Same as before" or "Changed: Halal → Haram", against the old system's status. */
export const Comparison = ({ r }: { r: Row }) =>
  !r.old_status ? <span class="muted">New: no earlier status</span>
    : r.old_status === r.status ? <span class="same">✓ Same as before</span>
    : <span class="changed">Changed: {r.old_status} → {r.status}</span>;

/** One open question: its options as buttons that fill the answer box, an Other choice, and Save. */
export const QuestionBox = ({ q, back }: { q: Row; back?: string }) => {
  const options = optionsOf(q.options);
  return (
    <div class="card qcard">
      <p class="who">{q.asset_name ? `${q.asset_name} (${q.asset_id})` : q.asset_id ?? "General question"}</p>
      <p class="ask">{q.question}</p>
      {q.context && <p class="ctx">{q.context}</p>}
      <form method="post" action={`/desk/questions/${q.id}/answer`}>
        {back && <input type="hidden" name="back" value={back} />}
        {options.length > 0 && (
          <>
            <p class="muted" style="margin:0">Choose an option, or Other to write your own:</p>
            <div class="chips">
              {options.map((o) => <button type="button" class="chip" data-fill={o}>{o}</button>)}
              <button type="button" class="chip other" data-other>Other…</button>
            </div>
          </>
        )}
        <textarea name="answer" rows={3} required placeholder="Your answer (you can add reasons or conditions)"></textarea>
        <p style="margin:10px 0 0"><button>Save answer</button></p>
      </form>
    </div>
  );
};

const DraftTable = ({ rows }: { rows: Row[] }) => (
  <table>
    <thead><tr><th>Token</th><th>New result</th><th>Old system</th><th>Compared</th><th>Confidence</th><th></th></tr></thead>
    <tbody>
      {rows.map((r) => (
        <tr>
          <td class="token"><a href={`/desk/rulings/${r.id}`}>{r.name} ({r.ticker})</a><br /><span class="muted">{r.review_type === "Re-review" ? "Re-review" : "First review"}</span></td>
          <td><Status status={r.status} code={r.code} /></td>
          <td><Status status={r.old_status} code={r.old_code} /></td>
          <td><Comparison r={r} />{r.open_questions > 0 && <><br /><span class="flag">Question waiting</span></>}</td>
          <td>{r.confidence}</td>
          <td><a class="btn" href={`/desk/rulings/${r.id}`}>Open</a></td>
        </tr>
      ))}
    </tbody>
  </table>
);

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

/** The newest wave's progress bar, the fast lane, the Scholar's token requests and the two forms. */
const WavePanel = ({ progress, fastLane, asked }: { progress: WaveProgress | null; fastLane: number; asked: Row[] }) => (
  <Section cls="s-main" title={progress ? `Wave ${progress.id}: top ${progress.size} by market cap` : "Waves"}>
    {progress ? (
      <>
        <p class="muted" style="margin:0 0 8px">Frozen from the ranking of {progress.snapshotAt.slice(0, 10)}. The analyst works through it from the top.</p>
        <div class="pbar" title={`${progress.approved} approved, ${progress.drafted} drafted, ${progress.toGo} to go`}>
          <span class="b-ok" style={`width:${pct(progress.approved, progress.size)}%`}></span>
          <span class="b-dr" style={`width:${pct(progress.drafted, progress.size)}%`}></span>
        </div>
        <div class="legend">
          <span data-approved={String(progress.approved)}><i class="dot b-ok"></i><b>{progress.approved}</b> approved</span>
          <span data-drafted={String(progress.drafted)}><i class="dot b-dr"></i><b>{progress.drafted}</b> drafted, waiting for you</span>
          <span data-togo={String(progress.toGo)}><i class="dot b-to"></i><b>{progress.toGo}</b> to go</span>
          <span><b>{fastLane}</b> in the fast lane (7 nights in the top 100)</span>
        </div>
      </>
    ) : <p class="empty">No wave has been frozen yet.</p>}
    <div class="forms">
      <form method="post" action="/desk/requests/token" class="card">
        <h3 style="margin-top:0">Ask for a token</h3>
        <p class="muted" style="margin:0 0 8px">It goes to the front of the analyst's next run.</p>
        <div class="row2"><input name="name" placeholder="Name, e.g. World Liberty USD" required /><input name="ticker" placeholder="Ticker" required /></div>
        <input name="note" placeholder="Note (optional)" style="margin-top:8px" />
        <p style="margin:10px 0 0"><button>Add to the queue</button></p>
        {asked.length > 0 && <p class="muted" style="margin:10px 0 0">Waiting: {asked.map((a) => a.text).join("; ")}</p>}
      </form>
      <form method="post" action="/desk/waves" class="card">
        <h3 style="margin-top:0">Freeze the next wave</h3>
        <p class="muted" style="margin:0 0 8px">When this wave is done, freeze a new list from the latest ranking. Tokens already reviewed are skipped.</p>
        <div class="row2"><input name="size" type="number" min="1" max="5000" value="1000" required /><button class="ghost">Freeze wave</button></div>
      </form>
    </div>
  </Section>
);

export const QueuePage = ({ drafts, returned, questions, approved, eligible, progress = null, fastLane = 0, asked = [] }: {
  drafts: Row[]; returned: Row[]; questions: Row[]; approved: number; eligible: number;
  progress?: WaveProgress | null; fastLane?: number; asked?: Row[];
}) => {
  const changed = drafts.filter((r) => r.old_status !== r.status);
  const same = drafts.filter((r) => r.old_status === r.status);
  return (
    <Layout title="To do" active="/desk/queue">
      <div class="tiles">
        <a class="tile" href="#questions" style="--c:var(--q)"><b>{questions.length}</b><span>Questions waiting</span></a>
        <a class="tile" href="#changed" style="--c:var(--chg)"><b>{changed.length}</b><span>Drafts changed or new</span></a>
        <a class="tile" href="#matching" style="--c:var(--ok)"><b>{same.length}</b><span>Drafts that match</span></a>
        <a class="tile" href="/desk/library" style="--c:var(--lib)"><b>{approved}</b><span>Approved tokens</span></a>
      </div>

      <WavePanel progress={progress} fastLane={fastLane} asked={asked} />

      <Section id="questions" cls="s-q" num="1" title="Questions waiting for your answer" count={questions.length}
        hint="Answer these first: a draft with an open question cannot be settled until you do.">
        {questions.length === 0 ? <p class="empty">Nothing here.</p> : questions.map((q) => <QuestionBox q={q} back="/desk/queue" />)}
      </Section>

      <Section id="changed" cls="s-chg" num="2" title="Drafts that changed, or are new" count={changed.length}
        hint="Open each one, then approve it or return it with a note.">
        {changed.length === 0 ? <p class="empty">Nothing here.</p> : <DraftTable rows={changed} />}
      </Section>

      <Section id="matching" cls="s-ok" num="3" title="Drafts that match the old system" count={same.length}>
        {same.length === 0 ? <p class="empty">Nothing here.</p> : (
          <>
            <form method="post" action="/desk/approve-matching" class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:0">
              <span><b>{eligible}</b> of these have High confidence and no open question.</span>
              <button class="approve" disabled={eligible === 0}>Approve these ({eligible})</button>
            </form>
            <DraftTable rows={same} />
          </>
        )}
      </Section>

      <Section cls="s-ret" title="Returned, waiting for a new draft" count={returned.length}>
        {returned.length === 0 ? <p class="empty">Nothing here.</p> : (
          <table>
            <thead><tr><th>Token</th><th>Your note</th></tr></thead>
            <tbody>{returned.map((r) => <tr><td class="token">{r.name} ({r.ticker})<br /><span class="muted">{r.id}</span></td><td>{r.detail}</td></tr>)}</tbody>
          </table>
        )}
      </Section>
    </Layout>
  );
};

export const RulingPage = ({ r, checks, changes, previous, isOpen, questions, decidingText }: {
  r: Row; checks: Row[]; changes: Change[] | null; previous: Row | null; isOpen: boolean; questions: Row[]; decidingText: string | null;
}) => (
  <Layout title={`${r.name} (${r.ticker})`} active="/desk/queue">
    <a class="back" href="/desk/queue">← Back to To do</a>

    <Section cls="s-main" title="Result">
      <div class="hero">
        <div><span class="muted">Old system</span><br /><Status status={r.old_status} code={r.old_code} big /></div>
        <span class="arrow">→</span>
        <div><span class="muted">New draft</span><br /><Status status={r.status} code={r.code} big /></div>
        <div style="margin-left:auto"><Comparison r={r} /></div>
      </div>
      <table class="kv">
        <tbody>
          {r.earlier_status && <tr><td>Earlier published</td><td>{r.earlier_status}</td></tr>}
          <tr><td>Decided by</td><td><b>{r.deciding_check}</b>{decidingText && <><br /><span class="muted">{decidingText}</span></>}</td></tr>
          <tr><td>Confidence</td><td>{r.confidence}</td></tr>
          <tr><td>Review</td><td>{r.review_type} · class {r.class ?? ""} · criteria {r.criteria_version}</td></tr>
          {previous && <tr><td>Earlier ruling</td><td><Status status={previous.status} code={previous.code} /></td></tr>}
          <tr><td>Public card</td><td><a href={`/desk/rulings/${r.id}/card`}>See the card as users will</a>{r.card_url && <> · <a href={r.card_url}>Ruling report</a></>}</td></tr>
        </tbody>
      </table>
    </Section>

    {questions.length > 0 && (
      <Section cls="s-q" title="Question waiting for your answer" count={questions.length}>
        {questions.map((q) => <QuestionBox q={q} back={`/desk/rulings/${r.id}`} />)}
      </Section>
    )}

    {isOpen && (
      <Section cls="s-ok" title="Your decision">
        <div class="actions">
          <form class="inline" method="post" action={`/desk/rulings/${r.id}/approve`}><button class="approve">✓ Approve</button></form>
          <form method="post" action={`/desk/rulings/${r.id}/return`} style="flex:1;min-width:280px">
            <textarea name="note" rows={2} required placeholder="Or return it: what should the analyst fix?"></textarea>
            <p style="margin:8px 0 0"><button class="ghost">Return with this note</button></p>
          </form>
        </div>
      </Section>
    )}

    {changes && (
      <Section cls="s-chg" title="Changes since the earlier ruling" count={changes.length}>
        {changes.length === 0 ? <p class="empty">No answer changed.</p> : (
          <table id="changes">
            <thead><tr><th>Check</th><th>Before</th><th>Now</th><th>Source</th></tr></thead>
            <tbody>{changes.map((c) => <tr><td>{c.checkId}</td><td>{c.from ?? "—"}</td><td>{c.to ?? "—"}</td><td>{c.source ?? ""}</td></tr>)}</tbody>
          </table>
        )}
      </Section>
    )}

    <Section cls="s-lib" title="The analyst's answers" count={checks.length}>
      <table>
        <thead><tr><th>Check</th><th>Answer</th><th>Evidence</th><th>Source</th></tr></thead>
        <tbody>
          {checks.map((c) => (
            <tr>
              <td><b>{c.check_id}</b>{c.question && <><br /><span class="muted">{c.question}</span></>}</td>
              <td>{c.answer}</td><td>{c.evidence ?? ""}</td>
              <td>{c.source_url ? <a href={c.source_url}>source</a> : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  </Layout>
);

export const CardPage = ({ r, card }: { r: Row; card: PublicCard }) => (
  <Layout title={`${r.name} (${r.ticker})`} active="/desk/queue">
    <a class="back" href={`/desk/rulings/${r.id}`}>← Back to the draft</a>
    <Section cls="s-main" title="Public card">
      <p><Status status={card.statusLabel} big /></p>
      <p><b>{card.usageLine}</b></p>
      <table>
        <tbody>{card.tiles.map((t) => <tr><td>{t.title}</td><td class={t.result.replace(/ /g, "")}>{t.result}</td><td>{t.line}</td></tr>)}</tbody>
      </table>
      <h3>What you can do with it</h3>
      <table>
        <thead><tr><th>Hold</th><th>Buy and sell</th><th>Payments</th><th>Rewards or staking</th><th>Lend for a return</th><th>Provide liquidity</th></tr></thead>
        <tbody><tr><td>{card.activity.hold}</td><td>{card.activity.buySell}</td><td>{card.activity.payments}</td><td>{card.activity.rewards}</td><td>{card.activity.lend}</td><td>{card.activity.liquidity}</td></tr></tbody>
      </table>
      <p><i>{card.footer}</i></p>
    </Section>
    <Section cls="s-ret" title="Internal">
      <table class="kv">
        <tbody>
          <tr><td>Code</td><td><Status status={r.status} code={r.code} /></td></tr>
          <tr><td>Deciding check</td><td>{r.deciding_check}</td></tr>
          <tr><td>Confidence</td><td>{r.confidence}</td></tr>
          <tr><td>Asset</td><td>{r.asset_id}</td></tr>
        </tbody>
      </table>
    </Section>
  </Layout>
);

export const LibraryPage = ({ rows }: { rows: Row[] }) => {
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <Layout title="Approved tokens" active="/desk/library">
      <div class="tiles">
        <div class="tile" style="--c:var(--lib)"><b>{rows.length}</b><span>Approved in total</span></div>
        <div class="tile" style="--c:var(--halal)"><b>{count("Halal")}</b><span>Halal</span></div>
        <div class="tile" style="--c:var(--doubt)"><b>{count("Doubtful")}</b><span>Doubtful</span></div>
        <div class="tile" style="--c:var(--haram)"><b>{count("Haram")}</b><span>Haram</span></div>
      </div>
      <Section cls="s-lib" title="All approved tokens" count={rows.length}>
        {rows.length === 0 ? <p class="empty">Nothing here.</p> : (
          <table>
            <thead><tr><th>Token</th><th>Class</th><th>Result</th><th>Approved</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr>
                  <td class="token">{r.name} ({r.ticker})<br /><span class="muted">{r.id}</span></td>
                  <td>{r.class}</td>
                  <td><Status status={r.status} code={r.code} /></td>
                  <td>{String(r.approved ?? "").slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </Layout>
  );
};

export const RulesPage = ({ rows }: { rows: Row[] }) => {
  const open = rows.filter((r) => !r.decision);
  const done = rows.filter((r) => r.decision);
  const Proposal = ({ r }: { r: Row }) => (
    <div class="card">
      <h3 style="margin-top:0">{r.title}</h3>
      {r.where_text && <p class="muted">{r.where_text}</p>}
      <table class="kv">
        <tbody>
          {r.current && <tr><td>Now</td><td>{r.current}</td></tr>}
          {r.proposed && <tr><td>Proposed</td><td>{r.proposed}</td></tr>}
          {r.reason && <tr><td>Why</td><td>{r.reason}</td></tr>}
          {r.affects && <tr><td>Tokens affected</td><td>{r.affects}</td></tr>}
          {r.decision && <tr><td>Your decision</td><td><b>{r.decision}</b>{r.note ? ` (${r.note})` : ""} · {r.applied ? "Applied" : "Not yet applied"}</td></tr>}
        </tbody>
      </table>
      {!r.decision && (
        <form method="post" action={`/desk/rules/${r.id}/decide`}>
          <textarea name="note" rows={2} placeholder="Note (optional)"></textarea>
          <p style="margin:10px 0 0">
            <button class="approve" name="decision" value="approved">✓ Approve</button>{" "}
            <button class="ghost" name="decision" value="rejected">Reject</button>
          </p>
        </form>
      )}
    </div>
  );
  return (
    <Layout title="Rule proposals" active="/desk/rules">
      <Section cls="s-q" num="1" title="Waiting for your decision" count={open.length}
        hint="Changes to the Decision Tables. Once you approve one, Claude applies the exact proposed wording and re-checks the tokens it affects.">
        {open.length === 0 ? <p class="empty">Nothing here.</p> : open.map((r) => <Proposal r={r} />)}
      </Section>
      <Section cls="s-ret" title="Decided" count={done.length}>
        {done.length === 0 ? <p class="empty">Nothing here.</p> : done.map((r) => <Proposal r={r} />)}
      </Section>
    </Layout>
  );
};

export const ListPage = ({ title, cols, rows, active }: { title: string; cols: string[]; rows: Row[]; active?: string }) => (
  <Layout title={title} active={active}>
    <table>
      <thead><tr>{cols.map((c) => <th>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr>{cols.map((c) => <td>{String(r[c] ?? "")}</td>)}</tr>)}</tbody>
    </table>
    {rows.length === 0 && <p class="empty">Nothing here.</p>}
  </Layout>
);

export const QuestionsPage = ({ open, answered }: { open: Row[]; answered: Row[] }) => (
  <Layout title="Questions" active="/desk/questions">
    <Section cls="s-q" num="1" title="Waiting for your answer" count={open.length}>
      {open.length === 0 ? <p class="empty">Nothing here.</p> : open.map((q) => <QuestionBox q={q} />)}
    </Section>
    <Section cls="s-ret" title="Answered" count={answered.length}>
      {answered.length === 0 ? <p class="empty">Nothing here.</p> : (
        <table>
          <thead><tr><th>Token</th><th>Question</th><th>Your answer</th><th>Answered</th><th>Acted on by the analyst</th></tr></thead>
          <tbody>
            {answered.map((q) => (
              <tr>
                <td class="token">{q.asset_name ?? q.asset_id}</td><td>{q.question}</td><td><b>{q.answer}</b></td>
                <td>{String(q.answered_at ?? "").slice(0, 10)}</td>
                <td>{q.applied ? <span class="same">Yes</span> : <span class="flag">Not yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
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
    <Section cls="s-main" title="Create a key">
      <form method="post" action="/desk/keys">
        <label>Client name <input name="name" required /></label>
        <p><label><input type="checkbox" name="preliminary" /> May see preliminary rulings</label></p>
        <button>Create key</button>
      </form>
    </Section>
    <Section cls="s-lib" title="Clients" count={clients.length}>
      {clients.length === 0 ? <p class="empty">Nothing here.</p> : (
        <table>
          <thead><tr><th>Client</th><th>Preliminary</th><th>Created</th><th>Revoked</th><th></th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr>
                <td>{c.name}</td><td>{c.preliminary ? "Yes" : "No"}</td><td>{c.created_at}</td><td>{c.revoked_at ?? ""}</td>
                <td>{!c.revoked_at && <form class="inline" method="post" action={`/desk/keys/${c.id}/revoke`}><button class="ghost">Revoke</button></form>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  </Layout>
);
