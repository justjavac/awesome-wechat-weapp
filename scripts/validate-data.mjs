import { readFile } from "node:fs/promises";
import { DATA_FILE, flattenResources, normalizeUrl } from "./catalog.mjs";

const DIFFICULTIES = new Set(["beginner", "intermediate", "advanced", "unknown"]);
const DATE_OR_UNKNOWN = /^(unknown|\d{4}-\d{2}-\d{2})$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const dataSource = await readFile(DATA_FILE, "utf8");
const catalog = JSON.parse(dataSource);
const errors = [];

function lineForNeedle(needle) {
  const index = dataSource.indexOf(needle);
  if (index < 0) return 1;
  return dataSource.slice(0, index).split(/\r?\n/).length;
}

function lineForResource(resource) {
  if (resource?.id) return lineForNeedle(`"id": "${resource.id}"`);
  if (resource?.url) return lineForNeedle(`"url": "${resource.url}"`);
  return 1;
}

function escapeAnnotation(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function fail(message, line = 1) {
  errors.push({ message, line });
}

if (!catalog.title) fail("catalog.title is required", lineForNeedle('"title"'));
if (!Array.isArray(catalog.categories) || catalog.categories.length === 0) {
  fail("catalog.categories must be a non-empty array", lineForNeedle('"categories"'));
}

const categoryIds = new Set();
for (const category of catalog.categories ?? []) {
  if (!category.id || !ID_PATTERN.test(category.id)) {
    fail(
      `category "${category.name ?? "<unknown>"}" has invalid id "${category.id}"`,
      lineForNeedle(`"id": "${category.id}"`)
    );
  }
  if (categoryIds.has(category.id)) {
    fail(`duplicate category id "${category.id}"`, lineForNeedle(`"id": "${category.id}"`));
  }
  categoryIds.add(category.id);
  if (!category.name) fail(`category "${category.id}" is missing name`, lineForNeedle(`"id": "${category.id}"`));

  const sectionIds = new Set();
  for (const section of category.sections ?? []) {
    if (!section.id || !ID_PATTERN.test(section.id)) {
      fail(
        `section "${section.name ?? "<unknown>"}" has invalid id "${section.id}"`,
        lineForNeedle(`"id": "${section.id}"`)
      );
    }
    if (sectionIds.has(section.id)) {
      fail(`duplicate section id "${category.id}/${section.id}"`, lineForNeedle(`"id": "${section.id}"`));
    }
    sectionIds.add(section.id);
    if (!section.name) {
      fail(`section "${category.id}/${section.id}" is missing name`, lineForNeedle(`"id": "${section.id}"`));
    }
  }
}

const resources = flattenResources(catalog);
const resourceIds = new Set();
const urls = new Map();
const allowedDuplicateCategories = new Set(catalog.duplicatePolicy?.allowCategoryIds ?? []);

for (const resource of resources) {
  const label = resource.id ?? resource.title ?? resource.url ?? "<unknown>";
  const line = lineForResource(resource);

  if (!resource.id || !ID_PATTERN.test(resource.id)) fail(`${label}: invalid id`, line);
  if (resourceIds.has(resource.id)) fail(`${label}: duplicate resource id`, line);
  resourceIds.add(resource.id);

  if (!resource.title) fail(`${label}: title is required`, line);
  if (!resource.description && resource.categoryId !== "featured") {
    fail(`${label}: description is required`, line);
  }

  try {
    const parsed = new URL(resource.url);
    if (!["http:", "https:"].includes(parsed.protocol)) fail(`${label}: url must be http(s)`, line);
  } catch {
    fail(`${label}: invalid url "${resource.url}"`, line);
  }

  const normalized = normalizeUrl(resource.url);
  const existing = urls.get(normalized) ?? [];
  existing.push(resource);
  urls.set(normalized, existing);

  const metadata = resource.metadata;
  if (!metadata) {
    fail(`${label}: metadata is required`, line);
    continue;
  }
  if (!Array.isArray(metadata.language) || metadata.language.length === 0) {
    fail(`${label}: metadata.language must be a non-empty array`, line);
  }
  if (!DIFFICULTIES.has(metadata.difficulty)) {
    fail(`${label}: metadata.difficulty is invalid`, line);
  }
  if (!Array.isArray(metadata.topics) || metadata.topics.length === 0) {
    fail(`${label}: metadata.topics must be a non-empty array`, line);
  }
  if (typeof metadata.license !== "string" || metadata.license.length === 0) {
    fail(`${label}: metadata.license is required`, line);
  }
  if (typeof metadata.updatedAt !== "string" || !DATE_OR_UNKNOWN.test(metadata.updatedAt)) {
    fail(`${label}: metadata.updatedAt must be "unknown" or YYYY-MM-DD`, line);
  }
}

for (const [url, duplicates] of urls) {
  if (duplicates.length <= 1) continue;
  const allAllowed = duplicates.some((resource) => allowedDuplicateCategories.has(resource.categoryId));
  if (!allAllowed) {
    fail(`duplicate url "${url}" in ${duplicates.map((item) => item.id).join(", ")}`, lineForResource(duplicates[0]));
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
