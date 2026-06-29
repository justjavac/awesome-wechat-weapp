import { DATA_FILE, flattenResources, normalizeUrl, readJson } from "./catalog.mjs";

const DIFFICULTIES = new Set(["beginner", "intermediate", "advanced", "unknown"]);
const DATE_OR_UNKNOWN = /^(unknown|\d{4}-\d{2}-\d{2})$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const catalog = await readJson(DATA_FILE);
const errors = [];

function fail(message) {
  errors.push(message);
}

if (!catalog.title) fail("catalog.title is required");
if (!Array.isArray(catalog.categories) || catalog.categories.length === 0) {
  fail("catalog.categories must be a non-empty array");
}

const categoryIds = new Set();
for (const category of catalog.categories ?? []) {
  if (!category.id || !ID_PATTERN.test(category.id)) {
    fail(`category "${category.name ?? "<unknown>"}" has invalid id "${category.id}"`);
  }
  if (categoryIds.has(category.id)) fail(`duplicate category id "${category.id}"`);
  categoryIds.add(category.id);
  if (!category.name) fail(`category "${category.id}" is missing name`);

  const sectionIds = new Set();
  for (const section of category.sections ?? []) {
    if (!section.id || !ID_PATTERN.test(section.id)) {
      fail(`section "${section.name ?? "<unknown>"}" has invalid id "${section.id}"`);
    }
    if (sectionIds.has(section.id)) fail(`duplicate section id "${category.id}/${section.id}"`);
    sectionIds.add(section.id);
    if (!section.name) fail(`section "${category.id}/${section.id}" is missing name`);
  }
}

const resources = flattenResources(catalog);
const resourceIds = new Set();
const urls = new Map();
const allowedDuplicateCategories = new Set(catalog.duplicatePolicy?.allowCategoryIds ?? []);

for (const resource of resources) {
  const label = resource.id ?? resource.title ?? resource.url ?? "<unknown>";

  if (!resource.id || !ID_PATTERN.test(resource.id)) fail(`${label}: invalid id`);
  if (resourceIds.has(resource.id)) fail(`${label}: duplicate resource id`);
  resourceIds.add(resource.id);

  if (!resource.title) fail(`${label}: title is required`);
  if (!resource.description && resource.categoryId !== "featured") {
    fail(`${label}: description is required`);
  }

  try {
    const parsed = new URL(resource.url);
    if (!["http:", "https:"].includes(parsed.protocol)) fail(`${label}: url must be http(s)`);
  } catch {
    fail(`${label}: invalid url "${resource.url}"`);
  }

  const normalized = normalizeUrl(resource.url);
  const existing = urls.get(normalized) ?? [];
  existing.push(resource);
  urls.set(normalized, existing);

  const metadata = resource.metadata;
  if (!metadata) {
    fail(`${label}: metadata is required`);
    continue;
  }
  if (!Array.isArray(metadata.language) || metadata.language.length === 0) {
    fail(`${label}: metadata.language must be a non-empty array`);
  }
  if (!DIFFICULTIES.has(metadata.difficulty)) {
    fail(`${label}: metadata.difficulty is invalid`);
  }
  if (!Array.isArray(metadata.topics) || metadata.topics.length === 0) {
    fail(`${label}: metadata.topics must be a non-empty array`);
  }
  if (typeof metadata.license !== "string" || metadata.license.length === 0) {
    fail(`${label}: metadata.license is required`);
  }
  if (typeof metadata.updatedAt !== "string" || !DATE_OR_UNKNOWN.test(metadata.updatedAt)) {
    fail(`${label}: metadata.updatedAt must be "unknown" or YYYY-MM-DD`);
  }
}

for (const [url, duplicates] of urls) {
  if (duplicates.length <= 1) continue;
  const allAllowed = duplicates.some((resource) => allowedDuplicateCategories.has(resource.categoryId));
  if (!allAllowed) {
    fail(`duplicate url "${url}" in ${duplicates.map((item) => item.id).join(", ")}`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${resources.length} resources`);
