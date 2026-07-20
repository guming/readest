# Readest One Question Quiz PRD

## 1. Document Information

- Product: Readest Desktop and iOS
- Feature: One Question / 问我一个
- Status: Draft for product and engineering review
- Priority: P0
- Related areas: Reader, Notebook Assistant, Notebook Cards, reading context, source anchors

## 2. Product Summary

Readest currently supports generating several quiz questions from the current
chapter. The existing experience resembles a generated test: users create a
question set, answer every question, submit the set, receive a score, and then
open the answers.

This PRD proposes a new primary experience called **One Question**. Instead of
asking readers to start a test, Readest asks one worthwhile, source-grounded
question about what they just read. The user answers, receives immediate and
specific feedback, and can return to the exact supporting passage.

The product promise is:

> Every question is worth pausing for, can be verified from the text, and helps
> the reader see what they understood or missed.

The existing multi-question Chapter Quiz remains available as a secondary
study action during the transition. It is not the primary entry point for
general readers.

## 3. Problem

### 3.1 User problem

Long-form reading creates an illusion of understanding. A passage can feel
clear while it is visible, but the reader may be unable to explain, apply, or
distinguish its central idea after looking away.

At the same time, most readers do not want their reading app to behave like a
school examination. A five-question set, mandatory completion, delayed
feedback, and a numeric score create unnecessary commitment and evaluation
pressure.

Readers need a low-friction way to:

- check whether they understood an important idea
- pause and think without starting a formal test
- receive useful feedback even when their answer is incomplete
- verify the feedback against the source
- continue reading without accumulating study tasks

### 3.2 Existing product problems

The current implementation has four material limitations:

1. The generation contract specifies output shape but does not sufficiently
   constrain importance, cognitive value, evidence, difficulty, distractor
   quality, or duplicate questions.
2. Short answers are graded with normalized exact string equality. Semantically
   correct paraphrases can therefore be marked incorrect.
3. Chapter text is supplied as flattened text without stable paragraph-level
   evidence identifiers, so questions cannot reliably jump back to their
   supporting passage.
4. The interface displays the entire set and delays feedback until every
   question is answered and submitted.

## 4. Product Hypothesis

If Readest offers one relevant question at a natural reading boundary, gives
immediate evidence-based feedback, and lets the user return to the source, then
readers will engage in active thinking without experiencing the feature as an
exam.

We expect this to improve:

- first-question completion
- repeat voluntary use
- return-to-source behavior
- trust in AI feedback
- continued reading after interaction

## 5. Goals and Non-goals

### 5.1 Goals

1. Reduce the commitment required to try a reading question.
2. Generate questions about important ideas rather than incidental facts.
3. Ensure every scored question is verifiable from supplied reading context.
4. Accept semantically equivalent short answers.
5. Provide immediate, constructive, and concise feedback.
6. Return users to the relevant source passage after uncertainty or error.
7. Support both knowledge-oriented and narrative reading without forcing the
   same question style on both.
8. Capture lightweight quality feedback for future personalization.

### 5.2 Non-goals

P0 does not attempt to:

- create a full curriculum or reading-plan system
- build spaced repetition or a large permanent question bank
- provide high-stakes academic assessment
- grade essays or long-form writing
- generate questions from an entire library at once
- infer medical, cognitive, or attention conditions from reading behavior
- automatically interrupt reading with modal questions
- guarantee useful questions for every page or chapter
- provide offline question generation or semantic grading; P0 is online-only
  and degrades explicitly when the configured provider is unavailable

## 6. Target Users and Jobs

### 6.1 Primary users

#### Curious non-fiction reader

Job: "Help me see whether I really understood the idea without turning reading
into homework."

#### Student or professional learner

Job: "Show me the exact part I missed and let me try again."

#### Reader returning after an interruption

Job: "Help me reactivate the important idea before I continue."

### 6.2 Secondary users

#### Fiction reader

Job: "Help me notice motives, clues, and possibilities without spoiling future
content."

#### Research reader

Job: "Challenge the claim, evidence, or assumption rather than asking me to
recall trivia."

