# Probe setup — 15 minutes, no dependency on P1

The point of this scratch schema is that you can retire the ZCQL risk **today**, before P1
delivers anything. `p2_probe` deliberately mimics the shape a crime fact table would have
*after* the derived-dimension columns from `P2_DAY1_FINDINGS.md` §4 are added — so running
these probes is simultaneously a capability test and a proof that the proposed fix works.

Delete both tables once the real `si_` tables land.

---

## 1. Enable the OLAP database

Data Store → **OLAP Database** tab → **Enable**. One-time, project-wide, syncs automatically.
Do this first; sync needs a moment and half the probes run on OLAP.

## 2. Create `p2_lookup`

Data Store → **New Table** → name it `p2_lookup`.

| Column | Type | Notes |
|---|---|---|
| head_code | Int | |
| head_label | VarChar | max length 100 |

## 3. Create `p2_probe`

| Column | Type | Notes |
|---|---|---|
| case_id | Int | |
| crime_head | Int | plain business key — **no FK**, deliberately |
| head_ref | Foreign Key → `p2_lookup` | **this is the point of the join probes** |
| unit_id | BigInt | |
| district_id | Int | |
| reg_date | Date | |
| reg_datetime | DateTime | |
| day_of_week | Int | 1 = Monday … 7 = Sunday |
| hour_of_day | Int | 0–23 |
| time_band | Int | 0–5, four-hour buckets |
| month_num | Int | 1–12 |
| year_num | Int | |
| year_month | Int | e.g. 202503 |
| is_chargesheeted | Boolean | |
| victim_age | Int | |
| victim_age_band | Int | 0–4 |
| victim_gender | VarChar | max length 5 |
| narrative | Text | |

`crime_head` and `head_ref` intentionally carry the same relationship twice — one as a bare
integer, one as a declared foreign key. Probes E1/E2 use the FK, probe E3 uses the bare
integer. **The difference between those results is the finding.**

## 4. Load the data

`p2_lookup` first (4 rows), then `p2_probe` (350 rows).

Data Store → select the table → **Bulk Operations** / import → upload
`p2_lookup_seed.csv`, then `p2_probe_seed.csv`.

The CSV has no `head_ref` column, because a Catalyst foreign key stores the parent row's
`ROWID`, which does not exist until `p2_lookup` is loaded. After importing both:

1. `SELECT ROWID, head_code FROM p2_lookup` — note the four ROWIDs
2. Backfill with four statements on the **primary** DB (not OLAP):

```sql
UPDATE p2_probe SET head_ref = '<rowid_for_12>' WHERE crime_head = 12
UPDATE p2_probe SET head_ref = '<rowid_for_45>' WHERE crime_head = 45
UPDATE p2_probe SET head_ref = '<rowid_for_78>' WHERE crime_head = 78
UPDATE p2_probe SET head_ref = '<rowid_for_91>' WHERE crime_head = 91
```

If the console will not let you set a Foreign Key column this way, that is itself a finding —
record it and run E1/E2 as FAIL rather than working around it silently.

## 5. Sanity check before you start

```sql
SELECT COUNT(case_id) FROM p2_probe
```

Expect 350. Then:

```sql
SELECT day_of_week, COUNT(case_id) FROM p2_probe WHERE crime_head = 12 AND unit_id IN (4430006) GROUP BY day_of_week
```

Days 5 and 6 (Fri, Sat) should be conspicuously higher than the rest. The seed data has the
same embedded pattern #1 the real generator is supposed to produce, so if this comes back flat,
something is wrong with the load, not with ZCQL.

## 6. Run the probes

Work through `probes.sql` top to bottom. For each one:

- Run on **Primary**, then flip the *Execute on* toggle to **OLAP DB** and run again
- Record PASS / PARTIAL / FAIL in `docs/ZCQL_CAPABILITY_REPORT.md`
- On any failure, **paste the exact error text** into the Notes column

The error text matters more than the pass/fail. `"Operator BETWEEN is not supported for DATE"`
tells the whole team something; `FAIL` tells them nothing.

## 7. Priority order if you are short on time

Do these nine first. They decide the architecture:

**B9** (two-column GROUP BY) · **B2** (`COUNT(*)`) · **B5** (`AVG` on boolean) ·
**C1/C2** (date functions — confirm the absence) · **D9b** (does a 6th WHERE error or silently
truncate) · **D10** (does `IN` count as one condition) · **E3** (join without a declared FK) ·
**F2** (OLAP rejects writes)

Everything else can wait a day. Those nine cannot.
