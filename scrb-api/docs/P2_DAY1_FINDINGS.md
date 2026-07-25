# P2 · Day 1 Findings — ZCQL Capability Review

**Owner:** P2 (Query and Analytics)
**Status:** Documentation review complete. Live confirmation pending (blocked on tables existing).
**Risk retired:** §15 row 1 — *"ZCQL behaves differently from expectation — High / High"*

---

## 1. Summary for the team

The v2.0 design assumes ZCQL is MySQL-shaped. It is not. Reading the current Catalyst
documentation end to end, ZCQL has a **five-function library** and **hard structural caps**
that invalidate several queries written into the design document verbatim — including the
flagship demo query in §9.2.

**None of this kills the project.** All of it is solvable, and the fix is cheap *if it lands
in P1's schema before the 5,000-row generator runs*, and expensive if it lands after.

This memo is therefore addressed primarily to **P1**, secondarily to **P3** and **P5**.

---

## 2. What ZCQL actually gives us

| Capability | Reality |
|---|---|
| Aggregate functions | `MIN()` `MAX()` `COUNT()` `SUM()` `AVG()` — **that is the entire list** |
| Other functions | `DISTINCT`, and `BINARYOF()` (GROUP BY only, VarChar/Text only) |
| Date/time functions | **None.** No `DAYOFWEEK`, `HOUR`, `MONTH`, `YEAR`, `DATE_TRUNC`, no date arithmetic |
| Conditional expressions | **None.** No `CASE WHEN`, no `IF()` |
| `WHERE` conditions | **Maximum 5 per query**, joined by AND/OR |
| `JOIN` | INNER and LEFT only. **Max 4 join clauses, exactly 1 condition per clause** |
| Join prerequisite | A real declared **foreign-key relationship** must exist between the tables |
| Result size | **Max 300 rows and max 20 columns per query.** Paginate with `LIMIT offset,value` |
| `BETWEEN` | **Int and Double only.** Does *not* work on dates |
| `LIKE` wildcards | `*` (zero or more) and `?` (exactly one). **Not `%`** |
| Subqueries | `WHERE` clause only, simple/singular, V2 only |
| Table alias | `AS`, SELECT statements only |
| Parameter binding | **Does not exist.** The API takes one raw query string |
| Result envelope | Rows nest under the table name: `data[].TableName.ColumnName` |
| Values in queries | Always single-quoted, or they are parsed as column names |
| Parser version | V2 is default; functions need env var `ZOHO_CATALYST_ZCQL_PARSER = V2` |

The **OLAP database uses the same ZCQL and the same function list.** It is faster and
read-only, but it does not unlock a single extra function. Its own documentation demonstrates
roll-up and drill-down by grouping on pre-existing `year` and `quarter` *columns* — which is
exactly the workaround proposed in §4 below.

One correction to §5.4 while we are here: OLAP sync is **near-real-time, triggered by writes**,
not a nightly scheduled window. Our `data_as_of` freshness contract still holds and is still
worth showing, but the sentence "a trend chart that silently reflects last night's data" is no
longer the accurate description of the risk.

---

## 3. What this breaks in v2.0 as written

### 3.1 The flagship demo query (§9.2) is not executable

The evidence panel in the API contract shows:

```
SELECT DAYOFWEEK(…), HOUR(…), COUNT(*) FROM … WHERE crime_head = ? AND unit_id IN (?)
AND date >= ? GROUP BY 1,2
```

Four separate problems: `DAYOFWEEK()` does not exist, `HOUR()` does not exist, `?` binding does
not exist, and grouping by ordinal position (`GROUP BY 1,2`) is not documented as supported.

This is the day×hour heatmap for chain snatching — **the single query the whole demo is built
around**, and the one that proves embedded pattern #1.

### 3.2 The 5-condition WHERE ceiling collides with the permission model

M6's whole design is *"bind parameters, then append the scope predicate."* Every appended scope
predicate consumes part of a five-condition budget the template has already spent.

Worked example — `TREND_BY_TIME` filtered to a crime head, a date range, and an SI's own unit:

```
WHERE crime_head = 12        (1)
  AND reg_date >= '2025-01-01'   (2)   ← 2 conditions, because BETWEEN can't take dates
  AND reg_date <= '2025-12-31'   (3)
  AND unit_id IN (4430006)       (4)   ← the appended scope predicate
```

Four of five gone on the simplest useful question. One spare. Any template needing a fifth
filter is dead on arrival, and the failure appears *only after* the scope predicate is appended
— i.e. it will pass P2's tests and fail in production for real users. **This is the nastiest
thing in this memo.**

### 3.3 Joins are conditional on the SCRB schema's FK declarations

ZCQL will only join two tables where one genuinely references the other's primary key. If the
SCRB schema links `Crime` to `CrimeType` or `Unit` by a plain integer business key rather than
a declared foreign key, **those joins cannot be written at all**, and the template library
loses most of its label lookups.