## 7. Product Principles

### 7.1 One worthwhile question beats five filler questions

The requested question count is a maximum. Readest may return no question when
the available text does not support a useful one.

### 7.2 Questions support reading; they do not police it

Users can skip, ask for a hint, say they do not know, view the source, or reject
the grading. No streak or overdue state is created.

### 7.3 Source before authority

AI feedback must point to supporting text. Unsupported interpretation must be
marked as interpretation and must not be scored as a factual answer.

### 7.4 Meaning before wording

Open answers are evaluated against semantic answer points, not a single exact
sentence.

### 7.5 Feedback should repair understanding

An incorrect label without a path forward is not sufficient. Feedback identifies
what the user understood, the most important missing point, and the next action.

### 7.6 Reading mode changes the interaction

Knowledge content can use scored comprehension and application questions.
Narrative content should prefer prediction, motive, and clue questions, which
may have no correct answer.

## 8. Core Experience

### 8.1 Entry points

P0 provides three non-blocking entry points:

1. Reader selection menu: **Ask me about this**
2. Notebook Review primary action: **Ask me one**
3. Page or chapter completion affordance: **Check my understanding**

The application must not automatically open a question over the reading view.
An optional inline affordance may appear at a section boundary, but the user
must initiate the interaction.

### 8.2 Pre-question choice

The default action immediately creates the recommended question. A secondary
menu offers:

- Quick check: recall or central-idea question, about 30-60 seconds
- Test understanding: explanation, distinction, or application, about 1-2 minutes
- Challenge the author: assumption, evidence, or counterexample, about 1-2 minutes

For narrative content, the menu becomes:

- Notice a clue
- Read a character
- Make a prediction

P0 may launch with only **Quick check** and **Test understanding** if content
classification is not sufficiently reliable.

### 8.3 Question card

Only one active question is shown.

Required elements:

- scope label: selection, page, or chapter
- question style label, such as Understand or Apply
- question text
- expected time, such as "About 1 minute"
- response control
- actions: Hint, I don't know, Skip

The response control is:

- selectable cards for multiple choice
- two explicit localized choices for true/false
- a multiline input for short answers

The UI must not require an answer before Skip or View source is available.

All new controls must meet the existing Readest accessibility and e-ink
contracts:

- selectable answers use native radio-group semantics and support keyboard
  navigation, focus indication, screen-reader labels, and RTL layout
- true/false uses localized visible labels while storing canonical boolean values
- cards, custom inputs, and secondary controls use the existing `eink-bordered`
  convention under `[data-eink='true']`
- the primary submit action uses the existing `btn-primary` convention
- hierarchy cannot depend on color, hover, shadow, or animation alone

### 8.4 Immediate response

Submission evaluates only the current question. The result is displayed without
another "Show answers" action.

Feedback contains:

1. Understanding state
2. What the user got right
3. One most important missing or mistaken point
4. A concise explanation
5. A source preview and **View in book** action
6. Next actions

Example:

> Mostly understood
>
> You identified that external rewards can replace intrinsic motivation. The
> missing condition is that the reward is experienced as controlling; the
> author does not claim that every reward reduces motivation.

Available next actions:

- Try again
- Give me an example
- View in book
- Ask another
- Continue reading

### 8.5 Result language

Numeric scores are not shown in the primary flow. Use:

- Understood
- Mostly understood
- Partly understood
- Revisit this idea
- No reliable judgment

For predictions or interpretations, use:

- Plausible reading
- Supported by the text so far
- Possible, but not yet supported
- Save prediction

### 8.6 User correction

Every semantic judgment provides a subtle **Not quite?** action with:

- Count my answer as understood
- The question is ambiguous
- The feedback missed my meaning
- The question is too easy
- The question is too trivial
- The source does not support this

A user override changes the local result and is recorded as quality telemetry
when usage tracking is enabled. It must not silently rewrite the generated
question or original model result.

## 9. Question Strategy

### 9.1 Cognitive levels

Questions are classified independently from UI input type:

