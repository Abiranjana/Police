# ZCQL Capability Report

**Owner:** P2 · **Target:** Catalyst India DC · **Parser:** ZCQL V2 · **Executed on:** Primary Data Store + OLAP

Every row is filled in by running the matching probe in `probe/probes.sql`.

**Status vocabulary**

| Status | Meaning |
|---|---|
| `DOC` | Documented behaviour. Not yet executed. **Not usable in a template.** |
| `PASS` | Executed live, behaved as documented |
| `PARTIAL` | Executed live, works with a caveat — caveat recorded in Notes |
| `FAIL` | Executed live, does not work |
| `N/A` | Not applicable to our templates |

**Rule:** a template may only use constructs marked `PASS` or `PARTIAL`. §8 rule 2.

---

## A · Core retrieval

| # | Construct | Status | DB | Notes |
|---|---|---|---|---|
| A1 | `SELECT col FROM t` | DOC | both | |
| A2 | `SELECT *` | DOC | both | Capped at 300 rows |
| A3 | Max columns per SELECT | DOC | both | Documented as 20 |
| A4 | Max rows per SELECT | DOC | both | Documented as 300 |
| A5 | `LIMIT offset, value` | DOC | both | Our pagination mechanism |
| A6 | `DISTINCT` | DOC | both | |
| A7 | Table alias via `AS` | DOC | both | SELECT only |
| A8 | Backtick-quoted numeric column names | DOC | both | Unlikely to be needed |

## B · Aggregates and grouping

| # | Construct | Status | DB | Notes |
|---|---|---|---|---|
| B1 | `COUNT(col)` | DOC | both | |
| B2 | `COUNT(*)` | DOC | both | **Confirm separately from B1** — docs only show `COUNT(col)` |
| B3 | `SUM(col)` | DOC | both | Numeric only |
| B4 | `AVG(col)` | DOC | both | Also documented for Date/DateTime/Boolean in V2 |
| B5 | `AVG(boolean)` → rate | DOC | both | **Our chargesheet-rate mechanism.** Confirm the return shape |
| B6 | `MIN()` / `MAX()` | DOC | both | |
| B7 | Multiple functions in one SELECT | DOC | both | V2 |
| B8 | `GROUP BY` single column | DOC | both | |
| B9 | `GROUP BY` two columns | DOC | both | **Critical — the heatmap depends on it** |
| B10 | `GROUP BY` three columns | DOC | both | Needed for area × time × type |
| B11 | `GROUP BY` ordinal (`GROUP BY 1,2`) | DOC | both | **Expect FAIL.** §9.2 of the design doc uses this |
| B12 | `HAVING` with a function | DOC | both | V2 |
| B13 | `ORDER BY` with a function | DOC | both | V2 |
| B14 | `ORDER BY a ASC, b DESC` | DOC | both | V2, per-column direction |
| B15 | `BINARYOF()` in GROUP BY | DOC | both | VarChar/Text only. Case-sensitive grouping |

## C · Functions we need and do not have

| # | Construct | Status | DB | Notes |
|---|---|---|---|---|
| C1 | `DAYOFWEEK()` | DOC | — | **Not in the function list. Expect FAIL.** Replace with `day_of_week` column |
| C2 | `HOUR()` | DOC | — | **Expect FAIL.** Replace with `hour_of_day` column |
| C3 | `MONTH()` / `YEAR()` | DOC | — | **Expect FAIL.** Replace with `month_num` / `year_num` |
| C4 | `DATE_FORMAT()` / `DATE_TRUNC()` | DOC | — | **Expect FAIL** |
| C5 | Date arithmetic (`date + INTERVAL`) | DOC | — | **Expect FAIL.** Ranges computed in Node, passed as literals |
| C6 | `CASE WHEN` | DOC | — | **Expect FAIL.** Replace with precomputed band columns |
| C7 | `ROUND()` / `FLOOR()` / `ABS()` | DOC | — | Undocumented. Probe anyway; rounding moves to Node if absent |
| C8 | `CONCAT()` | DOC | — | Undocumented. Label assembly moves to Node |
| C9 | `COALESCE()` / `IFNULL()` | DOC | — | Undocumented. Null handling moves to Node |