**P1: this is the single question I need answered first.** Which relationships in the official
schema are declared FKs in Catalyst terms, and which are bare integer columns?

### 3.4 The 300-row cap

A 7×24 day-hour grid is 168 cells — fits. A district×month series over 2019–2025 is 30×84 =
2,520 — does not. Any template that can exceed 300 rows needs declared pagination, and M6 has
to loop and stitch rather than assume one round trip.

### 3.5 The demo example filters on the wrong column

Now that the ER diagram is in, one correction that matters more than any of the above.

`CrimeHead` holds the broad group — its column is `CrimeGroupName`, example *"Crimes Against
Body"*. `CrimeSubHead` holds the actual offence — its column is `CrimeHeadName`, examples
*"Murder", "Robbery"*.

**Chain snatching is a sub-head, not a head.** So every query filtering `crime_head = 12`
returns an entire crime group, not chain snatching. On `CaseMaster` the correct column is
**`CrimeMinorHeadID`**, not `CrimeMajorHeadID`.

Note the naming trap for everyone writing queries against this: the table called `CrimeHead`
has a column called `CrimeGroupName`, and the table called `CrimeSubHead` has a column called
`CrimeHeadName`. They read backwards from what you would expect.

### 3.6 Which timestamp the temporal analysis uses is not a preference

`CaseMaster` carries four:

| Column | Type | Meaning |
|---|---|---|
| `CrimeRegisteredDate` | DATE | when the FIR was filed |
| `IncidentFromDate` | DATETIME | when the offence occurred |
| `IncidentToDate` | DATETIME | when it ended |
| `InfoReceivedPSDate` | DATETIME | when the station was informed |

The heatmap claims *chain snatchings cluster Friday and Saturday, 19:00–22:00*. That is a claim
about **when offences happen**, so it must derive from `IncidentFromDate`.

Built on `CrimeRegisteredDate` it would show a weekday-morning cluster — because that is when
people walk into a police station. We would have produced a confident, well-evidenced
visualisation of station opening hours and presented it as a crime pattern. `CrimeRegisteredDate`
is also DATE-only with no time component, so it cannot produce an hour breakdown at all.

Every derived temporal column in §4 is therefore defined as **derived from `IncidentFromDate`**,
and templates using them must state that in their limitations.

### 3.7 Chargesheet status has two sources of truth

`ChargesheetDetails.cstype` is a CHAR (A = chargesheet, B = false case, C = undetected).
Separately, `CaseStatusMaster` carries a "Charge Sheeted" status referenced from
`CaseMaster.CaseStatusID`. These can disagree. Someone has to declare which is authoritative
before any chargesheet-rate template is written, and the evidence panel should name it.

### 3.8 Twenty tables against a four-join ceiling

The schema is properly normalised — roughly twenty tables, clean foreign keys. Against ZCQL's
**max 4 joins and max 5 WHERE conditions**, that normalisation is a problem rather than a virtue.

"Top offences by district with victim gender breakdown" needs CaseMaster + CrimeSubHead + Unit
+ District + Victim. That is at or past the join ceiling before a single filter is applied, and
the scope predicate has not even been appended yet.

### 3.9 "Parameters are bound" (§8, rule 3) cannot be implemented literally

There is no bind mechanism. The rule has to be re-stated as: *the builder performs typed,
whitelist-validated substitution into named placeholders; any value failing its declared type
is rejected before a query string is assembled.* Same security property, honestly described.
Proposed implementation is in `templates/template.schema.json`.

---

## 4. The fix — one flat fact table, built by P1's generator

Two problems, one answer. ZCQL cannot derive a weekday from a date (§3.1), and cannot afford
joins for label lookups (§3.8). Both are solved by materialising **`si_case_fact`** — one row
per case, dimensions precomputed, labels pre-joined.

This is a bigger ask than "add a few columns", and it is still cheaper now than after the
5,000-row generator runs.

### 4.1 Derived temporal columns — all from `IncidentFromDate`

| Column | Type | Values | Feeds |
|---|---|---|---|
| `day_of_week` | INT | 1–7 | heatmap, Fri–Sat pattern, pattern test #1 |
| `hour_of_day` | INT | 0–23 | heatmap, habitual offender hour bands |
| `time_band` | INT | 0–5 (4-hour buckets) | coarse grouping inside the 300-row cap |
| `month_num` | INT | 1–12 | seasonality |
| `year_num` | INT | | year filter as **one** condition instead of two dates |
| `year_month` | INT | e.g. 202503 | monthly series, sortable, single condition |
| `week_of_year` | INT | 1–53 | weekly trend, emerging clusters |
| `incident_date` | DATE | | date-only copy, for range filters where needed |

`year_num` and `year_month` matter more than they look: they collapse a two-condition date range
into one, buying back the WHERE budget lost in §3.2.