- recall: retrieve a central fact or definition
- understand: explain an idea in the reader's own words
- distinguish: separate easily confused concepts
- apply: use an idea in a new but bounded example
- challenge: identify an assumption, weakness, or counterexample
- predict: anticipate a narrative event or consequence
- interpret: explain motive, tone, clue, or significance

Default knowledge-content mix over repeated use:

- 15% recall
- 30% understand
- 20% distinguish
- 25% apply
- 10% challenge

This is not a per-generation quota. The immediate question is selected based on
the content and recent question history.

P0 keeps a lightweight local history of the most recent 20 question objective
fingerprints per book. A normalized fingerprint is derived from
`learningObjective` plus the referenced source-block IDs. **Ask another** must
exclude exact fingerprints and reject near-duplicate objectives before showing
the next question. This history is local, bounded, and is not a mastery model.

### 9.2 Content-aware strategy

| Content type | Preferred questions | Avoid |
| --- | --- | --- |
| Concept explanation | Understand, distinguish, apply | Isolated wording recall |
| Argument | Assumption, evidence, counterexample | Author-name trivia |
| History/biography | Cause, consequence, motive, chronology | Unimportant dates |
| Narrative fiction | Motive, clue, prediction, interpretation | Future spoilers |
| Procedure | Next step, diagnosis, scenario | Decorative detail |
| Data/evidence | Interpretation, limits, conclusion support | Number memorization without purpose |
| Essay/poetry | Tone, metaphor, interpretation | Single authoritative interpretation |

### 9.3 Quality requirements

Every generated question must:

- map to one explicit learning or reflection objective
- be answerable from the allowed context unless explicitly marked interpretive
- include one or more valid source block IDs
- include a short supporting quote
- explain why the question is worth asking
- avoid relying on knowledge outside the supplied context
- avoid testing page furniture, repeated headers, copyright notices, or OCR noise
- avoid duplicating a recent question about the same objective
- use language appropriate to the configured target language

Multiple-choice questions additionally must:

- contain three or four unique choices
- identify the correct choice by stable ID, not by copied choice text
- have one unambiguous best answer
- use plausible distractors tied to likely misunderstandings
- avoid "all of the above" and "none of the above"
- explain each distractor after submission

Short-answer questions additionally must:

- define required semantic answer points
- define common misconceptions when supported
- avoid requiring an exact phrase unless the phrase itself is the learning target
- remain answerable in approximately one to three sentences

### 9.4 Abstention

Readest does not generate a scored question when:

- the context is too short or lacks a meaningful claim, concept, event, or decision
- source extraction is mostly noise
- the evidence needed for an answer is missing
- the model cannot provide a valid supporting quote
- a stable source location cannot be preserved for a scored question

User-facing response:

> There isn't enough meaningful text here for a useful question. Try the full
> section or continue reading.

## 10. Grounded Context and Generation

### 10.1 Source blocks

Quiz context must preserve structure instead of supplying only flattened text.

```ts
interface QuizSourceBlock {
  id: string;
  text: string;
  heading?: string;
  sourceAnchor: SourceAnchor;
}
```

Blocks should normally represent a paragraph, list, table caption, or other
meaningful reading unit. A source anchor includes book, section, CFI or PDF
location, page when available, and a quote snippet.

### 10.2 Generation stages

The logical generation process has two stages:

1. Identify important, distinct objectives supported by source blocks.
2. Generate and validate one question for the best objective and requested
   question style.

P0 may execute both stages in one model request for latency and cost, provided
the structured response includes the objective and evidence fields. A later
version may separate objective extraction and question generation for caching.

### 10.3 Generation response

