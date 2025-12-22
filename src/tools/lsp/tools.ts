import { tool } from "@opencode-ai/plugin/tool";
import { withLspClient } from "./client";

interface Location {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

interface LocationLink {
  targetUri: string;
  targetRange: { start: { line: number; character: number }; end: { line: number; character: number } };
}

interface HoverResult {
  contents: string | { kind: string; value: string } | Array<string | { kind: string; value: string }>;
}

interface DocumentSymbol {
  name: string;
  kind: number;
  range: { start: { line: number }; end: { line: number } };
  children?: DocumentSymbol[];
}

const SYMBOL_KINDS: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
  6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
  11: "Interface", 12: "Function", 13: "Variable", 14: "Constant", 15: "String",
  16: "Number", 17: "Boolean", 18: "Array", 19: "Object", 20: "Key",
  21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event", 25: "Operator",
  26: "TypeParameter",
};

function formatLocation(loc: Location | LocationLink): string {
  const uri = "uri" in loc ? loc.uri : loc.targetUri;
  const range = "range" in loc ? loc.range : loc.targetRange;
  const path = uri.replace("file://", "");
  return `${path}:${range.start.line + 1}:${range.start.character}`;
}

function formatHover(result: HoverResult | null): string {
  if (!result) return "No hover info";

  const contents = result.contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n\n");
  }
  return contents.value;
}

function formatSymbol(sym: DocumentSymbol, indent = 0): string {
  const kind = SYMBOL_KINDS[sym.kind] || "Unknown";
  const prefix = "  ".repeat(indent);
  const line = `${prefix}${sym.name} (${kind}) - line ${sym.range.start.line + 1}`;
  const children = sym.children?.map((c) => formatSymbol(c, indent + 1)).join("\n") || "";
  return children ? `${line}\n${children}` : line;
}

