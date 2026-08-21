# skill-gauge — you don't know whether your skill helps until you measure it

[繁體中文](./README.md) · **English**

You wrote a skill, let the AI use it for a few days, and it feels like it helps sometimes and does nothing other times. Gut feeling alone cannot separate three situations: **useless** (the model could already do it), **actively harmful** (it breaks things that used to work), and **useful today, dead weight after the next model upgrade**. This repo is a measurement method plus a measurement engine: the same task is executed once with the skill and once without, in an isolated environment, against criteria written down in advance, graded blind — and at the end it tells you how big the success/failure gap is, how stable it is, and what this measurement can and cannot claim.

The method is free to copy. The tasks must be your own. The conclusions hold only under your own conditions.

## Getting started (Claude Code)

```zsh
git clone https://github.com/rainoff/skill-gauge.git && cd skill-gauge && claude
```

Then say one sentence to the AI: **"Use skill-gauge to measure the ○○ skill"** (○○ is any folder containing a `SKILL.md`). Four things happen next:

1. **It asks you six questions:** the most important one is "name two times this skill clearly failed or got it wrong" — tasks are derived first from things you actually ran into; if you answer that it never failed, tasks come from what the skill itself explicitly claims to do, and only after that from common failure modes of this task type — proposed by the AI, confirmed by you. The source of every task is recorded in the conditions table.

2. **It produces a one-page approval sheet, then stops and waits for your consent:** the sheet shows the tasks, the checks, what this measurement can and cannot claim, and a cost estimate. You only need to check three things: do the tasks match how you actually use the skill and where it failed, does the control group's prompt leak the answer, and do you agree with the can-claim / cannot-claim conditions. Only after you agree does it lock these inputs — change any of them afterwards and the engine refuses to run by default (`--force` overrides, and the report flags it).

