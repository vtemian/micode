# Prompt Fragments Design

**Issue:** [#13 - How to adjust agent's system prompt from external config?](https://github.com/vtemian/micode/issues/13)

**Date:** 2026-01-28

## Overview

Allow users to append custom instructions to agent prompts via external configuration, without replacing base prompts. This addresses the need for users to customize agent behavior (e.g., saving brainstorm discussions to multiple files instead of one large file).

## Configuration Format

### Global Fragments

Location: `~/.config/opencode/micode.json`

```json
{
  "agents": { ... },
  "features": { ... },
  "fragments": {
    "brainstormer": [
      "Save lengthy discussions to multiple files in docs/brainstorms/",
      "Use naming pattern: YYYY-MM-DD-topic.md"
    ],
    "planner": [
      "Always include verification tasks after implementation tasks"
    ]
  }
}
```

### Project Fragments

Location: `.micode/fragments.json` (in project root)

```json
{
  "brainstormer": [
    "This project stores brainstorms in docs/design/ instead"
  ],
  "implementer": [
    "Run pnpm test after every code change"
  ]
}
```

### Merging Behavior

Global and project fragments **concatenate** (global first, then project):

```
[global fragment 1] + [global fragment 2] + [project fragment 1]
```

## Injection Format

Fragments are injected at the **beginning** of the agent's system prompt:

```xml
<user-instructions>
- Save lengthy discussions to multiple files in docs/brainstorms/
- Use naming pattern: YYYY-MM-DD-topic.md
- This project stores brainstorms in docs/design/ instead
</user-instructions>

<environment>
[... rest of base agent prompt ...]
</environment>
```

Key behaviors:
- Each fragment becomes a bullet point
- Fragments joined with newlines
- Empty fragment arrays produce no output
- Agents without fragments get unchanged base prompts

## Implementation

### Files to Modify

1. **`src/config-loader.ts`**
   - Add `fragments?: Record<string, string[]>` to `MicodeConfig` interface
   - Parse and validate fragments from config

2. **`src/hooks/fragment-injector.ts`** (new file)
   - Hook point: `chat.params`
   - Load global fragments from config
   - Load project fragments from `.micode/fragments.json`
   - Concatenate and inject into system prompt beginning

3. **`src/index.ts`**
   - Register the fragment-injector hook

### Data Flow

```
micode.json (global)     .micode/fragments.json (project)
        |                            |
    config-loader              fragment-injector
        |                            |
        +------------+---------------+
                     |
           Concatenate per agent
                     |
           Inject at prompt beginning
```

## Validation Rules

- `fragments` must be an object (if present)
- Each key should match a known agent name (warn on unknown, don't fail)
- Each value must be an array of strings
- Empty strings are filtered out
- Non-string values in arrays are skipped with warning

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No fragments key in config | No injection |
| Agent not in fragments | No injection for that agent |
| Empty array for agent | No injection for that agent |
| Unknown agent name | Log warning, skip |
| Project file doesn't exist | Use global only |
| Project file invalid JSON | Log warning, use global only |
| Both files missing | No injection |

### Example Warning

```
[micode] Unknown agent "brianstormer" in fragments config. Did you mean "brainstormer"?
```

## Security Considerations

This feature allows users to **append** instructions but not replace base prompts. The base agent behavior and safety constraints remain intact. Users can only influence behavior through natural language instructions that the agent interprets.
