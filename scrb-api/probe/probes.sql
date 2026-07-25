-- ============================================================================
-- P2 ZCQL CAPABILITY PROBES
-- Paste one at a time into: Catalyst console > Cloud Scale > Data Store >
-- ZCQL Console. Run each on "Primary" AND on "OLAP DB" (the Execute on toggle).
-- Record PASS / PARTIAL / FAIL against the matching row of
-- docs/ZCQL_CAPABILITY_REPORT.md. Do not skip the ones you expect to fail —
-- a documented failure is the deliverable.
-- Setup first: see probe/SETUP.md
-- ============================================================================

-- ---------------------------------------------------------------- A · CORE
-- A1
SELECT case_id, crime_head FROM p2_probe LIMIT 5

-- A2 / A4  how many rows actually come back from 350?
SELECT * FROM p2_probe

-- A3  17 declared columns + system columns. Does it exceed the 20 cap?
SELECT case_id, crime_head, unit_id, district_id, reg_date, reg_datetime, day_of_week, hour_of_day, time_band, month_num, year_num, year_month, is_chargesheeted, victim_age, victim_age_band, victim_gender, narrative FROM p2_probe LIMIT 2

-- A5  pagination
SELECT case_id FROM p2_probe ORDER BY case_id LIMIT 300,60

-- A6
SELECT DISTINCT crime_head FROM p2_probe

-- A7  alias
SELECT c.case_id FROM p2_probe AS c LIMIT 5

-- ---------------------------------------------------- B · AGGREGATES/GROUPING
-- B1
SELECT COUNT(case_id) FROM p2_probe

-- B2  COUNT(*) is used all through the design doc but never shown in Catalyst docs
SELECT COUNT(*) FROM p2_probe

-- B3
SELECT SUM(victim_age) FROM p2_probe

-- B4
SELECT AVG(victim_age) FROM p2_probe

-- B5  chargesheet rate without CASE WHEN. Critical.
SELECT unit_id, AVG(is_chargesheeted) FROM p2_probe GROUP BY unit_id

-- B6
SELECT MIN(victim_age), MAX(victim_age) FROM p2_probe

-- B7  multiple functions, V2 only
SELECT MIN(victim_age), MAX(victim_age), COUNT(case_id), SUM(victim_age), AVG(victim_age) FROM p2_probe

-- B8
SELECT crime_head, COUNT(case_id) FROM p2_probe GROUP BY crime_head

-- B9  THE HEATMAP. If this fails the demo has no flagship visual.
SELECT day_of_week, hour_of_day, COUNT(case_id) FROM p2_probe GROUP BY day_of_week, hour_of_day

-- B10  three grouping columns
SELECT unit_id, year_month, crime_head, COUNT(case_id) FROM p2_probe GROUP BY unit_id, year_month, crime_head

-- B11  ordinal GROUP BY, as written in design doc §9.2. Expect FAIL.
SELECT day_of_week, hour_of_day, COUNT(case_id) FROM p2_probe GROUP BY 1,2

-- B12  HAVING with a function
SELECT unit_id, COUNT(case_id) FROM p2_probe GROUP BY unit_id HAVING COUNT(case_id) > 50

-- B13  ORDER BY a function
SELECT crime_head, COUNT(case_id) FROM p2_probe GROUP BY crime_head ORDER BY COUNT(case_id) DESC

-- B14  per-column sort direction
SELECT day_of_week, hour_of_day FROM p2_probe ORDER BY day_of_week ASC, hour_of_day DESC LIMIT 10

-- B15  BINARYOF
SELECT victim_gender FROM p2_probe GROUP BY BINARYOF(victim_gender)

-- ------------------------------------------- C · FUNCTIONS WE MAY NOT HAVE
-- Every one of these is expected to fail. Record the exact error text —
-- the error text is the evidence for the memo.
-- C1
SELECT DAYOFWEEK(reg_date), COUNT(case_id) FROM p2_probe GROUP BY DAYOFWEEK(reg_date)

-- C2
SELECT HOUR(reg_datetime), COUNT(case_id) FROM p2_probe GROUP BY HOUR(reg_datetime)

-- C3
SELECT MONTH(reg_date), COUNT(case_id) FROM p2_probe GROUP BY MONTH(reg_date)

-- C3b
SELECT YEAR(reg_date), COUNT(case_id) FROM p2_probe GROUP BY YEAR(reg_date)

-- C6
SELECT CASE WHEN victim_age < 18 THEN 'minor' ELSE 'adult' END, COUNT(case_id) FROM p2_probe GROUP BY 1

-- C7
SELECT ROUND(AVG(victim_age)) FROM p2_probe

-- C8
SELECT CONCAT(victim_gender, '-x') FROM p2_probe LIMIT 3

-- C9
SELECT COALESCE(victim_age, 0) FROM p2_probe LIMIT 3

-- --------------------------------------------------------- D · FILTERING
-- D1
SELECT COUNT(case_id) FROM p2_probe WHERE victim_age >= 30

-- D2
SELECT COUNT(case_id) FROM p2_probe WHERE narrative IS NOT NULL

-- D3  the scope-predicate mechanism
SELECT COUNT(case_id) FROM p2_probe WHERE unit_id IN (4430006, 4430007)

-- D4  how long can the IN list be? escalate: 10, 50, 200, 500 fake ids
SELECT COUNT(case_id) FROM p2_probe WHERE unit_id IN (4430006,4430007,4430011,1,2,3,4,5,6,7)

-- D6  BETWEEN on INT
SELECT COUNT(case_id) FROM p2_probe WHERE victim_age BETWEEN 20 AND 40

