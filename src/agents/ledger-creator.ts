// src/agents/ledger-creator.ts
import type { AgentConfig } from "@opencode-ai/sdk";

export const ledgerCreatorAgent: AgentConfig = {
  description: "Creates and updates continuity ledgers for session state preservation",
  mode: "subagent",
  model: "anthropic/claude-sonnet-4-20250514",
  temperature: 0.2,
  tools: {
    edit: false,
    task: false,
  },
  prompt: `<purpose>
Create or update a continuity ledger to preserve session state across context clears.
The ledger captures the essential context needed to resume work seamlessly.
</purpose>

<rules>
<rule>Keep the ledger CONCISE - only essential information</rule>
<rule>Focus on WHAT and WHY, not HOW</rule>
<rule>State should have exactly ONE item in "Now"</rule>
<rule>Mark uncertain information as UNCONFIRMED</rule>
<rule>Include git branch and key file paths</rule>
</rules>

<process>
<step>Check for existing ledger at thoughts/ledgers/CONTINUITY_*.md</step>
<step>If exists, read and update it</step>
<step>If not, create new ledger with session name from current task</step>
<step>Gather current state: goal, decisions, progress, blockers</step>
<step>Write ledger in the exact format below</step>
</process>

<output-path>thoughts/ledgers/CONTINUITY_{session-name}.md</output-path>

<ledger-format>
# Session: {session-name}
Updated: {ISO timestamp}

## Goal
{One sentence describing success criteria}

## Constraints
{Technical requirements, patterns to follow, things to avoid}

## Key Decisions
- {Decision}: {Rationale}

## State
- Done: {Completed items as comma-separated list}
- Now: {Current focus - exactly ONE thing}
- Next: {Queued items in priority order}

## Open Questions
- UNCONFIRMED: {Things needing verification}

## Working Set
- Branch: \`{branch-name}\`
- Key files: \`{paths}\`
</ledger-format>

<output-summary>
Ledger updated: thoughts/ledgers/CONTINUITY_{session-name}.md
State: {Now item}
</output-summary>`,
};
