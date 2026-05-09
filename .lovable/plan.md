## Goal

Strip points/scoring from the dashboard. Replace it with a tabulated count of scripts being marked, broken down by level (and keep the existing progress detail). No moderation points anywhere.

## Changes — `src/routes/oversight.tsx`

1. **Remove points from KPI strip**
   - Drop the "Dashboard score" KPI tile (the `totalPoints` one).
   - Keep: Papers, Markers deployed, Scripts assigned, % complete, Overdue / Flagged.

2. **Remove the Dashboard leaderboard card** (the setting/marking/moderation points bars and the legend below it). Also remove the "Dashboard leaderboard →" button in the filter row that links to `/oversight/points`.

3. **Add a new "Scripts by level" card** above (or replacing) the leaderboard, showing a small table:
   - Columns: Level · Papers · Scripts assigned · Marked · % complete
   - Rows: one per distinct `level` from the visible marker deployments' papers, sorted by level, plus a Total row.
   - Uses the same year/assessment/subject filters already in scope.

4. **Drop unused state/derivations**: remove `totalPoints`, `leaderboard`, `maxLeaderTotal` and the `points` field usage. Keep `points`/`points_setting` in the row types as nullable but don't render them.

## Out of scope

- The `/oversight/points` route, DB schema, importer, and template are untouched — points still exist server-side, just no longer surfaced on the dashboard. (If you'd like me to also delete the `/oversight/points` page and the importer's points handling, say the word.)
