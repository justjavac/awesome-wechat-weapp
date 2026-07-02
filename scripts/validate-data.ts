import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { DATA_FILE, type Catalog, type FlattenedResource, type Resource, normalizeUrl } from "./catalog.ts";

const DIFFICULTIES = new Set(["beginner", "intermediate", "advanced", "unknown"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const dataSource = await readFile(DATA_FILE, "utf8");
const errors: ValidationError[] = [];
let catalog: unknown = {};

interface ValidationError {
  message: string;
  line: number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return isStringArray(value) && value.length > 0;
}

function lineForYamlField(field: string, value?: unknown): number {
  const lines = dataSource.split(/\r?\n/);
  const valueText = ["boolean", "number", "string"].includes(typeof value) ? String(value) : undefined;
  const escapedValue = valueText?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escapedValue
    ? new RegExp(`^\\s*${field}:\\s*['"]?${escapedValue}['"]?\\s*$`)
    : new RegExp(`^\\s*${field}:`);

  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : 1;
}

function lineForResource(resource: Partial<FlattenedResource> | undefined): number {
  if (resource?.id) return lineForYamlField("id", resource.id);
  if (resource?.url) return lineForYamlField("url", resource.url);
  return 1;
}

function escapeAnnotation(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string, line = 1): void {
  errors.push({ message, line });
}

try {
  catalog = parse(dataSource) as unknown;
} catch (error) {
  fail(`${DATA_FILE} is not valid YAML: ${errorMessage(error)}`);
}

function validateHttpUrl(value: unknown, label: string, line: number): string | null {
  if (!isNonEmptyString(value)) {
    fail(`${label}: url is required`, line);
    return null;
  }
  if (/\s/.test(value)) {
    fail(`${label}: url must not contain whitespace`, line);
    return null;
  }

  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      fail(`${label}: url must be http(s)`, line);
      return null;
    }
  } catch {
    fail(`${label}: invalid url "${value}"`, line);
    return null;
  }

  return value;
}

function collectResources({
  resources,
  categoryId,
  categoryName,
  sectionId,
  sectionName
}: {
  resources: unknown[];
  categoryId: string;
  categoryName: string;
  sectionId?: string;
  sectionName?: string;
}): FlattenedResource[] {
  const rows: FlattenedResource[] = [];

  for (const resource of resources) {
    if (!isRecord(resource)) {
      fail(`resource in "${sectionId ? `${categoryId}/${sectionId}` : categoryId}" must be an object`);
      continue;
    }

    rows.push({
      ...(resource as unknown as Resource),
      category: categoryName,
      categoryId,
      section: sectionName ?? null,
      sectionId: sectionId ?? null
    });
  }

  return rows;
}

if (!isRecord(catalog)) {
  fail("catalog must be a YAML object");
}

const typedCatalog = (isRecord(catalog) ? catalog : {}) as Partial<Catalog>;

for (const field of ["name", "title", "description", "generatedFrom"] as const) {
  if (!isNonEmptyString(typedCatalog[field])) {
    fail(`catalog.${field} is required`, lineForYamlField(field));
  }
}
if (!Array.isArray(typedCatalog.categories) || typedCatalog.categories.length === 0) {
  fail("catalog.categories must be a non-empty array", lineForYamlField("categories"));
}

const resources: FlattenedResource[] = [];

const qqGroups = typedCatalog.qqGroups;
if (qqGroups !== undefined && !Array.isArray(qqGroups)) {
  fail("catalog.qqGroups must be an array", lineForYamlField("qqGroups"));
}

for (const group of Array.isArray(qqGroups) ? qqGroups : []) {
  if (!isRecord(group)) {
    fail("qq group must be an object", lineForYamlField("qqGroups"));
    continue;
  }

  const label = isNonEmptyString(group.name) ? group.name : "<unknown qq group>";
  const line = lineForYamlField("name", group.name);
  if (!isNonEmptyString(group.name)) fail(`${label}: name is required`, line);
  validateHttpUrl(group.url, label, lineForYamlField("url", group.url));
  if (!isNonEmptyString(group.note)) fail(`${label}: note is required`, lineForYamlField("note", group.note));
}

