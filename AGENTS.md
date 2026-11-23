# AGENTS.md - READ THIS FIRST (any AI assistant working in this repo)

Project: Order-to-Audit System (internship shortlisting task).
A small food factory: salesman order -> GST invoice -> dispatch -> stock, AND
raw material -> BOM production -> finished goods -> costing -> monthly reports.

Before you do ANYTHING in a session:
1. Read docs/AI_CONTEXT.md  (stable rules, domain, benchmark numbers = source of truth).
2. Read docs/PROGRESS.md    (what is done, what is next, how to run, known issues).
3. Work ONLY on the step the user names (or "Next Step" in PROGRESS.md). Never skip ahead.
4. Make small, focused changes. Do not rewrite files you were not asked to touch.
5. When finished: run the checks, update docs/PROGRESS.md (tick step, log, file map,
   next step), then git commit.

If AI_CONTEXT.md and the user's prompt disagree, follow the user's prompt and record the
deviation in PROGRESS.md under Decisions.
If something is ambiguous, pick the simplest reasonable assumption, do NOT stop to ask,
and record it in PROGRESS.md under Assumptions.
Never claim something works unless you ran it.