Anything confirmed FAIL here is **not a workaround problem, it is a schema problem** — the
value has to exist as a column. See `P2_DAY1_FINDINGS.md` §4.

## D · Filtering

| # | Construct | Status | DB | Notes |
|---|---|---|---|---|
| D1 | `=` `!=` `>` `>=` `<` `<=` | DOC | both | |
| D2 | `IS NULL` / `IS NOT NULL` | DOC | both | `IS` supports NULL only |
| D3 | `IN (list)` | DOC | both | **The scope-predicate mechanism** |
| D4 | `IN` list max length | DOC | both | **Undocumented — must be measured.** Probe 10 / 50 / 200 / 500 |
| D5 | `NOT IN` | DOC | both | |
| D6 | `BETWEEN` on INT | DOC | both | |
| D7 | `BETWEEN` on DATE | DOC | both | **Expect FAIL** — documented as Int/Double only |
| D8 | Date range via `>= AND <=` | DOC | both | The fallback. **Costs 2 of the 5 conditions** |
| D9 | Max WHERE conditions | DOC | both | Documented as 5. **Confirm whether a 6th errors or silently truncates** — a silent truncation is a security hole, not a bug |
| D10 | Does `IN (a,b,c)` count as 1 condition? | DOC | both | **Decisive for the whole permission design.** If it counts as 3, the model collapses |
| D11 | AND / OR mixing, precedence | DOC | both | Probe explicit parenthesisation |
| D12 | `LIKE 'S*'` | DOC | both | `*` and `?` wildcards, **not `%`** |
| D13 | Unquoted value → error | DOC | both | Parsed as a column name. Confirms our quoting discipline |
| D14 | Column-to-column comparison | DOC | both | Same or different tables, matching types only |
| D15 | Subquery in WHERE | DOC | both | V2, simple/singular only |

## E · Joins

| # | Construct | Status | DB | Notes |
|---|---|---|---|---|
| E1 | `INNER JOIN` | DOC | both | Requires a declared FK relationship |
| E2 | `LEFT JOIN` | DOC | both | |
| E3 | Join on a non-FK integer column | DOC | both | **Expect FAIL. The most important row in this table** |
| E4 | 2 joins in one query | DOC | both | |
| E5 | 4 joins in one query | DOC | both | Documented maximum |
| E6 | 5 joins | DOC | both | Expect FAIL |
| E7 | Multiple conditions in one ON | DOC | both | **Expect FAIL** — one condition per join clause |
| E8 | JOIN + GROUP BY + aggregate together | DOC | both | Most templates need all three at once |
| E9 | JOIN + WHERE + scope predicate | DOC | both | End-to-end shape of a real template |

## F · Execution and plumbing

| # | Construct | Status | DB | Notes |
|---|---|---|---|---|
| F1 | Same query, primary vs OLAP, same result | DOC | both | |
| F2 | OLAP rejects INSERT | DOC | OLAP | **Our headline security claim. Must be demonstrated, not asserted** |
| F3 | OLAP rejects UPDATE / DELETE | DOC | OLAP | Same |
| F4 | Result envelope shape | DOC | both | `data[].TableName.ColumnName` — M6 normalises this |
| F5 | Aggregate column naming in the response | DOC | both | What key does `COUNT(x)` come back under? M6 depends on the answer |
| F6 | Error shape on a bad query | DOC | both | Feeds our `E_*` error mapping (§9.1) |
| F7 | Latency, 300-row aggregate, OLAP | DOC | OLAP | Baseline for the §13.5 budget |
| F8 | Latency, same query, primary | DOC | primary | Justifies routing to OLAP with a number |
| F9 | `ZOHO_CATALYST_ZCQL_PARSER=V2` env var set | DOC | — | Required for V2 features inside Functions |

---

## Findings log

Recorded as probes are executed. One line per surprise.

| Date | Probe | Expected | Observed | Consequence |
|---|---|---|---|---|
| | | | | |
