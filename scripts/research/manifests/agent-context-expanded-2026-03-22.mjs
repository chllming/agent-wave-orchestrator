import baseManifest from "./harness-and-blackboard-2026-03-21.mjs";

const TOPICS = {
  HARNESS: "harnesses-and-practice",
  PLANNING: "planning-and-orchestration",
  COOPERATION: "agent-cooperation-and-coordination",
  LONG_RUNNING: "long-running-agents-and-compaction",
  SKILLS: "skills-and-procedural-memory",
  BLACKBOARD: "blackboard-and-shared-workspaces",
  REPO: "repo-context-and-evaluation",
  SECURITY: "security-and-secure-code-generation",
};

function arxivPaper(arxivId, entry) {
  return {
    kind: "paper",
    venue: `arXiv ${arxivId}`,
    sourcePage: `https://arxiv.org/abs/${arxivId}`,
    sourcePdf: `https://arxiv.org/pdf/${arxivId}.pdf`,
    ...entry,
  };
}

function externalPaper(sourcePage, entry) {
  return {
    kind: "paper",
    sourcePage,
    ...entry,
  };
}

function directPdfPaper(sourcePdf, entry) {
  return {
    kind: "paper",
    sourcePage: sourcePdf,
    sourcePdf,
    ...entry,
  };
}

function withExtraTopics(entry, extraTopics) {
  return {
    ...entry,
    topics: [...new Set([...(entry.topics ?? []), ...extraTopics])],
  };
}

const PLANNING_BASE_SLUGS = new Set([
  "building-effective-ai-coding-agents-for-the-terminal-scaffolding-harness-context-engineering-and-lessons-learned",
  "vero-an-evaluation-harness-for-agents-to-optimize-agents",
  "evoclaw-evaluating-ai-agents-on-continuous-software-evolution",
  "exploring-advanced-llm-multi-agent-systems-based-on-blackboard-architecture",
  "llm-based-multi-agent-blackboard-system-for-information-discovery-in-data-science",
  "dova-deliberation-first-multi-agent-orchestration-for-autonomous-research-automation",
  "symphony-synergistic-multi-agent-planning-with-heterogeneous-language-model-assembly",
  "silo-bench-a-scalable-environment-for-evaluating-distributed-coordination-in-multi-agent-llm-systems",
]);

const SKILLS_BASE_SLUGS = new Set([
  "memory-for-autonomous-llm-agents-mechanisms-evaluation-and-emerging-frontiers",
]);

