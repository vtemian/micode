// src/mindmodel/loader.ts
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { type Category, type MindmodelManifest, parseManifest } from "./types";

const MARKDOWN_EXTENSION = ".md";

export interface LoadedMindmodel {
  readonly directory: string;
  readonly manifest: MindmodelManifest;
}

export interface LoadedExample {
  readonly path: string;
  readonly description: string;
  readonly content: string;
  /** Every heading in the file, for keyword matching. */
  readonly headings: string[];
}

// Constraint files are Markdown; manifest.yaml is the only YAML in .mindmodel.
// Weaker models sometimes emit stack/frontend.yaml and friends, which loads but
// leaves the directory inconsistent, so say so rather than failing the manifest.
function warnNonMarkdownCategories(manifest: MindmodelManifest): void {
  const wrongExtension = manifest.categories.map((c) => c.path).filter((path) => !path.endsWith(MARKDOWN_EXTENSION));

  if (wrongExtension.length > 0) {
    log.warn("mindmodel", `Constraint files must end in ${MARKDOWN_EXTENSION}: ${wrongExtension.join(", ")}`);
  }
}

/** Every markdown file under `.mindmodel/`, depth-first and name-sorted. */
async function findConstraintFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // A leading dot means a hidden directory, and `.mindmodel/` holds no
    // configuration that should be read as prose.
    if (entry.name.startsWith(".")) continue;

    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      found.push(...(await findConstraintFiles(join(dir, entry.name), relative)));
    } else if (entry.name.endsWith(MARKDOWN_EXTENSION)) {
      found.push(relative);
    }
  }

  return found;
}

/**
 * The H1 of a constraint file, which is what its manifest description usually
 * repeats. Falls back to the filename, so a file without an H1 still matches
 * queries on its name rather than matching nothing.
 */
function titleOf(content: string, path: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return path.replace(/\//g, " ").replace(MARKDOWN_EXTENSION, "");
}

/**
 * Every ATX heading, in order.
 *
 * These are what a constraint file is *about*. A manifest's `description` is a
 * two-word label, so matching on it alone misses the section a query is actually
 * about: "hard rules" finds nothing in a file titled "Architecture Constraints"
 * even though `## Hard rules` is its second heading. Headings are a short,
 * human-curated index of the file, so they are a far better signal than prose.
 */
export function headingsOf(content: string): string[] {
  return [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim());
}

/**
 * Build a manifest from the files on disk, for a `.mindmodel/` that has no
 * `manifest.yaml`.
 *
 * A hand-written `.mindmodel/` is a legitimate layout — flat `constraints.md`,
 * `patterns.md`, `overview.md` and no manifest at all — and it was previously
 * reported as *no mindmodel directory found*. That is worse than an error: the
 * caller tells the model to proceed without project constraints while the files
 * sit there unread, so every agent silently runs without them.
 *
 * The description is derived from each file's H1 so that keyword matching has
 * something to work with; a manifest's `description` field would have said more,
 * but inferring beats discarding the whole directory.
 */
async function manifestFromDirectory(mindmodelDir: string, projectDir: string): Promise<LoadedMindmodel | null> {
  let paths: string[];
  try {
    paths = await findConstraintFiles(mindmodelDir);
  } catch (error) {
    log.warn("mindmodel", `Failed to read .mindmodel/: ${extractErrorMessage(error)}`);
    return null;
  }

  if (paths.length === 0) {
    log.warn("mindmodel", "No manifest.yaml and no markdown files in .mindmodel/");
    return null;
  }

  const categories: Category[] = [];
  for (const path of paths) {
    try {
      const content = await readFile(join(mindmodelDir, path), "utf-8");
      categories.push({ path, description: titleOf(content, path) });
    } catch (error) {
      log.warn("mindmodel", `Failed to read constraint file: ${path} (${extractErrorMessage(error)})`);
    }
  }

  if (categories.length === 0) {
    log.warn("mindmodel", "No manifest.yaml and no readable markdown files in .mindmodel/");
    return null;
  }

  log.info(
    "mindmodel",
    `No manifest.yaml; derived ${categories.length} categories from the markdown files. ` +
      `Add a manifest to .mindmodel/ to give them real descriptions.`,
  );

  return {
    directory: mindmodelDir,
    manifest: {
      name: projectDir.split("/").filter(Boolean).pop() ?? "project",
      version: 1,
      categories,
    },
  };
}

export async function loadMindmodel(projectDir: string): Promise<LoadedMindmodel | null> {
  const mindmodelDir = join(projectDir, config.paths.mindmodelDir);

  try {
    await access(mindmodelDir);
  } catch {
    return null;
  }

  const manifestPath = join(mindmodelDir, config.paths.mindmodelManifest);

  let manifestContent: string;
  try {
    manifestContent = await readFile(manifestPath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOENT means the manifest is absent, which is a different problem from it
    // being present and malformed: the former still has usable content on disk.
    if (code === "ENOENT") {
      return manifestFromDirectory(mindmodelDir, projectDir);
    }
    log.warn("mindmodel", `Failed to read manifest: ${extractErrorMessage(error)}`);
    return null;
  }

  try {
    const manifest = parseManifest(manifestContent);
    warnNonMarkdownCategories(manifest);

    return {
      directory: mindmodelDir,
      manifest,
    };
  } catch (error) {
    log.warn("mindmodel", `Failed to load manifest: ${extractErrorMessage(error)}`);
    return null;
  }
}

export async function loadExamples(mindmodel: LoadedMindmodel, categoryPaths: string[]): Promise<LoadedExample[]> {
  const examples: LoadedExample[] = [];

  for (const categoryPath of categoryPaths) {
    const category = mindmodel.manifest.categories.find((c) => c.path === categoryPath);
    if (!category) continue;

    const fullPath = join(mindmodel.directory, categoryPath);

    try {
      const content = await readFile(fullPath, "utf-8");
      examples.push({
        path: categoryPath,
        description: category.description,
        content,
        headings: headingsOf(content),
      });
    } catch {
      log.warn("mindmodel", `Failed to load example: ${categoryPath}`);
    }
  }

  return examples;
}
