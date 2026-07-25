import { useState, useRef } from "react";
import "./App.css";

/* ------------------------------------------------------------------ *
 * SCRB Insight — answer view
 *
 * Wired to the real scrb-api (M6). Submits a question with a
 * hand-written Contract 2 payload (standing in for P4's router, which
 * doesn't exist yet — the design doc's whole point is that M6 is fully
 * testable before the model exists), polls Contract 4's progress shape,
 * and renders whatever Contract 3 answer comes back.
 * ------------------------------------------------------------------ */

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:9000";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const EXAMPLES = [
  { q: "chain snatchings in my station this year by day and hour", intent: "TREND_BY_TIME" },
  { q: "monthly trend of chain snatching", intent: "TREND_BY_MONTH" },
  { q: "weekly trend of chain snatching", intent: "TREND_BY_WEEK" },
  { q: "which units have the most chain snatching", intent: "COUNT_BY_AREA" },
  { q: "chain snatching by district", intent: "COUNT_BY_DISTRICT" },
  { q: "top crime types this year", intent: "TOP_CRIME_TYPES" },
  { q: "victim gender breakdown for chain snatching", intent: "VICTIM_BREAKDOWN" },
  { q: "accused age groups for chain snatching", intent: "ACCUSED_BREAKDOWN" },
  { q: "chargesheet rate for chain snatching", intent: "CHARGESHEET_RATE" },
  { q: "conviction rate for chain snatching", intent: "CONVICTION_ANALYSIS" },
  { q: "investigation delay for chain snatching", intent: "INVESTIGATION_DELAY" },
  { q: "chain snatching hotspots", intent: "HOTSPOT_CURRENT" },
  { q: "chain snatching this year vs last", intent: "TREND_COMPARE_PERIOD" },
  { q: "seasonal pattern of chain snatching", intent: "SEASONAL_PATTERN" },
  { q: "repeat accused for chain snatching", intent: "PERSON_CASE_HISTORY" },
  { q: "habitual offenders for chain snatching", intent: "HABITUAL_OFFENDERS" },
  { q: "map a criminal network (needs Module C)", intent: "NETWORK_AROUND_PERSON" },
  { q: "forecast chain snatching (needs QuickML)", intent: "FORECAST_TREND" },
];

/* Canned Contract 2 payload, standing in for fn-intent-router (P4/M9).
   Picks the intent from the chosen example; entities stay fixed for the
   demo. Swap for a real router call when M9 exists. */
function buildContract2(intent) {
  const base = {
    crime_subhead_id: { value: 12, type: "INT", is_list: false, source: "STATED" },
    crime_head_id: null,
    unit_id: { value: 4430006, type: "INT", is_list: false, source: "INHERITED_FROM_SESSION" },
    district_id: null, case_master_id: null, person_id: null, community_id: null, case_category_id: null,
    year_num: { value: 2024, type: "INT", is_list: false, source: "DERIVED" },
    year_month: null, date_from: null, date_to: null,
    group_by: { value: "DAY_AND_HOUR", type: "ENUM", is_list: false, source: "STATED" },
    dimension: null,
  };
  // intents that rank across all offences carry no specific sub-head
  if (intent === "TOP_CRIME_TYPES" || intent === "COUNT_BY_CRIME_TYPE") base.crime_subhead_id = null;
  // compare-period spans years, so it carries no single year
  if (intent === "TREND_COMPARE_PERIOD") base.year_num = null;
  return { intent, confidence: 0.94, is_followup: false, entities: base };
}

const STAGE_LABELS = {
  QUEUED: "Queued",
  UNDERSTANDING: "Understanding the question",
  PERMISSION: "Checking permissions",
  TEMPLATE_SELECT: "Selecting a query template",
  QUERYING: "Querying the database",
  ANALYSING: "Analysing results",
  EXPLAINING: "Writing the explanation",
  AUDITING: "Recording the audit trail",
  FINALISING: "Finalising",
  DONE: "Done",
  FAILED: "Failed",
};

const pad = (n) => String(n).padStart(2, "0");

const REQUIRED = [
  "question", "intent", "entities", "permission", "template", "zcql",
  "tables_used", "source", "rows_returned", "rows_suppressed",
  "execution_ms", "confidence", "data_as_of", "warnings",
];