const categoryIds = new Set<string>();
const categoryNames = new Set<string>();
for (const category of Array.isArray(typedCatalog.categories) ? typedCatalog.categories : []) {
  if (!isRecord(category)) {
    fail("category must be an object", lineForYamlField("categories"));
    continue;
  }

  const categoryId = category.id;
  const categoryName = category.name;
  const categoryIdText = isNonEmptyString(categoryId) ? categoryId : "<unknown>";
  if (!isNonEmptyString(categoryId) || !ID_PATTERN.test(categoryId)) {
    fail(
      `category "${isNonEmptyString(categoryName) ? categoryName : "<unknown>"}" has invalid id "${String(categoryId)}"`,
      lineForYamlField("id", categoryId)
    );
  } else if (categoryIds.has(categoryId)) {
    fail(`duplicate category id "${categoryId}"`, lineForYamlField("id", categoryId));
  } else {
    categoryIds.add(categoryId);
  }
  if (!isNonEmptyString(categoryName)) {
    fail(`category "${categoryIdText}" is missing name`, lineForYamlField("id", categoryId));
  } else if (categoryNames.has(categoryName)) {
    fail(`duplicate category name "${categoryName}"`, lineForYamlField("name", categoryName));
  } else {
    categoryNames.add(categoryName);
  }

  if (category.resources !== undefined && !Array.isArray(category.resources)) {
    fail(`category "${categoryIdText}" resources must be an array`, lineForYamlField("resources"));
  }

  if (Array.isArray(category.resources)) {
    resources.push(
      ...collectResources({
        resources: category.resources,
        categoryId: isNonEmptyString(categoryId) ? categoryId : "",
        categoryName: isNonEmptyString(categoryName) ? categoryName : ""
      })
    );
  }

  if (category.sections !== undefined && !Array.isArray(category.sections)) {
    fail(`category "${categoryIdText}" sections must be an array`, lineForYamlField("sections"));
  }

  const sectionIds = new Set<string>();
  const sectionNames = new Set<string>();
  for (const section of Array.isArray(category.sections) ? category.sections : []) {
    if (!isRecord(section)) {
      fail(`section in "${categoryIdText}" must be an object`, lineForYamlField("sections"));
      continue;
    }

    const sectionId = section.id;
    const sectionName = section.name;
    const sectionIdText = isNonEmptyString(sectionId) ? sectionId : "<unknown>";
    if (!isNonEmptyString(sectionId) || !ID_PATTERN.test(sectionId)) {
      fail(
        `section "${isNonEmptyString(sectionName) ? sectionName : "<unknown>"}" has invalid id "${String(sectionId)}"`,
        lineForYamlField("id", sectionId)
      );
    } else if (sectionIds.has(sectionId)) {
      fail(`duplicate section id "${categoryIdText}/${sectionId}"`, lineForYamlField("id", sectionId));
    } else {
      sectionIds.add(sectionId);
    }
    if (!isNonEmptyString(sectionName)) {
      fail(`section "${categoryIdText}/${sectionIdText}" is missing name`, lineForYamlField("id", sectionId));
    } else if (sectionNames.has(sectionName)) {
      fail(`duplicate section name "${categoryIdText}/${sectionName}"`, lineForYamlField("name", sectionName));
    } else {
      sectionNames.add(sectionName);
    }

    if (section.resources !== undefined && !Array.isArray(section.resources)) {
      fail(`section "${categoryIdText}/${sectionIdText}" resources must be an array`, lineForYamlField("resources"));
    }

    if (Array.isArray(section.resources)) {
      resources.push(
        ...collectResources({
          resources: section.resources,
          categoryId: isNonEmptyString(categoryId) ? categoryId : "",
          categoryName: isNonEmptyString(categoryName) ? categoryName : "",
          sectionId: isNonEmptyString(sectionId) ? sectionId : "",
          sectionName: isNonEmptyString(sectionName) ? sectionName : ""
        })
      );
    }
  }
}

