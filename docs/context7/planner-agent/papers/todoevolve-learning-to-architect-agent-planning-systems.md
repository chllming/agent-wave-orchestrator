---
summary: 'Converted paper text and source links for TodoEvolve: Learning to Architect Agent Planning Systems.'
read_when:
  - Reviewing harness and coordination research source material in the docs tree
  - You want the extracted paper text with source links preserved
topics:
  - planning-and-orchestration
  - harnesses-and-practice
kind: 'paper'
title: 'TodoEvolve: Learning to Architect Agent Planning Systems'
---
# TodoEvolve: Learning to Architect Agent Planning Systems

<Note>
Converted from the source document on 2026-03-22. The repo does not retain downloaded source files; they were fetched transiently, converted to Markdown, and deleted after extraction.
</Note>

## Metadata

| Field | Value |
| --- | --- |
| Content type | Paper / report |
| Authors | Jiaxi Liu, Yanzuo Jiang, Guibin Zhang, Zihan Zhang, Heng Chang, Zhenfei Yin, Qibing Ren, Junchi Yan |
| Year | 2026 |
| Venue | arXiv 2602.07839 |
| Research bucket | P0 direct hits |
| Maps to | Meta-planning, task-specific planning topology, and dynamic planning revision. |
| Harness fit | Useful when the planning loop itself should adapt instead of staying hand-designed. |
| Source page | [Open source](https://arxiv.org/abs/2602.07839) |
| Source PDF | [Open PDF](https://arxiv.org/pdf/2602.07839.pdf) |

## Extracted text
### Page 1

TodoEvolve: Learning to Architect Agent Planning Systems

TodoRL Team

Abstract

Planning has become a central capability for contemporary agent systems in navigating complex, long-

horizon tasks, yet existing approaches predominantly rely on fixed, hand-crafted planning structures that

lack the flexibility to adapt to the structural diversity of open-ended problems. To address this limitation,

we introduce TodoEvolve, a meta-planning paradigm that autonomously synthesizes and dynamically

revises task-specific planning architectures. Specifically, we first construct PlanFactory, a modular design

space that standardizes diverse planning paradigms within a unified codebase encompassing topology,

initialization, adaptation, and navigation, thereby providing a common interface for heterogeneous plan-

ning patterns. Leveraging PlanFactory, we collect high-quality planning trajectories and train Todo-14B

via Impedance-Guided Preference Optimization (IGPO), a multi-objective reinforcement learning objective

that encourages the generation of planning systems that are performant, stable, and token-efficient across

arbitrary tasks and agent backbones. Empirical evaluations on five agentic benchmarks demonstrate that

TodoEvolve consistently surpasses carefully engineered planning modules while maintaining economical

API costs and runtime overhead.

Date: February 10, 2026

Code: https://github.com/EcthelionLiu/TodoEvolve

1 Introduction

With the rapid advancement of foundation models (Team et al., 2025b,a,c), large language model (LLM)-powered

agents have begun to demonstrate strong capabilities across domains such as deep research (Hu et al., 2025a; Shi

et al., 2025b), complex software engineering (iQuest, 2025; Yang et al., 2024), and real-world transactions Andon

(2025); Backlund and Petersson (2025). Beyond improvements in base model capacity, increasingly sophisticated

agent scaffolds are equally critical (Wang et al., 2025a), equipping LLMs with essential agentic support including

planning (Parmar et al., 2025; Wu et al., 2025b; Erdogan et al., 2025a), memory (Hu et al., 2026a), reflection, etc. Among

these, planning stands out as a central capability, enabling agents to navigate complex environments by maintaining a

coherent global state, preserving behavioral consistency, and coordinating actions across tasks (Cao et al., 2025).

Existing planning systems developed for LLM-based agents exhibit substantial diversity. From the perspective of

planning target, some are designed to support single agent, primarily addressing long-horizon execution and mitigating

the risk of “lost in the middle” (Erdogan et al., 2025b), while others are tailored for multi-agent systems, focusing on

subtask allocation and contextual coordination across agents with distinct roles (Parmar et al., 2025; Hu et al., 2025b).

In terms of representational form, plans have been instantiated using a wide range of structures, including linear to-do

lists (LangChain, 2025), directed acyclic graphs (DAG) (Qin et al., 2025), tree-structured plans (Hu et al., 2026b), and

hierarchical notes. Moreover, planning systems differ markedly across task domains, with domain-specific designs

emerging for embodied action (Wang et al., 2024b), web search (Kim et al., 2024), and programming. Faced with this

diversity, practitioners may naturally ask: is there a single planning structure that can serve as a one-size-fits-all solution

that generalizes well across settings?

1

arXiv:2602.07839v1 [cs.CL] 8 Feb 2026

### Page 2

We posit that such an oracle planning system does not exist. Beyond distinct task domains require different planning

priors (for instance, MCTS-based planning may be effective for mathematical reasoning yet is rarely adopted for

autonomous driving agents due to the vastness of its action space (Wang et al., 2024a)), even within a single task

class, alternative planning priors exhibit performance disparities. For example, in web search, AOP (Li et al., 2025a)

employs a simple linear to-do list coupled with a reward model to solve document QA in a token-efficient manner, but

it is substantially outperformed in more complex multimodal settings by DAG-based planning structures (Qin et al.,

2025). Similarly, while linear tasks require minimal revision (Hu et al., 2025b), high-conflict environments demand

continuous topological restructuring (Zhang et al., 2025), rendering a single, universal planning system unrealistic.

Accordingly, we contend that the central challenge is not to design a one-size-fits-all planner, but to customize planning

systems to the structural characteristics of each task. To this end, we propose TodoEvolve, a meta-planning paradigm

that synthesizes task-adaptive agentic planners and dynamically updates their planning states as execution unfolds.

Concretely, we train Todo-14B using Impedance-Guided Preference Optimization (IGPO), a multi-objective preference

learning objective that jointly promotes high performance, stability, and token efficiency in the generated planning

systems. The resulting meta-planner Todo-14B takes a task instance as input and instantiates a tailored planning

topology, revision cadence, and navigation strategy, operationalized as a task-specific to-do structure. Todo-14B

integrates seamlessly with single/multi-agent execution frameworks, remains compatible with diverse LLM backbones,

and generalizes across heterogeneous task domains.

To ground TodoEvolve within the diverse landscape of existing planning systems, we introduce a modular planning

design space comprising four dimensions: ♣ Topology (the structural organization of task decomposition), ♦ Initializa-

tion (how the task topology is instantiated), ♥ Adaptation (when and how the topology is revised), and ♠ Navigation

(the mechanism that issues executable directives to the acting agent). This design space provides a unified abstraction

capable of accommodating and localizing a wide spectrum of existing planning paradigms. Building on this formula-

tion, we decompose and re-implement ten representative planning architectures, including Plan-and-Act (Erdogan

et al., 2025b), linear planning (Hu et al., 2025b), DAG-based planning (Qin et al., 2025), and parallel and dynamic

planning (Zhu et al., 2025). The resulting framework, denoted as PlanFactory, serves both as (i) a data synthesis engine

for generating high-quality planning trajectories to train TodoEvolve and (ii) a standardized codebase to facilitate

future research on agentic planning capabilities. Our contributions are as follows:

❶ Unified Codebase: We introduce PlanFactory, a modular design space for agentic planning systems encompassing

four key components (topology, initialization, adaptation, and navigation), providing unified implementations and

benchmark support for a wide range of prevailing planning structues.

❷ Meta Planners: We introduce TodoEvolve, a meta-planning paradigm that synthesizes task-adaptive planning

systems and dynamically revises planning states. Through impedance-guided preference optimization (IGPO), we

train Todo-14B, a meta-planner capable of instantiating and controlling planning structures across diverse scenarios

and agent backbones.

❸ Experimental Evaluation: Extensive experiments on four challenging agentic benchmarks demonstrate that TodoE-

volve delivers (I) substantial performance gains, improving frameworks such as Smolagents by up to 16.37% on

GAIA; and (II) robust generalization, generalizing across diverse LLM backbones, for example boosting GPT-5-Mini

to 75% on xBench-DS.

2 Related Works

Agent Planning Systems. Agentic planning has evolved from static prompting to structured reasoning. Foundational

works like CoT (Wei et al., 2022), ToT (Yao et al., 2023a), and GoT (Besta et al., 2023) enabled cognitive decomposition,

while ReAct (Yao et al., 2023b) and Reflexion (Shinn et al., 2023) introduced execution loops with self-correction.

However, these approaches typically rely on rigid, predetermined topologies, limiting adaptability in open-ended

environments where optimal structures vary dynamically. Recent frameworks address this by embedding domain

priors: Flash-Searcher (Qin et al., 2025) and OAgents (Zhu et al., 2025) leverage DAG-based parallelism; OWL (Hu et al.,

2025b) and AgentOrchestra (Li et al., 2025a) utilize hierarchical coordination; and systems like FlowSearch (Hu et al.,

2026b), JoyAgent (Han et al., 2025), and Co-Sight (Zhang et al., 2025) optimize workflows via structured verification.

Crucially, these systems remain bound by pre-designed architectures. This necessitates a meta-planning approach

capable of autonomously synthesizing and customizing planning structures tailored to each task’s unique complexity.

2

### Page 3

Table 1 An overview of agentic planning paradigms decomposed in PlanFactory. The “Mul” column distinguishes between

single-agent (S) and multi-agent (M) compatibility. “Scope” specifies the granularity at which planning is performed (α for

step-wise vs. Ω for task-wise), and “Struct” indicates whether the execution flow is linear (ℓ) or organized as a complex graph

structure (G).

Mul. Scope Struct. ♣ Topology ♦ Initialization ♥ Adaptation ♠ Navigation

Method Date

(M/S) (Ω/α) (G/ℓ) Structural Organization Instantiation Mechanism Revision Logic Execution Directives

OWL 2025.6 M Ω G Dual Hierarchy Planner Decompose Manager Intervention Dynamic Dispatch

OAgents 2025.6 M α ℓ Modular Graph SOP Configuration Critic-Loop Feedback Loop Execution

AgentOrchestra 2025.9 M Ω G Orch. Hierarchy Role Definition Env Feedback Centralized Routing

Flash-Searcher 2025.9 S Ω G Parallel DAG Dependency Parsing Workflow Pruning Concurrent Paths

JoyAgent 2025.10 M Ω G Collective Hierarchy Hybrid Planning Consensus Voting Joint Deliberation

FlowSearch 2025.10 M Ω G Thought Graph Flow Construction Dynamic Expansion Graph Traversal

Co-Sight 2025.10 M α ℓ Cross-Check Net Inconsistency Trigger Meta-Verification Conflict Resolution

RL for Agent Planning. Training paradigms have shifted from preference alignment (Rafailov et al., 2023; Schulman

et al., 2017) toward reinforcement learning with verifiable rewards (RLVR) (Guo et al., 2025), optimizing against

objective ground truths fosters emergent self-verification. Recent works apply this to diverse dimensions: Search-

R1 (Jin et al., 2025) and LATS (Zhou et al., 2023) optimize search trajectories; RAGEN (Wang et al., 2025b) targets

multi-turn interactions; and ToRL (Li et al., 2025b) refines tool-use strategies. More related works include (Li et al., 2025c;

Xi et al., 2025; Feng et al., 2024; Paglieri et al., 2025). However, a critical limitation persists: these approaches primarily

optimize the agent’s action policy or tool selection within fixed topological loops. In contrast, our work leverages

verifiable trajectories to train a meta-planner, moving beyond policy optimization to autonomously synthesize the

underlying planning structure itself.

3 PlanFactory: Unified Planning Codebase

3.1 Preliminary

We adopt a bi-level agentic inference abstraction where the Agent System executes environment interactions, while

the Planning System governs high-level control logic.

Agent Systems. We formalize the execution substrate as a tuple M = ⟨I, S, A, Ψ, Ω⟩, comprising an agent roster I, a

global state space S, and a joint action space A = ⋃i∈I Ai. The state dynamics follow Ψ(st+1 ∣ st, at, μ(t)), where

μ(t) ∈ I identifies the active agent at time t. To support action generation, a context mechanism Ω aggregates the

execution history Ht, such that at = πμ(t)(st, Ht, Q ∣ Ω). Finally, the resulting trajectory τ is evaluated by a reward

R(τ), positioning M as a flexible execution engine orchestrated by higher-level logic.

Planning Systems. The Planning System imposes structural logic on execution. We formalize it as a configuration P

comprising four key functional modules:

P = ⟨G, Iinit, Fadapt, Nnav⟩ (1)

defining the mechanisms respectively. As shown in Table 1, existing paradigms represent static instances of P,

augmenting the policy as at = π(⋅ ∣ P). Crucially, current systems rely on manual engineering to fix P, limiting

adaptability. This motivates our meta-level framework, which automatically synthesizes an optimal P ∗ tailored to

each task.

3.2 PlanFactory Codebase

We present PlanFactory, a modular toolkit designed to decouple high-level planning logic from low-level execution,

facilitating the systematic study of agentic architectures.

Implementation. The core of PlanFactory is a standardized lifecycle interface. All planning paradigms (Table 1)

inherit from the BasePlanning abstract class, which encapsulates the four essential components: ♣ Topology,

3

### Page 4

Topology

Structural Organization

Initialization

Instantiation Mechanism

Adaptation

Task Revision Logic

Navigation

Execution Directives

Query

Task Description

PlanFactory

Tools

Context

Concrete

Prompts

Topology

Architecture

DAG

Tree

Others

Linear

Feedback

Alert/Error Dynamic Update

Plan State

Action

Answer

Issue

TodoEvolve Agent Execution Loop

Question: Identify the sequence of key locations

traversed on the route from the Shire to Mordor.

System Prompts: You are an expert AI Architect

for the our Agent Framework. Your goal is to

create a NEW Agent Planning Module in Python

and its corresponding Prompt Configuration

(YAML) based on a specific task description,....

Exam-

ples

Instantiated

Agent

Follow Code & Config

Init Topology

Execute Tool

Update

Sync State

Performance Metrics

Solution

Planning

Execution

Adaptation

Summary

Modular

design

Tools

Info

Meta-Planner

Todo-14B

Meta-designing thinking...

class LoTRPlanner(BasePlanning):

def topology_initialize(self):

# Topology: Linear Chain

# 1. Identify Start & End

# 2. Decompose into Segments

return PlanningStep(plan)

def adaptation(self, step):

# 1. Check current location

# 2. Verify next connection

return SummaryStep(status)

Planning Class

which topo? when to adapt?...

system_prompt:

role: "Middle-earth Cartographer"

goal: "Trace route sequentially"

output: "JSON file"

planning:

strategy: "Linear_Chain_Topology"

instruction: "List key stops from Shire

to Mordor"

step:

action: "Find next location"

Planing System Config

Delivering task-customized system...

Optimize

Input

Customized

Planning System

StepLatencyCost Metrics

...... (more iterations)

Final

Answer

Tool Output

Reward

Spearhead

Feedback

Figure 1 The overall inference workflow of TodoEvolve first constructs a customized planning system along four dimen-

sions—topology, initialization, adaptation, and navigation, and then deploys it in real time to orchestrate agent execution.

♦ Initialization, ♥ Adaptation, and ♠ Navigation. For more details, please refer to Appendix A.. This polymorphism

allows heterogeneous strategies to be swapped seamlessly within a shared runtime. Crucially, this design supports

highly parallelized inference, enabling users to benchmark disparate configurations concurrently on a unified backend

without refactoring the agent loop.

Evaluation. PlanFactory provides a comprehensive evaluation suite tailored for dynamic information-seeking tasks.

To ensure reliable assessment in open domains, we employ an LLM-as-a-Judge mechanism. This automates trajectory

analysis, rigorously quantifying both task success rates and the logical coherence of the generated plans.

4 TodoEvolve: Training Meta-Planners

Current agentic systems predominantly rely on static protocols, which inherently lack the flexibility to address the

diverse distribution of real-world queries. To break the shackles of manual engineering, we propose a Generative

Planning Paradigm. The core of this paradigm is Impedance-Guided Preference Optimization (IGPO), a novel training

strategy designed to endue Todo-14B with the ability to dynamically synthesize bespoke planning systems Pcustom

tailored to unique structural requirements. Unlike standard alignment which focuses on stylistic imitation, IGPO

explicitly optimizes the meta-planner to maximize execution stability while minimizing computational overhead. This

section elaborates on our dual-track methodology: (I) constructing a high-quality verifiable planning dataset, and (II)

employing IGPO to establish robust architectural reasoning.

4.1 Data Construction

To enable generative planning, we formulate the system design as a conditional code generation task. To bridge the

lack of architectural priors in standard LLMs, we propose a Bootstrap-and-Filter pipeline within PlanFactory that

transforms the search for optimal plans into a high-quality supervised dataset. This process involves four stages:

Phase 1: Standardization via Unified Tool Interface. First, we utilize the modular nature of PlanFactory to deconstruct

the functional primitives of existing representative planning systems, specifically the 7 paradigms listed in Table 1.

4

### Page 5

We decompose their discrete mechanisms into standardized tools. These tools are encapsulated within our unified

framework, creating a shared Plan Space where different topological structures can be expressed using a consistent

code interface.

Phase 2: Evolutionary Sampling. With the standardized tools ready, we employ an evolutionary strategy to generate

diverse planning candidates. For each query Qi, we construct a specialized input context Ci consisting of:

• The specific user query Qi.

• The system prompt defining the Meta-Planner’s role.

• Detailed documentation of the available Meta-Tools.

• A randomly sampled subset of 3 static planning samples {P 1

ref, P 2

ref, P 3

ref} from our standardized pool, serving as

structural references to guide the architectural design.

The model is tasked with synthesizing a unique, query-specific plan Pgen by integrating or modifying these patterns

to best suit Qi. This process encourages the model to adapt the structural logic to the specific task requirements,

rather than simply replicating existing templates.

Phase 3: Execution-Based Verification. We validate each synthesized plan Pgen by executing it within the PlanFactory

runtime to generate a trajectory τ and final answer Af inal. We apply a strict Execution-as-Judge filter: Pgen is retained

into the dataset if and only if Af inal matches the ground truth. This mechanism effectively purges hallucinated or

unsound architectures, ensuring the Meta-Planner learns exclusively from successful design patterns.

Phase 4: Preference Construction for SFT and IGPO. Finally, we format the validated execution trajectories into training

supervision. To instill both correctness and efficiency into the Meta-Planner, we employ a dual-track alignment

strategy, that separates fundamental capability learning from preference-based refinement:

SFT Data Construction: During SFT, we adopt a strict outcome-supervised filtering protocol. We iterate through the

generated plan candidates and retain only those pairs (Ci, Pgen) that successfully execute. By grounding the target

plan Pgen on the reference-augmented context Ci, we ensure that the base model learns to synthesize valid, executable

architectures from the provided structural inspirations.

IGPO Data Construction: To further align the model with high-quality planning logic via process supervision, we

construct preference pairs (Pwin, Plose) for IGPO. We process the sampling results in pairs and determine the winner

using a hierarchical criterion:

• Correctness First: Correctness is the prerequisite. If one plan succeeds and the other fails, the successful plan is

strictly preferred (Pwin ≻ Plose).

• Noise Filtering: Pairs where both failed are discarded.

• Efficiency as Tie-Breaker: In “expert scenarios” where both candidates yield correct answers, we introduce a novel

metric, Cognitive Impedance (I), to resolve the tie. We define I as a compound cost function:

I(τ) = Ctot ⋅ exp (λ1Nf ail + λ2(1 − Sstab) + λ3

Cplan

Cexec

) (2)

where Ctot is the total cost, Nf ail counts errors, and Sstab quantifies execution smoothness. Crucially, the ratio of

planning cost (Cplan) to execution cost (Cexec) acts as a bureaucracy penalty, ensuring planning effort does not

outweigh execution.

Formally, this pipeline yields two corpora: DSF T = {(Ci, Pgen) ∣ Correct(Pgen)} for structural competence, and

DIGP O = {(Ci, Pwin, Plose) ∣ Pwin ≻ Plose} for efficiency alignment.

4.2 Todo-14B: Training Meta-Planner

This section details the training methodology for Todo-14B. We optimize the Meta-Planner πθ to synthesize planning

configurations that maximize downstream agent performance. We adopt a two-stage curriculum: SFT establishes

structural competence, followed by IGPO to align the planner with execution efficiency.

5

### Page 6

Table 2 Detailed statistics of the constructed datasets. We operate in a long-context regime, where the input LContext (∼13k

tokens) is a composite sequence comprising the system prompt, tool definitions, retrieved structural examples, and the specific user

query.

Dataset Stage Samples Input (LContext) Reasoning (LCoT) Code (LCode)

Stage 1: SFT 3360 ∼ 13,199 ∼ 423 ∼ 1,642

Stage 2: IGPO 2000 ∼ 13,168 ∼ 497 ∼ 1,636

4.2.1 Stage 1: Structural Competence via SFT

We first instill the fundamental capabilities of code generation and architectural reasoning into the Meta-Planner.

Leveraging DSF T, we treat the verified pairs (C, P gen) as expert demonstrations. We optimize πθ using the standard

next-token prediction objective by minimizing the negative log-likelihood of the target sequence. This supervised

training serves as a crucial warm-start phase, ensuring that the model acquires the necessary syntactic rules and API

constraints. Consequently, it learns to synthesize valid instances of P that are structurally grounded in the context C,

providing a stable initialization for subsequent alignment.

4.2.2 Stage 2: Impedance-Guided Preference Alignment

While SFT ensures syntactic viability, it does not guarantee execution efficiency. The subspace of functionally correct

plans is vast, yet the subset of optimal configurations—those that minimize resource consumption while maximizing

success—is sparse. To transition from static correctness to dynamic optimality, we formulate planning generation as a

meta-level optimization problem.

Let P ∈ P denote an executable plan configuration. The Meta-Planner searches the plan space for an optimal

configuration P ∗ that maximizes the expected return, balancing task success against operational costs:

P ∗

= arg max

P ∈P

Eτ ∼M(P)[R(τ) − λI(τ)] (3)

where R(τ) is the binary success reward and I(τ) represents the cognitive impedance. To solve this, we employ our

IGPO method.

Impedance-Contrastive Rejection Sampling. Unlike standard preference collection which often relies on subjective

human ranking, our framework constructs preference pairs based on objective execution metrics. The data curation

process functions as a rejection sampling mechanism designed to distill efficiency signals from stochastic exploration:

• Exploratory Synthesis: Given a context C, the current policy πθ samples K candidate plans {ϕ1,..., ϕK}, instantiat-

ing varied transition dynamics for the Agent System.

• Execution & Evaluation: The Agent System executes these plans to generate trajectories τi. Each trajectory is

evaluated using the composite impedance metric I(τi), aggregating token consumption, temporal latency, and

runtime errors.

• Contrastive Pair Construction: We construct the preference dataset DIGP O by selecting pairs (ϕwin, ϕlose). To

ensure functional validity, we enforce R(τwin) = 1. A pair is selected only if there exists a significant impedance

gap I(τlose) − I(τwin) > δ, ensuring the optimization is driven by high-confidence efficiency signals.

Implicit Reward Alignment. We posit that the optimal policy π∗ should assign probability mass to a configuration

ϕ inversely proportional to its impedance, subject to a KL-divergence constraint that prevents deviation from the

reference distribution. Defining the implicit reward as r(ϕ) = −E[I(τ)] for successful trajectories, the optimal policy

follows the Boltzmann distribution:

π∗

(ϕ ∣ C) ∝ πref (ϕ ∣ C) ⋅ exp (

1

β

r(ϕ)) (4)

This formulation allows us to bypass training an explicit reward model. Following the DPO derivation, the implicit

reward rθ(ϕ) can be re-parameterized by the log-ratio of the policy likelihoods:

rθ(ϕ) = β log

πθ(ϕ ∣ C)

πref (ϕ ∣ C)

(5)

6

### Page 7

Table 3 Performance of various agent frameworks on the WebWalerQA, xBench-Ds, TaskCraft, and GAIA benchmarks. For each

column, the best and second-best pass@1 scores are highlighted in bold and underlined respectively.

Framework Model Family

WebWalker

QA

xBench

-DS

Task

Craft

GAIA

Avg. Level 1 Level 2 Level 3

OWL Workforce pass@3 GPT-4o+o3-mini 57.64 55.0 58.33 60.61 81.14 58.14 26.92

OWL RP pass@3 GPT-4o+o3-mini ---58.18 81.14 54.65 23.08

TapeAgents Claude 3.7 etc. ---55.76 71.70 53.49 30.77

AutoAgent Claude 3.5 etc. ---55.15 71.70 53.40 26.92

Smolagents GPT-4.1 ---55.15 67.92 53.49 34.62

Smolagents GPT-5-mini 58.82 51.0 64.00 55.75 69.81 54.65 30.77

Magnetic-1 OpenAI o1 etc. ---46.06 56.60 46.51 23.08

Cognitive Kernel-Pro Claude-3.7 etc. 60.64 56.0 66.00 60.00 79.25 56.98 30.77

Cognitive Kernel-Pro pass@3 Claude-3.7 etc. ---75.15 84.91 73.26 61.54

OAgents Claude-3.7 etc. 58.23 47.0 -66.67 77.36 66.28 46.15

Agent KB GPT-4.1 60.59 48.0 61.67 61.21 79.25 58.14 34.62

Agent KB pass@2 GPT-4.1 68.82 58.0 72.67 67.27 83.02 67.44 34.62

Agent KB pass@3 GPT-4.1 73.53 68.0 75.33 73.94 84.91 73.26 53.85

Flash-Searcher GPT-5-mini 71.18 69.0 69.67 69.09 79.25 69.77 46.15

Flash-Searcher Kimi K2 52.35 66.0 58.00 52.12 58.49 52.33 34.62

Flash-Searcher DeepSeek V3.2 69.41 68.0 69.33 60.61 79.25 53.49 46.15

TodoEvolve + Smolagents GPT-5-Mini 73.53 75.0 72.67 72.12 81.14 72.09 46.15

TodoEvolve + Smolagents Kimi K2 64.71 71.0 69.33 60.00 73.58 55.81 46.15

TodoEvolve + Smolagents DeepSeek V3.2 70.59 74.0 71.33 70.91 84.91 67.44 53.85

The final IGPO loss function maximizes the margin between efficient and inefficient architectures by minimizing:

LIGP O(θ) = −E(ϕw,ϕl)∼DIGP O [log σ(rθ(ϕw) − rθ(ϕl))] (6)

This approach directly aligns the Meta-Planner with the execution environment, teaching it to architect systems that

minimize cognitive impedance while maintaining functional correctness.

5 Experiments

5.1 Experiment Setup

Training. To equip our model with robust planning capabilities, we construct a high-quality composite dataset sourced

from diverse domains. Our training corpus aggregates samples from TaskCraft (Shi et al., 2025a), MoNaCo (Wolfson

et al., 2026), WebWalkerQA (Wu et al., 2025a), and DeepSearchQA (Google, 2025).The data construction pipeline

leverages a teacher-student paradigm, utilizing Gemini-3-Flash as the expert planner to generate high-level reasoning

traces, and DeepSeek V3.2 as the executor to verify actionable outcomes.The final curated dataset detail is shown in

Table 2. We employ Qwen3-14B (Yang et al., 2025) as our backbone model.

Testing & Baselines. To rigorously evaluate the model’s ability to handle diverse and multimodal queries, we

employ a comprehensive evaluation suite. Our benchmarks include the complete GAIA (Mialon et al., 2023) and

XBench-DS (Chen et al., 2025). Additionally, we construct specific test splits from TaskCraft (Shi et al., 2025a) and

WebWalkerQA (Wu et al., 2025a). Crucially, the test samples from these datasets are distinct and non-overlapping

with the training splits to prevent data leakage. For fair comparison during inference, the underlying LLMs driving

the agents include DeepSeek V3.2 (DeepSeek-AI et al., 2025), Kimi-K2 (Team et al., 2025b), and GPT-5-mini (OpenAI,

2025). We utilize Gemini-3-Flash (Comanici et al., 2025) as the judge model to provide unbiased evaluation of agent

trajectories. To validate efficacy, we benchmark Todo-14B against a wide spectrum of state-of-the-art systems. Please

refer to Table 3 for the detailed list of all baselines compared.

5.2 Main Results

Substantial Performance Enhancement over Baselines. As presented in Table 3, integrating TodoEvolve with the

Smolagents framework yields significant performance gains across all evaluated benchmarks. On the comprehensive

7

### Page 8

Table 4 Comprehensive comparison of execution performance across different agent frameworks. The framework achieving the

highest accuracy on each benchmark is highlighted in bold.

Benchmark Metric Co-Sight FlowSearch Flash-Searcher AgentOrchestra OAgents JoyAgent OWL TodoEvolve

WebWalker-QA

Accuracy (%) 16.67 30.00 60.00 46.67 33.33 63.33 53.33 70.00

Avg Cost ($) 0.0013 0.0053 0.0134 0.0112 0.0236 0.0028 0.0062 0.0167

Avg Time (s) 190.52 94.79 164.78 137.69 150.74 212.83 127.63 216.59

Avg Step 2.1 4.0 5.3 6.5 7.2 4.0 3.8 7.7

DeepSearch-QA

Accuracy (%) 4.00 16.00 22.00 20.00 28.00 28.00 30.00 42.00

Avg Cost ($) 0.0025 0.0109 0.0408 0.0263 0.0454 0.0034 0.0191 0.0495

Avg Time (s) 895.88 351.76 522.36 437.06 519.91 548.70 428.63 875.26

Avg Step 2.8 5.5 10.0 9.9 10.8 4.0 6.9 11.7

GAIA-level2 Text-only

Accuracy (%) 17.14 25.71 25.71 14.29 15.71 30.00 24.29 57.14

Avg Cost ($) 0.0018 0.0069 0.0255 0.0149 0.0317 0.0027 0.0130 0.0282

Avg Time (s) 250.23 159.14 305.67 222.75 292.12 304.38 299.78 323.65

Avg Step 2.6 4.6 8.0 7.7 8.7 4.1 6.2 9.1

GAIA benchmark, our approach using GPT-5-Mini achieves an average score of 72.12%, marking a remarkable absolute

improvement of 16.37% over the vanilla Smolagents baseline. Furthermore, our method outperforms specialized

frameworks operating with the same backbone; for instance, it surpasses Flash-Searcher on GAIA Avg and demonstrates

superior versatility on domain-specific benchmarks like WebWalkerQA and xBench-DS. These results empirically

validate that the autonomous synthesis of task-specific planning architectures offers greater adaptability than static

graph-based priors.

Consistent Gains across Diverse Backbones. The scalability of TodoEvolve is evidenced by its consistent improvements

across diverse execution backbones, including GPT-5-Mini, DeepSeek V3.2 and Kimi K2. Notably, when equipped with

the DeepSeek V3.2, our framework achieves a GAIA average of 70.91%, significantly outperforming the Flash-Searcher

implementation using the same model by over 10 percentage points. This consistency suggests that the meta-planner

acquires transferable architectural reasoning capabilities that function independently of the execution model’s internal

knowledge, effectively acting as a general-purpose performance booster for agentic systems.

Complex Reasoning with Open-Source Frameworks. The advantages of TodoEvolve are particularly pronounced in

high-complexity scenarios requiring long-horizon reasoning. On GAIA Level 3, the most challenging subset, our

framework driven by DeepSeek V3.2 attains a success rate of 53.85%. This performance not only surpasses the standard

Agent KB using the more powerful GPT-4.1 but also matches the performance of Agent KB with pass@3 voting. This

finding highlights a critical insight: with optimal dynamic planning topology, cost-effective open-weights models can

rival or exceed the capabilities of resource-intensive proprietary models in complex problem-solving.

5.3 Structural Specialization

We first investigate the performance variability of fixed planning architectures across diverse task typologies, leveraging

the GPT-5-mini (OpenAI, 2025) to evaluate a multi-category benchmark extracted from TaskCraft (Shi et al., 2025a).

As visualized in Figure 2, distinct planning priors exhibit strong inductive biases suitable for specific domains but

lack universality. For instance, centralized systems trade data-handling capacity for reasoning depth, whereas DAG

topologies prioritize extraction speed over logical coherence. This heterogeneity highlights a critical limitation that

rigid topologies cannot optimally address the structural diversity of open-ended queries. This empirical evidence

validates the core premise of TodoEvolve: by dynamically synthesizing architectures that integrate the complementary

strengths of diverse planning paradigms, our meta-planner achieves cross-domain robustness that no single static

framework can match.

5.4 Inference Efficiency

Beyond task adaptability, we evaluate whether the performance gains of TodoEvolve come at the expense of excessive

computational overhead. Table 4 details the execution metrics on three benchmarks using the Kimi-K2 (Team

et al., 2025b) backbone. TodoEvolve consistently achieves dominant accuracy, surpassing the best static baseline by

substantial margins (e.g., +10.0% on WebWalker-QA, +14.0% on DeepSearch-QA). Crucially, this performance does

not incur a proportional spike in resource consumption, TodoEvolve demonstrates superior Pareto optimality: it

8

### Page 9

Figure 2 Task-Dependent Performance Variability.

Figure 3 Ablation Analysis on GAIA Level 2. We compare the following variants, BS (Base Model), SFT (SFT-Only), ZS (Zero-Shot)

and TodoEvolve.

maintains comparable costs and latency to sophisticated baselines while delivering significantly higher success rates.

This indicates that the meta-planner effectively minimizes cognitive impedance, avoiding the redundant loops of

inefficient planners and the premature failures of overly simple ones.

5.5 Ablation Study

To dissect the efficacy of our training components, we conduct an ablation study on the GAIA Level 2 validation set,

comparing four configurations: (1) Base Model, utilizing the unaligned Qwen3-14B to generate planning systems;

(2) SFT-Only, fine-tuned exclusively on verified planning trajectories; (3) Zero-Shot, which incorporates our IGPO

training but performs inference without few-shot examples; and (4) TodoEvolve, the complete framework employing

both training stages and reference-augmented inference. As illustrated in Figure 3, the Base Model fails to synthesize

executable plans due to a lack of syntactic grounding, a capability established by SFT-Only. Notably, the Zero-Shot

setting not only improves accuracy to 55.8% but also reduces API costs relative to SFT-Only, confirming that IGPO

effectively optimizes execution efficiency. Finally, TodoEvolve achieves a peak accuracy of 72.1%; the concomitant

increase in steps and cost reflects the planner’s enhanced capability to persist through and resolve complex, long-

horizon tasks that simpler variants abandon.

5.6 Case Study

To intuitively illustrate how TodoEvolve facilitates complex reasoning, we present a qualitative analysis of a planning

system synthesized during a real execution. As shown in Figure 4, unlike static, "one-size-fits-all" scaffolds, TodoEvolve

9

### Page 10

Figure 4 Evolved planning architectures in real-world instantiation. The system provides adaptive, state-aware structural

scaffolding that spans from macro-topology initialization to granular adaptation and navigation during the execution stage,

effectively steering the agent toward robust and resilient inference.

delivers a dynamic planning architecture that is adaptively tailored to the evolving task state.

We present a qualitative analysis of the planning system synthesized during real execution, as shown in Figure 4.

The results illustrate that TodoEvolve delivers a dynamic planning architecture that is adaptively tailored to the

evolving task state. Specifically, the planner identifies the optimal computational shape for impedance reduction: it

instantiates a high-breadth Fork-Join topology to break information deadlocks (Task A), while conversely enforcing

strict linear constraints to prune search-space noise for high-precision targets (Task B). Notably, the system exhibits

predictive resilience by anticipating access barriers—such as paywalled reports—and proactively staging fallback paths

to secondary sources. Together, these mechanisms ensure the plan acts as a state-aware anchor, preventing reasoning

drift and transforming passive generation into active, strategic solving.

We present more concrete visualizations of the planning systems designed by Todo-14B in Section C.

6 Conclusion

Traditional agentic planning relies on "one-size-fits-all" workflows, often proving rigid and suboptimal for diverse task

demands. This paper aims to transform planning from manual engineering into an autonomous synthesis process,

making architectural design as adaptive as the underlying model’s reasoning. To this end, we introduce TodoEvolve, a

meta-planning paradigm that navigates a unified design space, PlanFactory, to dynamically configure task-specific

topologies and strategies via IGPO. Our extensive evaluations across diverse benchmarks demonstrate that TodoEvolve

outperforms static baselines, achieving Pareto optimality between success rates and computational efficiency. By

bridging the gap between internal reasoning and external architectural scaffolding, TodoEvolve provides a blueprint

for self-evolving agents capable of mastering open-ended, long-horizon complexities.

10

### Page 11

Contributions

Core Contributors

• Jiaxi Liu

• Yanzuo Jiang

Project Lead

• Guibin Zhang

Contributors

• Zihan Zhang

• Heng Chang

Corresponding Authors

• Zhenfei Yin

• Qibing Ren

• Junchi Yan

11

### Page 12

References

Andon (2025). Vending-Bench 2 | Andon Labs — andonlabs.com. https://andonlabs.com/evals/

vending-bench-2. [Accessed 15-01-2026].

Backlund, A. and Petersson, L. (2025). Vending-bench: A benchmark for long-term coherence of autonomous agents.

Besta, M., Blach, N., Kubicek, A., Gerstenberger, R., Gianinazzi, L., Gajda, J., Lehmann, T., Podstawski, M., Niewiadomski,

H., Nyczyk, P., and Hoefler, T. (2023). Graph of thoughts: Solving elaborate problems with large language models.

Cao, P., Men, T., Liu, W., Zhang, J., Li, X., Lin, X., Sui, D., Cao, Y., Liu, K., and Zhao, J. (2025). Large language models

for planning: A comprehensive and systematic survey.

Chen, K., Ren, Y., Liu, Y., Hu, X., Tian, H., Xie, T., Liu, F., Zhang, H., Liu, H., Gong, Y., Sun, C., Hou, H., Yang, H., Pan,

J., Lou, J., Mao, J., Liu, J., Li, J., Liu, K., Liu, K., Wang, R., Li, R., Niu, T., Zhang, W., Yan, W., Wang, X., Zhang, Y.,

Hung, Y.-H., Jiang, Y., Liu, Z., Yin, Z., Ma, Z., and Mo, Z. (2025). xbench: Tracking agents productivity scaling with

profession-aligned real-world evaluations.

Comanici, G., Bieber, E., Schaekermann, M., Pasupat, I., Sachdeva, N., Dhillon, I., Blistein, M., Ram, O., Zhang, D.,

Rosen, E., et al. (2025). Gemini 2.5: Pushing the frontier with advanced reasoning, multimodality, long context, and

next generation agentic capabilities. arXiv preprint arXiv:2507.06261.

DeepSeek-AI, Liu, A., Mei, A., Lin, B., Xue, B., Wang, B., Xu, B., Wu, B., Zhang, B., Lin, C., Dong, C., Lu, C., Zhao, C.,

Deng, C., Xu, C., Ruan, C., Dai, D., Guo, D., Yang, D., Chen, D., Li, E., Zhou, F., Lin, F., Dai, F., Hao, G., Chen, G., Li,

G., Zhang, H., Xu, H., Li, H., Liang, H., Wei, H., Zhang, H., Luo, H., Ji, H., Ding, H., Tang, H., Cao, H., Gao, H., Qu,

H., Zeng, H., Huang, J., Li, J., Xu, J., Hu, J., Chen, J., Xiang, J., Yuan, J., Cheng, J., Zhu, J., Ran, J., Jiang, J., Qiu, J., Li, J.,

Song, J., Dong, K., Gao, K., Guan, K., Huang, K., Zhou, K., Huang, K., Yu, K., Wang, L., Zhang, L., Wang, L., Zhao, L.,

Yin, L., Guo, L., Luo, L., Ma, L., Wang, L., Zhang, L., Di, M. S., Xu, M. Y., Zhang, M., Zhang, M., Tang, M., Zhou, M.,

Huang, P., Cong, P., Wang, P., Wang, Q., Zhu, Q., Li, Q., Chen, Q., Du, Q., Xu, R., Ge, R., Zhang, R., Pan, R., Wang, R.,

Yin, R., Xu, R., Shen, R., Zhang, R., Liu, S. H., Lu, S., Zhou, S., Chen, S., Cai, S., Chen, S., Hu, S., Liu, S., Hu, S., Ma, S.,

Wang, S., Yu, S., Zhou, S., Pan, S., Zhou, S., Ni, T., Yun, T., Pei, T., Ye, T., Yue, T., Zeng, W., Liu, W., Liang, W., Pang,

W., Luo, W., Gao, W., Zhang, W., Gao, X., Wang, X., Bi, X., Liu, X., Wang, X., Chen, X., Zhang, X., Nie, X., Cheng, X.,

Liu, X., Xie, X., Liu, X., Yu, X., Li, X., Yang, X., Li, X., Chen, X., Su, X., Pan, X., Lin, X., Fu, X., Wang, Y. Q., Zhang, Y.,

Xu, Y., Ma, Y., Li, Y., Li, Y., Zhao, Y., Sun, Y., Wang, Y., Qian, Y., Yu, Y., Zhang, Y., Ding, Y., Shi, Y., Xiong, Y., He, Y.,

Zhou, Y., Zhong, Y., Piao, Y., Wang, Y., Chen, Y., Tan, Y., Wei, Y., Ma, Y., Liu, Y., Yang, Y., Guo, Y., Wu, Y., Wu, Y.,

Cheng, Y., Ou, Y., Xu, Y., Wang, Y., Gong, Y., Wu, Y., Zou, Y., Li, Y., Xiong, Y., Luo, Y., You, Y., Liu, Y., Zhou, Y., Wu,

Z. F., Ren, Z. Z., Zhao, Z., Ren, Z., Sha, Z., Fu, Z., Xu, Z., Xie, Z., Zhang, Z., Hao, Z., Gou, Z., Ma, Z., Yan, Z., Shao, Z.,

Huang, Z., Wu, Z., Li, Z., Zhang, Z., Xu, Z., Wang, Z., Gu, Z., Zhu, Z., Li, Z., Zhang, Z., Xie, Z., Gao, Z., Pan, Z., Yao,

Z., Feng, B., Li, H., Cai, J. L., Ni, J., Xu, L., Li, M., Tian, N., Chen, R. J., Jin, R. L., Li, S. S., Zhou, S., Sun, T., Li, X. Q.,

Jin, X., Shen, X., Chen, X., Song, X., Zhou, X., Zhu, Y. X., Huang, Y., Li, Y., Zheng, Y., Zhu, Y., Ma, Y., Huang, Z., Xu,

Z., Zhang, Z., Ji, D., Liang, J., Guo, J., Chen, J., Xia, L., Wang, M., Li, M., Zhang, P., Chen, R., Sun, S., Wu, S., Ye, S.,

Wang, T., Xiao, W. L., An, W., Wang, X., Sun, X., Wang, X., Tang, Y., Zha, Y., Zhang, Z., Ju, Z., Zhang, Z., and Qu, Z.

(2025). Deepseek-v3.2: Pushing the frontier of open large language models.

Erdogan, L. E., Lee, N., Kim, S., Moon, S., Furuta, H., Anumanchipalli, G., Keutzer, K., and Gholami, A. (2025a).

Plan-and-act: Improving planning of agents for long-horizon tasks.

Erdogan, L. E., Lee, N., Kim, S., Moon, S., Furuta, H., Anumanchipalli, G., Keutzer, K., and Gholami, A. (2025b).

Plan-and-act: Improving planning of agents for long-horizon tasks. arXiv preprint arXiv:2503.09572.

Feng, P., He, Y., Huang, G., Lin, Y., Zhang, H., Zhang, Y., and Li, H. (2024). Agile: A novel reinforcement learning

framework of llm agents.

Google (2025). DeepSearchQA — kaggle.com. https://www.kaggle.com/datasets/deepmind/

deepsearchqa. [Accessed 05-01-2026].

Guo, D., Yang, D., Zhang, H., Song, J., Zhang, R., Xu, R., Zhu, Q., Ma, S., Wang, P., Bi, X., et al. (2025). Deepseek-r1:

Incentivizing reasoning capability in llms via reinforcement learning. arXiv preprint arXiv:2501.12948.

12

### Page 13

Han, A., Hu, J., Wei, P., Zhang, Z., Guo, Y., Lu, J., and Zhang, Z. (2025). Joyagents-r1: Joint evolution dynamics for

versatile multi-llm agents with reinforcement learning. arXiv preprint arXiv:2506.19846.

Hu, C., Du, H., Wang, H., Lin, L., Chen, M., Liu, P., Miao, R., Yue, T., You, W., Ji, W., Yuan, W., Deng, W., Yuan, X.,

Zhang, X., Liu, X., Liu, X., Xu, Y., Cao, Y., Zhang, Y., Wang, Y., Shu, Y., Zhang, Y., Zhang, Y., Gong, Z., Chang, Z., Li,

B., Ma, D., Jia, F., Wang, H., Liu, J., Bai, J., Liu, J., Liu, M., Wang, N., Wu, Q., Du, Q., Li, S., Sun, W., Gong, Y., Chen, Y.,

Zhao, Y., Lin, Y., Ren, Z., Wang, Z., Zhang, A., Li, B., Ma, B., An, K., Xie, L., Li, M., Li, P., Yang, S., Chen, X., Liu, X.,

Luo, Y., Song, Y., Ding, Y., Liang, Y., Li, Z., Zhang, Z., Zhang, Z., Jiao, B., Jiang, D., Chen, J., Li, J., Zhang, X., and Zhu,

Y. (2025a). Step-deepresearch technical report.

Hu, M., Zhou, Y., Fan, W., Nie, Y., Xia, B., Sun, T., Ye, Z., Jin, Z., Li, Y., Chen, Q., Zhang, Z., Wang, Y., Ye, Q., Ghanem, B.,

Luo, P., and Li, G. (2025b). Owl: Optimized workforce learning for general multi-agent assistance in real-world task

automation.

Hu, Y., Liu, S., Yue, Y., Zhang, G., Liu, B., Zhu, F., Lin, J., Guo, H., Dou, S., Xi, Z., Jin, S., Tan, J., Yin, Y., Liu, J., Zhang,

Z., Sun, Z., Zhu, Y., Sun, H., Peng, B., Cheng, Z., Fan, X., Guo, J., Yu, X., Zhou, Z., Hu, Z., Huo, J., Wang, J., Niu, Y.,

Wang, Y., Yin, Z., Hu, X., Liao, Y., Li, Q., Wang, K., Zhou, W., Liu, Y., Cheng, D., Zhang, Q., Gui, T., Pan, S., Zhang, Y.,

Torr, P., Dou, Z., Wen, J.-R., Huang, X., Jiang, Y.-G., and Yan, S. (2026a). Memory in the age of ai agents.

Hu, Y., Ma, R., Fan, Y., Shi, J., Cao, Z., Zhou, Y., Yuan, J., Zhang, S., Feng, S., Yan, X., Zhang, S., Zhang, W., Bai, L., and

Zhang, B. (2026b). Flowsearch: Advancing deep research with dynamic structured knowledge flow.

iQuest (2025). IQuest Coder — iquestlab.github.io. https://iquestlab.github.io/. [Accessed 15-01-2026].

Jin, B., Zeng, H., Yue, Z., Yoon, J., Arik, S., Wang, D., Zamani, H., and Han, J. (2025). Search-r1: Training llms to reason

and leverage search engines with reinforcement learning. arXiv preprint arXiv:2503.09516.

Kim, M., Bursztyn, V., Koh, E., Guo, S., and Hwang, S.-w. (2024). RaDA: Retrieval-augmented web agent planning

with LLMs. In Ku, L.-W., Martins, A., and Srikumar, V., editors, Findings of the Association for Computational

Linguistics: ACL 2024, pages 13511–13525, Bangkok, Thailand. Association for Computational Linguistics.

LangChain (2025). GitHub - langchain-ai/deepagents: Deep Agents is an agent harness built on langchain and

langgraph. Deep Agents are equipped with a planning tool, a filesystem backend, and the ability to spawn sub-

agents - making them well-equipped to handle complex agentic tasks. — github.com. https://github.com/

langchain-ai/deepagents. [Accessed 15-01-2026].

Li, A., Xie, Y., Li, S., Tsung, F., Ding, B., and Li, Y. (2025a). Agent-oriented planning in multi-agent systems.

Li, X., Zou, H., and Liu, P. (2025b). Torl: Scaling tool-integrated rl. arXiv preprint arXiv:2503.23383.

Li, Z., Hu, Y., and Wang, W. (2025c). Encouraging good processes without the need for good answers: Reinforcement

learning for llm agent planning.

Mialon, G., Fourrier, C., Wolf, T., LeCun, Y., and Scialom, T. (2023). Gaia: a benchmark for general ai assistants. In The

Twelfth International Conference on Learning Representations.

OpenAI (2025). Introducing GPT-5.2 — openai.com. https://openai.com/index/

introducing-gpt-5-2/. [Accessed 08-01-2026].

Paglieri, D., Cupiał, B., Cook, J., Piterbarg, U., Tuyls, J., Grefenstette, E., Foerster, J. N., Parker-Holder, J., and

Rocktäschel, T. (2025). Learning when to plan: Efficiently allocating test-time compute for llm agents. arXiv

preprint arXiv:2509.03581.

Parmar, M., Liu, X., Goyal, P., Chen, Y., Le, L., Mishra, S., Mobahi, H., Gu, J., Wang, Z., Nakhost, H., Baral, C., Lee,

C.-Y., Pfister, T., and Palangi, H. (2025). Plangen: A multi-agent framework for generating planning and reasoning

trajectories for complex problem solving.

Qin, T., Chen, Q., Wang, S., Xing, H., Zhu, K., Zhu, H., Shi, D., Liu, X., Zhang, G., Liu, J., Jiang, Y. E., Gao, X., and Zhou,

W. (2025). Flash-searcher: Fast and effective web agents via dag-based parallel execution.

Rafailov, R., Sharma, A., Mitchell, E., Manning, C. D., Ermon, S., and Finn, C. (2023). Direct preference optimization: Your

language model is secretly a reward model. Advances in Neural Information Processing Systems, 36:53728–53741.

13

### Page 14

Schulman, J., Wolski, F., Dhariwal, P., Radford, A., and Klimov, O. (2017). Proximal policy optimization algorithms.

arXiv preprint arXiv:1707.06347.

Shi, D., Cao, J., Chen, Q., Sun, W., Li, W., Lu, H., Dong, F., Qin, T., Zhu, K., Liu, M., Yang, J., Zhang, G., Liu, J., Zhang, C.,

Wang, J., Jiang, Y. E., and Zhou, W. (2025a). Taskcraft: Automated generation of agentic tasks.

Shi, Z., Chen, Y., Li, H., Sun, W., Ni, S., Lyu, Y., Fan, R.-Z., Jin, B., Weng, Y., Zhu, M., Xie, Q., Guo, X., Yang, Q., Wu, J.,

Zhao, J., Tang, X., Ma, X., Wang, C., Mao, J., Ai, Q., Huang, J.-T., Wang, W., Zhang, Y., Yang, Y., Tu, Z., and Ren, Z.

(2025b). Deep research: A systematic survey.

Shinn, N., Labash, B., and Gopinath, A. (2023). Reflexion: an autonomous agent with dynamic memory and self-

reflection. arXiv preprint, abs/2303.11366.

Team,., Zeng, A., Lv, X., Zheng, Q., Hou, Z., Chen, B., Xie, C., Wang, C., Yin, D., Zeng, H., Zhang, J., Wang, K., Zhong,

L., Liu, M., Lu, R., Cao, S., Zhang, X., Huang, X., Wei, Y., Cheng, Y., An, Y., Niu, Y., Wen, Y., Bai, Y., Du, Z., Wang, Z.,

Zhu, Z., Zhang, B., Wen, B., Wu, B., Xu, B., Huang, C., Zhao, C., Cai, C., Yu, C., Li, C., Ge, C., Huang, C., Zhang, C.,

Xu, C., Zhu, C., Li, C., Yin, C., Lin, D., Yang, D., Jiang, D., Ai, D., Zhu, E., Wang, F., Pan, G., Wang, G., Sun, H., Li, H.,

Li, H., Hu, H., Zhang, H., Peng, H., Tai, H., Zhang, H., Wang, H., Yang, H., Liu, H., Zhao, H., Liu, H., Yan, H., Liu, H.,

Chen, H., Li, J., Zhao, J., Ren, J., Jiao, J., Zhao, J., Yan, J., Wang, J., Gui, J., Zhao, J., Liu, J., Li, J., Li, J., Lu, J., Wang,

J., Yuan, J., Li, J., Du, J., Du, J., Liu, J., Zhi, J., Gao, J., Wang, K., Yang, L., Xu, L., Fan, L., Wu, L., Ding, L., Wang, L.,

Zhang, M., Li, M., Xu, M., Zhao, M., Zhai, M., Du, P., Dong, Q., Lei, S., Tu, S., Yang, S., Lu, S., Li, S., Li, S., Shuang-Li,

Yang, S., Yi, S., Yu, T., Tian, W., Wang, W., Yu, W., Tam, W. L., Liang, W., Liu, W., Wang, X., Jia, X., Gu, X., Ling, X.,

Wang, X., Fan, X., Pan, X., Zhang, X., Zhang, X., Fu, X., Zhang, X., Xu, Y., Wu, Y., Lu, Y., Wang, Y., Zhou, Y., Pan, Y.,

Zhang, Y., Wang, Y., Li, Y., Su, Y., Geng, Y., Zhu, Y., Yang, Y., Li, Y., Wu, Y., Li, Y., Liu, Y., Wang, Y., Li, Y., Zhang, Y.,

Liu, Z., Yang, Z., Zhou, Z., Qiao, Z., Feng, Z., Liu, Z., Zhang, Z., Wang, Z., Yao, Z., Wang, Z., Liu, Z., Chai, Z., Li, Z.,

Zhao, Z., Chen, W., Zhai, J., Xu, B., Huang, M., Wang, H., Li, J., Dong, Y., and Tang, J. (2025a). Glm-4.5: Agentic,

reasoning, and coding (arc) foundation models.

Team, K., Bai, Y., Bao, Y., Chen, G., Chen, J., Chen, N., Chen, R., Chen, Y., Chen, Y., Chen, Y., Chen, Z., Cui, J., Ding, H.,

Dong, M., Du, A., Du, C., Du, D., Du, Y., Fan, Y., Feng, Y., Fu, K., Gao, B., Gao, H., Gao, P., Gao, T., Gu, X., Guan, L.,

Guo, H., Guo, J., Hu, H., Hao, X., He, T., He, W., He, W., Hong, C., Hu, Y., Hu, Z., Huang, W., Huang, Z., Huang, Z.,

Jiang, T., Jiang, Z., Jin, X., Kang, Y., Lai, G., Li, C., Li, F., Li, H., Li, M., Li, W., Li, Y., Li, Y., Li, Z., Li, Z., Lin, H., Lin, X.,

Lin, Z., Liu, C., Liu, C., Liu, H., Liu, J., Liu, J., Liu, L., Liu, S., Liu, T. Y., Liu, T., Liu, W., Liu, Y., Liu, Y., Liu, Y., Liu, Y.,

Liu, Z., Lu, E., Lu, L., Ma, S., Ma, X., Ma, Y., Mao, S., Mei, J., Men, X., Miao, Y., Pan, S., Peng, Y., Qin, R., Qu, B., Shang,

Z., Shi, L., Shi, S., Song, F., Su, J., Su, Z., Sun, X., Sung, F., Tang, H., Tao, J., Teng, Q., Wang, C., Wang, D., Wang, F.,

Wang, H., Wang, J., Wang, J., Wang, J., Wang, S., Wang, S., Wang, Y., Wang, Y., Wang, Y., Wang, Y., Wang, Y., Wang,

Z., Wang, Z., Wang, Z., Wei, C., Wei, Q., Wu, W., Wu, X., Wu, Y., Xiao, C., Xie, X., Xiong, W., Xu, B., Xu, J., Xu, J., Xu,

L. H., Xu, L., Xu, S., Xu, W., Xu, X., Xu, Y., Xu, Z., Yan, J., Yan, Y., Yang, X., Yang, Y., Yang, Z., Yang, Z., Yang, Z., Yao,

H., Yao, X., Ye, W., Ye, Z., Yin, B., Yu, L., Yuan, E., Yuan, H., Yuan, M., Zhan, H., Zhang, D., Zhang, H., Zhang, W.,

Zhang, X., Zhang, Y., Zhang, Y., Zhang, Y., Zhang, Y., Zhang, Y., Zhang, Y., Zhang, Z., Zhao, H., Zhao, Y., Zheng, H.,

Zheng, S., Zhou, J., Zhou, X., Zhou, Z., Zhu, Z., Zhuang, W., and Zu, X. (2025b). Kimi k2: Open agentic intelligence.

Team, T. D., Li, B., Zhang, B., Zhang, D., Huang, F., Li, G., Chen, G., Yin, H., Wu, J., Zhou, J., Li, K., Su, L., Ou, L., Zhang,

L., Xie, P., Ye, R., Yin, W., Yu, X., Wang, X., Wu, X., Chen, X., Zhao, Y., Zhang, Z., Tao, Z., Zhang, Z., Qiao, Z., Wang,

C., Yu, D., Fu, G., Shen, H., Yang, J., Lin, J., Zhang, J., Zeng, K., Yang, L., Yin, H., Song, M., Yan, M., Liao, M., Xia, P.,

Xiao, Q., Min, R., Ding, R., Fang, R., Chen, S., Huang, S., Wang, S., Cai, S., Shen, W., Wang, X., Guan, X., Geng, X.,

Shi, Y., Wu, Y., Chen, Z., Li, Z., and Jiang, Y. (2025c). Tongyi deepresearch technical report.

Wang, C., Deng, Y., Lyu, Z., Zeng, L., He, J., Yan, S., and An, B. (2024a). Q*: Improving multi-step reasoning for llms

with deliberative planning.

Wang, X., Li, B., Song, Y., Xu, F. F., Tang, X., Zhuge, M., Pan, J., Song, Y., Li, B., Singh, J., Tran, H. H., Li, F., Ma, R.,

Zheng, M., Qian, B., Shao, Y., Muennighoff, N., Zhang, Y., Hui, B., Lin, J., Brennan, R., Peng, H., Ji, H., and Neubig, G.

(2025a). Openhands: An open platform for ai software developers as generalist agents.

Wang, Z., Cai, S., Chen, G., Liu, A., Ma, X., and Liang, Y. (2024b). Describe, explain, plan and select: Interactive

planning with large language models enables open-world multi-task agents.

14

### Page 15

Wang, Z., Wang, K., Wang, Q., Zhang, P., Li, L., Yang, Z., Jin, X., Yu, K., Nguyen, M. N., Liu, L., et al. (2025b). Ragen:

Understanding self-evolution in llm agents via multi-turn reinforcement learning. arXiv preprint arXiv:2504.20073.

Wei, J., Wang, X., Schuurmans, D., Bosma, M., Ichter, B., Xia, F., Chi, E., Le, Q., and Zhou, D. (2022). Chain-of-thought

prompting elicits reasoning in large language models.

Wolfson, T., Trivedi, H., Geva, M., Goldberg, Y., Roth, D., Khot, T., Sabharwal, A., and Tsarfaty, R. (2026). Monaco:

More natural and complex questions for reasoning across dozens of documents. Transactions of the Association

for Computational Linguistics, 14:23–46.

Wu, J., Yin, W., Jiang, Y., Wang, Z., Xi, Z., Fang, R., Zhang, L., He, Y., Zhou, D., Xie, P., and Huang, F. (2025a). Webwalker:

Benchmarking llms in web traversal.

Wu, J., Zhao, Q., Chen, Z., Qin, K., Zhao, Y., Wang, X., and Yao, Y. (2025b). Gap: Graph-based agent planning with

parallel tool use and reinforcement learning.

Xi, Z., Huang, J., Liao, C., Huang, B., Guo, H., Liu, J., Zheng, R., Ye, J., Zhang, J., Chen, W., He, W., Ding, Y., Li, G.,

Chen, Z., Du, Z., Yao, X., Xu, Y., Chen, J., Gui, T., Wu, Z., Zhang, Q., Huang, X., and Jiang, Y.-G. (2025). Agentgym-rl:

Training llm agents for long-horizon decision making through multi-turn reinforcement learning.

Yang, A., Li, A., Yang, B., Zhang, B., Hui, B., Zheng, B., Yu, B., Gao, C., Huang, C., Lv, C., Zheng, C., Liu, D., Zhou, F.,

Huang, F., Hu, F., Ge, H., Wei, H., Lin, H., Tang, J., Yang, J., Tu, J., Zhang, J., Yang, J., Yang, J., Zhou, J., Zhou, J., Lin,

J., Dang, K., Bao, K., Yang, K., Yu, L., Deng, L., Li, M., Xue, M., Li, M., Zhang, P., Wang, P., Zhu, Q., Men, R., Gao, R.,

Liu, S., Luo, S., Li, T., Tang, T., Yin, W., Ren, X., Wang, X., Zhang, X., Ren, X., Fan, Y., Su, Y., Zhang, Y., Zhang, Y.,

Wan, Y., Liu, Y., Wang, Z., Cui, Z., Zhang, Z., Zhou, Z., and Qiu, Z. (2025). Qwen3 technical report.

Yang, J., Jimenez, C. E., Wettig, A., Lieret, K., Yao, S., Narasimhan, K., and Press, O. (2024). Swe-agent: Agent-computer

interfaces enable automated software engineering.

Yao, S., Yu, D., Zhao, J., Shafran, I., Griffiths, T. L., Cao, Y., and Narasimhan, K. (2023a). Tree of thoughts: Deliberate

problem solving with large language models.

Yao, S., Zhao, J., Yu, D., Du, N., Shafran, I., Narasimhan, K. R., and Cao, Y. (2023b). React: Synergizing reasoning and

acting in language models. In The Eleventh International Conference on Learning Representations.

Zhang, H., Lu, J., Jiang, S., Zhu, C., Xie, L., Zhong, C., Chen, H., Zhu, Y., Du, Y., Gao, Y., Huang, L., Wang, B., Tan, F.,

and Zou, P. (2025). Co-sight: Enhancing llm-based agents via conflict-aware meta-verification and trustworthy

reasoning with structured facts.

Zhou, A., Yan, K., Shlapentokh-Rothman, M., Wang, H., and Wang, Y.-X. (2023). Language agent tree search unifies

reasoning acting and planning in language models. arXiv preprint arXiv:2310.04406.

Zhu, H., Qin, T., Zhu, K., Huang, H., Guan, Y., Xia, J., Yao, Y., Li, H., Wang, N., Liu, P., Peng, T., Gui, X., Li, X., Liu, Y.,

Jiang, Y. E., Wang, J., Zhang, C., Tang, X., Zhang, G., Yang, J., Liu, M., Gao, X., Liu, J., and Zhou, W. (2025). Oagents:

An empirical study of building effective agents.

A PlanFactory Details

We detail the established planning system in PlanFactory as follows:

• Co-Sight

Co-Sight establishes a cross-check net topology, specifically engineered to resolve epistemic discrepancies

through mutual verification. The system is initialized via an inconsistency trigger, where the planning process

is activated only upon detecting conflicting information or divergent perspectives among internal modules.

Navigation is executed through conflict resolution, utilizing trustworthy reasoning with structured facts

to systematically eliminate cognitive biases across the agent collective. For its adaptation mechanism, the

framework employs meta-verification, conducting high-level assessments of the underlying verification logic to

ensure the integrity of the process of building consensus.

15

### Page 16

• AgentOrchestra

AgentOrchestra adheres to an orchestration hierarchy topology, establishing a structured command chain

for multi-agent coordination. The system initiates through role definition, where functional identities are

assigned to activate the environment. During this phase, a planning agent leverages its global perspective to

decompose complex objectives into manageable sub-tasks. Navigation is facilitated via centralized routing, with

the planning agent dispatching specific instructions to specialized sub-agents based on their designated roles.

The framework’s adaptation is driven by environment feedback, where the system dynamically re-calibrates the

plan by synthesizing execution data, aggregating feedback loops, and monitoring cumulative progress toward

the final objective.

• OAgents

OAgents employs a modular graph topology, representing the global objective as a web of decoupled yet

interdependent modules. The framework initiates via SOP configuration, where the agent decomposes the

primary task into sub-tasks interconnected by edges that define prerequisite dependencies. Navigation is driven

by dynamic programming, which, at each discrete step, identifies and dispatches the set of candidate nodes

whose dependencies have been fully satisfied. The system’s adaptation mechanism relies on critic-loop feedback

for periodic refinement: every N steps, intermediate results are cross-referenced against global constraints

to verify alignment with the objective, triggering a re-sequencing of sub-tasks based on novel observations.

Furthermore, trajectories from prior execution attempts are distilled into heuristic guidance and integrated

into the planning module as soft constraints or behavioral preferences, dynamically biasing sub-task selection

toward proven success paths.

• JoyAgent

JoyAgent utilizes a collective hierarchy topology, structuring its multi-agent system to balance global oversight

with local flexibility. the system is initialized through hybrid planning, which implements a supervisor agent

based on a plan-and-execute framework to maintain global coherence while concurrently deploying multiple

single agents utilizing react to ensure step-level responsiveness. navigation is governed by joint deliberation,

where outputs from the diverse agent pool are aggregated and processed through consensus voting to determine

the optimal execution path. the framework’s adaptation is achieved through the intrinsic react loops of the

individual agents, allowing for real-time adjustments based on localized feedback without compromising the

overarching trajectory.

• Flash-Searcher

Upon receiving a request, Flash-Searcher decomposes the task into a parallel Directed Acyclic Graph (DAG),

where nodes denote granular sub-tasks and edges represent their dependencies. The system instantiates this

structure through dependency parsing, mapping out the prerequisite constraints to initialize the graph’s nodes

and edges. Navigation is governed by aggressive parallelization. A node is dispatched to a concurrent execution

pool as soon as its predecessors are satisfied or when partial execution results provide sufficient auxiliary

validation. To maintain system agility, the framework performs workflow pruning at defined step intervals,

where it summarizes progress to excise resolved nodes and re-evaluates the dependencies of pending tasks,

dynamically injecting new decomposition branches if environmental contingencies arise.

• FlowSearch

FlowSearch conceptualizes task resolution through a thought graph topology, representing the reasoning

process as an evolving network of cognitive states. The framework employs flow construction for incremental

instantiation; starting from the root task, a knowledge flow planner iteratively evaluates whether active

nodes require further decomposition or supplemental context. This process generates descendant nodes that

encapsulate sub-problems, intermediate reasoning steps, and required evidentiary grounding while concurrently

establishing dependency edges to preserve logical consistency and structural integrity. Navigation is managed by

a knowledge collector, which identifies and dispatches nodes that exhibit the highest execution readiness based on

satisfied dependencies. The system’s adaptation is realized through dynamic expansion via a knowledge refiner,

which leverages newly acquired insights to perform structural transformations on the flow. By synthesizing

16

### Page 17

current knowledge contexts with execution states, the refiner dynamically executes atomic operations including

the addition, deletion, or modification of nodes and edges to optimize the graph’s trajectory toward the goal.

• OWL

OWL adopts a dual hierarchy topology that formally segregates the strategic management layer from the tactical

execution layer. Upon task arrival, the system undergoes planner decomposition, where a high-level planner

analyzes task complexity against the latent capabilities of available worker nodes to instantiate a structured

task list. Navigation is facilitated via dynamic dispatch, managed by a coordinator that evaluates real-time

agent profiles to map specific sub-tasks to the most suitable worker nodes. The framework’s adaptation logic is

driven by manager intervention triggered by decentralized failure detection: individual workers autonomously

monitor their execution status, broadcasting failure signals to a dedicated task channel upon impasse. This

channel acts as an observation primitive, prompting the planner to perform reactive re-planning and inject

revised sub-tasks based on the contextual feedback from the failed execution.

B Datasets

The five datasets used in this study are described as follows: (1) GAIA (Mialon et al., 2023) consists of 165 tasks,

categorized into 53 Level-1, 86 Level-2, and 26 Level-3 problems. (2) WebWalkerQA (Wu et al., 2025a) evaluates an

agent’s capability in handling complex, multi-turn web interactions. It comprises 680 real-world queries across four

domains and spans over 1, 373 webpages. We sample a subset of 170 queries for evaluation. (3) xBench-DeepSearch

(xBench-DS) (Chen et al., 2025) contains 100 tasks assessing agentic planning, tool use, and reasoning. (4) TaskCraft(Shi

et al., 2025a) is a synthetic benchmark generated via an autonomous data pipeline, we collect 300 queries as a valid

subset.(5) DeepSearchQA (Google, 2025) targets the long-horizon research capabilities of agents, we collect 50 queries

as a valid subset.

C Case Study

To provide a concrete and intuitive understanding of the planning architectures synthesized by TodoEvolve, we

visualize three representative systems generated for distinct query types, as shown in Figures 5 to 7. These examples

demonstrate how our meta-planner moves beyond static templates, dynamically tailoring the control flow—ranging

from linear sequential logic to complex parallel graph structures—to match the specific cognitive impedance and

dependency requirements of the task. By autonomously configuring the topology initialization, execution navigation,

and adaptation triggers, TodoEvolve ensures robust performance across varying levels of problem complexity.

17

### Page 18

Figure 5 Linear Sequential Planning for Multi-Criteria Filtering. For a query requiring strict multi-stage filtering and

calculation (identifying countries based on migration thresholds followed by crime index analysis), TodoEvolve instantiates a linear

execution topology. The system prioritizes a sequential “fetch-and-filter” pipeline to manage data dependencies, incorporating a

periodic adaptation trigger to validate intermediate retrieval results before proceeding to the final synthesis and verification stage.

This structure minimizes branching overhead for tasks where step-wise logical progression is paramount.

18

### Page 19

Figure 6 State-Aware Graph Topology for Structured Data Extraction. Addressing a structured retrieval task involving

sorting and ranking constraints, the meta-planner constructs a Knowledge Flow Graph. This topology decomposes the problem

into granular nodes (acquisition, filtering, and finalization). The navigation strategy employs a state-aware routing mechanism that

dynamically selects between parallel extraction or sequential reasoning based on the current node status ("pending" vs. "success"),

allowing the system to efficiently prune the search space while adhering to numerical constraints.

19

### Page 20

Figure 7 High-Breadth Parallel Planning for Complex Entity Resolution. Faced with a complex entity resolution task

requiring the retrieval of nested attributes for multiple subjects simultaneously, TodoEvolve evolves a highly parallelized graph

architecture. The system identifies independent sub-goals (e.g., retrieving data for different players concurrently) and activates a

“Parallel Executor” module to minimize latency. The adaptation layer monitors the synchronization of these concurrent streams,

ensuring that the graph topology is only updated and merged when specific dependency conditions are met.

20