```ts
interface GeneratedQuizQuestion {
  id: string;
  type: 'multiple_choice' | 'true_false' | 'short_answer';
  sourceLanguage: string;
  questionLanguage: string;
  cognitiveLevel:
    | 'recall'
    | 'understand'
    | 'distinguish'
    | 'apply'
    | 'challenge'
    | 'predict'
    | 'interpret';
  learningObjective: string;
  whyWorthAsking: string;
  question: string;
  choices?: Array<{
    id: string;
    text: string;
    explanation: string;
  }>;
  correctChoiceId?: string;
  acceptedAnswers?: string[];
  answerKey?: {
    requiredPoints: Array<{
      id: string;
      meaning: string;
      weight: number;
    }>;
    commonMisconceptions: Array<{
      id: string;
      meaning: string;
    }>;
  };
  sourceBlockIds: string[];
  evidenceQuote: string;
  explanation: string;
  generationConfidence: number;
}
```

### 10.4 Client-side validation

Before rendering, Readest validates:

- referenced source blocks exist
- the evidence quote occurs in the referenced blocks after safe normalization
- choices are valid and unique
- the correct choice ID exists
- true/false answers use the defined value set
- short answers contain at least one required answer point
- required strings are non-empty and within UI length limits
- generation confidence meets the configured minimum
- question and objective are not near-duplicates of recent local questions

Invalid questions are discarded. P0 does not make a hidden automatic retry
unless the additional cost behavior is disclosed in settings and usage tracking.

## 11. Answer Evaluation

### 11.1 Deterministic grading

Readest grades these locally:

- multiple choice by stable choice ID
- true/false by canonical boolean value
- bounded factual answers by normalized accepted-answer list

Normalization may include case, Unicode form, punctuation, full-width forms,
and surrounding whitespace. It must not use fuzzy text similarity as proof of
semantic correctness.

### 11.2 Semantic grading

Open short answers are evaluated using a second, smaller request containing
only:

- question
- learning objective
- required answer points
- common misconceptions
- supporting source blocks
- user answer

The evaluator must not introduce additional book knowledge.

P0 uses the user's configured provider and model for semantic grading. It does
not silently route answers to a different provider or model. The request uses
the smallest sufficient context: question, answer key, cited source blocks, and
user answer. If the configured model cannot meet the grading latency or quality
contract, Readest degrades to self-assessment rather than making a definitive
judgment. A separately configurable lower-cost evaluator is deferred until
provider/model benchmarking demonstrates a need.

```ts
interface SemanticGrade {
  result:
    | 'correct'
    | 'mostly_correct'
    | 'partial'
    | 'incorrect'
    | 'uncertain';
  confidence: number;
  matchedPointIds: string[];
  missingPointIds: string[];
  misconceptionIds: string[];
  feedback: string;
}
```

Rules:

- Feedback evaluates meaning, not wording or writing style.
- Feedback must acknowledge genuinely matched points.
- Feedback identifies at most one primary missing point in the compact view.
- An uncertain result is not counted as incorrect.
- Low-confidence judgments expose user override and source comparison.
- The evaluator cannot alter the original answer key.

### 11.3 Cross-language answers

The language of the source, interface, question, and user answer may differ.
P0 must support the common case of an English source with a Chinese interface
and a Chinese answer.

The generation response records `sourceLanguage` and `questionLanguage`. The
semantic evaluator is instructed to:

- judge semantic content independently of the answer language
- compare translated meaning against the same required answer points
- accept code-switching and established untranslated terms
- avoid penalizing grammar, fluency, or translation style unless language use
  is explicitly the tested objective
- preserve names, quotations, formulas, and technical terms when translation
  would change their meaning
- return feedback in the configured target language

If the evaluator cannot confidently align a cross-language answer with the
answer key, it returns `uncertain`; it must not guess or mark the answer wrong.
This policy should be implemented through the existing non-expendable Reedy
policy-layer pattern so it survives prompt shrinkage.

### 11.4 No semantic evaluator available

If the configured provider cannot complete semantic grading, Readest must not
fall back to exact-string grading for open answers. It displays:

> Compare with the key idea

The user self-reports:

- I got it
- Partly
- I missed it

This same fallback applies when generation succeeded but grading later times
out, is cancelled, returns an invalid response, or exceeds the latency budget.
Readest preserves the user's entered answer, shows the reference key and source,
and records the degraded path when usage tracking is enabled.

## 12. Hints and Repair Flow

