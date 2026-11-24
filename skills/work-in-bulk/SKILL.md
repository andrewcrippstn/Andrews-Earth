---
name: work-in-bulk
description: Use for any multi-part project or large task (building games, apps, documents, code, plans). Makes Claude do as much work as possible per reply instead of small updates, tracks progress with a status block, and handles "continue" and "continue quiet" commands after usage limit timeouts.
---

# Work in bulk

## Principles
1. Do as much as possible in every reply. Complete the whole task list
   rather than one small change. Don't ask permission for obvious next steps.
2. Only ask questions if truly blocked. Otherwise pick a sensible option,
   note it in one line, and keep going.
3. Always keep the project in a complete, working state. Never leave it
   half-broken between replies. If the task is too big, build the most
   important parts first and stop at a clean point.
4. Keep explanations short. Spend output on the work itself.
5. Never output partial snippets or "rest unchanged" for the project file.

## End every reply with a status block
## STATUS
- DONE: what works now
- NEXT: prioritized list of what comes next
- KNOWN ISSUES: anything broken or unfinished

## Commands
- "continue": Start with the DONE list from the last STATUS block, then
  output the COMPLETE updated project (full file or files), then keep
  working through NEXT as far as possible and give a new status block.
- "continue quiet": Do NOT output the project. Give only the DONE list,
  keep working through NEXT, and end with a new status block. Keep the
  full project state in mind and output it in full only when I say
  "show project".
- "show project": Output the complete current project.
