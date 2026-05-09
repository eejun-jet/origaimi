## Plan

1. **Make the mock rows obvious in the template**
   - Keep one `Deployment` sheet grouped by Term 1–4.
   - Ensure each term has exactly **15 editable mock data rows** directly under its term banner.
   - Rename the dashboard/import button text from “blank template” to something like “download template with sample data” so users don’t expect an empty file.

2. **Fix teacher name dropdown reliability**
   - Change the `Teachers` named range from a multi-column union (`A4:A10,B4:B10...`) to one clean single-column roster range.
   - Keep the visible roster at the top of the `Deployment` sheet, but make Excel dropdowns point to that single continuous list so Excel/Google Sheets reliably update after names are overwritten.
   - Apply actual data validation to Setter and Marker cells across all 60 mock rows.

3. **Regenerate and verify the XLSX**
   - Rebuild `public/templates/setters-markers-template.xlsx` from the script.
   - Verify the workbook contains 15 rows for each of T1, T2, T3, and T4.
   - Verify the workbook XML contains list validation for Term, Assessment, Stream, Setter, and Marker.
   - Verify formulas recalculate with zero Excel formula errors.

## Technical details

- Update `scripts-tmp/build-marking-template.py` only as needed, then regenerate the `.xlsx` file.
- Update the visible download labels in `src/routes/oversight.tsx` and `src/routes/oversight.import.tsx` so the UI accurately describes the generated template.
- Do not change import logic or backend behaviour unless verification shows the updated workbook is incompatible.