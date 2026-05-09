## Plan

1. **Fix the roster dropdown behaviour**
   - Replace the current XLSX generation approach that only writes named ranges with a method that writes actual Excel data validation records.
   - Make `Setter` and `Marker` dropdowns point to the editable roster cells, so when users overwrite Andy/Barry/etc., the dropdown list updates in Excel.
   - Keep single-select dropdowns while allowing users to type combinations such as `Andy / Barry`.

2. **Expand mock data by term**
   - Generate exactly **15 mock deployment rows under each term**: Term 1, Term 2, Term 3, Term 4.
   - Use generic roster names and varied levels, subjects, streams, assessment types, setters, markers, classes, counts, and remarks.
   - Keep all rows import-compatible with the existing parser.

3. **Preserve template structure**
   - Keep one `Deployment` sheet with the editable roster at the top.
   - Keep dropdowns for `Term`, `Assessment`, `Stream`, `Setter`, and `Marker`.
   - Keep the `Lists` sheet hidden for dropdown source lists.
   - Keep `Total` as formulas summing columns `1` through `10`.

4. **Quality check the workbook**
   - Inspect the generated `.xlsx` internals to confirm data validation records exist.
   - Recalculate formulas and verify there are no Excel formula errors.
   - Confirm the template contains 60 mock rows total, 15 per term.