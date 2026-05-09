## Plan

1. **Fix the dashboard parent route rendering**
   - Keep `/oversight` as the dashboard page.
   - When the URL is `/oversight/import` or `/oversight/points`, render the nested child route instead of the dashboard shell.
   - This prevents the parent dashboard route from hiding the import/points child pages.

2. **Make the dashboard data load fail visibly instead of silently**
   - Update the dashboard `load()` function to capture read errors from `marking_papers` and `marking_deployments`.
   - Show a clear message if the data request fails, rather than showing an empty dashboard.
   - Keep the existing empty-state message only for the true “no imported rows” case.

3. **Refresh dashboard data reliably after import**
   - After import completes and navigates back to `/oversight`, ensure the dashboard performs a fresh read from the backend.
   - Add a lightweight cache-busting/remount approach if needed so the dashboard doesn’t show stale in-memory state.

4. **Verify with current backend data**
   - The database already contains imported data: 60 papers, 182 deployments, and 1 import record.
   - After the code change, the dashboard should show those rows immediately instead of appearing blank.

## Technical details

- Primary files to update: `src/routes/oversight.tsx` and, only if needed, `src/routes/oversight.import.tsx`.
- No database migration is needed because the rows are already inserted successfully.
- The likely issue is frontend rendering/state visibility, not the XLSX parser or insert flow.