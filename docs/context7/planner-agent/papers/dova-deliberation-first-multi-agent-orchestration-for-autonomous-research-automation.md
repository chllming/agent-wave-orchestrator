---
summary: 'Converted paper text and source links for DOVA: Deliberation-First Multi-Agent Orchestration for Autonomous Research Automation.'
read_when:
  - Reviewing harness and coordination research source material in the docs tree
  - You want the extracted paper text with source links preserved
topics:
  - blackboard-and-shared-workspaces
  - harnesses-and-practice
kind: 'paper'
title: 'DOVA: Deliberation-First Multi-Agent Orchestration for Autonomous Research Automation'
---
# DOVA: Deliberation-First Multi-Agent Orchestration for Autonomous Research Automation

<Note>
Converted from the source document on 2026-03-21. The repo does not retain downloaded source files; they were fetched transiently, converted to Markdown, and deleted after extraction.
</Note>

## Metadata

| Field | Value |
| --- | --- |
| Content type | Paper / report |
| Authors | Aaron Shen, Alfred Shen |
| Year | 2026 |
| Venue | arXiv 2603.13327 |
| Research bucket | P0 direct hits |
| Maps to | Deliberation-first orchestration, iterative refinement, and transparent coordination for autonomous research. |
| Harness fit | Useful as a modern hybrid between harness design and blackboard-style coordination. |
| Source page | [Open source](https://arxiv.org/abs/2603.13327) |
| Source PDF | [Open PDF](https://arxiv.org/pdf/2603.13327.pdf) |

## Extracted text
### Page 1

DOVA: Deliberation-First Multi-Agent Orchestration

for Autonomous Research Automation

Aaron Shen 1 Alfred Shen 2

Abstract

Large language model (LLM) agents have demon-

strated remarkable capabilities in tool use, rea-

soning, and code generation, yet single-agent

systems exhibit fundamental limitations when

confronted with complex research tasks demand-

ing multi-source synthesis, adversarial verifica-

tion, and personalized delivery. We present

DOVA (Deep Orchestrated Versatile Agent), a

multi-agent platform introducing three innova-

tions: (1) deliberation-first orchestration, where

explicit meta-reasoning precedes tool invocation,

informed by a persistent user model and entity-

aware conversation context; (2) hybrid collabora-

tive reasoning, a composable three-phase pipeline

unifying ensemble diversity, blackboard trans-

parency, and iterative refinement; and (3) adap-

tive multi-tiered thinking, a six-level token-budget

allocation scheme reducing inference cost by 40–

60% on simple tasks while preserving deep rea-

soning capacity. We formalize the core algo-

rithms, present an architectural ablation study

across seven system configurations, and analyze

the contribution of each component to answer con-

fidence, source coverage, and token efficiency.

1. Introduction

The rapid advancement of large language models

(LLMs) (Brown et al., 2020; Anthropic, 2024a) has enabled

a new generation of autonomous agents capable of reason-

ing, tool use, and multi-step planning (Yao et al., 2023b;

Schick et al., 2023). However, deploying these agents for

complex research automation—where a single query may

require searching academic databases, analyzing code repos-

itories, cross-referencing model registries, and synthesiz-

ing findings with citations—exposes several limitations of

1

University of California, Berkeley, USA 2

Amazon

Web Services, USA. Correspondence to: Aaron

Shen <aaron.shen@berkeley.edu>, Alfred Shen <al-

freshe@amazon.com>.

Preprint. March 17, 2026.

single-agent architectures:

• Linear reasoning. A single agent processes informa-

tion sequentially, missing cross-domain connections.

• Premature commitment. Without adversarial chal-

lenge, agents accept initial findings without verifica-

tion.

• Reflexive tool invocation. Standard REACT

loops (Yao et al., 2023b) trigger tools based on key-

word patterns rather than deliberate need assessment.

• Fixed computation cost. Identical reasoning depth

for trivial and complex queries wastes tokens on the

former and starves the latter.

We present DOVA, a multi-agent platform designed to ad-

dress these limitations.

1.1. Contributions

1. Deliberation-first orchestration (§5.2). A meta-

reasoning layer that deliberates—using a persistent

user model and entity-aware context—before invoking

any tool, reducing unnecessary API calls and enabling

context-aware follow-ups.

2. Hybrid collaborative reasoning (§5.3). A compos-

able three-phase pipeline (ensemble → blackboard →

iterative refinement) combining breadth, transparency,

and depth of multi-round critique.

3. Adaptive multi-tiered thinking (§5.4). A six-

level token-budget allocation with automatic task-

complexity selection, achieving significant token sav-

ings on simple tasks.

4. Diversity-aware memory retrieval (§5.6).

MMR (Carbonell & Goldstein, 1998) reranking

over a multi-tier memory architecture with embedding-

based semantic search.

5. Unified multi-modal interface (§6). Four cohesive

access modalities—REST API, CLI, browser UI, and

MCP server—sharing a single orchestration backend,

with seamless Claude Code integration via dynamic

plugin (Anthropic, 2024b).

1

arXiv:2603.13327v1 [cs.AI] 4 Mar 2026

### Page 2

DOVA: Deliberation-First Multi-Agent Orchestration

2. Preliminaries

Definition 2.1 (Agent). An agent A = (π, T, M) is a tuple

of a policy π (an LLM with a system prompt), a tool set

T = {t1,..., tm}, and a memory store M.

Definition 2.2 (Reasoning Trace). A reasoning trace τ =

(s0, a1, o1, s1,..., an, on, sn) is an alternating sequence of

thought states si ∈ S, actions ai ∈ Aact ∪ {conclude},

and observations oi ∈ O.

Definition 2.3 (Confidence Function). A confidence func-

tion C: R × P → [0, 1] maps a response r and prompt p to

a scalar quality estimate.

Let Q denote user queries, D the data sources (ArXiv,

GitHub, HuggingFace, Web), and U a user model capturing

expertise, preferences, and history.

Problem. Given query q ∈ Q, user model u ∈ U, and

context ξ, produce response r∗ maximizing:

r∗ = arg max

r∈R

C(r, q) · Cov(r, D) s.t. cost(r) ≤ B(q),

(1)

where Cov(r, D) measures source coverage and B(q) is a

query-adaptive token budget.

3. Related Work

LLM Reasoning. Chain-of-thought prompting (Wei et al.,

2022) demonstrated that intermediate reasoning steps im-

prove LLM performance. REACT (Yao et al., 2023b) inter-

leaved reasoning with tool actions. Tree of Thoughts (Yao

et al., 2023a) and Language Agent Tree Search (Zhou et al.,

2023) extended this to tree-structured exploration. Reflex-

ion (Shinn et al., 2023) added verbal self-reflection, Self-

Refine (Madaan et al., 2023) showed LLMs can critique

their own outputs, and Self-Consistency (Wang et al., 2023)

introduced majority voting. Wei et al. (2026) provide a

comprehensive taxonomy of agentic reasoning along foun-

dational, self-evolving, and collective dimensions, and a sur-

vey of long chain-of-thought reasoning (Chen et al., 2025)

traces the evolution from standard CoT to extended reason-

ing in models such as OpenAI O1 and DeepSeek-R1. DOVA

augments REACT with (a) a deliberation step that reasons

about whether to invoke tools and (b) multi-component

confidence scoring with self-reflection.

Multi-Agent Systems. Multi-agent debate (Du et al.,

2023; Liang et al., 2023) improves factuality. CAMEL (Li

et al., 2023) explored role-playing communication. Gen-

erative Agents (Park et al., 2023) simulated behavior with

memory. MetaGPT (Hong et al., 2023) assigned software

roles. AutoGen (Wu et al., 2023) provided conversation-

based multi-agent frameworks. A recent survey (Tran et al.,

2025) categorizes collaboration mechanisms into coopera-

tion, competition, and coordination protocols, while Dang

et al. (2025) propose centralized orchestration with rein-

forcement learning. Orogat et al. (2026) provide a uni-

fied benchmark showing that framework-level architectural

choices (e.g., message routing, memory sharing) can in-

crease latency by up to 100×, underscoring the importance

of deliberation-aware orchestration. Unlike these systems

which employ a single collaboration pattern, DOVA com-

poses three patterns into a hybrid pipeline with a delib-

eration layer determining when multi-agent reasoning is

warranted.

Tool-Augmented LLMs. Toolformer (Schick et al., 2023)

trained LLMs to self-annotate tool calls. Gorilla (Patil et al.,

2023) fine-tuned on API documentation. ToolLLM (Qin

et al., 2023) scaled to 16,000+ APIs. MCP (Anthropic,

2024b) standardized tool integration; Hou et al. (2025)

provide a systematic landscape analysis and threat taxon-

omy, while MCP-Universe (Luo et al., 2025) offers the first

comprehensive benchmark across real-world MCP servers.

DOVA leverages MCP but introduces deliberation-first tool

selection.

Adaptive Computation. Adaptive Computation

Time (Graves, 2016) introduced variable compute for

RNNs. Pause tokens (Goyal et al., 2023) allocated extra pro-

cessing. Recent work on budget-guided thinking (Li et al.,

2025), token-budget-aware reasoning (Han et al., 2024),

and a survey of adaptive test-time compute (Alomrani

et al., 2025) confirm that variable token budgets improve

efficiency–quality trade-offs. Sleep-time compute (Lin

et al., 2025) extends this to pre-computation, while Zhu

et al. (2025) provide the first systematic study of test-time

scaling specifically for LLM agents. DOVA applies this at

the system level through a six-tier thinking budget.

4. System Architecture

Figure 1 illustrates the layered architecture.

4.1. Agent Layer

All agents inherit from a common base providing two

mixins: ReasoningMixin (implements the REACT loop

with self-reflection and a working-memory scratchpad) and

MemoryMixin (access to the enhanced memory service).

Five specialized agents compose the agent pool: (1) Re-

searchAgent—multi-source search via MCP servers with

query-type classification; (2) ProfilingAgent—user model

management via persistent memory; (3) ValidationAgent—

code analysis and sandboxed execution; (4) Synthesis-

Agent—narrative generation with source attribution; (5) De-

bateAgent—adversarial Bull-vs-Bear analysis.

2

### Page 3

DOVA: Deliberation-First Multi-Agent Orchestration

Figure 1. Layered architecture of DOVA. Queries enter through the Interface Layer, pass through Orchestration (with deliberation),

dispatch to specialized agents, which leverage collaborative reasoning and intelligence services.

Table 1. Model tier configuration.

Task Type Tier Max Tok. Temp.

Classification Basic 10K 0.0

Summarization Basic 20K 0.3

Chat Standard 40K 0.7

Code Gen. Advanced 80K 0.2

Reasoning Advanced 40K 0.7

4.2. Model Tiering

DOVA routes LLM calls through a tiering system that maps

task types to model classes (Table 1).

5. Core Algorithms

5.1. ReAct Reasoning with Self-Reflection

The foundational reasoning loop extends REACT (Yao et al.,

2023b) with a terminal self-reflection step. Each agent main-

tains a scratchpad—a working memory that accumulates

observations.

The trace confidence is the mean over per-step confidences:

¯c(τ) =

1

|{ci}|

X

i

ci, ci ∈ [0, 1]. (2)

Algorithm 1 ReAct Reasoning with Self-Reflection

Require: Problem q; max iterations N; reflect flag ϕ

Ensure: Reasoning trace τ, answer r, confidence ¯c

τ ← ∅; pad ← ∅

for i = 1 toN do

(si, ai, ci) ← THINK(q, τ, pad)

τ ← τ ∪ {(THOUGHT, si, ci)}

if ai = conclude then

r ← si; break

end if

oi ← ACT(ai) {execute tool}

τ ← τ ∪ {(ACT, ai), (OBS, oi)}

pad ← pad ∪ {oi}

end for

if ϕ and r exists then

(r′, crit) ← REFLECT(r, q, τ)

τ ← τ ∪ {(REFL, crit)}; r ← r′

end if

¯c ← 1

|τc|

P

ci

return (τ, r, ¯c)

3

### Page 4

DOVA: Deliberation-First Multi-Agent Orchestration

5.2. Deliberation-First Orchestration

The key innovation of DOVA’s

ThinkingOrchestrator is an explicit delibera-

tion step preceding all tool invocation. Unlike standard

REACT agents that reflexively call tools, the orchestrator

first assesses whether external information is necessary.

Algorithm 2 Deliberation-First Orchestration

Require: Query q; user model u; context ξ; sources D′

Ensure: Deliberation δ

exp ← FORMATEXPERTISE(u)

ent ← FORMATENTITIES(ξ)

rec ← RECENTTURNS(ξ, k=6)

Tavail ← DISCOVERTOOLS(D′)

δ ← LLM DELIBERATE(q, exp, ent, rec, Tavail)

if CHECKMANDATORYTRIGGERS(q) then

δ.action ← USE TOOLS

end if

return δ

The mandatory trigger function detects temporal keywords

(“latest,” “recent,” year patterns ≥2025), specificity mark-

ers (“specific papers”), and real-time queries that always

warrant tool invocation.

Proposition 5.1 (Tool Call Reduction). Let fd be

the fraction of queries where deliberation selects

RESPOND DIRECTLY. The expected tool-call volume rel-

ative to a standard REACT agent is (1 − fd), achieving cost

savings proportional to fd · ctool, where ctool is the average

cost per tool-augmented response.

5.3. Hybrid Collaborative Reasoning

DOVA composes three collaboration patterns into a single

pipeline.

Phase 1: Ensemble. Multiple agents solve the problem

independently in parallel. The agreement score quantifies

consensus:

A(c1,..., cn) = max

0, 1 − Var(c1,..., cn)



. (3)

Phase 2: Blackboard. Results are posted to a shared

workspace where agents contribute evidence and votes.

Each post carries a weighted confidence:

w(p) = cbase(p) ·

1 + ¯a(p)

2

, ¯a(p) =

1

|Vp|

X

v∈Vp

vagree, (4)

where cbase is the agent’s self-assessed confidence and ¯a is

mean agreement from peer votes (vagree ∈ [−1, 1]) (Hayes-

Roth, 1985).

Phase 3: Iterative Refinement. The top-ranked synthesis

is iteratively refined through multi-round critique.

Algorithm 3 Hybrid Collaborative Reasoning

Require: Problem q; agents {Ai}; max iter. K; context ξ

Ensure: Result r∗, confidence c∗, agreement A

{Phase 1: Ensemble}

(ˆr, {ci}, dissent) ← ENSEMBLE(q, {Ai}, ξ)

A ← 1 − Var({ci})

{Phase 2: Blackboard}

BB.clear()

POST(HYPO, ˆr, ¯c)

for d ∈ dissent do

POST(EVID, d, 0.3)

end for

rbb ← SYNTHESIZEBB(BB)

{Phase 3: Iterative Refinement}

r∗ ← ITERREFINE(rbb, {A1, A2}, min(2, K))

c∗ ← 1

2 (¯cens + citer)

return (r∗, c∗, A)

Table 2. Thinking levels and token budgets (2–4× scaling per

level).

Level Budget Typical Tasks

OFF 0 Embeddings

MINIMAL 1,024 Classification

LOW 4,096 Summarization

MEDIUM 16,384 Code generation

HIGH 32,768 Reasoning, research

XHIGH 65,536 Complex analysis

5.4. Adaptive Multi-Tiered Thinking

DOVA allocates reasoning compute via a six-level budget

(Table 2).

The selection function maps a task to a thinking level:

Formally, the budget function is:

B(t, h, q) = BUD



clamp

β(t)+ α(h)+ γ(q), 0, 5



, (5)

where β: Ttask → {0,..., 5} maps task types, α:

H → {−1, 0, 1, 2} adjusts for complexity, and γ: Q →

{−1, 0, 1} adjusts for query length.

5.5. Multi-Component Confidence Scoring

The self-evaluation service computes confidence as:

C(r, p) =

P

k wk · fk(r, p)

P

k wk

, (6)

4

### Page 5

DOVA: Deliberation-First Multi-Agent Orchestration

Algorithm 4 Adaptive Thinking Level Selection

Require: Task type t; query q; complexity hint h

Ensure: Level ℓ and budget b

L ← [OFF, MIN, LOW, MED, HI, XH]

base ← TASKDEFAULTS[t]

adj ← 0

if h = simple then

adj ← adj − 1

end if

if h = complex then

adj ← adj + 1

end if

if h = very complex then

adj ← adj + 2

end if

if |q| > 2000 then

adj ← adj + 1

end if

if |q| < 50 then

adj ← adj − 1

end if

idx ← clamp(indexOf(base) + adj, 0, 5)

ℓ ← L[idx]; b ← BUDGETS[ℓ]

return (ℓ, b)

with four components:

flen(r) = clip



|r|

τlen

, 0.2, 1.0



, (7)

fref (r) = 1 − 0.7 · ⊮[∃ k∈Kref: k⊆r], (8)

ffmt(r, φ) = format check(r, φ), (9)

frel(r, p) = min



1, |kw(r)∩kw(p)|

0.3·|kw(p)|



. (10)

A response is acceptable when C(r, p) ≥ θmin (default 0.6).

When C < 0.7, iterative query refinement triggers (up to 2

rounds).

5.6. Diversity-Aware Memory Retrieval

The enhanced memory stores entries in three tiers: short-

term (TTL = 86,400s), long-term (persistent), and proce-

dural (reusable skills).

Retrieval uses cosine similarity reranked with MMR (Car-

bonell & Goldstein, 1998). Recent work on agent memory

beyond RAG (Hu et al., 2026) decouples memories into se-

mantic components; DOVA takes a complementary approach

with tiered storage and diversity-aware retrieval:

MMR(di) = λ·sim(di, q) − (1−λ)·max

dj∈S

sim(di, dj), (11)

where sim(a, b) = a·b/(∥a∥∥b∥), S is the set of already-

selected results, and λ ∈ [0, 1] (default 0.5) controls the

relevance–diversity trade-off.

Algorithm 5 MMR-Enhanced Semantic Memory Search

Require: Query q; top-k; λ; memory M

Ensure: Ranked results R

eq ← EMBED(q)

sc ← {(m, sim(eq, em)): m ∈ M}

Sort sc by similarity descending

S ← ∅; R ← ∅

while |R| < k and sc ̸= ∅ do

d∗ ← arg maxd∈sc λ · sim(d, q) − (1−λ) ·

maxd′∈S sim(d, d′)

R ← R ∪ {d∗}; S ← S ∪ {d∗}

sc ← sc \ {d∗}

end while

return R

Table 3. Query type to source routing.

Type ArXiv GitHub HF Web

Technical ✓ ✓ ✓ ✓

News ✓

Biographical ✓

Factual ✓ ✓

General ✓ ✓ ✓ ✓

5.7. Query Intent Classification

The research agent classifies queries to route to appropriate

sources:

t∗(q) = arg max

t∈Tq

X

k∈Kt

⊮[k ∈ q↓] + bonus(q, t), (12)

where Tq = {tech., news, bio., fact., gen.}, q↓ is the low-

ercased query, and bonus(q, bio.) = 2 · ⊮[is person(q)].

Table 3 shows the source routing.

5.8. Multi-Round Adversarial Debate

The debate agent implements a Bull-vs-Bear pattern for

evaluative queries. Inspired by financial analysis practice,

two adversarial agents—Bull (advocate) and Bear (critic)—

argue opposing positions across multiple rounds. Each agent

receives the accumulated arguments of its opponent, forcing

direct engagement with counterpoints rather than indepen-

dent monologues.

The sequential turn-taking is critical: in round r, the

Bull agent conditions on all prior Bear arguments B<r

ear,

and vice versa. This creates an implicit convergence

dynamic—arguments that survive multiple rounds of ad-

versarial scrutiny carry higher epistemic weight in the final

synthesis.

The synthesis step aggregates both argument sets into a struc-

tured output containing: (i) a balanced summary, (ii) sur-

viving strengths (Bull arguments not effectively rebutted),

5

### Page 6

DOVA: Deliberation-First Multi-Agent Orchestration

Algorithm 6 Multi-Round Adversarial Debate

Require: Topic q; context ξ; rounds R (default 2)

Ensure: Conclusion: summary, strengths, concerns, confi-

dence

Bull ← ∅; Bear ← ∅

for r = 1 toR do

br ← BULLAGENT.ARGUE(q, ξ, Bear)

Bull ← Bull ∪ {br}

kr ← BEARAGENT.ARGUE(q, ξ, Bull)

Bear ← Bear ∪ {kr}

end for

return SYNTHESIZE(Bull, Bear)

Table 4. Interface modalities.

Interface Access Key Features

REST API HTTP 15+ endpoints, OAuth2

CLI Terminal CoT display, sessions

Browser UI Web Source chips, badges

MCP Server Stdio 5 tools, plugin arch.

(iii) validated concerns (Bear arguments not adequately ad-

dressed), and (iv) an overall confidence score reflecting

argument balance. We default to R=2 rounds, as empiri-

cally the marginal information gain diminishes beyond two

rounds while token cost grows linearly.

This pattern draws on multi-agent debate research (Du et al.,

2023; Liang et al., 2023), extending it with structured syn-

thesis and integration into the broader orchestration pipeline

via the deliberation layer, which determines when adversar-

ial analysis is warranted versus simpler reasoning modes.

6. Interface Modalities

DOVA exposes its orchestration engine through four inter-

faces sharing the same backend (Table 4).

6.1. Claude Code Integration via Dynamic Plugin

The MCP server (Anthropic, 2024b) exposes

five tools to Claude Code: dova research,

dova search, dova debate, dova validate,

and dova web search. Communication uses stdio

transport with lazy initialization.

The plugin architecture provides: (i) a plugin.json

manifest; (ii) an.mcp.json server configuration;

(iii) custom slash-command skills (/dova-research,

/dova-debate); (iv) a custom agent definition enabling

autonomous multi-source research.

This creates a bidirectional integration: Claude Code in-

vokes DOVA as a tool provider, while DOVA uses Claude

models as its LLM backbone—each system augmenting the

other.

6.2. Interactive CLI

The interactive CLI provides a seven-step chain-of-thought

pipeline: (1) Observe—parse input; (2) Recall—search

memory; (3) Reason—CoT analysis; (4) Plan—select ac-

tion; (5) Act—execute tools; (6) Reflect—evaluate qual-

ity; (7) Respond—generate output. Session commands

(/status, /thinking, /orchestrator) provide

runtime control.

7. Experiments and Evaluation

We evaluate DOVA through an architectural ablation and

reasoning mode comparison.

7.1. Setup

Models. Claude Sonnet 4.6 (Standard tier), Claude

Opus 4.6 (Advanced tier), and Claude Haiku 4.5 (Basic

tier).

Baselines. (1) Single-LLM: one Claude Opus call;

(2) REACT-only: standard REACT without deliberation

or collaboration; (3) Ensemble-only: parallel multi-agent

without blackboard or iterative refinement.

Metrics. Answer confidence (C), source coverage (Cov),

token efficiency, latency, refinement rate, and error recovery

rate.

7.2. Ablation Study

Table 5 presents the architectural ablation across seven con-

figurations.

Key findings. (1) Collaboration is highest-impact: re-

moving it drops confidence by 0.14 and coverage by

0.25. (2) Self-evaluation prevents degradation: without

it, low-quality responses reach the user (refinement rate

18%→35%). (3) Adaptive thinking is a pure efficiency gain:

fixed MEDIUM reduces token efficiency by 32% with mini-

mal confidence impact. (4) Deliberation reduces cost: re-

moving it increases latency by 19% and decreases efficiency

by 27% through unnecessary tool invocations. (5) ReAct is

foundational: single-pass causes the largest confidence drop

(0.82→0.58).

7.3. Reasoning Mode Comparison

Table 6 compares the four reasoning modes that DOVA ex-

poses, each representing a different point on the quality–cost

Pareto frontier.

Quick mode uses a single agent with minimal thinking

budget and no tool invocation, suitable for simple factual

6

### Page 7

DOVA: Deliberation-First Multi-Agent Orchestration

Table 5. Architectural ablation study. Each row removes one component. Values represent expected relative performance based on

architectural analysis. ↑ = higher is better; ↓ = lower is better. Bold indicates full-system values.

Configuration Reasoning Collab. Think Conf.↑ Cov.↑ Tok.Eff.↑ Lat.(s)↓

DOVA-Full ✓ ✓ Adaptive 0.82 0.90 0.71 12.4

−Collaboration ✓ — Adaptive 0.68 0.65 0.74 6.1

−Thinking (fixed Med) ✓ ✓ Fixed 0.79 0.88 0.48 11.8

−Memory ✓ ✓ Adaptive 0.75 0.85 0.65 11.2

−Deliberation ✓ ✓ Adaptive 0.77 0.90 0.52 14.8

−Self-Eval ✓ ✓ Adaptive 0.70 0.88 0.69 10.1

−ReAct (single pass) — — — 0.58 0.45 0.80 3.2

Single-LLM baseline — — — 0.52 0.00 0.85 1.8

Table 6. Reasoning mode comparison. Confidence and token

consumption are averaged across a mixed workload of factual,

technical, and evaluative queries.

Mode Agents Conf. Lat. Tok.

Quick 1 0.52 1.8s 2K

Standard 1 0.68 6.5s 12K

Deep N 0.78 18.3s 45K

Collaborative N 0.82 24.1s 65K

recall or conversational follow-ups. Standard mode enables

the full REACT loop with self-reflection and tool access,

providing a 31% confidence gain over Quick at 6× the token

cost. Deep mode activates multiple agents with ensemble

reasoning but without the blackboard or iterative refinement

phases, achieving a further 15% confidence improvement.

Collaborative mode engages the complete hybrid pipeline

(Algorithm 3), yielding the highest confidence at the cost of

32.5× the tokens of Quick mode.

The confidence gap between Standard and Collaborative

(0.68 vs. 0.82) highlights the value of multi-agent reason-

ing for complex queries, while the gap between Quick and

Standard (0.52 vs. 0.68) demonstrates that tool access and

self-reflection are individually high-value. The delibera-

tion layer (§5.2) automatically selects the appropriate mode

based on query complexity, ensuring that simple queries de-

fault to Quick or Standard while research-intensive queries

escalate to Deep or Collaborative.

7.4. Token Efficiency Analysis

Figure 2 illustrates the token savings from adaptive thinking

level selection (Algorithm 4) compared to a fixed MEDIUM

baseline across five representative task types.

The savings are most pronounced for lightweight tasks: clas-

sification drops from 16K to 1K tokens (94% reduction) and

summarization from 16K to 4K (75%), since these tasks

require only MINIMAL and LOW thinking budgets respec-

tively. For complex tasks (reasoning and research), the

adaptive system allocates HIGH budgets (33K), exceeding

the fixed 16K baseline—this is the intended behavior, as un-

Classif.

Summ.

Code

Reason.

Research

0

10

20

30

40

1

4

16

33 33

16 16 16 16 16

Tokens (K)

Adaptive

Fixed

Figure 2. Token consumption: adaptive vs. fixed MEDIUM. Adap-

tive saves 94% on classification and 75% on summarization.

derspending on hard tasks degrades answer quality (Table 5,

row 2).

The key insight is that adaptive allocation is not uniformly

cheaper. Rather, it redistributes tokens from tasks that do

not benefit from deep reasoning to tasks that do. Under

a realistic workload where 40–60% of queries are simple

(classification, summarization, or short factual lookups), the

aggregate token savings reach 40–60% with no measurable

confidence loss (Table 5: 0.82 vs. 0.79). Code generation

consumes 16K under both schemes because its default level

(MEDIUM) already matches the fixed baseline.

7.5. Component Interaction Effects

We observe notable interactions:

• Deliberation × Collaboration: Removing both

is worse than the sum of individual removals—

deliberation gatekeeps expensive collaborative reason-

ing.

• Memory × Self-Eval: Memory provides context

that improves evaluation accuracy. Without it, false-

positive retries increase.

• Thinking × Tiering: Adaptive thinking (depth within

a model) is complementary to model tiering (which

model), providing two-dimensional cost optimization.

7

### Page 8

DOVA: Deliberation-First Multi-Agent Orchestration

8. Discussion

Deliberation as meta-cognition. The deliberation-first

approach represents meta-reasoning—the system reasons

about whether to reason. This parallels human metacogni-

tive monitoring, where experts assess their knowledge state

before consulting external sources (Shinn et al., 2023).

Composition over specialization. Rather than a single

monolithic pattern, DOVA’s hybrid approach composes sim-

ple, well-understood patterns (ensemble, blackboard, iter-

ative) into a pipeline with emergent capabilities exceeding

any individual pattern.

Cost-aware intelligence. Model tiering + adaptive think-

ing provides two-dimensional cost control. Organizations

can set budget constraints knowing the system degrades

gracefully.

8.1. Limitations

1. Self-evaluation circularity. Confidence scoring uses

the same LLM that generated the response. External

signals (user feedback) would strengthen assessment.

2. Ablation scope. Our ablation is based on architectural

analysis rather than large-scale benchmarks. Evalua-

tion on standard benchmarks (HotpotQA, MMLU) and

emerging agent evaluation frameworks (Ferrag et al.,

2025) remains future work.

3. Memory scalability. In-memory MMR search has

O(n · k) complexity; indexing is needed for very large

stores.

4. Agent homogeneity. All agents share the same LLM

backbone. Heterogeneous models could improve en-

semble diversity.

9. Conclusion

We presented DOVA, a multi-agent platform for autonomous

research automation introducing deliberation-first orches-

tration, hybrid collaborative reasoning, and adaptive multi-

tiered thinking. The architectural ablation demonstrates that

collaborative reasoning is the highest-impact component,

while adaptive thinking and deliberation provide significant

efficiency gains without sacrificing quality.

Future directions include: persistent user models learn-

ing from feedback; heterogeneous agent ensembles mix-

ing LLM providers; streaming deliberation display; multi-

modal context integration; and comprehensive benchmark-

ing on standard multi-hop QA datasets.

DOVA is available as open-source software under

Apache 2.0 at https://github.com/alfredcs/

dova.

References

Alomrani, M. A., Zhang, Y., Li, D., Sun, Q., Pal, S., Zhang,

Z., Hu, Y., Ajwani, R. D., Valkanas, A., et al. Reasoning

on a budget: A survey of adaptive and controllable test-

time compute in LLMs. arXiv preprint arXiv:2507.02076,

2025.

Anthropic. The Claude model family: Technical report.

Technical report, Anthropic, 2024a.

Anthropic. Model context protocol specification.

Technical report, Anthropic, 2024b. https://

modelcontextprotocol.io.

Brown, T., Mann, B., Ryder, N., Subbiah, M., Kaplan, J. D.,

Dhariwal, P., Neelakantan, A., Shyam, P., Sastry, G.,

Askell, A., et al. Language models are few-shot learners.

In Advances in Neural Information Processing Systems,

volume 33, pp. 1877–1901, 2020.

Carbonell, J. and Goldstein, J. The use of MMR, diversity-

based reranking for reordering documents and producing

summaries. In Proceedings of the 21st Annual Interna-

tional ACM SIGIR Conference on Research and Develop-

ment in Information Retrieval, pp. 335–336, 1998.

Chen, Q., Qin, L., Liu, J., et al. Towards reasoning era: A

survey of long chain-of-thought for reasoning large lan-

guage models. arXiv preprint arXiv:2503.09567, 2025.

Dang, Y., Qian, C., Luo, X., Fan, J., Xie, Z., Shi, R., Chen,

W., Yang, C., Che, X., Tian, Y., et al. Multi-agent col-

laboration via evolving orchestration. arXiv preprint

arXiv:2505.19591, 2025.

Du, Y., Li, S., Torralba, A., Tenenbaum, J. B., and Mor-

datch, I. Improving factuality and reasoning in lan-

guage models through multiagent debate. arXiv preprint

arXiv:2305.14325, 2023.

Ferrag, M. A., Tihanyi, N., and Debbah, M. From LLM

reasoning to autonomous AI agents: A comprehensive

review. arXiv preprint arXiv:2504.19678, 2025.

Goyal, S., Ji, Z., Rawat, A. S., Menon, A. K., Kumar,

S., and Naber, V. Think before you speak: Training

language models with pause tokens. arXiv preprint

arXiv:2310.02226, 2023.

Graves, A. Adaptive computation time for recurrent neural

networks. arXiv preprint arXiv:1603.08983, 2016.

Han, T., Wang, Z., Fang, C., et al. Token-budget-aware

LLM reasoning. arXiv preprint arXiv:2412.18547, 2024.

Hayes-Roth, B. A blackboard architecture for control. Arti-

ficial Intelligence, 26(3):251–321, 1985.

8

### Page 9

DOVA: Deliberation-First Multi-Agent Orchestration

Hong, S., Zhuge, M., Chen, J., Zheng, X., Cheng, Y., Zhang,

C., Wang, J., Wang, Z., Yau, S. K. S., Lin, Z., et al.

MetaGPT: Meta programming for a multi-agent collab-

orative framework. arXiv preprint arXiv:2308.00352,

2023.

Hou, X., Zhao, Y., Wang, S., and Wang, H. Model context

protocol (MCP): Landscape, security threats, and future

research directions. arXiv preprint arXiv:2503.23278,

2025.

Hu, Z., Zhu, Q., Yan, H., et al. Beyond RAG for agent

memory: Retrieval by decoupling and aggregation. arXiv

preprint arXiv:2602.02007, 2026.

Li, G., Hammoud, H. A. A. K., Itani, H., Khizbullin, D., and

Ghanem, B. CAMEL: Communicative agents for “mind”

exploration of large language model society. Advances in

Neural Information Processing Systems, 36, 2023.

Li, J., Zhao, W., Zhang, Y., and Gan, C. Steering

LLM thinking with budget guidance. arXiv preprint

arXiv:2506.13752, 2025.

Liang, T., He, Z., Jiao, W., Wang, X., Wang, Y., Wang,

R., Yang, Y., Tu, Z., and Shi, S. Encouraging divergent

thinking in large language models through multi-agent

debate. arXiv preprint arXiv:2305.19118, 2023.

Lin, K., Snell, C., Wang, Y., et al. Sleep-time compute:

Beyond inference scaling at test-time. arXiv preprint

arXiv:2504.13171, 2025.

Luo, Z., Shen, Z., Yang, W., et al. MCP-Universe:

Benchmarking large language models with real-world

model context protocol servers. arXiv preprint

arXiv:2508.14704, 2025.

Madaan, A., Tandon, N., Gupta, P., Hallinan, S., Gao,

L., Wiegreffe, S., Alon, U., Dziri, N., Prabhumoye, S.,

Yang, Y., et al. Self-refine: Iterative refinement with self-

feedback. In Advances in Neural Information Processing

Systems, volume 36, 2023.

Orogat, A., Rostam, A., and Mansour, E. Understanding

multi-agent LLM frameworks: A unified benchmark and

experimental analysis. arXiv preprint arXiv:2602.03128,

2026.

Park, J. S., O’Brien, J. C., Cai, C. J., Morris, M. R., Liang,

P., and Bernstein, M. S. Generative agents: Interactive

simulacra of human behavior. In Proceedings of the 36th

Annual ACM Symposium on User Interface Software and

Technology, pp. 1–22, 2023.

Patil, S. G., Zhang, T., Wang, X., and Gonzalez, J. E. Go-

rilla: Large language model connected with massive APIs.

arXiv preprint arXiv:2305.15334, 2023.

Qin, Y., Liang, S., Ye, Y., Zhu, K., Yan, L., Lu, Y., Lin, Y.,

Cong, X., Tang, X., Qian, B., et al. ToolLLM: Facilitating

large language models to master 16000+ real-world APIs.

arXiv preprint arXiv:2307.16789, 2023.

Schick, T., Dwivedi-Yu, J., Dess`ı, R., Raileanu, R., Lomeli,

M., Hambro, E., Zettlemoyer, L., Cancedda, N., and

Scialom, T. Toolformer: Language models can teach

themselves to use tools. In Advances in Neural Informa-

tion Processing Systems, volume 36, 2023.

Shinn, N., Cassano, F., Gopinath, A., Narasimhan, K., and

Yao, S. Reflexion: Language agents with verbal rein-

forcement learning. In Advances in Neural Information

Processing Systems, volume 36, 2023.

Tran, K.-T., Dao, D., Nguyen, M.-D., Pham, Q.-V.,

O’Sullivan, B., and Nguyen, H. D. Multi-agent collabo-

ration mechanisms: A survey of LLMs. arXiv preprint

arXiv:2501.06322, 2025.

Wang, X., Wei, J., Schuurmans, D., Le, Q., Chi, E.,

Narasimhan, S., Chowdhery, A., and Zhou, D. Self-

consistency improves chain of thought reasoning in lan-

guage models. In International Conference on Learning

Representations, 2023.

Wei, J., Wang, X., Schuurmans, D., Bosma, M., Ichter, B.,

Xia, F., Chi, E., Le, Q., and Zhou, D. Chain-of-thought

prompting elicits reasoning in large language models.

In Advances in Neural Information Processing Systems,

volume 35, pp. 24824–24837, 2022.

Wei, T., Li, T.-W., Liu, Z., Ning, X., Yang, Z., Zou, J., Zeng,

Z., Qiu, R., Lin, X., Fu, D., et al. Agentic reasoning for

large language models. arXiv preprint arXiv:2601.12538,

2026.

Wu, Q., Bansal, G., Zhang, J., Wu, Y., Li, B., Zhu, E., Jiang,

L., Zhang, X., Zhang, S., Liu, J., et al. AutoGen: Enabling

next-gen LLM applications via multi-agent conversation.

arXiv preprint arXiv:2308.08155, 2023.

Yao, S., Yu, D., Zhao, J., Shafran, I., Griffiths, T. L., Cao,

Y., and Narasimhan, K. Tree of thoughts: Deliberate

problem solving with large language models. Advances

in Neural Information Processing Systems, 36, 2023a.

Yao, S., Zhao, J., Yu, D., Du, N., Shafran, I., Narasimhan,

K., and Cao, Y. ReAct: Synergizing reasoning and act-

ing in language models. In International Conference on

Learning Representations, 2023b.

Zhou, A., Yan, K., Shlapentokh-Rothman, M., Wang, H.,

and Wang, Y.-X. Language agent tree search unifies rea-

soning, acting, and planning in language models. arXiv

preprint arXiv:2310.04406, 2023.

9

### Page 10

DOVA: Deliberation-First Multi-Agent Orchestration

Zhu, K., Li, H., Wu, S., et al. Scaling test-time compute for

LLM agents. arXiv preprint arXiv:2506.12928, 2025.

10
