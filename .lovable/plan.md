## Plan

Fix the Assessment Builder so Combined Science always exposes all three LO sets — Physics, Chemistry, and Biology — as separate selectable lists with their own Select all controls.

## What I found

- The current builder loads topics from the selected paper first.
- If that paper has only Physics-linked topics, the LO selector only receives Physics topics.
- The recent grouping UI can only group whatever topics it receives, so it cannot show Chemistry/Biology if they were filtered out upstream.

## Changes to implement

1. **Detect Combined Science syllabus selections**
   - Treat Combined Science documents/papers as a multi-discipline syllabus when the document or paper contains Physics/Chemistry/Biology sections.

2. **Load the full Combined Science LO universe**
   - For Combined Science, use document-level topics for the LO/topic pool instead of only the selected paper’s topics.
   - This restores Physics, Chemistry, and Biology together even when the selected paper/component is tagged to one discipline.

3. **Remove accidental discipline narrowing for Combined Science LOs**
   - Keep the active section selector from hiding Biology/Chemistry/Physics in the LO selector.
   - Ensure the auto-selected topic pool includes all three disciplines by default.

4. **Keep three separate LO lists**
   - Preserve the `LOGroupedSelector` discipline grouping.
   - Ensure it renders Physics, Chemistry, and Biology as separate expandable lists, each with its own checkbox to select/deselect all LOs in that discipline.

5. **Validate the behavior**
   - Check the builder code path for a Combined Science paper and verify the topic/LO pool no longer collapses to only one discipline.
   - No database migration needed; this is a frontend data-selection bug.