export const lsp_hover = tool({
  description: "Get type info and docs for a symbol at position",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("1-based line number"),
    character: tool.schema.number().min(0).describe("0-based column"),
  },
  execute: async (args, ctx) => {
    try {
      const result = await withLspClient(args.filePath, process.cwd(), async (client) => {
        return (await client.hover(args.filePath, args.line, args.character)) as HoverResult | null;
      });
      return formatHover(result);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

export const lsp_goto_definition = tool({
  description: "Find where a symbol is defined",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("1-based line number"),
    character: tool.schema.number().min(0).describe("0-based column"),
  },
  execute: async (args, ctx) => {
    try {
      const result = await withLspClient(args.filePath, process.cwd(), async (client) => {
        return (await client.definition(args.filePath, args.line, args.character)) as
          | Location
          | Location[]
          | LocationLink[]
          | null;
      });

      if (!result) return "No definition found";
      const locations = Array.isArray(result) ? result : [result];
      if (locations.length === 0) return "No definition found";
      return locations.map(formatLocation).join("\n");
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

export const lsp_find_references = tool({
  description: "Find all usages of a symbol",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("1-based line number"),
    character: tool.schema.number().min(0).describe("0-based column"),
  },
  execute: async (args, ctx) => {
    try {
      const result = await withLspClient(args.filePath, process.cwd(), async (client) => {
        return (await client.references(args.filePath, args.line, args.character)) as Location[] | null;
      });

      if (!result || result.length === 0) return "No references found";

      const MAX = 50;
      const truncated = result.length > MAX;
      const lines = result.slice(0, MAX).map(formatLocation);
      if (truncated) lines.unshift(`Found ${result.length} references (showing first ${MAX}):`);
      return lines.join("\n");
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

export const lsp_document_symbols = tool({
  description: "Get all symbols in a file (outline)",
  args: {
    filePath: tool.schema.string(),
  },
  execute: async (args, ctx) => {
    try {
      const result = await withLspClient(args.filePath, process.cwd(), async (client) => {
        return (await client.documentSymbols(args.filePath)) as DocumentSymbol[] | null;
      });

      if (!result || result.length === 0) return "No symbols found";
      return result.map((s) => formatSymbol(s)).join("\n");
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

export const lsp_workspace_symbols = tool({
  description: "Search for symbols by name across workspace",
  args: {
    filePath: tool.schema.string().describe("Any file in workspace (for LSP context)"),
    query: tool.schema.string().describe("Symbol name to search"),
  },
  execute: async (args, ctx) => {
    try {
      const result = await withLspClient(args.filePath, process.cwd(), async (client) => {
        return (await client.workspaceSymbols(args.query)) as Array<{
          name: string;
          kind: number;
          location: Location;
        }> | null;
      });

      if (!result || result.length === 0) return "No symbols found";

      const MAX = 50;
      const truncated = result.length > MAX;
      const lines = result.slice(0, MAX).map((s) => {
        const kind = SYMBOL_KINDS[s.kind] || "Unknown";
        return `${s.name} (${kind}) - ${formatLocation(s.location)}`;
      });
      if (truncated) lines.unshift(`Found ${result.length} symbols (showing first ${MAX}):`);
      return lines.join("\n");
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

interface Diagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
}

const SEVERITY_NAMES: Record<number, string> = {
  1: "Error",
  2: "Warning",
  3: "Info",
  4: "Hint",
};

export const lsp_diagnostics = tool({
  description: "Get errors and warnings for a file before building",
  args: {
    filePath: tool.schema.string(),
  },
  execute: async (args, ctx) => {
    try {
      const result = await withLspClient(args.filePath, process.cwd(), async (client) => {
        return (await client.diagnostics(args.filePath)) as { items?: Diagnostic[] } | null;
      });

      const items = result?.items || [];
      if (items.length === 0) return "No diagnostics (file is clean)";

      const lines = items.map((d) => {
        const severity = SEVERITY_NAMES[d.severity || 1] || "Unknown";
        const line = d.range.start.line + 1;
        const source = d.source ? ` [${d.source}]` : "";
        return `${severity} (line ${line})${source}: ${d.message}`;
      });

      return lines.join("\n");
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

export const lsp_rename = tool({
  description: "Rename a symbol across the entire workspace",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("1-based line number"),
    character: tool.schema.number().min(0).describe("0-based column"),
    newName: tool.schema.string().describe("New name for the symbol"),
  },
  execute: async (args, ctx) => {
    try {
      // First validate the rename is possible
      const prepareResult = await withLspClient(args.filePath, process.cwd(), async (client) => {
        return (await client.prepareRename(args.filePath, args.line, args.character)) as {
          range?: { start: { line: number } };
          placeholder?: string;
        } | null;
      });

      if (!prepareResult) {
        return "Cannot rename symbol at this position";
      }

      // Perform the rename
      const result = await withLspClient(args.filePath, process.cwd(), async (client) => {
        return (await client.rename(args.filePath, args.line, args.character, args.newName)) as {
          changes?: Record<string, Array<{ range: Location["range"]; newText: string }>>;
          documentChanges?: Array<{ textDocument: { uri: string }; edits: Array<{ range: Location["range"]; newText: string }> }>;
        } | null;
      });

      if (!result) return "Rename failed - no changes returned";

      // Count affected files and locations
      let fileCount = 0;
      let editCount = 0;

      if (result.changes) {
        fileCount = Object.keys(result.changes).length;
        editCount = Object.values(result.changes).reduce((sum, edits) => sum + edits.length, 0);
      } else if (result.documentChanges) {
        fileCount = result.documentChanges.length;
        editCount = result.documentChanges.reduce((sum, doc) => sum + doc.edits.length, 0);
      }

      return `Renamed to "${args.newName}" in ${editCount} location(s) across ${fileCount} file(s).\n\nNote: Changes have been computed but NOT applied. Use the Edit tool to apply changes.`;
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
}

export const lsp_code_actions = tool({
  description: "Get available quick fixes and refactorings for a code range",
  args: {
    filePath: tool.schema.string(),
    startLine: tool.schema.number().min(1).describe("1-based start line"),
    endLine: tool.schema.number().min(1).describe("1-based end line"),
  },
  execute: async (args, ctx) => {
    try {
      const result = await withLspClient(args.filePath, process.cwd(), async (client) => {
        return (await client.codeActions(args.filePath, args.startLine, args.endLine)) as CodeAction[] | null;
      });

      if (!result || result.length === 0) return "No code actions available for this range";

      const lines = result.map((action) => {
        const kind = action.kind ? ` [${action.kind}]` : "";
        const preferred = action.isPreferred ? " ⭐" : "";
        return `- ${action.title}${kind}${preferred}`;
      });

      return `Available code actions:\n${lines.join("\n")}`;
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});