function Heatmap({ spec }) {
  const cells = spec.cells ?? [];
  const lookup = new Map(cells.map((c) => [`${c.day_of_week}-${c.hour_of_day}`, c.count]));
  const max = Math.max(...cells.map((c) => c.count), 1);
  const peak = cells.length ? cells.reduce((a, b) => (b.count > a.count ? b : a), cells[0]) : null;

  return (
    <figure className="heat">
      <div className="heat__scroll">
        <div className="heat__grid">
          <div className="heat__corner" aria-hidden="true" />
          {HOURS.map((h) => (
            <div key={h} className="heat__hour" aria-hidden="true">
              {h % 3 === 0 ? pad(h) : ""}
            </div>
          ))}
          {DAYS.map((label, i) => {
            const day = i + 1;
            return (
              <div className="heat__row" key={day} style={{ "--row": i }}>
                <div className="heat__day">{label}</div>
                {HOURS.map((h) => {
                  const count = lookup.get(`${day}-${h}`) ?? 0;
                  const isPeak = peak && peak.day_of_week === day && peak.hour_of_day === h;
                  return (
                    <div
                      key={h}
                      className={"heat__cell" + (count ? " is-filled" : "") + (isPeak ? " is-peak" : "")}
                      style={{ "--w": count / max }}
                      title={`${label} ${pad(h)}:00 — ${count} case${count === 1 ? "" : "s"}`}
                    >
                      <span className="visually-hidden">{label} {pad(h)}:00, {count} cases</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <figcaption className="heat__legend">
        <span className="heat__legend-label">{spec.value?.label ?? "Cases"}</span>
        <span className="heat__ramp" aria-hidden="true">
          <i style={{ "--w": 0.08 }} /><i style={{ "--w": 0.3 }} /><i style={{ "--w": 0.55 }} /><i style={{ "--w": 0.8 }} /><i style={{ "--w": 1 }} />
        </span>
        <span className="heat__legend-max">{max} max</span>
        {peak && <span className="heat__peak-note">Peak {DAYS[peak.day_of_week - 1]} {pad(peak.hour_of_day)}:00</span>}
      </figcaption>
    </figure>
  );
}

function BarChart({ spec }) {
  const points = spec.points ?? [];
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <figure className="bars">
      {spec.geographic && (
        <p className="bars__geo">Geographic distribution — ranked; boundary map pending GIS layer</p>
      )}
      {points.map((p, i) => (
        <div className="bars__row" key={i} style={{ "--i": i }}>
          <span className="bars__label" title={p.category}>{p.category}</span>
          <span className="bars__track">
            <span className="bars__fill" style={{ "--w": p.value / max }} />
          </span>
          <span className="bars__val">{spec.is_rate ? `${p.value}%` : p.value}</span>
        </div>
      ))}
      <figcaption className="bars__cap">{spec.value?.label}</figcaption>
    </figure>
  );
}

function LineChart({ spec }) {
  const points = spec.points ?? [];
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const W = 640, H = 200, PAD = 28;
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [PAD + i * step, H - PAD - (p.value / max) * (H - PAD * 2)]);
  const path = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${xy[xy.length - 1][0].toFixed(1)},${H - PAD} L${xy[0][0].toFixed(1)},${H - PAD} Z`;
  return (
    <figure className="line">
      <svg viewBox={`0 0 ${W} ${H}`} className="line__svg" role="img" aria-label="Trend over time">
        <path d={area} className="line__area" />
        <path d={path} className="line__stroke" />
        {xy.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="3.5" className="line__dot" />
            <text x={x} y={H - PAD + 16} className="line__xlabel" textAnchor="middle">
              {points[i].category}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="bars__cap">{spec.value?.label}</figcaption>
    </figure>
  );
}

function Visual({ visual }) {
  if (!visual) return null;
  if (visual.type === "HEATMAP_DAY_HOUR") return <Heatmap spec={visual.spec} />;
  if (visual.type === "BAR_CATEGORY") return <BarChart spec={visual.spec} />;
  if (visual.type === "LINE_TIME") return <LineChart spec={visual.spec} />;
  return null;
}

function Field({ n, label, children, mono, wide }) {
  return (
    <section className={"ev" + (wide ? " ev--wide" : "")}>
      <header className="ev__head">
        <span className="ev__n">{pad(n)}<span className="ev__n-of">/14</span></span>
        <h3 className="ev__label">{label}</h3>
      </header>
      <div className={"ev__body" + (mono ? " is-mono" : "")}>{children}</div>
    </section>
  );
}

function AnswerView({ result }) {
  const { answer: ans, evidence: ev, outcome, turn_id, audit_id, error } = result;

  if (outcome === "CLARIFICATION_NEEDED") {
    return (
      <div className="notice notice--ask">
        <p className="notice__code">Need one more detail</p>
        <p>{error?.clarifying_question || error?.message}</p>
      </div>
    );
  }

  if (outcome === "UNSUPPORTED" || outcome === "ERROR") {
    return (
      <div className="notice notice--error">
        <p className="notice__code">{error?.code}</p>
        <p>{error?.message}</p>
        {error?.detail && <p className="muted">{error.detail}</p>}
        {error?.nearest_supported?.length > 0 && (
          <p className="muted">Try asking about: {error.nearest_supported.join(", ")}</p>
        )}
      </div>
    );
  }

  const present = ev ? REQUIRED.filter((k) => ev[k] !== undefined).length : 0;

  return (
    <>
      <header className="masthead">
        <div className="masthead__id">
          <span className="masthead__mark">SCRB</span>
          <span className="masthead__sub">Insight</span>
        </div>
        <dl className="masthead__meta">
          <div><dt>Turn</dt><dd>{turn_id}</dd></div>
          <div><dt>Audit</dt><dd>{audit_id}</dd></div>
          <div><dt>Outcome</dt><dd className="is-outcome">{outcome}</dd></div>
        </dl>
      </header>

      <main className="layout">
        <div className="col col--answer">
          <div className="ask">
            <span className="ask__tag">Asked</span>
            <p className="ask__text">{ev.question.raw}</p>
            <span className="ask__via">{ev.question.via} · {ev.question.language.toUpperCase()}</span>
          </div>
          <p className="summary">{ans.summary}</p>
          {ans.reasoning && <p className="reasoning">{ans.reasoning}</p>}
          {ans.visual && <Visual visual={ans.visual} />}
          {ans.table && (
            <div className="table-wrap">
              <table className="tbl">
                <caption className="tbl__cap">
                  Top cells
                  {ans.table.total_rows != null && <span> — {ans.table.total_rows} rows total</span>}
                  {ans.table.truncated && <span className="tbl__trunc"> · truncated</span>}
                </caption>
                <thead><tr>{ans.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {ans.table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{String(v)}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="col col--evidence" aria-label="Evidence">
          <header className="ev-head">
            <h2 className="ev-head__title">How this answer was produced</h2>
            <p className="ev-head__count">
              <strong>{present} of 14</strong> fields present
              {present < 14 && <span className="ev-head__gap"> — incomplete</span>}
            </p>
          </header>

          <Field n={1} label="Question">{ev.question.raw}</Field>
          <Field n={2} label="Intent">
            <span className="chip">{ev.intent.value}</span>
            <span className="muted"> confidence {ev.intent.confidence}</span>
          </Field>
          <Field n={3} label="Entities">
            <ul className="ents">
              {ev.entities.map((e) => (
                <li key={e.slot}>
                  <code>{e.slot}</code>
                  <span className="ents__val">{String(e.value)}{e.label && <em> — {e.label}</em>}</span>
                  <span className="ents__src">{e.source}</span>
                </li>
              ))}
            </ul>
          </Field>
          <Field n={4} label="Permission">
            <span className="chip">{ev.permission.role}</span>
            <span className="chip chip--quiet">{ev.permission.scope_rule}</span>
            <span className="chip chip--quiet">{ev.permission.field_policy}</span>
            <p className="muted">
              min cell size {ev.permission.min_cell_size} · rule {ev.permission.rule_id ?? "—"} ·{" "}
              {ev.permission.narrowed ? "scope was narrowed to your jurisdiction" : "not narrowed"}
            </p>
          </Field>
          <Field n={5} label="Template">
            <code>{ev.template.id}</code> <span className="muted">v{ev.template.version}</span>
            <p className="muted">written by {ev.template.author} · reviewed by {ev.template.reviewer} on {ev.template.reviewed}</p>
          </Field>
          <Field n={6} label="Statement executed" mono wide>
            <pre className="zcql">{ev.zcql}</pre>
          </Field>
          <Field n={7} label="Tables read">
            {ev.tables_used.map((t) => <code key={t} className="chip chip--code">{t}</code>)}
          </Field>
          <Field n={8} label="Source">
            <span className="chip chip--source">{ev.source}</span>
            <span className="muted"> read-only analytical copy</span>
          </Field>
          <Field n={9} label="Rows returned">
            <span className="stat">{ev.rows_returned}</span>
            {ev.pages_fetched > 1 && <span className="muted"> across {ev.pages_fetched} pages</span>}
          </Field>
          <Field n={10} label="Rows suppressed">
            <span className="stat">{ev.rows_suppressed}</span>
            <span className="muted"> {ev.rows_suppressed === 0 ? "nothing withheld" : "below minimum cell size"}</span>
          </Field>
          <Field n={11} label="Timing" wide>
            <ul className="timing">
              {Object.entries(ev.execution_ms).filter(([k]) => k !== "total").map(([k, v]) => (
                <li key={k}>
                  <span className="timing__k">{k}</span>
                  <span className="timing__bar" style={{ "--w": v / ev.execution_ms.total }} />
                  <span className="timing__v">{v} ms</span>
                </li>
              ))}
            </ul>
            <p className="timing__total">total <strong>{ev.execution_ms.total} ms</strong></p>
          </Field>
          <Field n={12} label="Confidence">
            <span className="chip">{ev.confidence.analytical}</span>
            <span className="muted"> intent {ev.confidence.intent}</span>
          </Field>
          <Field n={13} label="Data as of">
            <time dateTime={ev.data_as_of}>{new Date(ev.data_as_of).toLocaleString("en-IN")}</time>
          </Field>
          <Field n={14} label="Warnings">
            {ev.warnings.length === 0 ? <span className="muted">None</span> : (
              <ul className="warns">
                {ev.warnings.map((w) => <li key={w.code}><code>{w.code}</code> {w.message}</li>)}
              </ul>
            )}
          </Field>
        </aside>
      </main>

      <footer className="foot">
        <p>Rendered live from scrb-api. M6's real builder ran; execution used local seed data, not live Catalyst — see the warning above.</p>
      </footer>
    </>
  );
}

export default function App() {
  const [question, setQuestion] = useState("chain snatchings in my station this year by day and hour");
  const [intent, setIntent] = useState("TREND_BY_TIME");
  const [stage, setStage] = useState(null);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const pollRef = useRef(null);

  async function ask(useIntent = intent) {
    setResult(null);
    setErrorMsg(null);
    setStage("QUEUED");
    clearInterval(pollRef.current);

    try {
      const res = await fetch(`${API_BASE}/conversations/c1/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, as_unit_id: 4430006, contract2: buildContract2(useIntent) }),
      });
      if (!res.ok) throw new Error(`submit failed: ${res.status}`);
      const { turn_id } = await res.json();

      pollRef.current = setInterval(async () => {
        const s = await fetch(`${API_BASE}/turns/${turn_id}/status`).then((r) => r.json());
        setStage(s.stage);
        if (s.terminal) {
          clearInterval(pollRef.current);
          const final = await fetch(`${API_BASE}/turns/${turn_id}`).then((r) => r.json());
          setResult(final);
        }
      }, 400);
    } catch (e) {
      setErrorMsg(`Could not reach scrb-api at ${API_BASE}. Is it running? (${e.message})`);
      setStage(null);
    }
  }

  function pickExample(ex) {
    setQuestion(ex.q);
    setIntent(ex.intent);
    ask(ex.intent);
  }

  const busy = stage && stage !== "DONE" && stage !== "FAILED";

  return (
    <div className="page">
      <div className="composer">
        <input
          className="composer__input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="Ask a question…"
        />
        <button className="composer__btn" onClick={() => ask()} disabled={busy}>Ask</button>
      </div>

      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.intent}
            className={"examples__chip" + (ex.intent === intent ? " is-active" : "")}
            onClick={() => pickExample(ex)}
            disabled={busy}
          >
            {ex.q}
          </button>
        ))}
      </div>

      {busy && (
        <p className="progress"><span className="progress__dot" />{STAGE_LABELS[stage] || stage}…</p>
      )}

      {errorMsg && <div className="notice notice--error">{errorMsg}</div>}

      {result && <AnswerView result={result} />}
    </div>
  );
}
