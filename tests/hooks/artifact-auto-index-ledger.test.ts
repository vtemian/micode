import { describe, expect, it } from "bun:test";
import { parseLedger } from "../../src/hooks/artifact-auto-index";

describe("artifact-auto-index ledger parsing", () => {
  it("should parse file operations from ledger", () => {
    const content = `# Session: test-session
Updated: 2025-01-30T12:00:00Z

## Goal
Implement structured compaction

## Constraints
Follow existing patterns

## Progress
### Done
- [x] Remove handoff

### In Progress
- [ ] Add file tracking

### Blocked
- None

## Key Decisions
- **Use iterative merging**: Better preservation

## Next Steps
1. Test the implementation

## File Operations
### Read
- \`src/hooks/auto-clear-ledger.ts\`
- \`src/agents/ledger-creator.ts\`

### Modified
- \`src/hooks/file-ops-tracker.ts\`

## Critical Context
- Based on Factory.ai approach
`;

    const result = parseLedger(content, "thoughts/ledgers/CONTINUITY_test.md", "test-session");

    expect(result.id).toBe("ledger-test-session");
    expect(result.sessionName).toBe("test-session");
    expect(result.goal).toBe("Implement structured compaction");
    expect(result.stateNow).toBe("Add file tracking");
    expect(result.filesRead).toBe("src/hooks/auto-clear-ledger.ts,src/agents/ledger-creator.ts");
    expect(result.filesModified).toBe("src/hooks/file-ops-tracker.ts");
  });

  it("should handle ledger without file operations section", () => {
    const content = `# Session: old-session
Updated: 2025-01-30T12:00:00Z

## Goal
Some old goal

## Progress
### In Progress
- [ ] Current task

## Key Decisions
- **Decision**: Reason
`;

    const result = parseLedger(content, "thoughts/ledgers/CONTINUITY_old.md", "old-session");

    expect(result.filesRead).toBe("");
    expect(result.filesModified).toBe("");
    expect(result.goal).toBe("Some old goal");
    expect(result.stateNow).toBe("Current task");
  });

  it("should handle empty file operations lists", () => {
    const content = `# Session: empty-ops
Updated: 2025-01-30T12:00:00Z

## Goal
Test empty ops

## Progress
### In Progress
- [ ] Testing

## File Operations
### Read
(none)

### Modified
(none)

## Key Decisions
`;

    const result = parseLedger(content, "thoughts/ledgers/CONTINUITY_empty.md", "empty-ops");

    expect(result.filesRead).toBe("");
    expect(result.filesModified).toBe("");
  });

  it("should handle multiple file paths", () => {
    const content = `# Session: multi-files
Updated: 2025-01-30T12:00:00Z

## Goal
Test multiple files

## Progress
### In Progress
- [ ] Testing

## File Operations
### Read
- \`file1.ts\`
- \`file2.ts\`
- \`file3.ts\`

### Modified
- \`mod1.ts\`
- \`mod2.ts\`
`;

    const result = parseLedger(content, "thoughts/ledgers/CONTINUITY_multi.md", "multi-files");

    expect(result.filesRead).toBe("file1.ts,file2.ts,file3.ts");
    expect(result.filesModified).toBe("mod1.ts,mod2.ts");
  });
});
