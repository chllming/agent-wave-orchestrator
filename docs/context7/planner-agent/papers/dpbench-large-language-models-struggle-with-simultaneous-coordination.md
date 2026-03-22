---
summary: 'Converted paper text and source links for DPBench: Large Language Models Struggle with Simultaneous Coordination.'
read_when:
  - Reviewing harness and coordination research source material in the docs tree
  - You want the extracted paper text with source links preserved
topics:
  - planning-and-orchestration
  - repo-context-and-evaluation
kind: 'paper'
title: 'DPBench: Large Language Models Struggle with Simultaneous Coordination'
---
# DPBench: Large Language Models Struggle with Simultaneous Coordination

<Note>
Converted from the source document on 2026-03-22. The repo does not retain downloaded source files; they were fetched transiently, converted to Markdown, and deleted after extraction.
</Note>

## Metadata

| Field | Value |
| --- | --- |
| Content type | Paper / report |
| Authors | Najmul Hasan, Prashanth BusiReddyGari |
| Year | 2026 |
| Venue | arXiv 2602.13255 |
| Research bucket | P1 strong adjacent work |
| Maps to | Distributed-information coordination benchmarks with simultaneous constraints. |
| Harness fit | Useful benchmark for testing whether coordination-heavy planning systems scale beyond serial reasoning. |
| Source page | [Open source](https://arxiv.org/abs/2602.13255) |
| Source PDF | [Open PDF](https://arxiv.org/pdf/2602.13255.pdf) |

## Extracted text
### Page 1

DPBench: Large Language Models Struggle with Simultaneous Coordination

Najmul Hasan * 1 Prashanth BusiReddyGari * 1

Abstract

Large language models are increasingly deployed

in multi-agent systems, yet we lack benchmarks

that test whether they can coordinate under re-

source contention. We introduce DPBench, a

benchmark based on the Dining Philosophers

problem that evaluates LLM coordination across

eight conditions that vary decision timing, group

size, and communication. Our experiments with

GPT-5.2, Claude Opus 4.5, and Grok 4.1 reveal a

striking asymmetry: LLMs coordinate effectively

in sequential settings but fail when decisions must

be made simultaneously, with deadlock rates ex-

ceeding 95% under some conditions. We trace

this failure to convergent reasoning, where agents

independently arrive at identical strategies that,

when executed simultaneously, guarantee dead-

lock. Contrary to expectations, enabling commu-

nication does not resolve this problem and can

even increase deadlock rates. Our findings sug-

gest that multi-agent LLM systems requiring con-

current resource access may need external coor-

dination mechanisms rather than relying on emer-

gent coordination. DPBench is released as an

open-source benchmark. 2

1. Introduction

Large language models are increasingly deployed in multi-

agent systems (Hong et al., 2024; Bo et al., 2024; Kim et al.,

2024). Multiple LLM agents collaborate on complex tasks,

from software development to scientific research (Du et al.,

2024). These systems raise a fundamental question: when

multiple agents must make decisions about shared resources,

can they coordinate effectively?

Consider a simple scenario: two LLM agents need to access

the same database. If both attempt to write simultaneously,

they may corrupt data or create inconsistencies. They need

1

Department of Mathematics and Computer Science, University

of North Carolina at Pembroke.

Preprint. February 17, 2026.

2

https://github.com/najmulhasan-code/

dpbench; install via pip install dpbench

P0

P1

P2P3

P4

circular wait

holds needs (blocked)

Figure 1. Deadlock state in the Dining Philosophers problem (N =

5). Each philosopher holds one of their two adjacent forks (green)

but needs the other to eat. That fork is held by their neighbor

(red dashed), forming a circular wait: P0→P4→P3→P2→P1→P0.

No agent can proceed. This is the coordination failure DPBench

measures.

to coordinate, whether by taking turns or by dividing the

work so that their actions are compatible. This type of

coordination is essential for reliable multi-agent systems.

However, current LLM benchmarks do not test this capabil-

ity. Existing benchmarks evaluate single-agent performance

on knowledge (Hendrycks et al., 2021), reasoning (Wei

et al., 2022), planning (Valmeekam et al., 2023a), or strate-

gic games (Duan et al., 2024). Multi-agent benchmarks

typically use turn-based interaction where agents respond in

sequence, avoiding the challenge of simultaneous decisions.

Zero-shot coordination benchmarks exist for reinforcement

learning agents (Wang et al., 2024; Hu et al., 2020) but

not for LLMs. We lack a benchmark that specifically tests

whether LLMs can coordinate when they must act at the

same time.

We introduce DPBench, a benchmark for evaluating LLM

coordination based on the Dining Philosophers problem (Di-

jkstra, 1965). In this classic coordination puzzle, agents

must acquire shared resources (forks) to complete a task

(eating), but concurrent acquisition can lead to deadlock (all

agents stuck waiting). The problem has been studied for six

decades and provides a rigorous test of coordination under

1

arXiv:2602.13255v1 [cs.AI] 2 Feb 2026

### Page 2

DPBench: LLMs Struggle with Simultaneous Coordination

resource contention.

DPBench tests LLMs on eight conditions varying three fac-

tors: simultaneous versus sequential decision-making, three

versus five agents, and with or without inter-agent com-

munication. We define six standardized metrics including

deadlock rate, throughput, and fairness. The benchmark is

model-agnostic and designed for reproducible evaluation.

We evaluated three frontier models: GPT-5.2, Claude Opus

4.5, and Grok 4.1. Our experiments reveal that current

LLMs struggle with simultaneous coordination. GPT-5.2,

the best-performing model, achieves 0% deadlock in se-

quential mode, but 25–95% deadlock in simultaneous mode.

Communication between agents does not reliably improve

coordination and sometimes increases deadlock rates.

These findings have implications for deploying LLMs in

multi-agent systems. Applications that require simultane-

ous decisions about shared resources, such as autonomous

vehicles, collaborative robotics, and distributed computing,

may experience coordination failures. Sequential protocols

or external coordination mechanisms may be necessary.

Contributions. (1) We introduce DPBench, the first bench-

mark specifically designed to test LLM coordination under

simultaneous decision-making. (2) We evaluate frontier

models and find that they struggle with simultaneous coor-

dination, while succeeding in sequential coordination. (3)

We analyze why LLMs fail and discuss implications for

multi-agent deployment.

2. The Coordination Problem

Large language models (Brown et al., 2020) are increasingly

deployed in multi-agent systems where multiple models

interact. This raises the question: can LLMs coordinate their

actions to achieve shared goals while avoiding conflicts?

What is coordination? In multi-agent systems, coordina-

tion refers to the ability of agents to select actions that are

mutually compatible. Agents must avoid conflicts (e.g., two

agents grabbing the same resource) and achieve efficient

outcomes (e.g., maximizing total utility). Coordination is

challenging because each agent’s optimal action depends on

what others do.

Sequential vs. simultaneous decisions. Coordination prob-

lems differ fundamentally based on timing. In sequential

settings, agents observe the actions of others before decid-

ing. This is strictly easier: if agent A acts first, agent B

can adapt. In simultaneous settings, all agents decide at

the same moment without observing current actions. This

requires each agent to predict what the others will do.

Most multi-agent LLM benchmarks use sequential or turn-

based interaction (Hua et al., 2024). In dialogue tasks, one

agent speaks and then another responds. In collaborative

problem-solving, agents take turns contributing (Bo et al.,

2024). This turn-taking structure avoids the core challenge

of simultaneous coordination.

Why simultaneous coordination matters; Real-world

multi-agent systems often require simultaneous decisions.

Autonomous vehicles at an intersection must decide concur-

rently. Robotic swarms must coordinate movement without

central control. In these settings, agents cannot wait to see

what others do; they must predict and act.

Why Dining Philosophers? The Dining Philosophers prob-

lem, introduced by Dijkstra in 1965 (Dijkstra, 1965), is the

canonical test for coordination under resource contention.

Philosophers must acquire two shared resources (forks) to

eat, and concurrent acquisition attempts can lead to a dead-

lock. The problem has been studied for six decades in op-

erating systems and distributed computing (Lamport, 1978;

Chandy & Misra, 1984).

We use Dining Philosophers because it isolates the core

coordination challenge: agents must make compatible de-

cisions about shared resources without direct observation

of others’ current choices. The problem has a clear fail-

ure mode (deadlock), well-defined metrics, and theoretical

foundations that allow rigorous analysis.

What DPBench adds. Existing LLM benchmarks focus on

individual capabilities: knowledge (Hendrycks et al., 2021),

reasoning (Mirzadeh et al., 2025), or single-agent tasks (Liu

et al., 2024). Multi-agent benchmarks exist, but typically use

turn-based interaction (Zhu et al., 2025) or test cooperation

without resource contention (Agashe et al., 2025). DPBench

specifically tests simultaneous coordination under resource

contention, a capability that existing benchmarks do not

measure.

3. DPBench

DPBench implements the Dining Philosophers problem as

a multi-agent environment where LLM agents must coor-

dinate to avoid deadlock. We describe the environment,

metrics, and experimental conditions.

3.1. Environment Design

The environment follows Dijkstra’s original formulation (Di-

jkstra, 1965). The N philosophers sit around a circular table

with N forks, one placed between each adjacent pair (Fig-

ure 1). To eat, a philosopher must hold both adjacent forks

simultaneously. Each fork can only be held by one philoso-

pher at a time.

States. Each philosopher is in one of two states: HUNGRY

(seeking forks) or EATING (holding both forks). We use

the “always hungry” variant, where philosophers return to

2

### Page 3

DPBench: LLMs Struggle with Simultaneous Coordination

HUNGRY immediately after eating.

Actions. At each timestep, a philosopher chooses one of

four actions. The GRAB LEFT action picks up the left

fork and succeeds only if that fork is free. Similarly,

GRAB RIGHT picks up the right fork when available. The

RELEASE action releases all held forks, and WAIT does not

take action for the current timestep.

Automatic Release. After a philosopher eats (holds both

forks for one timestep), both forks are automatically re-

leased. This prevents trivial strategies like hoarding forks.

Deadlock Detection. A deadlock occurs when all philoso-

phers are HUNGRY and each holds exactly one fork. In this

state, no philosopher can eat (each needs their neighbor’s

fork) and no philosopher will release (each is waiting for

the other fork). The episode terminates when deadlock is

detected.

Conflict Resolution. In simultaneous mode, if multiple

philosophers attempt to grab the same fork, the philosopher

with the lower ID succeeds. This deterministic rule ensures

reproducibility.

Partial Observability. Each philosopher observes only lo-

cal information: their own state, whether they hold each

fork, and whether each adjacent fork is currently avail-

able. Philosophers cannot see the global table state or other

philosophers’ holdings. When communication is enabled,

philosophers also receive messages from their immediate

neighbors sent in the previous timestep.

3.2. Metrics

DPBench uses six fixed metrics. Standardized metrics en-

able fair comparison across different models and studies.

Primary Metrics:

Deadlock Rate. The fraction of episodes that end in dead-

lock:

Deadlock Rate =

Episodes with deadlock

Total episodes

(1)

Throughput. The average number of meals per timestep,

measuring coordination efficiency:

Throughput =

1

E

EX

e=1

Me

Te

(2)

where Me is total meals in episode e and Te is the number

of timesteps.

Fairness. We measure fairness using the Gini coeffi-

cient (Gini, 1912) over meal distribution. Let mi be meals

eaten by philosopher i, sorted in ascending order. The Gini

coefficient is:

G =

2

PN

i=1 i · mi

N

PN

i=1 mi

−

N + 1

N

(3)

We normalize by Gnorm = G · N

N−1 so that maximum in-

equality yields Gnorm = 1, then report 1 − Gnorm so that

higher values indicate fairer distribution (1.0 = perfect equal-

ity, 0.0 = maximum inequality).

Secondary Metrics:

Time to Deadlock. Average timestep at which deadlock

occurs, computed only over episodes that deadlock.

Starvation Count. Number of philosophers with zero meals

at episode end.

Communication Metric:

Message-Action Consistency. When communication is en-

abled, we measure how often stated intentions match actual

actions. If a philosopher says “I will grab left” and then

executes GRAB LEFT, this counts as consistent.

3.3. Experimental Conditions

DPBench defines eight experimental conditions by varying

three factors:

Decision Mode. We test two decision modes that differ

in timing. In simultaneous mode, all philosophers decide

at the same time without seeing others’ current actions,

which represents the canonical Dining Philosophers setup.

In sequential mode, philosophers decide one at a time, each

seeing the updated state after previous decisions. Sequential

mode is strictly easier since agents can react to what others

have done.

Number of Philosophers. We test with N = 3 and N = 5.

More philosophers increases coordination complexity but

also provides more opportunities for successful coordina-

tion.

Communication. When enabled, philosophers can send a

short message to their neighbors each turn. Messages from

the previous timestep are visible in the current observation.

Table 1 lists all conditions. The condition codes follow the

pattern: mode (sim/seq) + philosophers (3/5) + communica-

tion (c/nc).

4. Experiments

We evaluate frontier LLMs on all eight DPBench conditions.

Our experiments test whether current models can coordinate

effectively under simultaneous decision-making.

3

### Page 4

DPBench: LLMs Struggle with Simultaneous Coordination

Table 1. Eight experimental conditions in DPBench.

Code Mode N Communication

sim5nc Simultaneous 5 No

sim5c Simultaneous 5 Yes

seq5nc Sequential 5 No

seq5c Sequential 5 Yes

sim3nc Simultaneous 3 No

sim3c Simultaneous 3 Yes

seq3nc Sequential 3 No

seq3c Sequential 3 Yes

Table 2. GPT-5.2 performance across all eight DPBench conditions.

DL = Deadlock Rate, TP = Throughput (meals/timestep), FR =

Fairness (1 = perfect equality).

Condition DL TP FR

sim5nc 0.25 0.446 0.576

sim5c 0.65 0.452 0.527

seq5nc 0.00 0.115 0.540

seq5c 0.00 0.145 0.690

sim3nc 0.95 0.243 0.333

sim3c 1.00 0.190 0.379

seq3nc 0.00 0.107 0.617

seq3c 0.10 0.128 0.702

4.1. Setup

Models. We evaluate three frontier models: GPT-5.2 (Ope-

nAI), Claude Opus 4.5 (Anthropic), and Grok 4.1 (xAI).

We conduct full evaluation across all eight conditions with

GPT-5.2 and evaluate Claude and Grok on a representative

subset of conditions for cross-model comparison.

Parameters. Each condition runs for 20 episodes with a

maximum of 30 timesteps per episode. We use temperature

0.7 and seed 42 for reproducibility.

Prompts. Each LLM agent receives a system prompt de-

scribing the Dining Philosophers problem, available actions,

and goals (avoid deadlock, maximize throughput, ensure

fairness). At each timestep, agents receive an observation

prompt showing their current state, which forks they hold,

and fork availability. When communication is enabled,

agents also see messages from neighbors and can send their

own. Full prompts are in Appendix A.

4.2. Results

GPT-5.2 Full Evaluation. Table 2 shows GPT-5.2 perfor-

mance across all eight conditions.

Several patterns emerge, visualized in Figure 2. First, si-

multaneous mode produces substantially higher deadlock

rates than sequential mode. In sequential mode without

communication, GPT-5.2 achieves zero deadlocks for both

N = 3 and N = 5. In simultaneous mode, deadlock rates

S3-S3+ S5-S5+ Q3-Q3+ Q5-Q5+

Condition (S=Simultaneous, Q=Sequential, 3/5=Philosophers, -/+=Comm)

0

20

40

60

80

100

Deadlock Rate (%)

95

100

25

65

10

Simultaneous

Sequential

Figure 2. GPT-5.2 deadlock rates across all eight DPBench condi-

tions. Simultaneous mode (orange) produces dramatically higher

deadlock rates than sequential mode (blue). The gap is most pro-

nounced with 3 philosophers, where simultaneous mode reaches

95–100% deadlock while sequential mode stays near 0%.

Table 3. Cross-model comparison on shared conditions.

Condition Model DL TP FR

sim5nc

GPT-5.2 0.25 0.446 0.576

Claude 4.5 0.55 0.455 0.619

Grok 4.1 0.70 0.437 0.578

sim5c

GPT-5.2 0.65 0.452 0.527

Claude 4.5 0.60 0.554 0.717

Grok 4.1 0.60 0.438 0.743

seq5nc

GPT-5.2 0.00 0.115 0.540

Claude 4.5 0.60 0.078 0.890

Grok 4.1 0.25 0.112 0.655

reach 25% (N = 5) and 95% (N = 3).

Second, three philosophers proves harder than five in simul-

taneous mode. This counterintuitive result occurs because

with fewer philosophers, the probability that all grab the

same direction (causing immediate deadlock) is higher.

Third, communication increases deadlock in simultaneous

mode with 5 philosophers (25% to 65%), as shown in Fig-

ure 4. Agents attempt to coordinate through messages but

fail to act on them consistently. The message-action con-

sistency metric shows only 29% alignment between stated

intentions and actual actions.

Cross-Model Comparison. Table 3 compares all three

models on the conditions they share: sim5nc, sim5c, and

seq5nc.

Figure 3 visualizes the cross-model comparison. GPT-5.2

achieves the lowest deadlock rates across conditions. In

simultaneous mode without communication, deadlock rates

range from 25% (GPT-5.2) to 70% (Grok 4.1). All models

struggle with simultaneous coordination, confirming that

this is a challenging capability for current LLMs.

The sequential mode reveals interesting differences. GPT-

5.2 achieves zero deadlocks, while Claude and Grok still

experience deadlocks (60% and 25% respectively). This sug-

gests that even with the advantage of seeing others’ actions,

some models fail to exploit the information effectively.

4

### Page 5

DPBench: LLMs Struggle with Simultaneous Coordination

Sim 5P

No Comm

Sim 5P

Comm

Seq 5P

No Comm

0

20

40

60

80

Deadlock Rate (%)

25

65

55

60 60

70

60

25

GPT-5.2

Claude 4.5

Grok 4.1

Figure 3. Cross-model comparison of deadlock rates. GPT-5.2

(blue) achieves 0% deadlock in sequential mode, while Claude

4.5 (orange) and Grok 4.1 (green) still deadlock 60% and 25% of

episodes respectively. All models struggle in simultaneous mode,

with deadlock rates between 25–70%.

5. Analysis

Our results reveal fundamental limitations in how LLMs

coordinate under simultaneous decision-making. We discuss

the key findings, their causes, and implications.

Finding 1: Simultaneous coordination is fundamentally

harder. The gap between simultaneous and sequential

modes is substantial. GPT-5.2 achieves 0% deadlock in

sequential mode but 25–95% in simultaneous mode. This

gap persists across all models tested.

The explanation lies in the nature of the decision process.

In sequential mode, agents observe the updated state after

each decision. If philosopher P0 grabs their left fork, P1

sees this and can adapt. In simultaneous mode, all agents

decide based on the same snapshot. If all reason “both forks

are free, I should grab left,” all attempt the same action

simultaneously, and deadlock follows.

Finding 2: Communication does not solve the coordi-

nation problem. We expected communication to reduce

deadlock rates. Instead, enabling communication increased

deadlocks in simultaneous mode with 5 philosophers (25%

to 65% for GPT-5.2). This pattern persists across all condi-

tions (Figure 4).

Examining the transcripts reveals why. Agents send mes-

sages like “I will grab my left fork” but then face a timing

problem: messages arrive one timestep late. By the time

neighbors receive the message, the sender has already acted.

Moreover, message-action consistency is low (29–44%),

meaning agents often do not follow through on stated inten-

tions.

Finding 3: Fewer agents can mean harder coordination.

With 3 philosophers, deadlock rates reached 95–100% in

3P Sim 5P Sim 3P Seq 5P Seq

0

20

40

60

80

100

Deadlock Rate (%)

95

25

100

65

10

No Comm

With Comm

Figure 4. Effect of communication on deadlock rates. Contrary to

expectations, enabling communication (pink) often increases dead-

lock compared to no communication (blue). In simultaneous mode

with 5 philosophers, deadlock rises from 25% to 65%. Sequential

mode remains near 0% regardless of communication.

simultaneous mode, compared to 25–65% with 5 philoso-

phers. With 3 agents in a symmetric situation, if all choose

the same direction (e.g., all grab left), immediate deadlock

occurs. With 5 agents, there is more room for heterogeneous

behavior to emerge.

Why LLMs Fail at Simultaneous Coordination. The core

challenge is prediction under uncertainty. In simultaneous

mode, each agent must predict what others will do, then

choose an action that works well given those predictions.

This is precisely the challenge studied in game-theoretic

evaluations (Duan et al., 2024; Mozikov et al., 2024), where

LLMs have shown limitations in strategic reasoning. Hu-

mans solve coordination problems through conventions (e.g.,

always grab the lower-numbered fork first) or randomization.

LLMs, trained to give helpful and logical responses (Ouyang

et al., 2022), tend to converge on similar reasoning patterns.

When all agents reason identically, they act identically, and

identical action in the Dining Philosophers problem leads

to deadlock. Figure 5 illustrates this phenomenon with an

actual transcript excerpt.

This convergence phenomenon relates to broader concerns

about multi-agent AI systems and potential coordination

failures (Motwani et al., 2024).

This is not a failure of reasoning capability. The models

understand the problem and can articulate strategies to avoid

deadlock. The failure is in coordination: translating individ-

ual reasoning into compatible joint action without explicit

communication timing.

Implications for Deployment. Our results suggest caution

when deploying multiple LLM agents in settings requiring

simultaneous coordination. Applications where agents must

make concurrent decisions about shared resources, such

as traffic control, emergency response coordination, and

5

### Page 6

DPBench: LLMs Struggle with Simultaneous Coordination

GPT-5.2, simultaneous mode, N = 3, no communication.

Timestep 4:

P0: “Both forks available; I’ll follow a consistent order and

pick up my right fork first.” → grab right

P1: “Both forks available; I’ll start by taking my right fork

(consistent ordering can help).” → grab right

P2: “Both forks available; I’ll follow a consistent order and

pick up my right fork first.” → grab right

Result: All three philosophers now hold one fork each.

DEADLOCK.

Figure 5. Convergent reasoning leading to deadlock. All three

philosophers independently decide to follow a “consistent order”

by grabbing their right fork first. This identical reasoning produces

identical actions, resulting in immediate deadlock.

resource allocation, may experience coordination failures

similar to those observed here.

Sequential protocols, where agents take turns and observe

others’ actions, appear much safer. If simultaneous deci-

sions are unavoidable, external coordination mechanisms

(locks, arbiters, or turn-taking protocols) may be necessary.

Limitations. This study has several limitations. First, we

tested only three models due to API costs and runtime. Re-

sults may differ for other models. Second, we used a single

prompt design. Different prompting strategies might im-

prove coordination. Third, we tested only N = 3 and

N = 5. Larger groups might exhibit different dynam-

ics. Fourth, the Dining Philosophers problem is stylized;

real-world coordination may involve richer state and action

spaces.

6. Related Work

LLM Benchmarks. Current benchmarks focus on single-

agent capabilities. MMLU (Hendrycks et al., 2021) tests

knowledge across 57 domains. GSM-Symbolic (Mirzadeh

et al., 2025) tests mathematical reasoning. AgentBench (Liu

et al., 2024) tests LLMs as agents on web browsing, cod-

ing, and game tasks. GTBench (Duan et al., 2024) evaluates

strategic reasoning through game-theoretic tasks but focuses

on two-player competitive games. PlanBench (Valmeekam

et al., 2023a) tests planning and reasoning about change.

AgentHarm (Andriushchenko et al., 2025) measures po-

tential harms from LLM agents in multi-step scenarios.

These benchmarks evaluate individual performance, not

multi-agent coordination under simultaneous decisions.

LLM Reasoning. Chain-of-thought prompting (Wei et al.,

2022) enables LLMs to solve complex reasoning tasks by

generating intermediate steps. Self-consistency (Wang et al.,

2023) improves reasoning by sampling multiple paths and

selecting the most consistent answer. Tree of Thoughts (Yao

et al., 2023a) extends this to deliberate exploration of rea-

soning paths. ReAct (Yao et al., 2023b) combines reasoning

with acting in interactive environments. Language Agent

Tree Search (Zhou et al., 2024) unifies reasoning, acting,

and planning through Monte Carlo tree search. Despite

these advances, recent work shows LLMs struggle with

planning tasks (Valmeekam et al., 2023b; Kambhampati

et al., 2024). Kambhampati et al. argue that LLMs cannot

plan autonomously but can assist planning in hybrid frame-

works. Self-verification has also proven unreliable (Stechly

et al., 2025). Thought of Search (Katz et al., 2024) pro-

poses more efficient planning by using LLMs to generate

search components rather than performing search directly.

Our findings align with these limitations in the multi-agent

setting.

Multi-Agent LLM Systems. Recent work explores LLMs

in multi-agent settings. MetaGPT (Hong et al., 2024) en-

ables multi-agent collaboration for software development.

MultiAgentBench (Zhu et al., 2025) evaluates collabora-

tion and competition but uses turn-based interaction. LLM-

Coordination (Agashe et al., 2025) studies coordination

in game-theoretic settings. DeMac (Liu et al., 2025) en-

hances coordination through dynamic task allocation. MDA-

gents (Kim et al., 2024) adaptively assigns collaboration

structures for medical decision-making. Multiagent de-

bate (Du et al., 2024) improves reasoning and factuality by

having multiple LLM instances debate their responses. Re-

flective collaboration (Bo et al., 2024) uses self-reflection to

enhance multi-agent coordination. Research on LLM negoti-

ation (Hua et al., 2024; Kwon et al., 2025) explores strategic

multi-turn dialogue. Work on emergent behaviors shows

that LLM agents can develop volunteer and conformity be-

haviors in collaboration (Ma et al., 2024). Theory-of-mind

benchmarks like OpenToM (Xu et al., 2024), Hi-ToM (Wu

et al., 2023), and Hypothetical Minds (Cross et al., 2025)

test whether LLMs can model others’ beliefs. These works

advance our understanding of multi-agent LLMs but do not

test simultaneous coordination under resource contention.

Multi-Agent Reinforcement Learning. In MARL, coor-

dination has been extensively studied (Lanctot et al., 2017).

Value decomposition methods like VDN (Sunehag et al.,

2018) and QMIX (Rashid et al., 2018) learn decentral-

ized policies with centralized training. MADDPG (Lowe

et al., 2017) extends actor-critic methods to multi-agent

settings. CommNet (Sukhbaatar et al., 2016) and DIAL (Fo-

erster et al., 2016) study learned communication protocols.

Zero-shot coordination, where agents must coordinate with

unseen partners, is studied through methods like Other-

Play (Hu et al., 2020) and trajectory diversity (Lupu et al.,

2021). ZSC-Eval (Wang et al., 2024) provides a compre-

hensive benchmark for evaluating zero-shot coordination.

Language grounding has been explored to make emergent

6

### Page 7

DPBench: LLMs Struggle with Simultaneous Coordination

communication interpretable (Li et al., 2024). Work on

emergent communication (Eccles et al., 2019; Lazaridou

& Baroni, 2021; Chaabouni et al., 2021) shows that agents

can develop effective signaling strategies through training.

These approaches use learned policies optimized over many

episodes, whereas LLMs rely on in-context reasoning (Xie

et al., 2022) without task-specific training.

Dining Philosophers. The Dining Philosophers problem

was introduced by Dijkstra (Dijkstra, 1965) to illustrate

deadlock and mutual exclusion. Lamport (Lamport, 1978)

connected the problem to distributed systems and logical

clocks. Chandy and Misra (Chandy & Misra, 1984) general-

ized it to the Drinking Philosophers problem with dynamic

resource requirements. The problem has been a staple of

concurrent programming education for decades. We use it as

a benchmark because it provides a minimal, well-understood

test of coordination under resource contention.

7. Conclusion

We introduced DPBench, a benchmark that tests whether

LLMs can coordinate under resource contention using the

Dining Philosophers problem. Our experiments with GPT-

5.2, Claude Opus 4.5, and Grok 4.1 reveal three key findings.

First, LLMs exhibit a fundamental asymmetry in coordina-

tion: they succeed in sequential settings where they observe

others’ actions but fail dramatically in simultaneous settings,

with deadlock rates reaching 95–100% in some conditions.

Second, we identify convergent reasoning as the underlying

cause: agents independently arrive at identical “rational”

strategies that, when executed simultaneously, guarantee

deadlock. Third, contrary to intuition, enabling communi-

cation does not resolve this problem and can even increase

deadlock rates, as agents fail to act consistently on stated

intentions.

These findings have implications for deploying multi-agent

LLM systems. Applications requiring concurrent decisions

about shared resources, such as autonomous vehicles, col-

laborative robotics, or distributed computing, may need

external coordination mechanisms rather than relying on

emergent coordination among agents.

Our study has limitations. We tested three models on a styl-

ized problem with small group sizes. Real-world coordina-

tion involves richer state spaces and larger agent populations.

Future work should explore whether fine-tuning on coordi-

nation tasks can develop this capability, whether alternative

communication protocols (such as explicit turn-taking or

leader election) improve outcomes, and how coordination

scales with agent count.

We release DPBench to enable the research community to

measure progress on this challenge and to develop LLM

systems capable of reliable multi-agent coordination.

Impact Statement

This paper introduces DPBench, a benchmark for evaluating

coordination capabilities in multi-agent LLM systems. We

discuss potential impacts below.

Positive Impacts. Our work can help identify coordination

failures before LLM agents are deployed in high-stakes ap-

plications. By revealing that current models struggle with

simultaneous decision-making, we provide guidance for

practitioners: systems requiring concurrent resource access

should incorporate external coordination mechanisms rather

than assuming emergent coordination. This finding may pre-

vent failures in safety-critical domains such as autonomous

systems and collaborative robotics.

Potential Concerns. Our benchmark could be misused to

identify exploitable coordination weaknesses in deployed

systems. However, the coordination failures we document

(convergent reasoning, communication ineffectiveness) are

fundamental limitations rather than specific vulnerabilities,

making targeted exploitation unlikely. Additionally, running

large-scale LLM experiments incurs computational and en-

vironmental costs; we report token usage and API calls to

enable cost-aware replication.

Limitations of Benchmark Evaluation. As with any

benchmark, performance on DPBench may not fully predict

real-world coordination capabilities. The Dining Philoso-

phers problem is a stylized setting; actual multi-agent de-

ployments involve richer contexts and larger scales. We

encourage complementary evaluation approaches alongside

benchmark testing.

References

Agashe, S., Fan, Y., Reyna, A., and Wang, X. E. LLM-

coordination: Evaluating and analyzing multi-agent coor-

dination abilities in large language models. In Findings of

the Association for Computational Linguistics: NAACL

2025, pp. 8038–8057, Albuquerque, New Mexico, April

2025. Association for Computational Linguistics. doi:

10.18653/v1/2025.findings-naacl.448.

Andriushchenko, M., Souly, A., Dziemian, M., Duenas,

D., Lin, M., Wang, J., Hendrycks, D., Zou, A., Kolter,

Z., Fredrikson, M., Winsor, E., Wynne, J., Gal, Y.,

and Davies, X. AgentHarm: A benchmark for mea-

suring harmfulness of LLM agents. In The Thirteenth

International Conference on Learning Representations,

2025. URL https://openreview.net/forum?

id=AC5n7xHuR1.

Bo, X., Zhang, Z., Dai, Q., Feng, X., Wang, L., Li, R., Chen,

7

### Page 8

DPBench: LLMs Struggle with Simultaneous Coordination

X., and Wen, J.-R. Reflective multi-agent collaboration

based on large language models. In Advances in Neu-

ral Information Processing Systems, volume 37. Curran

Associates, Inc., 2024.

Brown, T., Mann, B., Ryder, N., Subbiah, M., Kaplan, J. D.,

Dhariwal, P., Neelakantan, A., Shyam, P., Sastry, G.,

Askell, A., et al. Language models are few-shot learners.

In Advances in Neural Information Processing Systems,

volume 33, pp. 1877–1901. Curran Associates, Inc., 2020.

Chaabouni, R., Kharitonov, E., Bouchacourt, D., Dupoux,

E., and Baroni, M. Emergent communication under vary-

ing sizes and connectivities. In Advances in Neural In-

formation Processing Systems, volume 34. Curran Asso-

ciates, Inc., 2021.

Chandy, K. M. and Misra, J. The drinking philosophers

problem. ACM Transactions on Programming Languages

and Systems, 6(4):632–646, October 1984. doi: 10.1145/

1780.1804.

Cross, L., Xiang, V., Bhatia, A., Yamins, D. L., and Haber,

N. Hypothetical minds: Scaffolding theory of mind for

multi-agent tasks with large language models. In The Thir-

teenth International Conference on Learning Represen-

tations, 2025. URL https://openreview.net/

forum?id=otW0TJOUYF.

Dijkstra, E. W. Solution of a problem in concurrent pro-

gramming control. Communications of the ACM, 8(9):

569, 1965. doi: 10.1145/365559.365617.

Du, Y., Li, S., Torralba, A., Tenenbaum, J. B., and Mordatch,

I. Improving factuality and reasoning in language models

through multiagent debate. In Proceedings of the 41st

International Conference on Machine Learning, volume

235 of Proceedings of Machine Learning Research, pp.

11733–11763. PMLR, 2024.

Duan, J., Zhang, R., Diffenderfer, J., Kailkhura, B., Sun, L.,

Stengel-Eskin, E., Bansal, M., Chen, T., and Xu, K. GT-

Bench: Uncovering the strategic reasoning capabilities

of LLMs via game-theoretic evaluations. In Advances

in Neural Information Processing Systems, volume 37.

Curran Associates, Inc., 2024.

Eccles, T., Bachrach, Y., Lever, G., Lazaridou, A., and Grae-

pel, T. Biases for emergent communication in multi-agent

reinforcement learning. In Advances in Neural Informa-

tion Processing Systems, volume 32. Curran Associates,

Inc., 2019.

Foerster, J., Assael, I. A., de Freitas, N., and Whiteson,

S. Learning to communicate with deep multi-agent rein-

forcement learning. In Advances in Neural Information

Processing Systems, volume 29, pp. 2137–2145. Curran

Associates, Inc., 2016.

Gini, C. Variabilit`a e mutabilit`a: contributo allo studio

delle distribuzioni e delle relazioni statistiche. Studi

Economico-Giuridici della Regia Universit`a di Cagliari.

Tipografia di Paolo Cuppini, Bologna, 1912.

Hendrycks, D., Burns, C., Basart, S., Zou, A., Mazeika, M.,

Song, D., and Steinhardt, J. Measuring massive multitask

language understanding. In International Conference

on Learning Representations, 2021. URL https://

openreview.net/forum?id=d7KBjmI3GmQ.

Hong, S., Zhuge, M., Chen, J., Zheng, X., Cheng, Y., Zhang,

C., Wang, J., Wang, Z., Yau, S. K. S., Lin, Z., et al.

MetaGPT: Meta programming for a multi-agent collabo-

rative framework. In The Twelfth International Confer-

ence on Learning Representations, 2024. URL https:

//openreview.net/forum?id=VtmBAGCN7o.

Hu, H., Lerer, A., Peysakhovich, A., and Foerster, J. “other-

play” for zero-shot coordination. In Proceedings of the

37th International Conference on Machine Learning, vol-

ume 119 of Proceedings of Machine Learning Research,

pp. 4399–4410. PMLR, 2020.

Hua, Y., Qu, L., and Haffari, G. Assistive large language

model agents for socially-aware negotiation dialogues.

In Findings of the Association for Computational Lin-

guistics: EMNLP 2024, pp. 8047–8074, Miami, Florida,

USA, 2024. Association for Computational Linguistics.

Kambhampati, S., Valmeekam, K., Guan, L., Verma, M.,

Stechly, K., Bhambri, S., Saldyt, L., and Murthy, A. Po-

sition: LLMs can’t plan, but can help planning in LLM-

modulo frameworks. In Proceedings of the 41st Interna-

tional Conference on Machine Learning, volume 235 of

Proceedings of Machine Learning Research, pp. 22895–

22907. PMLR, 2024.

Katz, M., Kokel, H., Srinivas, K., and Sohrabi, S. Thought

of search: Planning with language models through the

lens of efficiency. In Advances in Neural Information

Processing Systems, volume 37. Curran Associates, Inc.,

2024.

Kim, Y., Park, C., Jeong, H., Chan, Y. S., Xu, X., McDuff,

D., Lee, H., Ghassemi, M., Breazeal, C., and Park, H. W.

MDAgents: An adaptive collaboration of LLMs for med-

ical decision-making. In Advances in Neural Information

Processing Systems, volume 37. Curran Associates, Inc.,

2024.

Kwon, D., Hae, J., Clift, E., Shamsoddini, D., Gratch, J.,

and Lucas, G. ASTRA: A negotiation agent with adap-

tive and strategic reasoning via tool-integrated action for

dynamic offer optimization. In Proceedings of the 2025

Conference on Empirical Methods in Natural Language

Processing, pp. 16228–16249, Suzhou, China, 2025. As-

sociation for Computational Linguistics.

8

### Page 9

DPBench: LLMs Struggle with Simultaneous Coordination

Lamport, L. Time, clocks, and the ordering of events in a

distributed system. Communications of the ACM, 21(7):

558–565, July 1978. doi: 10.1145/359545.359563.

Lanctot, M., Zambaldi, V., Gruslys, A., Lazaridou, A.,

Tuyls, K., P´erolat, J., Silver, D., and Graepel, T. A uni-

fied game-theoretic approach to multiagent reinforcement

learning. In Advances in Neural Information Processing

Systems, volume 30. Curran Associates, Inc., 2017.

Lazaridou, A. and Baroni, M. Emergent communication

of generalizations. In Advances in Neural Information

Processing Systems, volume 34. Curran Associates, Inc.,

2021.

Li, H., Mahjoub, H. N., Chalaki, B., Tadiparthi, V., Lee,

K., Moradi-Pari, E., Lewis, M., and Sycara, K. Lan-

guage grounded multi-agent reinforcement learning with

human-interpretable communication. In Advances in Neu-

ral Information Processing Systems, volume 37. Curran

Associates, Inc., 2024.

Liu, X., Yu, H., Zhang, H., Xu, Y., Lei, X., Lai, H., Gu, Y.,

Ding, H., Men, K., Yang, K., et al. Agentbench: Evaluat-

ing LLMs as agents. In The Twelfth International Confer-

ence on Learning Representations, 2024. URL https:

//openreview.net/forum?id=zAdUB0aCTQ.

Liu, Y., Xu, C., Liu, L., Wang, Y., Chen, F., Jia, Q., Zhao, Y.,

Wang, Z., and Li, X. DeMAC: Enhancing multi-agent co-

ordination with dynamic DAG and manager-player feed-

back. In Findings of the Association for Computational

Linguistics: EMNLP 2025, pp. 14072–14098, Suzhou,

China, November 2025. Association for Computational

Linguistics. doi: 10.18653/v1/2025.findings-emnlp.757.

Lowe, R., Wu, Y., Tamar, A., Harb, J., Abbeel, P., and Mor-

datch, I. Multi-agent actor-critic for mixed cooperative-

competitive environments. In Advances in Neural In-

formation Processing Systems, volume 30. Curran Asso-

ciates, Inc., 2017.

Lupu, A., Cui, B., Hu, H., and Foerster, J. Trajectory diver-

sity for zero-shot coordination. In Proceedings of the 38th

International Conference on Machine Learning, volume

139 of Proceedings of Machine Learning Research, pp.

7204–7213. PMLR, 2021.

Ma, H., Hu, T., Pu, Z., Liu, B., Ai, X., Liang, Y., and Chen,

M. Coevolving with the other you: Fine-tuning LLM

with sequential cooperative multi-agent reinforcement

learning. In Advances in Neural Information Processing

Systems, volume 37. Curran Associates, Inc., 2024.

Mirzadeh, I., Alizadeh, K., Shahrokhi, H., Tuzel, O., Ben-

gio, S., and Farajtabar, M. GSM-Symbolic: Understand-

ing the limitations of mathematical reasoning in large

language models. In The Thirteenth International Confer-

ence on Learning Representations, 2025. URL https:

//openreview.net/forum?id=AjXkRZIvjB.

Motwani, S. R., Baranchuk, M., Strohmeier, M., Bolina,

V., Torr, P. H., Hammond, L., and Schroeder de Witt, C.

Secret collusion among AI agents: Multi-agent deception

via steganography. In Advances in Neural Information

Processing Systems, volume 37. Curran Associates, Inc.,

2024.

Mozikov, M., Severin, N., Bodishtianu, V., Glushanina, M.,

Nasonov, I., Orekhov, D., Pekhotin, V., Makovetskiy, I.,

Baklashkin, M., Lavrentyev, V., Tsvigun, A., Turdakov,

D., Shavrina, T., Savchenko, A., and Makarov, I. EAI:

Emotional decision-making of LLMs in strategic games

and ethical dilemmas. In Advances in Neural Information

Processing Systems, volume 37. Curran Associates, Inc.,

2024.

Ouyang, L., Wu, J., Jiang, X., Almeida, D., Wainwright, C.,

Mishkin, P., Zhang, C., Agarwal, S., Slama, K., Ray, A.,

et al. Training language models to follow instructions

with human feedback. In Advances in Neural Informa-

tion Processing Systems, volume 35, pp. 27730–27744.

Curran Associates, Inc., 2022.

Rashid, T., Samvelyan, M., Schroeder de Witt, C., Far-

quhar, G., Foerster, J., and Whiteson, S. QMIX:

Monotonic value function factorisation for deep multi-

agent reinforcement learning. In Proceedings of

the 35th International Conference on Machine Learn-

ing, volume 80 of Proceedings of Machine Learn-

ing Research, pp. 4295–4304. PMLR, July 2018.

URL https://proceedings.mlr.press/v80/

rashid18a.html.

Stechly, K., Valmeekam, K., and Kambhampati, S. On

the self-verification limitations of large language mod-

els on reasoning and planning tasks. In The Thirteenth

International Conference on Learning Representations,

2025. URL https://openreview.net/forum?

id=4O0v4s3IzY.

Sukhbaatar, S., Szlam, A., and Fergus, R. Learn-

ing multiagent communication with backpropa-

gation. In Advances in Neural Information Pro-

cessing Systems, volume 29. Curran Associates,

Inc., 2016. URL https://proceedings.

neurips.cc/paper/2016/hash/

55b1927fdafef39c48e5b73b5d61ea60-Abstract.

html.

Sunehag, P., Lever, G., Gruslys, A., Czarnecki, W. M., Zam-

baldi, V., Jaderberg, M., Lanctot, M., Sonnerat, N., Leibo,

J. Z., Tuyls, K., and Graepel, T. Value-decomposition net-

works for cooperative multi-agent learning based on team

9

### Page 10

DPBench: LLMs Struggle with Simultaneous Coordination

reward. In Proceedings of the 17th International Confer-

ence on Autonomous Agents and MultiAgent Systems, pp.

2085–2087, 2018.

Valmeekam, K., Marquez, M., Olmo, A., Sreedharan, S.,

and Kambhampati, S. PlanBench: An extensible bench-

mark for evaluating large language models on planning

and reasoning about change. In Advances in Neural In-

formation Processing Systems, volume 36. Curran Asso-

ciates, Inc., 2023a.

Valmeekam, K., Marquez, M., Sreedharan, S., and Kamb-

hampati, S. On the planning abilities of large language

models - a critical investigation. In Advances in Neu-

ral Information Processing Systems, volume 36. Curran

Associates, Inc., 2023b.

Wang, X., Wei, J., Schuurmans, D., Le, Q., Chi, E., Narang,

S., Chowdhery, A., and Zhou, D. Self-consistency im-

proves chain of thought reasoning in language models.

In The Eleventh International Conference on Learning

Representations, 2023. URL https://openreview.

net/forum?id=1PL1NIMMrw.

Wang, X., Zhang, S., Zhang, W., Dong, W., Chen, J., Wen,

Y., and Zhang, W. ZSC-Eval: An evaluation toolkit

and benchmark for multi-agent zero-shot coordination.

In Advances in Neural Information Processing Systems,

volume 37. Curran Associates, Inc., 2024. Datasets and

Benchmarks Track.

Wei, J., Wang, X., Schuurmans, D., Bosma, M., Ichter, B.,

Xia, F., Chi, E., Le, Q. V., and Zhou, D. Chain-of-thought

prompting elicits reasoning in large language models.

In Advances in Neural Information Processing Systems,

volume 35, pp. 24824–24837. Curran Associates, Inc.,

2022.

Wu, Y., He, Y., Jia, Y., Mihalcea, R., Chen, Y., and Deng, N.

Hi-ToM: A benchmark for evaluating higher-order theory

of mind reasoning in large language models. In Find-

ings of the Association for Computational Linguistics:

EMNLP 2023, pp. 10691–10706, Singapore, December

2023. Association for Computational Linguistics. doi:

10.18653/v1/2023.findings-emnlp.717.

Xie, S. M., Raghunathan, A., Liang, P., and Ma, T. An ex-

planation of in-context learning as implicit bayesian infer-

ence. In The Tenth International Conference on Learning

Representations, 2022. URL https://openreview.

net/forum?id=RdJVFCHjUMI.

Xu, H., Zhao, R., Zhu, L., Du, J., and He, Y. OpenToM:

A comprehensive benchmark for evaluating theory-of-

mind reasoning capabilities of large language models. In

Proceedings of the 62nd Annual Meeting of the Associ-

ation for Computational Linguistics (Volume 1: Long

Papers), pp. 8593–8623, Bangkok, Thailand, August

2024. Association for Computational Linguistics. doi:

10.18653/v1/2024.acl-long.466.

Yao, S., Yu, D., Zhao, J., Shafran, I., Griffiths, T. L., Cao,

Y., and Narasimhan, K. Tree of thoughts: Deliberate

problem solving with large language models. In Advances

in Neural Information Processing Systems, volume 36.

Curran Associates, Inc., 2023a.

Yao, S., Zhao, J., Yu, D., Du, N., Shafran, I., Narasimhan,

K. R., and Cao, Y. React: Synergizing reasoning

and acting in language models. In The Eleventh In-

ternational Conference on Learning Representations,

2023b. URL https://openreview.net/forum?

id=WE_vluYUL-X.

Zhou, A., Yan, K., Shlapentokh-Rothman, M., Wang, H.,

and Wang, Y.-X. Language agent tree search unifies

reasoning, acting, and planning in language models. In

Proceedings of the 41st International Conference on Ma-

chine Learning, volume 235 of Proceedings of Machine

Learning Research, pp. 61816–61836. PMLR, 2024.

Zhu, K., Du, H., Hong, Z., Yang, X., Guo, S., Wang, Z.,

Wang, Z., Qian, C., Tang, R., Ji, H., and You, J. MultiA-

gentBench: Evaluating the collaboration and competition

of LLM agents. In Proceedings of the 63rd Annual Meet-

ing of the Association for Computational Linguistics (Vol-

ume 1: Long Papers), pp. 8580–8622, Vienna, Austria,

July 2025. Association for Computational Linguistics.

doi: 10.18653/v1/2025.acl-long.421.

10

### Page 11

DPBench: LLMs Struggle with Simultaneous Coordination

A. Prompts

We provide the full prompts used in experiments. Variables in braces (e.g., {philosopher name}) are replaced with

actual values at runtime.

System Prompt (No Communication)

You are {philosopher name}, one of {num philosophers} philosophers seated at a

circular dining table.

THE DINING PHILOSOPHERS PROBLEM:

-You and your fellow philosophers share forks placed between each pair of adjacent

philosophers

-To eat, you must hold BOTH your left fork AND your right fork simultaneously

-Each fork can only be held by one philosopher at a time

-After eating, you automatically release both forks

YOUR GOAL:

-Coordinate with others to avoid DEADLOCK (where everyone holds one fork and waits

forever)

-Maximize total meals eaten by the group

-Ensure fair distribution of meals among all philosophers

AVAILABLE ACTIONS:

-GRAB LEFT: Pick up the fork on your left (if available)

-GRAB RIGHT: Pick up the fork on your right (if available)

-RELEASE: Release any forks you are holding

-WAIT: Do nothing this turn

RESPONSE FORMAT:

THINKING: [Brief reasoning about the current situation]

ACTION: [One of: GRAB LEFT, GRAB RIGHT, RELEASE, WAIT]

Figure 6. System prompt provided to each LLM agent at the start of an episode. This prompt establishes the problem context, goals, and

expected response format.

Decision Prompt (No Communication)

You are {philosopher name}.

CURRENT STATE:

-Your state: {state}

-Meals eaten: {meals eaten}

-Currently holding: {holding status}

FORK STATUS:

-Left fork: {left fork status}

-Right fork: {right fork status}

What is your action?

THINKING: [Your reasoning]

ACTION: [GRAB LEFT /GRAB RIGHT /RELEASE /WAIT]

Figure 7. Decision prompt sent at each timestep. Variables are populated with the agent’s current state and fork availability.

11

### Page 12

DPBench: LLMs Struggle with Simultaneous Coordination

Communication Addition (System Prompt)

COMMUNICATION:

-You can send a message to your neighbors each turn

-Use messages to coordinate and avoid conflicts

-Be concise and clear in your communication

RESPONSE FORMAT:

THINKING: [Brief reasoning about the current situation]

MESSAGE: [Short message to your neighbors, or "None"]

ACTION: [One of: GRAB LEFT, GRAB RIGHT, RELEASE, WAIT]

Figure 8. Additional section appended to the system prompt when communication is enabled. The response format is extended to include

a message field.

Communication Addition (Decision Prompt)

NEIGHBOR MESSAGES:

-From left neighbor: {left message}

-From right neighbor: {right message}

What is your action? You may also send a message to coordinate.

THINKING: [Your reasoning]

MESSAGE: [Short message to neighbors, or "None"]

ACTION: [GRAB LEFT /GRAB RIGHT /RELEASE /WAIT]

Figure 9. Additional section in the decision prompt when communication is enabled. Agents receive messages from neighbors sent in the

previous timestep.

B. Additional Results

Table 4 provides extended metrics for GPT-5.2 across all conditions, including standard deviations and secondary metrics.

Table 4. Extended GPT-5.2 results with standard deviations. TTD = Time to Deadlock, SC = Starvation Count, MAC = Message-Action

Consistency (%).

Condition DL TP (std) FR (std) TTD SC MAC

sim5nc 0.25 0.45 (0.16) 0.58 (0.21) 11.8 1.15 N/A

sim5c 0.65 0.45 (0.15) 0.53 (0.22) 13.2 1.40 28.9

seq5nc 0.00 0.12 (0.02) 0.54 (0.21) N/A 1.75 N/A

seq5c 0.00 0.15 (0.02) 0.69 (0.25) N/A 1.10 34.2

sim3nc 0.95 0.24 (0.11) 0.33 (0.35) 7.9 1.60 N/A

sim3c 1.00 0.19 (0.12) 0.38 (0.45) 5.7 1.90 42.2

seq3nc 0.00 0.11 (0.02) 0.62 (0.27) N/A 0.55 N/A

seq3c 0.10 0.13 (0.04) 0.70 (0.22) 7.5 0.40 27.4

Table 5 reports computational costs for each model on the sim5nc condition, the primary simultaneous mode benchmark

where all three models were evaluated. Latency is the average API response time per call. Token counts are reported by the

respective APIs.

Table 5. Computational costs per model on sim5nc condition (20 episodes).

Model Avg Latency (ms) Total Tokens LLM Calls

GPT-5.2 1,626 884,630 2,545

Claude 4.5 5,245 1,000,055 2,050

Grok 4.1 9,235 924,540 1,895

12

### Page 13

DPBench: LLMs Struggle with Simultaneous Coordination

C. Implementation Details

C.1. Agent Orchestration

DPBench uses LangGraph to orchestrate agent execution. In simultaneous mode, the graph executes all philosopher nodes

in parallel within a single timestep. Each node receives the same observation snapshot, calls the LLM independently, and

returns a decision. After all decisions are collected, an apply node resolves conflicts and updates the table state. In sequential

mode, philosopher nodes execute one after another in a chain. Each node observes the current table state, makes a decision,

and immediately applies its action before the next philosopher observes. This means philosopher P1 sees the result of

P0’s action, P2 sees the results of both P0 and P1, and so on. In sequential mode, each philosopher’s action constitutes

one timestep, whereas in simultaneous mode all philosophers act within a single timestep. Consequently, for the same

max timesteps setting, sequential mode executes fewer full rounds than simultaneous mode.

C.2. Model Configuration

We evaluate three frontier models accessed through their respective APIs. GPT-5.2 uses model ID gpt-5.2-2025-12-11

via the OpenAI API. Claude Opus 4.5 uses model ID claude-opus-4-5-20251101 via the Anthropic API. Grok 4.1

uses model ID grok-4-1-fast-reasoning via the xAI API. All models use temperature 0.7 and default maximum

token limits.

C.3. Experimental Parameters

Each condition runs for 20 episodes with a maximum of 30 timesteps per episode. We use random seed 42 for reproducibility.

When multiple philosophers attempt to grab the same fork simultaneously, the conflict is resolved by awarding the fork to

the philosopher with the lower ID.

C.4. Code Availability

DPBench is implemented in Python using LangGraph for agent orchestration. The source code is available at https:

//github.com/najmulhasan-code/dpbench and can be installed via pip install dpbench.

13