Hints are progressive:

1. Direction hint: names the relevant distinction or perspective without giving
   the answer.
2. Source hint: previews the relevant paragraph with the answer-bearing phrase
   visually concealed when feasible.
3. Reveal: shows the answer and explanation.

After a partial or incorrect answer, the user may:

- retry the same question
- request a simpler rephrasing
- request a concrete example
- view the source
- continue without saving the result

P1 may add a scaffold question generated from the same objective. P0 does not
automatically branch into additional questions.

## 13. Narrative and Spoiler Safety

For fiction and narrative content:

- retrieval and generation context must be filtered to content at or before the
  current reading position
- future sections must not be sent to the generation request
- prediction and interpretation questions are not graded against future events
- saved predictions can be revisited after the relevant reveal
- feedback uses "supported so far" rather than "correct"

Prompt instructions alone are not considered sufficient spoiler protection.
The context builder must enforce the reading-position boundary.

## 14. Persistence and Privacy

### 14.1 Default persistence

P0 stores the active question in component state. It is not automatically added
to Notebook Cards.

The user may explicitly save:

- a question worth remembering
- a missed idea
- a prediction
- the source-backed explanation

Saved state preserves the user answer, result, source anchors, provider, model,
and generation timestamp.

### 14.2 Data handling

- The UI shows whether selection, page, or chapter context will be sent.
- Only the required blocks are sent for semantic grading.
- Full-book content is not sent for P0 One Question.
- Usage telemetry must not contain source text, question text, or user answer.
- User corrections and quality labels are recorded only when usage tracking is enabled.

## 15. Functional Requirements

### 15.1 P0 requirements

- OQ-001: User can request one question from a selection, current page, or current chapter.
- OQ-002: UI displays only one active question.
- OQ-003: User can submit, skip, request a hint, or say "I don't know."
- OQ-004: Submission produces immediate feedback for the current question.
- OQ-005: Every scored question contains a validated source anchor and evidence quote.
- OQ-006: User can preview and jump to supporting source text.
- OQ-007: Multiple choice uses stable choice IDs for grading.
- OQ-008: Open answers are semantically evaluated or explicitly self-assessed.
- OQ-009: Low-confidence judgments are not displayed as definite incorrect results.
- OQ-010: User can challenge or override an AI judgment.
- OQ-011: Generator can abstain instead of filling a requested quota.
- OQ-012: User can ask another question without saving the previous one.
- OQ-013: Existing Chapter Quiz remains accessible as a secondary action.
- OQ-014: Usage limits, cancellation, provider configuration, and token warnings continue to apply.
- OQ-015: Saved questions retain source anchors and result provenance.
- OQ-016: Ask another excludes recent exact and near-duplicate learning objectives.
- OQ-017: Cross-language answers are semantically graded without language-fluency penalties.
- OQ-018: Grading failure preserves the user answer and degrades to self-assessment.
- OQ-019: P0 clearly communicates that generation and semantic grading require connectivity.

### 15.2 P1 requirements

- content-aware knowledge and narrative question strategies
- personalized deduplication beyond the bounded P0 local history
- question-style preference
- simple adaptive difficulty based on recent results
- scaffold question after a misconception
- revisit saved predictions
- delayed re-questioning for explicitly saved missed ideas

### 15.3 P2 requirements

- cross-book questions grounded in explicit source sets
- reader-level concept memory
- personalized question-style ranking
- offline/local semantic evaluator when supported
- aggregate understanding view without gamified pressure

## 16. UX States

Required states:

- idle: One Question call to action and source scope
- generating: cancellable progress with provider and estimated use
- question ready
- grading: cancellable semantic evaluation
- grading failed: preserve the submitted answer and offer self-assessment
- feedback: understood, partial, revisit, uncertain, or interpretive
- no useful question
- invalid generated response
- source unavailable or stale
- provider unavailable
- usage limit reached

If a source anchor becomes stale, the saved question remains readable but the
jump action is disabled with an explicit explanation.

### 16.1 Latency service-level objectives