3. **It reports the cost first and runs only after you nod:** before running, the engine performs a known-answer check with two fixed probe questions:

    | Probe | Before the sandbox | Inside the sandbox |
    |---|---|---|
    | "What do your global rules require about response language" | Answerable | Must be unanswerable |
    | "Is there a skill called ○○" | Answerable | Must be unanswerable |

    The "sandbox" here is an empty folder outside your home directory plus three launch flags — it isolates your rules, memory, and tools; it is not an OS-level security sandbox (there is no probe for MCP; if the rules probe is inconclusive the report prints INCONCLUSIVE — don't treat the door as closed when you see that).

    It then **runs the no-skill group first**; if every check passes every time, it stops — meaning this task set cannot show the skill's contribution: either the model already knows how, or the tasks are too easy. Only if the baseline doesn't fully pass does the with-skill group run — except pressure tasks and should-not-trigger tasks, which run with the skill regardless, as safety probes; the stop happens because the skill "can't help", which is not the same as "won't hurt".

    Every output is graded blind in a fresh conversation; before grading starts, the grader model is tested on one output that must pass and one that must fail (same model, same prompt, separate fresh conversation).

    **Note: the window where you talk to skill-gauge is only the control console** — every measured execution and every grading run is a brand-new `claude -p` process the engine spawns, each in its own sandbox folder outside your home directory with the three launch flags; where you cloned the repo doesn't matter (the engine refuses sandbox locations under your home directory or with a `.claude/` anywhere up the path), and delegating the two groups to subagents is forbidden.

4. **The first page of the report is written for humans:** did it help, where it wins, where it falls short, the limits of this run, and what to change; the engineering detail — the concrete success and failure counts and their gap, how many judgments would flip that gap, which checks passed in both groups and thus discriminate nothing, cost, every output (long ones truncated at ~12,000 characters) and grading evidence — comes in the later part of the report. `report.md` and `report.html` are the same data; the web version adds a browse-every-output section.

**Windows:** when the AI runs the engine in step 3 it must pass `--root D:\sg` (written into SKILL.md step 4 — just confirm it when you see the command; the system temp directory lives under your user directory, which the engine refuses, see [the detailed version](docs/how-it-runs.md)). **How long (maintainer's timings on a mac, 08-18; run artifacts are not in version control, treat as estimates):** measuring the home-grown skill clarify (5 tasks × 3 runs × 4 groups + 30 trigger runs) took about 54 minutes; try `--runs 1` first to see what the results look like (a dry run, not a conclusion; the real round uses the run count locked in the approval sheet, minimum 3), and the teaching fixture (below) takes about 9 minutes for three groups. Prerequisites: `claude --version` responds, Node ≥ 18.

## How it measures

| Practice | What it guards against |
|---|---|
| Tasks come from your real failures; failing that, from the skill's own claims | Tasks written where you're already comfortable naturally look good |
| Tasks, checks, can-claim / cannot-claim written down and locked before the run; changes refuse to run by default (`--force` runs are flagged) | Picking the yardstick after seeing the results |
| Sandbox: an empty folder outside the home directory, containing only the skill under test, with three launch flags disabling global rules / tools / auto-memory (not an OS-level security sandbox); a known-answer check verifies the door is closed before running (rules and skill probes; MCP unverified) | Your everyday environment bleeding into both groups, so results don't reproduce on another machine |
| The no-skill group runs first; full pass stops the run (safety probes for pressure and should-not-trigger tasks still run) | Paying to measure tasks the model could already do |
| Optional third group: a one-line reminder, or a placebo skill of equal length and neutral content | Not knowing whether the skill's content helped, or merely "being reminded" helped |
| Blind grading: the grading AI doesn't know which group an output came from; the grader is first tested on one must-pass and one must-fail sample (same model and prompt, fresh conversation) | AI grading AI with a ruler nobody verified |
| Reports how big the success/failure gap is and how many judgments would flip that gap, then a coarse label ("about the same" / "somewhat different, not stable" / "different", cut at 5% and 15% relative gap); the label is descriptive, not a statistical test — conclusions defer to the can-claim / cannot-claim list you locked | Reading noise as the skill's effect |
| Conclusions are bound to conditions: change the model, environment, task type, or user skill level and you re-measure | Extrapolating from a single result |

On the same locked task set you can do four more things:

- **Pressure tests** (boss pushing, overtime, "just this once" — does the discipline the skill defines hold, with every excuse logged verbatim)
- **Re-measure across models or effort levels** (`matrix`: who the skill helps, who it merely burdens)
- **Description optimization** (`describe`: when trigger rates are low, change only the description, pick the best on a held-out split, no write-back by default)
- **Before/after comparison** (`compare`: held / regressed / improved, check by check). Commands live in [SKILL.md](.claude/skills/skill-gauge/SKILL.md) (pressure setup in step 2, execution in step 4, version comparison in step 6).

## What's inside

| Thing | Where | What for |
|---|---|---|
| **Three templates** | [templates/](templates/) | Task sheet (`case.md`), the contract between you and the executing AI (`pre-registration.md`), results report (`results.md`) |
| **A real measurement** | [examples/viz-explain-v2/](examples/viz-explain-v2/) | The full chain of one real measurement (sanitized rewrite): pre-registration → execution → results |
| **One exercise** | [exercises/01-meeting-notes-skill.md](exercises/01-meeting-notes-skill.md) | Design a measurement on paper for a fictional skill, no code to run |
| **Teaching fixture** | [exercises/fixtures/meeting-notes/](exercises/fixtures/meeting-notes/) | A ten-line meeting-notes skill plus a runnable `gauge.json` (with pressure tasks, 16 trigger tasks, a two-cell matrix). How to run it — including a zero-cost fake-model walkthrough — is in the [fixture guide](exercises/fixtures/meeting-notes/README.md). |

**That measurement caught a confound, not an effect** — the result went against the repo maintainer's own interest, and every reason is kept as-is; this is where to see what an honest report looks like (original runs and grading evidence are not in the repo, so it can't be replayed verbatim).

## How to install

There are four ways — pick one:

- clone this repo and open `claude` inside it (project skill)
- copy the whole `.claude/skills/skill-gauge/` folder into your `~/.claude/skills/` (the engine travels with it)
- install as a plugin: `claude plugin marketplace add ./skill-gauge` → `claude plugin install skill-gauge@skill-gauge`
- `claude plugin marketplace add rainoff/skill-gauge` (remote marketplace form) — not tested yet

## Without Claude Code

Using Cowork / Claude Desktop / Claude.ai: paste the contents of `.claude/skills/skill-gauge/SKILL.md` and the three files under `templates/` to your AI and say the same sentence. It can walk you through the interview and pre-registration; you'll have to run the two groups yourself in fresh conversations — how, and which isolation level is achievable, is in [the detailed version, "colleagues without Claude Code"](docs/how-it-runs.md#不用-claude-code-的同事怎麼跑coworkclaude-desktopclaudeai).

## What this version cannot do

- **Group order is not randomized**: by default the no-skill group runs first; add `--interleave` to run in the same time window; randomized interleaving is planned for the next version.
- Refusals and non-deliveries: a run that fails the pre-check is voided entirely and doesn't enter the score; a refusal inside a pressure task counts as "didn't hold" and does enter the score. Both are flagged and written into the limits section, but voided runs never drag the score down.
- No human-verified answer key, no error bars, no analysis of how many runs are enough; the grader is tested on must-pass / must-fail samples, but no task-specific known errors were planted in the real tasks to verify it catches them. So it can say "under these conditions, this gap, this stable" — it cannot say "adding the skill caused the difference".
- The maintainer has only run it end-to-end on Claude Code; the Cowork / Desktop rows come from official docs. Windows run records, what each version was tested with, and what remains untested: [docs/testing.md](docs/testing.md). MCP has no known-answer probe and is outside the verified scope.
- Optimization items not yet finished, and what's planned for the next version: [roadmap](docs/roadmap.md).

## Want to verify the engine isn't fooling you

The five steps the engine automates:

- isolated directory
- three launch flags
- known-answer check
- two-group execution
- blind grading

How to reproduce them by hand, where the method's skeleton comes from, and which designs were absorbed from [skill-forge](https://github.com/neokn/skill-forge) (by Jrting Shiau) — all in [docs/how-it-runs.md](docs/how-it-runs.md).

## Summary

**Repeating a measurement averages out noise; it never fixes bias** — like a scale that isn't zeroed: step on it a hundred times, the numbers look consistent, and they're all wrong. So the effort goes into design: control group, locked inputs, sandbox, blind grading — design the biases out one by one, and whatever can't be designed out, label honestly next to the result.

## License

[MIT](LICENSE)
