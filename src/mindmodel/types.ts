// src/mindmodel/types.ts
import * as v from "valibot";
import { parse as parseYaml } from "yaml";

export const CategorySchema = v.object({
  path: v.string(),
  description: v.string(),
});

export const ManifestSchema = v.object({
  name: v.string(),
  version: v.pipe(v.number(), v.minValue(1)),
  categories: v.pipe(v.array(CategorySchema), v.minLength(1)),
});

export type Category = v.InferOutput<typeof CategorySchema>;
export type MindmodelManifest = v.InferOutput<typeof ManifestSchema>;

export function parseManifest(yamlContent: string): MindmodelManifest {
  const parsed = parseYaml(yamlContent);
  return v.parse(ManifestSchema, parsed);
}
