// src/mindmodel/loader.ts
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { type MindmodelManifest, parseManifest } from "./types";

const MARKDOWN_EXTENSION = ".md";

export interface LoadedMindmodel {
  readonly directory: string;
  readonly manifest: MindmodelManifest;
}

export interface LoadedExample {
  readonly path: string;
  readonly description: string;
  readonly content: string;
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

export async function loadMindmodel(projectDir: string): Promise<LoadedMindmodel | null> {
  const mindmodelDir = join(projectDir, config.paths.mindmodelDir);

  try {
    await access(mindmodelDir);
  } catch {
    return null;
  }

  const manifestPath = join(mindmodelDir, config.paths.mindmodelManifest);

  try {
    const manifestContent = await readFile(manifestPath, "utf-8");
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
      });
    } catch {
      log.warn("mindmodel", `Failed to load example: ${categoryPath}`);
    }
  }

  return examples;
}