Latency is measured from the user's action until the next interactive state,
excluding user answer time. Targets apply on a supported network and exclude
provider-wide outages:

| Transition | p70 target | p90 target | Required fallback |
| --- | ---: | ---: | --- |
| Request question -> question ready | <= 4 s | <= 8 s | Cancellable loading; retain reading position |
| Submit deterministic answer -> feedback | <= 100 ms | <= 250 ms | Local grading only |
| Submit open answer -> semantic feedback | <= 3 s | <= 6 s | Preserve answer; degrade to self-assessment |
| View in book -> anchored source visible | <= 500 ms | <= 1.5 s | Show source preview if navigation is unavailable |

At the p90 grading budget, the client stops waiting for an authoritative result
and offers self-assessment. A late response must not overwrite a user override
or a self-assessed result. Latency is evaluated separately by provider/model;
models that consistently miss the SLO remain usable for generation but do not
receive definitive semantic-grading UI.

## 17. Success Metrics

### 17.1 North-star signal

Percentage of completed questions for which the user either:

- asks another question
- views the supporting source
- saves the idea
- continues reading within five minutes

This measures whether the question creates useful reading activity rather than
isolated quiz consumption.

The signal is reported as separate components as well as a composite. **Ask
another** only qualifies when the next objective passes P0 deduplication. The
continue-reading component uses an explicit Continue reading action or verified
reader progress, not merely an open reader window.

### 17.2 Primary metrics

- question request to first-answer completion rate
- median time to answer
- Ask another rate
- View in book rate after partial or incorrect feedback
- continue-reading rate after feedback
- seven-day repeat use among first-time users
- next reading session within 24 hours after a completed interaction
- percentage of generated questions passing client validation
- Ask another near-duplicate rate

### 17.3 Quality and trust guardrails

- user-reported unsupported question rate
- user-reported ambiguous question rate
- grading override rate
- "feedback missed my meaning" rate
- trivial or too-easy rate
- generation abstention rate by source type
- semantic grader uncertain rate
- evaluator false-incorrect rate against the human-rated evaluation set
- evaluator/answer-key disagreement rate
- invalid source-anchor rate
- spoiler report rate
- reading abandonment within two minutes of entering the feature

Numeric correctness rate is diagnostic, not a product success metric.

## 18. Analytics Events

When usage tracking is enabled, record metadata without content:

- `one_question_requested`: scope, content class, requested style, provider, model
- `one_question_generated`: type, cognitive level, latency, token estimate
- `one_question_abstained`: reason
- `one_question_answered`: answer mode, response time; no answer text
- `one_question_graded`: result, confidence bucket, latency
- `one_question_grading_failed`: timeout, invalid response, provider, or cancellation reason
- `one_question_grading_degraded_to_self_assess`: degradation reason and elapsed-time bucket
- `one_question_hint_used`: hint level
- `one_question_source_opened`
- `one_question_retried`
- `one_question_asked_another`
- `one_question_continued_reading`
- `one_question_saved`: saved type
- `one_question_feedback`: quality label
- `one_question_grade_overridden`: override reason

Book identity should follow the existing privacy treatment used by Notebook
Assistant usage tracking.

## 19. Experiment Plan

### 19.1 Experiment A: One Question versus Chapter Quiz

Population: users who open Notebook Review and have a configured provider.

- Control: Generate Quiz with the configured number of questions
- Variant: Ask me one as primary; Chapter Quiz in overflow menu

Primary comparison:

- first-answer completion
- repeat use within seven days
- continued reading after interaction

Guardrail:

- provider cost per completed interaction

### 19.2 Experiment B: feedback framing

- Control: Correct / Incorrect plus reference answer
- Variant: understanding state plus matched point, missing point, and source action

Measure:

- source-open rate
- retry rate
- grading dispute rate
- Ask another rate

### 19.3 Experiment C: entry point

Compare:

- Notebook-only entry
- user-triggered section-boundary affordance
- selection-menu entry

No variant automatically opens a question.

## 20. Rollout Plan

### Phase 0: Accuracy foundation