const resourceIds = new Set<string>();
const urls = new Map<string, FlattenedResource[]>();
const duplicatePolicy = typedCatalog.duplicatePolicy;
if (duplicatePolicy !== undefined && !isRecord(duplicatePolicy)) {
  fail("catalog.duplicatePolicy must be an object", lineForYamlField("duplicatePolicy"));
}

const allowCategoryIds = isRecord(duplicatePolicy) ? duplicatePolicy.allowCategoryIds : undefined;
if (allowCategoryIds !== undefined && !isStringArray(allowCategoryIds)) {
  fail("catalog.duplicatePolicy.allowCategoryIds must be a string array", lineForYamlField("allowCategoryIds"));
}
const allowedDuplicateCategories = new Set(isStringArray(allowCategoryIds) ? allowCategoryIds : []);
for (const categoryId of allowedDuplicateCategories) {
  if (!ID_PATTERN.test(categoryId)) {
    fail(
      `catalog.duplicatePolicy.allowCategoryIds has invalid category id "${categoryId}"`,
      lineForYamlField("allowCategoryIds")
    );
  } else if (!categoryIds.has(categoryId)) {
    fail(
      `catalog.duplicatePolicy.allowCategoryIds references unknown category "${categoryId}"`,
      lineForYamlField("allowCategoryIds")
    );
  }
}

for (const resource of resources) {
  const label = [resource.id, resource.title, resource.url].find(isNonEmptyString) ?? "<unknown>";
  const line = lineForResource(resource);

  if (!isNonEmptyString(resource.id) || !ID_PATTERN.test(resource.id)) {
    fail(`${label}: invalid id`, line);
  } else if (resourceIds.has(resource.id)) {
    fail(`${label}: duplicate resource id`, line);
  } else {
    resourceIds.add(resource.id);
  }

  if (!isNonEmptyString(resource.title)) fail(`${label}: title is required`, line);
  if (typeof resource.description !== "string") {
    fail(`${label}: description must be a string`, line);
  } else if (!resource.description && resource.categoryId !== "featured") {
    fail(`${label}: description is required`, line);
  }
  if (resource.note !== undefined && typeof resource.note !== "string") {
    fail(`${label}: note must be a string`, line);
  }

  const validUrl = validateHttpUrl(resource.url, label, line);
  if (validUrl) {
    const normalized = normalizeUrl(validUrl);
    const existing = urls.get(normalized) ?? [];
    existing.push(resource);
    urls.set(normalized, existing);
  }

  const metadata = resource.metadata as unknown;
  if (!isRecord(metadata)) {
    fail(`${label}: metadata is required`, line);
    continue;
  }
  if (!isNonEmptyStringArray(metadata.language)) {
    fail(`${label}: metadata.language must be a non-empty string array`, line);
  }
  if (!isNonEmptyString(metadata.difficulty) || !DIFFICULTIES.has(metadata.difficulty)) {
    fail(`${label}: metadata.difficulty is invalid`, line);
  }
  if (!isNonEmptyStringArray(metadata.topics)) {
    fail(`${label}: metadata.topics must be a non-empty string array`, line);
  }
}

for (const [url, duplicates] of urls) {
  if (duplicates.length <= 1) continue;
  const disallowedDuplicates = duplicates.filter((resource) => !allowedDuplicateCategories.has(resource.categoryId));
  if (disallowedDuplicates.length > 1) {
    fail(
      `duplicate url "${url}" in ${disallowedDuplicates.map((item) => item.id).join(", ")}`,
      lineForResource(disallowedDuplicates[0])
    );
  }
}

if (errors.length > 0) {
  if (process.env.GITHUB_ACTIONS) {
    for (const error of errors) {
      console.error(
        `::error file=${DATA_FILE},line=${error.line},title=Resource validation::${escapeAnnotation(error.message)}`
      );
    }
  }
  console.error(errors.map((error) => `- ${DATA_FILE}:${error.line} ${error.message}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${resources.length} resources`);