Cases with a null `IncidentFromDate` need an explicit rule — excluded, or flagged. Silently
dropping them skews every temporal chart in the system.

### 4.2 Pre-joined identifiers and labels

Each of these saves a join at query time:

| Column | Source |
|---|---|
| `crime_subhead_id` | `CaseMaster.CrimeMinorHeadID` — **the offence.** See §3.5 |
| `crime_subhead_name` | `CrimeSubHead.CrimeHeadName` |
| `crime_head_id` | `CaseMaster.CrimeMajorHeadID` — the group |
| `crime_head_name` | `CrimeHead.CrimeGroupName` |
| `unit_id` | `CaseMaster.PoliceStationID` |
| `unit_name` | `Unit.UnitName` |
| `district_id` | via `Unit.DistrictID` — **denormalised onto the fact row**, so jurisdiction filtering never costs a join |
| `district_name` | `District.DistrictName` |
| `case_status_id` / `case_status_name` | `CaseStatusMaster` |
| `case_category_id` | `CaseCategory` |
| `gravity_offence_id` | `GravityOffence` |
| `latitude` / `longitude` | `CaseMaster`, for map templates |

`district_id` on the fact row is the important one. Without it, every SP-scoped question needs a
join to `Unit` before it can even apply the permission predicate.

### 4.3 Precomputed flags

| Column | Type | Notes |
|---|---|---|
| `is_chargesheeted` | BOOLEAN | resolves §3.7. Lets us compute a rate with `AVG()`, no CASE WHEN |
| `chargesheet_source` | VARCHAR | which source was treated as authoritative. Goes in the evidence panel |
| `victim_count` | INT | pre-aggregated from `Victim` |
| `accused_count` | INT | pre-aggregated from `Accused` |
| `has_arrest` | BOOLEAN | pre-aggregated from `ArrestSurrender` |

The counts matter because `Victim` and `Accused` are one-to-many. Joining them inside an
aggregate query double-counts cases, and the fix in normal SQL is a subquery per join — which
ZCQL does not support outside a simple WHERE clause.

### 4.4 What this buys

The flagship query becomes legal, honest, and cheap:

```sql
SELECT day_of_week, hour_of_day, COUNT(case_id)
FROM si_case_fact
WHERE crime_subhead_id = 12 AND year_num = 2025 AND unit_id IN (4430006)
GROUP BY day_of_week, hour_of_day
ORDER BY day_of_week, hour_of_day
```

Zero joins, three WHERE conditions, two spare, 168 rows, one round trip, no unsupported
function. The join budget stays free for genuinely relational questions.

The original SCRB tables remain untouched and read-only throughout — `si_case_fact` is a derived
`si_` table, so the schema-invariance test in M1 still holds.

## 5. Asks

| Who | Ask | Why it is urgent |
|---|---|---|
| **P1** | Build `si_case_fact` per §4 instead of querying the normalised tables directly | Free before the generator runs; a regeneration after (§3.8) |
| **P1** | Confirm: in **Catalyst** terms, are the relationships declared as Foreign Key column type, or plain Int? | "The schema has FKs" is true of SQL Server. Catalyst FKs store the parent `ROWID` and are a separate column type. If they come across as plain Int, no join works at all — probe E3 |
| **P1** | Decide the null-`IncidentFromDate` rule | Silently dropping them skews every temporal chart (§4.1) |
| **P1** | Decide the authoritative chargesheet source | Two sources currently disagree (§3.7) |
| **P3** | Scope predicate must fit in **1 WHERE condition** (`unit_id IN (...)` / `district_id IN (...)`) | Budget is 5 total (§3.2) |
| **P3** | Confirm `district_id` on the fact row is acceptable for SP-level scoping | Avoids a join before the permission filter can even be applied |
| **P4** | Slot names: `crime_subhead_id` for the offence, `crime_head_id` for the group — they are **different slots** | "Chain snatching" is a sub-head. Routing it to the head slot returns a whole crime group (§3.5) |
| **P5** | Contracts 3 and 4 are frozen and in `contracts/` | Fixture-first frontend can start now. **No change needed from this memo** — only example values moved, not the shape |
| **All** | §9.2's example ZCQL string needs correcting in the design doc | Wrong function names *and* wrong column granularity |

## 6. What I am doing next

1. Run `probe/probes.sql` against a scratch table to convert every "documented" row in
   `ZCQL_CAPABILITY_REPORT.md` into "confirmed" or "contradicted". Documentation is evidence,
   not proof, and §8 rule 2 says nothing enters the catalogue on the strength of looking valid.
2. Rewrite the 44-template plan against the confirmed function set, with a declared
   WHERE-condition budget per template.
3. Build M6's typed substitution layer per `templates/template.schema.json`.

*Prepared from Catalyst documentation as of the date of this memo. Every line in §2 is marked
CONFIRM-pending in the capability report until executed live.*