- reuse Reedy's `CfiChunker` and `BookRetriever` output as the canonical EPUB
  source-block and navigation foundation instead of building a parallel chunker;
  preserve the existing CFI round-trip validation and spoiler-bound retrieval
- add a thin QuizSourceBlock adapter only where the quiz contract needs fields
  not already present on `RetrievedChunk`
- extend question schema with objective, evidence, and answer key
- implement strict response validation
- use stable choice IDs
- remove exact-string grading for open answers
- add semantic evaluator with uncertain fallback
- implement bounded local recent-objective fingerprints for Ask another
- implement the cross-language evaluation contract
- instrument generation and grading latency, failure, and degradation

Exit criteria:

- at least 95% of rendered scored questions have valid source evidence in the
  internal evaluation corpus
- no open answer is marked incorrect by exact-string comparison
- malformed questions fail closed
- semantic grades reach Cohen's kappa >= 0.60 against two-reviewer adjudicated
  labels on a multilingual internal evaluation set
- false-incorrect rate is <= 5% overall and <= 7% for cross-language answers
- evaluator/answer-key disagreement is <= 5%; ambiguous answer keys are rejected
  before the question is shown
- generation and grading meet the section 16.1 p70 latency SLO on the supported
  provider/model benchmark matrix, or the affected path visibly degrades
- Ask another near-duplicate rate is <= 5% in the internal scripted evaluation

Question-quality gate before Phase 1:

- two human reviewers independently rate a representative multilingual sample
  across EPUB and native-text PDF
- >= 80% of questions are rated "worth pausing for"
- <= 10% are rated trivial or incidental
- <= 5% are rated ambiguous or unsupported
- inter-rater agreement and adjudicated results are recorded with the release
  decision; source validity alone is not sufficient to enter Phase 1

### Phase 1: One-question experience

- make Ask me one the primary Notebook Review action
- render one question at a time
- provide immediate feedback
- add Hint, I don't know, Skip, Try again, View in book, and Ask another
- retain Chapter Quiz as secondary action
- instrument P0 analytics

Exit criteria:

- end-to-end experience works for EPUB and native-text PDF contexts
- saved question can reopen its source
- cancellation and provider failure preserve reading state
- grading timeout or failure preserves the answer and reaches self-assessment
- keyboard, screen-reader, RTL, and `[data-eink='true']` checks pass for every
  new question and feedback state
- seven-day repeat use and Chapter Quiz usage are reported separately so the
  legacy experience can be evaluated for sunset

### Phase 2: Content-aware interaction

- distinguish knowledge and narrative content
- add challenge, prediction, and interpretation styles
- enforce spoiler-safe source boundary
- extend P0 deduplication with personalized semantic history
- add question-quality feedback learning

### Phase 3: Revisit and personalization

- resurface only explicitly saved missed ideas or predictions
- adapt cognitive level and difficulty
- support cross-book questions with explicit sources

## 21. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| AI asks trivia | Low repeat use | Objective selection, `whyWorthAsking`, abstention, quality feedback |
| Valid paraphrase marked wrong | Loss of trust | Semantic answer points, uncertain state, user override |
| Evaluator is too lenient | False sense of mastery | Human-rated calibration set, result-distribution monitoring, confidence threshold |
| Evaluator disagrees with answer key | Arbitrary feedback | Immutable answer key, point-ID contract, disagreement validation, uncertain fallback |
| Evaluator imports outside knowledge | Unsupported judgment | Send only cited blocks, non-expendable policy, source-bound evaluation tests |
| Generator emits a vague answer key | Answers remain perpetually partial | Reject ambiguous keys in validation and human quality gate |
| Unsupported answer | Misinformation | Evidence quote validation and source jump |
| Extra model call increases cost | Reduced adoption | Small grading context, deterministic local grading where possible |
| Question interrupts immersion | Reading abandonment | User-triggered entry and one-question default |
| Fiction question spoils future content | Severe trust damage | Context-level progress filter, not prompt-only protection |
| AI feedback is verbose | Slow interaction | Compact three-part feedback and expandable detail |
| Fixed quotas create filler | Low quality | Question count as maximum and explicit abstention |
| Saved mistakes become clutter | Notebook degradation | Explicit save only; no automatic wrong-answer archive |