-- D7  BETWEEN on DATE. Expect FAIL — docs say Int/Double only.
SELECT COUNT(case_id) FROM p2_probe WHERE reg_date BETWEEN '2025-01-01' AND '2025-12-31'

-- D8  the date-range fallback, and it costs TWO conditions
SELECT COUNT(case_id) FROM p2_probe WHERE reg_date >= '2025-01-01' AND reg_date <= '2025-12-31'

-- D9  five conditions — the documented ceiling
SELECT COUNT(case_id) FROM p2_probe WHERE crime_head = 12 AND unit_id = 4430006 AND year_num = 2025 AND day_of_week = 5 AND hour_of_day >= 19

-- D9b  SIX conditions. Does it error, or silently drop one?
-- A silent drop is a security defect, not a limitation. Compare the count
-- returned here against D9. If they are equal, escalate immediately.
SELECT COUNT(case_id) FROM p2_probe WHERE crime_head = 12 AND unit_id = 4430006 AND year_num = 2025 AND day_of_week = 5 AND hour_of_day >= 19 AND victim_age > 20

-- D10  DECISIVE: does IN(3 values) count as 1 condition or 3?
-- Four plain conditions plus one IN. If IN counts as 3, this is 7 and fails.
SELECT COUNT(case_id) FROM p2_probe WHERE crime_head = 12 AND year_num = 2025 AND day_of_week = 5 AND hour_of_day >= 19 AND unit_id IN (4430006,4430007,4430011)

-- D11  AND/OR precedence
SELECT COUNT(case_id) FROM p2_probe WHERE crime_head = 12 OR crime_head = 45 AND year_num = 2025

-- D12  LIKE with * not %
SELECT COUNT(case_id) FROM p2_probe WHERE narrative LIKE '*snatched*'

-- D12b  does % work at all?
SELECT COUNT(case_id) FROM p2_probe WHERE narrative LIKE '%snatched%'

-- D13  unquoted value. Expect an "unknown column" error.
SELECT COUNT(case_id) FROM p2_probe WHERE victim_gender = M

-- D15  subquery in WHERE
SELECT case_id, victim_age FROM p2_probe WHERE victim_age > (SELECT AVG(victim_age) FROM p2_probe) LIMIT 5

-- ------------------------------------------------------------- E · JOINS
-- E1  INNER JOIN on the declared FK column (head_ref)
SELECT p2_probe.case_id, p2_lookup.head_label FROM p2_probe INNER JOIN p2_lookup ON p2_probe.head_ref = p2_lookup.ROWID LIMIT 5

-- E2  LEFT JOIN on the same FK
SELECT p2_probe.case_id, p2_lookup.head_label FROM p2_probe LEFT JOIN p2_lookup ON p2_probe.head_ref = p2_lookup.ROWID LIMIT 5

-- E3  THE IMPORTANT ONE. Join on a plain integer business key, no FK declared.
-- If this fails, every label lookup in the SCRB schema is affected.
SELECT p2_probe.case_id, p2_lookup.head_label FROM p2_probe INNER JOIN p2_lookup ON p2_probe.crime_head = p2_lookup.head_code LIMIT 5

-- E7  two conditions in one ON clause. Expect FAIL.
SELECT p2_probe.case_id FROM p2_probe INNER JOIN p2_lookup ON p2_probe.head_ref = p2_lookup.ROWID AND p2_probe.crime_head = p2_lookup.head_code LIMIT 5

-- E8  join + group + aggregate, the real template shape
SELECT p2_lookup.head_label, COUNT(p2_probe.case_id) FROM p2_probe INNER JOIN p2_lookup ON p2_probe.head_ref = p2_lookup.ROWID GROUP BY p2_lookup.head_label

-- E9  join + where + appended scope predicate: a complete template
SELECT p2_lookup.head_label, p2_probe.day_of_week, COUNT(p2_probe.case_id) FROM p2_probe INNER JOIN p2_lookup ON p2_probe.head_ref = p2_lookup.ROWID WHERE p2_probe.year_num = 2025 AND p2_probe.unit_id IN (4430006) GROUP BY p2_lookup.head_label, p2_probe.day_of_week

-- ------------------------------------------------- F · EXECUTION / PLUMBING
-- F1  run B9 on both toggles and diff the results

-- F2  OLAP write rejection. RUN THIS ONLY WITH THE OLAP TOGGLE SELECTED.
-- This is the demo's headline security claim. Screenshot the error.
INSERT INTO p2_probe (case_id, crime_head) VALUES (999999, 12)

-- F3  same, update and delete. OLAP toggle only.
UPDATE p2_probe SET crime_head = 99 WHERE case_id = 1001
DELETE FROM p2_probe WHERE case_id = 1001

-- F5  what key does an aggregate come back under? Switch the console to
-- JSON View for this one and paste the raw envelope into the report.
SELECT crime_head, COUNT(case_id) FROM p2_probe GROUP BY crime_head

-- F6  deliberate syntax error, to capture the error envelope shape
SELECT nonexistent_column FROM p2_probe

-- F7 / F8  latency. Run B10 five times on OLAP, five times on primary,
-- record the console's reported execution time for each.

-- ============================================================================
-- The flagship query, in its corrected form. When this returns a 7x24-ish grid
-- with a visible Friday/Saturday 19:00-22:00 peak, the pattern is findable and
-- the demo's central claim is executable in ZCQL.
-- ============================================================================
SELECT day_of_week, hour_of_day, COUNT(case_id) FROM p2_probe WHERE crime_head = 12 AND unit_id IN (4430006) AND year_num = 2025 GROUP BY day_of_week, hour_of_day ORDER BY day_of_week, hour_of_day