const contextEngineeringManifest = [
  arxivPaper("2510.04618", {
    title: "Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models",
    slug: "agentic-context-engineering-evolving-contexts-for-self-improving-language-models",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Evolving playbooks, context mutation, and self-improving agent instructions.",
    fit: "Directly relevant to treating harness context as a maintained artifact instead of a fixed prompt.",
    topics: [TOPICS.HARNESS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2509.13313", {
    title: "ReSum: Unlocking Long-Horizon Search Intelligence via Context Summarization",
    slug: "resum-unlocking-long-horizon-search-intelligence-via-context-summarization",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Periodic summarization, context compaction, and long-horizon search loops.",
    fit: "Direct evidence for summary-based compaction in long-running agent workflows.",
    topics: [TOPICS.LONG_RUNNING, TOPICS.HARNESS],
  }),
  arxivPaper("2601.12030", {
    title: "ARC: Active and Reflection-driven Context Management for Long-Horizon Information Seeking Agents",
    slug: "arc-active-and-reflection-driven-context-management-for-long-horizon-information-seeking-agents",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Reflection-driven context selection and active memory management for long-horizon agents.",
    fit: "Useful companion to compaction papers when deciding how much context should stay live.",
    topics: [TOPICS.LONG_RUNNING, TOPICS.HARNESS],
  }),
  arxivPaper("2601.21557", {
    title: "Meta Context Engineering via Agentic Skill Evolution",
    slug: "meta-context-engineering-via-agentic-skill-evolution",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Skill evolution, meta-level context updates, and self-improving agent workflows.",
    fit: "Extends context engineering from manual playbooks to learned skill updates.",
    topics: [TOPICS.HARNESS, TOPICS.LONG_RUNNING, TOPICS.SKILLS],
  }),
  arxivPaper("2510.21413", {
    title: "Context Engineering for AI Agents in Open-Source Software",
    slug: "context-engineering-for-ai-agents-in-open-source-software",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Real-world context engineering patterns in open-source agentic coding.",
    fit: "Empirical evidence for how repositories structure and maintain coding-agent context.",
    topics: [TOPICS.HARNESS, TOPICS.REPO],
  }),
  arxivPaper("2603.09619", {
    title: "Context Engineering: From Prompts to Corporate Multi-Agent Architecture",
    slug: "context-engineering-from-prompts-to-corporate-multi-agent-architecture",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Enterprise multi-agent context architecture, governance, and prompt-to-system transitions.",
    fit: "Broad systems framing for moving from prompt snippets to durable agent architecture.",
    topics: [TOPICS.HARNESS, TOPICS.BLACKBOARD],
  }),
  arxivPaper("2601.06606", {
    title: "CEDAR: Context Engineering for Agentic Data Science",
    slug: "cedar-context-engineering-for-agentic-data-science",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Context engineering for multi-step data science agents and artifact-rich workflows.",
    fit: "Domain-specific, but useful for studying context structure in complex multi-stage tasks.",
    topics: [TOPICS.HARNESS, TOPICS.LONG_RUNNING],
  }),
];

const repoContextManifest = [
  arxivPaper("2511.12884", {
    title: "Agent READMEs: An Empirical Study of Context Files for Agentic Coding",
    slug: "agent-readmes-an-empirical-study-of-context-files-for-agentic-coding",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Repository context files, activation conditions, and empirical effects on agentic coding.",
    fit: "One of the closest papers to the repo's AGENTS.md and skill-surface concerns.",
    topics: [TOPICS.REPO],
  }),
  arxivPaper("2512.18925", {
    title: "Beyond the Prompt: An Empirical Study of Cursor Rules",
    slug: "beyond-the-prompt-an-empirical-study-of-cursor-rules",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Tool-specific rules files and developer-authored coding context in real projects.",
    fit: "Useful evidence on how developers externalize coding guidance beyond the base prompt.",
    topics: [TOPICS.REPO],
    notes:
      "Normalized to the current arXiv title for 2512.18925; the supplied list described the paper more generically as developer-provided context for coding assistants.",
  }),
  arxivPaper("2511.09268", {
    title: "Decoding the Configuration of AI Coding Agents: Insights from Claude Code Projects",
    slug: "decoding-the-configuration-of-ai-coding-agents-insights-from-claude-code-projects",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Real-world coding-agent configuration patterns, defaults, and project-level conventions.",
    fit: "Helps reason about which configuration layers belong in the harness versus the repo.",
    topics: [TOPICS.REPO],
  }),
  arxivPaper("2601.20404", {
    title: "On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents",
    slug: "on-the-impact-of-agents-md-files-on-the-efficiency-of-ai-coding-agents",
    year: 2026,
    researchBucket: "P0 direct hits",
    mapsTo: "Efficiency impact of AGENTS.md files on coding-agent task completion.",
    fit: "Direct evaluation signal for repository-level context files.",
    topics: [TOPICS.REPO],
  }),
  arxivPaper("2603.16021", {
    title: "Interpretable Context Methodology: Folder Structure as Agentic Architecture",
    slug: "interpretable-context-methodology-folder-structure-as-agentic-architecture",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Folder structure and filesystem organization as agent-readable context.",
    fit: "Relevant when directory layout itself becomes part of the harness contract.",
    topics: [TOPICS.REPO, TOPICS.HARNESS],
  }),
];

const skillsManifest = [
  arxivPaper("2602.20867", {
    title: "SoK: Agentic Skills -- Beyond Tool Use in LLM Agents",
    slug: "sok-agentic-skills-beyond-tool-use-in-llm-agents",
    year: 2026,
    researchBucket: "P0 direct hits",
    mapsTo: "Skill lifecycle, design patterns, acquisition, composition, evaluation, and governance.",
    fit: "Best current framing paper for treating skills as reusable procedural modules rather than prompt fragments.",
    topics: [TOPICS.SKILLS, TOPICS.SECURITY],
  }),
  arxivPaper("2602.12430", {
    title:
      "Agent Skills for Large Language Models: Architecture, Acquisition, Security, and the Path Forward",
    slug: "agent-skills-for-large-language-models-architecture-acquisition-security-and-the-path-forward",
    year: 2026,
    researchBucket: "P0 direct hits",
    mapsTo: "Skill architecture, acquisition pathways, security concerns, and open ecosystem governance.",
    fit: "Useful survey-style companion to the SoK, especially for skill-library security and governance.",
    topics: [TOPICS.SKILLS, TOPICS.SECURITY],
  }),
  arxivPaper("2305.16291", {
    title: "Voyager: An Open-Ended Embodied Agent with Large Language Models",
    slug: "voyager-an-open-ended-embodied-agent-with-large-language-models",
    year: 2023,
    researchBucket: "P2 lineage and older references",
    mapsTo: "Growing executable skill libraries and open-ended reuse in an embodied environment.",
    fit: "One of the clearest ancestors of the modern skill-library pattern.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2302.04761", {
    title: "Toolformer: Language Models Can Teach Themselves to Use Tools",
    slug: "toolformer-language-models-can-teach-themselves-to-use-tools",
    year: 2023,
    researchBucket: "P2 lineage and older references",
    mapsTo: "Self-supervised tool invocation and capability selection during reasoning.",
    fit: "Foundational precursor for skill routing and external capability use.",
    topics: [TOPICS.SKILLS],
  }),
  arxivPaper("2305.17126", {
    title: "Large Language Models as Tool Makers",
    slug: "large-language-models-as-tool-makers",
    year: 2023,
    researchBucket: "P2 lineage and older references",
    mapsTo: "Tool creation and executable capability synthesis instead of tool use alone.",
    fit: "Important precursor to programmatic skills and generated reusable procedures.",
    topics: [TOPICS.SKILLS],
  }),
  arxivPaper("2306.07863", {
    title: "Synapse: Trajectory-as-Exemplar Prompting with Memory for Computer Control",
    slug: "synapse-trajectory-as-exemplar-prompting-with-memory-for-computer-control",
    year: 2023,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Trajectory memory, exemplar reuse, and procedural recall for computer-control agents.",
    fit: "Useful early bridge between trajectory memory and reusable procedural skills.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2308.10144", {
    title: "ExpeL: LLM Agents Are Experiential Learners",
    slug: "expel-llm-agents-are-experiential-learners",
    year: 2023,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Learning from experience through externalized feedback and reusable strategy updates.",
    fit: "Helps motivate persistent skill and memory stores instead of stateless prompting.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2409.07429", {
    title: "Agent Workflow Memory",
    slug: "agent-workflow-memory",
    year: 2024,
    researchBucket: "P0 direct hits",
    mapsTo: "Reusable workflow induction from trajectories for web and long-horizon agents.",
    fit: "One of the strongest practical papers on extracting reusable procedures from successful experience.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2504.07079", {
    title: "SkillWeaver: Web Agents can Self-Improve by Discovering and Honing Skills",
    slug: "skillweaver-web-agents-can-self-improve-by-discovering-and-honing-skills",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Skill discovery, refinement, and reusable API-like abstractions for web agents.",
    fit: "Strong evidence that reusable discovered skills can materially improve long-horizon execution.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2510.14308", {
    title: "ReUseIt: Synthesizing Reusable AI Agent Workflows for Web Automation",
    slug: "reuseit-synthesizing-reusable-ai-agent-workflows-for-web-automation",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Reusable workflow synthesis from successful and failed web automation traces.",
    fit: "Useful for turning concrete traces into editable workflow skills instead of opaque prompt tuning.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2602.01869", {
    title:
      "ProcMEM: Learning Reusable Procedural Memory from Experience via Non-Parametric PPO for LLM Agents",
    slug: "procmem-learning-reusable-procedural-memory-from-experience-via-non-parametric-ppo-for-llm-agents",
    year: 2026,
    researchBucket: "P0 direct hits",
    mapsTo: "Reusable procedural memory learned from experience without weight updates.",
    fit: "Directly relevant to a skills layer built from trajectories rather than static hand-authored instructions.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2512.18950", {
    title:
      "Learning Hierarchical Procedural Memory for LLM Agents through Bayesian Selection and Contrastive Refinement",
    slug: "learning-hierarchical-procedural-memory-for-llm-agents-through-bayesian-selection-and-contrastive-refinement",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Hierarchical procedural memory with control policies for continue, skip, repeat, and abort.",
    fit: "Useful when flat skill lists are not enough and the harness needs structured playbooks.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2508.06433", {
    title: "Mem^p: Exploring Agent Procedural Memory",
    slug: "memp-exploring-agent-procedural-memory",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Procedural memory construction, retrieval, and update policies across agent trajectories.",
    fit: "Useful companion to workflow-memory and procedural-memory papers when designing a skill store.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2602.02474", {
    title: "MemSkill: Learning and Evolving Memory Skills for Self-Evolving Agents",
    slug: "memskill-learning-and-evolving-memory-skills-for-self-evolving-agents",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Memory operations as skills with explicit skill-bank evolution.",
    fit: "Strong fit for the frontier where memory and skills are treated as one evolving substrate.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2512.17102", {
    title: "Reinforcement Learning for Self-Improving Agent with Skill Library",
    slug: "reinforcement-learning-for-self-improving-agent-with-skill-library",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Skill-library accumulation, RL-based selection, and lower-cost task completion.",
    fit: "Useful evidence for skill-library routing and continual improvement over related tasks.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2601.03509", {
    title: "Evolving Programmatic Skill Networks",
    slug: "evolving-programmatic-skill-networks",
    year: 2026,
    researchBucket: "P0 direct hits",
    mapsTo: "Composable executable skills, structured reflection, maturity-aware updates, and rollback validation.",
    fit: "One of the strongest current papers on programmatic skill composition and controlled skill evolution.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2603.12056", {
    title: "XSkill: Continual Learning from Experience and Skills in Multimodal Agents",
    slug: "xskill-continual-learning-from-experience-and-skills-in-multimodal-agents",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Continual learning that combines experience replay with reusable multimodal skills.",
    fit: "Useful for the broader direction of skill reuse outside purely text-only agents.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2603.18743", {
    title: "Memento-Skills: Let Agents Design Agents",
    slug: "memento-skills-let-agents-design-agents",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Markdown-based evolving skills, read-write-reflect loops, and learned routing.",
    fit: "Directly relevant to repo-local skill files and self-evolving skill libraries.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2603.17187", {
    title: "MetaClaw: Just Talk -- An Agent That Meta-Learns and Evolves in the Wild",
    slug: "metaclaw-just-talk-an-agent-that-meta-learns-and-evolves-in-the-wild",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Failure-driven skill synthesis and zero-downtime evolution of agent capabilities.",
    fit: "Useful frontier reference for agents that grow a skill library from live operating experience.",
    topics: [TOPICS.SKILLS, TOPICS.LONG_RUNNING],
  }),
  arxivPaper("2602.12670", {
    title: "SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks",
    slug: "skillsbench-benchmarking-how-well-agent-skills-work-across-diverse-tasks",
    year: 2026,
    researchBucket: "P0 direct hits",
    mapsTo: "Cross-domain skill evaluation, curated-versus-generated skills, and routing quality.",
    fit: "Best current benchmark evidence that curated human-authored skills help while self-generated ones often do not.",
    topics: [TOPICS.SKILLS, TOPICS.REPO],
  }),
];

const sharedWorkspaceManifest = [
  arxivPaper("2510.14312", {
    title: "Terrarium: Revisiting the Blackboard for Multi-Agent Safety, Privacy, and Security Studies",
    slug: "terrarium-revisiting-the-blackboard-for-multi-agent-safety-privacy-and-security-studies",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Blackboard coordination under safety, privacy, and security constraints.",
    fit: "Rare direct treatment of attack surfaces in shared-workspace multi-agent systems.",
    topics: [TOPICS.BLACKBOARD, TOPICS.SECURITY, TOPICS.PLANNING],
  }),
  arxivPaper("2603.03780", {
    title: "MACC: Multi-Agent Collaborative Competition for Scientific Exploration",
    slug: "macc-multi-agent-collaborative-competition-for-scientific-exploration",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Shared scientific workspaces, institutional incentives, and collaborative competition among agents.",
    fit: "Useful for studying coordination designs beyond simple supervisor-worker delegation.",
    topics: [TOPICS.BLACKBOARD, TOPICS.HARNESS, TOPICS.PLANNING],
  }),
  arxivPaper("2603.08369", {
    title:
      "M3-ACE: Rectifying Visual Perception in Multimodal Math Reasoning via Multi-Agentic Context Engineering",
    slug: "m3-ace-rectifying-visual-perception-in-multimodal-math-reasoning-via-multi-agentic-context-engineering",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Shared evidential context and multi-agent collaboration in multimodal reasoning.",
    fit: "Domain-specific but still relevant to context-sharing patterns across agents.",
    topics: [TOPICS.BLACKBOARD, TOPICS.HARNESS],
  }),
];

const orchestrationManifest = [
  arxivPaper("2601.13671", {
    title: "The Orchestration of Multi-Agent Systems: Architectures, Protocols, and Enterprise Adoption",
    slug: "the-orchestration-of-multi-agent-systems-architectures-protocols-and-enterprise-adoption",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Architectures, protocols, and adoption patterns for orchestrated agent systems.",
    fit: "Broad systems framing for mapping blackboard ideas into deployable orchestration.",
    topics: [TOPICS.BLACKBOARD, TOPICS.HARNESS, TOPICS.PLANNING],
  }),
  arxivPaper("2601.12560", {
    title:
      "Agentic Artificial Intelligence (AI): Architectures, Taxonomies, and Evaluation of Large Language Model Agents",
    slug: "agentic-artificial-intelligence-ai-architectures-taxonomies-and-evaluation-of-large-language-model-agents",
    year: 2026,
    researchBucket: "P2 lineage and older references",
    mapsTo: "Agent architectures, taxonomies, evaluation dimensions, and governance patterns.",
    fit: "Survey-style reference for architecture and evaluation vocabulary.",
    topics: [TOPICS.BLACKBOARD, TOPICS.HARNESS],
  }),
  arxivPaper("2603.15021", {
    title: "Describing Agentic AI Systems with C4: Lessons from Industry Projects",
    slug: "describing-agentic-ai-systems-with-c4-lessons-from-industry-projects",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Architecture documentation patterns, collaboration boundaries, and quality gates for agentic systems.",
    fit: "Useful when the orchestration surface needs a software-architecture representation.",
    topics: [TOPICS.BLACKBOARD, TOPICS.HARNESS, TOPICS.PLANNING],
  }),
];

const planningManifest = [
  arxivPaper("2603.11445", {
    title:
      "Verified Multi-Agent Orchestration: A Plan-Execute-Verify-Replan Framework for Complex Query Resolution",
    slug: "verified-multi-agent-orchestration-a-plan-execute-verify-replan-framework-for-complex-query-resolution",
    year: 2026,
    researchBucket: "P0 direct hits",
    mapsTo: "DAG decomposition, parallel execution, verification, and replanning for complex queries.",
    fit: "Direct blueprint for a planner-verifier harness loop instead of one-shot multi-agent delegation.",
    topics: [TOPICS.PLANNING, TOPICS.HARNESS],
  }),
  arxivPaper("2602.07839", {
    title: "TodoEvolve: Learning to Architect Agent Planning Systems",
    slug: "todoevolve-learning-to-architect-agent-planning-systems",
    year: 2026,
    researchBucket: "P0 direct hits",
    mapsTo: "Meta-planning, task-specific planning topology, and dynamic planning revision.",
    fit: "Useful when the planning loop itself should adapt instead of staying hand-designed.",
    topics: [TOPICS.PLANNING, TOPICS.HARNESS],
  }),
  arxivPaper("2503.03505", {
    title: "Parallelized Planning-Acting for Efficient LLM-based Multi-Agent Systems in Minecraft",
    slug: "parallelized-planning-acting-for-efficient-llm-based-multi-agent-systems-in-minecraft",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Parallel planning/acting schedules, latency-sensitive coordination, and dynamic environments.",
    fit: "Useful reference for reducing serialized planning bottlenecks in multi-agent execution.",
    notes:
      "Normalized to the current arXiv title for 2503.03505; the user-supplied list described the paper more generally as dynamic-environment planning.",
    topics: [TOPICS.PLANNING, TOPICS.BLACKBOARD],
  }),
  arxivPaper("2603.03005", {
    title:
      "OrchMAS: Orchestrated Reasoning with Multi Collaborative Heterogeneous Scientific Expert Structured Agents",
    slug: "orchmas-orchestrated-reasoning-with-multi-collaborative-heterogeneous-scientific-expert-structured-agents",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Structured orchestration, heterogeneous experts, and coordinated reasoning pipelines.",
    fit: "Another current orchestration reference for role-structured collaborative planning.",
    topics: [TOPICS.PLANNING, TOPICS.BLACKBOARD],
  }),
  arxivPaper("2510.12120", {
    title: "Towards Engineering Multi-Agent LLMs: A Protocol-Driven Approach",
    slug: "towards-engineering-multi-agent-llms-a-protocol-driven-approach",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Protocol-driven agent coordination, interface contracts, and multi-agent engineering discipline.",
    fit: "Useful when orchestration protocols should be explicit artifacts rather than prompt folklore.",
    topics: [TOPICS.PLANNING, TOPICS.HARNESS],
  }),
  arxivPaper("2504.21030", {
    title:
      "Advancing Multi-Agent Systems Through Model Context Protocol: Architecture, Implementation, and Applications",
    slug: "advancing-multi-agent-systems-through-model-context-protocol-architecture-implementation-and-applications",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "MCP-based system architecture, server coordination, and protocol-mediated agent integration.",
    fit: "Relevant when the planning harness sits on top of MCP-style tool and server boundaries.",
    topics: [TOPICS.PLANNING, TOPICS.HARNESS],
  }),
  arxivPaper("2601.11595", {
    title: "Enhancing Model Context Protocol (MCP) with Context-Aware Server Collaboration",
    slug: "enhancing-model-context-protocol-mcp-with-context-aware-server-collaboration",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Context-aware server collaboration and richer coordination on MCP-style infrastructures.",
    fit: "Useful follow-on reference for collaborative planning over protocolized tool ecosystems.",
    topics: [TOPICS.PLANNING, TOPICS.HARNESS],
  }),
  arxivPaper("2503.13657", {
    title: "Why Do Multi-Agent LLM Systems Fail?",
    slug: "why-do-multi-agent-llm-systems-fail",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Failure taxonomy for orchestration, inter-agent alignment, verification, and termination.",
    fit: "One of the most useful planning reality checks for where orchestration loops actually break down.",
    topics: [TOPICS.PLANNING, TOPICS.REPO],
  }),
  arxivPaper("2505.11556", {
    title: "Systematic Failures in Collective Reasoning under Distributed Information in Multi-Agent LLMs",
    slug: "systematic-failures-in-collective-reasoning-under-distributed-information-in-multi-agent-llms",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Collective reasoning failures when evidence is distributed across agents.",
    fit: "Useful diagnostic reference for whether planning systems actually pool distributed evidence.",
    notes:
      "Normalized to the current arXiv title for 2505.11556; the user-supplied list referred to the benchmark as HiddenBench.",
    topics: [TOPICS.PLANNING, TOPICS.REPO, TOPICS.BLACKBOARD],
  }),
  arxivPaper("2602.13255", {
    title: "DPBench: Large Language Models Struggle with Simultaneous Coordination",
    slug: "dpbench-large-language-models-struggle-with-simultaneous-coordination",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Distributed-information coordination benchmarks with simultaneous constraints.",
    fit: "Useful benchmark for testing whether coordination-heavy planning systems scale beyond serial reasoning.",
    topics: [TOPICS.PLANNING, TOPICS.REPO],
  }),
  arxivPaper("2601.13295", {
    title: "CooperBench: Why Coding Agents Cannot be Your Teammates Yet",
    slug: "cooperbench-why-coding-agents-cannot-be-your-teammates-yet",
    authors:
      "Arpandeep Khatua, Hao Zhu, Peter Tran, Arya Prabhudesai, Frederic Sadrieh, Johann K. Lieberwirth, Xinkai Yu, Yicheng Fu, Michael J. Ryan, Jiaxin Pei, Diyi Yang",
    year: 2026,
    researchBucket: "P0 direct hits",
    mapsTo:
      "Collaborative coding benchmark for inter-agent cooperation, communication quality, commitment tracking, and coordination failures.",
    fit: "Direct benchmark for whether coding agents behave like usable teammates instead of isolated solo solvers.",
    additionalSource: "https://cooperbench.com",
    additionalPdf: "https://cooperbench.com/static/pdfs/main.pdf",
    notes:
      "Project site hosts the same paper PDF plus leaderboard, dataset, and trajectory viewer for the benchmark.",
    topics: [TOPICS.PLANNING, TOPICS.COOPERATION, TOPICS.REPO],
  }),
  arxivPaper("2602.01011", {
    title: "Multi-Agent Teams Hold Experts Back",
    slug: "multi-agent-teams-hold-experts-back",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Expert-underutilization failures in self-organizing multi-agent teams.",
    fit: "Useful caution against naive team-size scaling and weak expertise weighting.",
    topics: [TOPICS.PLANNING, TOPICS.REPO],
  }),
  externalPaper("https://link.springer.com/article/10.1007/s44336-024-00009-2", {
    title: "A Survey on LLM-based Multi-agent Systems: Workflow, Infrastructure, and Challenges",
    slug: "a-survey-on-llm-based-multi-agent-systems-workflow-infrastructure-and-challenges",
    preferHtml: true,
    year: 2024,
    venue: "Vicinagearth 1, 9 (2024)",
    researchBucket: "P2 lineage and older references",
    mapsTo: "Survey of LLM-MAS construction, interaction, planning, and communication patterns.",
    fit: "Broad framing reference for situating planning and blackboard papers in the wider MAS landscape.",
    textSourceUrl:
      "https://r.jina.ai/http://https://link.springer.com/article/10.1007/s44336-024-00009-2",
    textSourceFormat: "jina-markdown",
    topics: [TOPICS.PLANNING, TOPICS.BLACKBOARD],
  }),
  arxivPaper("2404.04834", {
    title:
      "LLM-Based Multi-Agent Systems for Software Engineering: Literature Review, Vision and the Road Ahead",
    slug: "llm-based-multi-agent-systems-for-software-engineering-literature-review-vision-and-the-road-ahead",
    year: 2024,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Multi-agent software-engineering workflows, shared repositories, and coding-oriented coordination patterns.",
    fit: "Useful bridge between general multi-agent planning papers and repository-centered coding systems.",
    topics: [TOPICS.PLANNING, TOPICS.HARNESS, TOPICS.REPO],
  }),
  arxivPaper("2508.12683", {
    title:
      "A Taxonomy of Hierarchical Multi-Agent Systems: Design Patterns, Coordination Mechanisms, and Industrial Applications",
    slug: "a-taxonomy-of-hierarchical-multi-agent-systems-design-patterns-coordination-mechanisms-and-industrial-applications",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Hierarchical MAS design patterns and coordination mechanisms for comparing against blackboard systems.",
    fit: "Useful contrast class when deciding between hierarchy-heavy and shared-workspace planning designs.",
    topics: [TOPICS.PLANNING, TOPICS.BLACKBOARD],
  }),
  externalPaper("https://ojs.aaai.org/index.php/aimagazine/article/view/537", {
    title:
      "Blackboard Systems, Part One: The Blackboard Model of Problem Solving and the Evolution of Blackboard Architectures",
    slug: "blackboard-systems-part-one-the-blackboard-model-of-problem-solving-and-the-evolution-of-blackboard-architectures",
    authors: "H. Penny Nii",
    year: 1986,
    venue: "AI Magazine 7(2) (1986)",
    researchBucket: "P2 lineage and older references",
    mapsTo: "Foundational blackboard architecture concepts, control structure, and problem-solving model.",
    fit: "Classic grounding for the blackboard pattern that still informs shared-workspace planning design.",
    textSourceUrl: "https://r.jina.ai/http://https://ojs.aaai.org/index.php/aimagazine/article/view/537",
    textSourceFormat: "jina-markdown",
    skipSourcePageFetch: true,
    topics: [TOPICS.PLANNING, TOPICS.BLACKBOARD],
  }),
  externalPaper("https://www.sciencedirect.com/science/article/abs/pii/0004370285900633", {
    title: "A Blackboard Architecture for Control",
    slug: "a-blackboard-architecture-for-control",
    authors: "Barbara Hayes-Roth",
    year: 1985,
    venue: "Artificial Intelligence 26(3) (1985)",
    researchBucket: "P2 lineage and older references",
    mapsTo: "Agenda-driven control, behavioral goals, and blackboard-based control architecture.",
    fit: "Foundational reference for the control side of blackboard-style planning systems.",
    textSourceUrl:
      "https://r.jina.ai/http://https://www.sciencedirect.com/science/article/abs/pii/0004370285900633",
    textSourceFormat: "jina-markdown",
    skipSourcePageFetch: true,
    topics: [TOPICS.PLANNING, TOPICS.BLACKBOARD],
  }),
  directPdfPaper("https://cdn.aaai.org/AAAI/1986/AAAI86-010.pdf", {
    title: "Incremental Planning to Control a Blackboard-Based Problem Solver",
    slug: "incremental-planning-to-control-a-blackboard-based-problem-solver",
    authors: "Edmund H. Durfee, Victor R. Lesser",
    year: 1986,
    venue: "AAAI-86",
    researchBucket: "P2 lineage and older references",
    mapsTo: "Incremental planning, plan monitoring, and repair for blackboard-based control.",
    fit: "Direct classic reference connecting planning explicitly to blackboard control.",
    topics: [TOPICS.PLANNING, TOPICS.BLACKBOARD],
  }),
  directPdfPaper("https://mas.cs.umass.edu/Documents/Corkill/ai-expert.pdf", {
    title: "Blackboard Systems",
    slug: "blackboard-systems",
    authors: "Daniel D. Corkill",
    year: 1991,
    venue: "AI Expert 6(9) (1991)",
    researchBucket: "P2 lineage and older references",
    mapsTo: "Blackboard characteristics, specialist coordination, and applicability to ill-defined problems.",
    fit: "Useful retrospective on what blackboard systems are good at and where they fit.",
    topics: [TOPICS.PLANNING, TOPICS.BLACKBOARD],
  }),
];

const secureCodeGenerationManifest = [
  arxivPaper("2407.07064", {
    title: "Prompting Techniques for Secure Code Generation: A Systematic Investigation",
    slug: "prompting-techniques-for-secure-code-generation-a-systematic-investigation",
    year: 2024,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Prompt variants and their effect on secure code generation quality.",
    fit: "Baseline evidence for what prompt-only hardening can and cannot accomplish.",
    topics: [TOPICS.SECURITY],
  }),
  directPdfPaper("https://emaiannone.github.io/assets/pdf/c6.pdf", {
    title:
      "Retrieve, Refine, or Both? Using Task-Specific Guidelines for Secure Python Code Generation",
    slug: "retrieve-refine-or-both-using-task-specific-guidelines-for-secure-python-code-generation",
    year: 2025,
    venue: "ICSME 2025",
    authors: "Catherine Tony, Emanuele Iannone, Riccardo Scandariato",
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Guideline retrieval versus iterative refinement for secure Python generation.",
    fit: "Direct comparison point for retrieval-only, repair-only, and hybrid security loops in coding workflows.",
    topics: [TOPICS.SECURITY],
  }),
  externalPaper("https://www.sciencedirect.com/science/article/pii/S0164121225003516", {
    title: "Discrete Prompt Optimization Using Genetic Algorithm for Secure Python Code Generation",
    slug: "discrete-prompt-optimization-using-genetic-algorithm-for-secure-python-code-generation",
    authors: "Catherine Tony, Riccardo Scandariato, Max Kretschmann, Maura Pintor",
    year: 2026,
    venue: "Journal of Systems and Software 232 (2026)",
    researchBucket: "P2 lineage and older references",
    mapsTo: "Search-based prompt optimization for secure Python code generation.",
    fit: "Adjacent baseline for automated prompt tuning in security-sensitive coding.",
    textSourceUrl:
      "https://r.jina.ai/http://https://www.sciencedirect.com/science/article/pii/S0164121225003516",
    textSourceFormat: "jina-markdown",
    skipSourcePageFetch: true,
    notes:
      "Primary cache text uses r.jina.ai because the ScienceDirect article page is not reliably extractable through Readability alone.",
    topics: [TOPICS.SECURITY],
  }),
  arxivPaper("2506.07313", {
    title:
      "SCGAgent: Recreating the Benefits of Reasoning Models for Secure Code Generation with Agentic Workflows",
    slug: "scgagent-recreating-the-benefits-of-reasoning-models-for-secure-code-generation-with-agentic-workflows",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Agentic secure-code workflows that recover reasoning-model benefits through orchestration.",
    fit: "Very close to the repo's interest in harness-mediated secure coding workflows.",
    topics: [TOPICS.SECURITY, TOPICS.HARNESS],
  }),
  arxivPaper("2510.18204", {
    title: "RESCUE: Retrieval Augmented Secure Code Generation",
    slug: "rescue-retrieval-augmented-secure-code-generation",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Security-focused retrieval augmentation for code generation.",
    fit: "Useful reference for designing security-specific retrieval layers instead of generic RAG.",
    topics: [TOPICS.SECURITY],
  }),
  arxivPaper("2601.00509", {
    title:
      "Improving LLM-Assisted Secure Code Generation through Retrieval-Augmented-Generation and Multi-Tool Feedback",
    slug: "improving-llm-assisted-secure-code-generation-through-retrieval-augmented-generation-and-multi-tool-feedback",
    year: 2026,
    researchBucket: "P0 direct hits",
    mapsTo: "RAG, compiler feedback, static analysis, and multi-tool repair for secure coding.",
    fit: "Strong direct fit for a tool-augmented secure-coding harness with iterative verification.",
    topics: [TOPICS.SECURITY, TOPICS.HARNESS],
  }),
  arxivPaper("2602.01187", {
    title: "Autoregressive, Yet Revisable: In Decoding Revision for Secure Code Generation",
    slug: "autoregressive-yet-revisable-in-decoding-revision-for-secure-code-generation",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Decoding-time revision and self-correction for secure generation.",
    fit: "Adds a decoding-centric alternative to outer-loop repair orchestration.",
    topics: [TOPICS.SECURITY],
  }),
  arxivPaper("2603.11212", {
    title:
      "Security-by-Design for LLM-Based Code Generation: Leveraging Internal Representations for Concept-Driven Steering Mechanisms",
    slug: "security-by-design-for-llm-based-code-generation-leveraging-internal-representations-for-concept-driven-steering-mechanisms",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Internal representation steering and concept-driven controls for secure generation.",
    fit: "Mechanism-oriented reference for security controls beyond prompt engineering.",
    topics: [TOPICS.SECURITY],
  }),
  arxivPaper("2602.05868", {
    title:
      "Persistent Human Feedback, LLMs, and Static Analyzers for Secure Code Generation and Vulnerability Detection",
    slug: "persistent-human-feedback-llms-and-static-analyzers-for-secure-code-generation-and-vulnerability-detection",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Human feedback, static analyzers, and vulnerability detection in secure code generation.",
    fit: "Useful reality check on combining analyzers and humans instead of trusting either alone.",
    topics: [TOPICS.SECURITY, TOPICS.HARNESS],
  }),
];

const securityEvaluationManifest = [
  arxivPaper("2504.21205", {
    title:
      "SecRepoBench: Benchmarking Code Agents for Secure Code Completion in Real-World Repositories",
    slug: "secrepobench-benchmarking-code-agents-for-secure-code-completion-in-real-world-repositories",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Repository-level secure code completion for code agents in real-world projects.",
    fit: "Direct benchmark match for secure, repo-grounded coding-agent evaluation.",
    notes:
      "Normalized to the latest arXiv title for 2504.21205; earlier versions framed the paper around LLMs rather than code agents.",
    topics: [TOPICS.SECURITY, TOPICS.REPO],
  }),
  arxivPaper("2509.22097", {
    title: "SecureAgentBench: Benchmarking Secure Code Generation under Realistic Vulnerability Scenarios",
    slug: "secureagentbench-benchmarking-secure-code-generation-under-realistic-vulnerability-scenarios",
    year: 2025,
    researchBucket: "P0 direct hits",
    mapsTo: "Secure code generation tasks under realistic vulnerability scenarios.",
    fit: "Useful benchmark for testing whether secure coding improvements hold beyond toy snippets.",
    topics: [TOPICS.SECURITY, TOPICS.REPO],
  }),
  arxivPaper("2410.11096", {
    title: "SeCodePLT: A Unified Platform for Evaluating the Security of Code GenAI",
    slug: "secodeplt-a-unified-platform-for-evaluating-the-security-of-code-genai",
    year: 2024,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Unified evaluation platform for insecure generation and code security analysis.",
    fit: "Broader benchmarking substrate for security-focused evaluation workflows.",
    topics: [TOPICS.SECURITY, TOPICS.REPO],
  }),
  arxivPaper("2603.10969", {
    title: "TOSSS: a CVE-based Software Security Benchmark for Large Language Models",
    slug: "tosss-a-cve-based-software-security-benchmark-for-large-language-models",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "CVE-grounded software security benchmark tasks.",
    fit: "Useful when evaluation should anchor to real vulnerability patterns rather than synthetic prompts.",
    topics: [TOPICS.SECURITY, TOPICS.REPO],
  }),
  arxivPaper("2412.15004", {
    title: "From Vulnerabilities to Remediation: A Systematic Literature Review of LLMs in Code Security",
    slug: "from-vulnerabilities-to-remediation-a-systematic-literature-review-of-llms-in-code-security",
    year: 2024,
    researchBucket: "P2 lineage and older references",
    mapsTo: "Survey of LLM use across vulnerability finding, explanation, and remediation.",
    fit: "Breadth reference for situating the secure-coding cache in the wider literature.",
    topics: [TOPICS.SECURITY],
  }),
  arxivPaper("2511.10271", {
    title:
      "Quality Assurance of LLM-generated Code: Addressing Non-Functional Quality Characteristics",
    slug: "quality-assurance-of-llm-generated-code-addressing-non-functional-quality-characteristics",
    year: 2025,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Security and other non-functional quality checks for LLM-generated code.",
    fit: "Useful broader QA framing around generated-code risk, beyond only functional correctness.",
    topics: [TOPICS.SECURITY, TOPICS.REPO],
  }),
  arxivPaper("2603.09002", {
    title: "Security Considerations for Multi-agent Systems",
    slug: "security-considerations-for-multi-agent-systems",
    year: 2026,
    researchBucket: "P1 strong adjacent work",
    mapsTo: "Credential, provenance, auditability, and shared-state risks in multi-agent systems.",
    fit: "Useful systems-level security framing for agent orchestration and shared workspaces.",
    topics: [TOPICS.SECURITY, TOPICS.BLACKBOARD],
  }),
];

export const paperManifest = [
  ...baseManifest.map((entry) => {
    const extraTopics = [];
    if (PLANNING_BASE_SLUGS.has(entry.slug)) {
      extraTopics.push(TOPICS.PLANNING);
    }
    if (SKILLS_BASE_SLUGS.has(entry.slug)) {
      extraTopics.push(TOPICS.SKILLS);
    }
    return extraTopics.length > 0 ? withExtraTopics(entry, extraTopics) : entry;
  }),
  ...contextEngineeringManifest,
  ...repoContextManifest,
  ...skillsManifest,
  ...sharedWorkspaceManifest,
  ...orchestrationManifest,
  ...planningManifest,
  ...secureCodeGenerationManifest,
  ...securityEvaluationManifest,
];

export default paperManifest;