## 22. Open Decisions

1. Should the primary label be **Ask me one**, **Check understanding**, or vary
   by locale and reading mode?
2. What minimum anchor fidelity is required before PDF chapter questions are
   enabled?
3. How many recent objectives beyond the P0 default of 20 should be retained
   after product telemetry is available?
4. Should quality feedback influence only local selection or be aggregated into
   prompt evaluation when users opt into telemetry?
5. Should the legacy Chapter Quiz remain indefinitely, or enter deprecation when
   One Question reaches >= 20% seven-day repeat use among first-time completers,
   maintains its quality guardrails for two releases, and fewer than 10% of
   Notebook Review users still initiate Chapter Quiz?

Resolved for P0:

- Semantic grading uses the user's configured provider/model; no hidden lower-cost
  model routing.
- Reflection questions without a verifiable grade are excluded from P0 to keep
  the experiment and north-star signal interpretable.

## 23. Acceptance Scenarios

### Scenario A: Correct paraphrase

Given a short-answer question with two required semantic points, when the user
expresses both points using different wording, the result is Understood and no
exact reference phrase is required.

### Scenario B: Partially correct answer

Given a two-point answer key, when the user expresses one point, the feedback
acknowledges that point, identifies the most important missing point, and offers
View in book and Try again.

### Scenario C: Weak source

Given a copyright page or extraction noise, when the user requests a question,
the generator returns no useful question rather than inventing filler.

### Scenario D: Invalid evidence

Given a generated evidence quote that does not occur in the referenced source
blocks, the client rejects the question and does not render it as source-grounded.

### Scenario E: User disagrees with grading

Given a semantic result, when the user selects "Feedback missed my meaning,"
the local result can be overridden, the original judgment remains in provenance,
and no answer text is included in telemetry.

### Scenario F: Fiction progress boundary

Given a reader at chapter five, when Readest generates a prediction or character
question, no source block after the current reading position is sent or cited.

### Scenario G: No semantic evaluator

Given an open-answer question and an unavailable evaluator, Readest presents a
self-assessment against the key idea and does not use exact-string grading.

### Scenario H: Grading timeout after answer submission

Given a generated question and a submitted answer, when semantic grading exceeds
the p90 budget or fails, Readest keeps the answer visible, offers self-assessment,
records the degraded path when enabled, and ignores any late result after the
user completes self-assessment.

### Scenario I: Cross-language answer

Given an English source and question with a Chinese target language, when the
user answers correctly in Chinese or with mixed Chinese and English technical
terms, Readest evaluates the semantic answer points without penalizing language
choice or grammar.

### Scenario J: Ask another deduplication

Given a recently answered learning objective, when the user selects Ask another,
Readest does not render a question with the same source-objective fingerprint or
a near-duplicate objective.

### Scenario K: E-ink and keyboard operation

Given e-ink mode or keyboard-only navigation, the question card retains crisp
boundaries and visible focus, radio choices expose correct group semantics, and
the primary action remains distinguishable without color, hover, shadow, or
animation.

### Scenario L: Question-quality release gate

Given a release candidate, Phase 1 cannot begin when the human-rated sample
misses the worth-pausing-for, triviality, ambiguity, evidence, or agreement
thresholds defined in Phase 0, even if all source anchors are technically valid.

## 24. Recommended P0 Product Decision

Ship **One Question** as the default general-reader experience with these
non-negotiable capabilities:

1. one active question
2. important-idea selection
3. validated source evidence
4. immediate feedback
5. semantic or self-assessed open answers
6. View in book
7. AI judgment override
8. graceful abstention

Keep multi-question Chapter Quiz available for users who intentionally want a
test. Do not add reading plans, streaks, automatic mistake storage, or scheduled
review until One Question demonstrates repeat voluntary use and trusted feedback.
