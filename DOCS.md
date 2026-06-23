# Lumière — Documentation Index

One entry point for every planning doc. **Read in this order.** Each doc has a single job;
if two docs disagree, the "source of truth" column wins for that topic.

| Doc | Job | Source of truth for |
|---|---|---|
| [README.md](README.md) | How to run it | setup, run command, API quick ref |
| [FINAL_PLAN.md](FINAL_PLAN.md) | **The build plan** (master) | milestones, decisions, scope, delivery layer |
| [SPEC.md](SPEC.md) | The contract | data shapes, enums, API request/response, business rules |
| [BLUEPRINT.md](BLUEPRINT.md) | Wiring | button↔function↔API mapping, **authoritative counts** |
| [INVENTORY.md](INVENTORY.md) | What exists | feature/sub-feature catalogue |
| [ROADMAP.md](ROADMAP.md) | Work breakdown | epics E0–E8, nested to-dos, **Gap Audit §G** |

**Rule:** code is checked against SPEC + BLUEPRINT. If code and a doc disagree, that's a bug
in one of them — fix the mismatch, don't fork behavior. Counts come from BLUEPRINT (44 client
functions, 54 total); other docs defer to it.
