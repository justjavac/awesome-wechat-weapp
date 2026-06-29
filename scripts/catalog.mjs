import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const DATA_FILE = "data/resources.json";
export const API_FILE = "public/api/resources.json";

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function slugForHeading(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function makeResourceId(title, url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\.git$/i, "");
    const fromUrl = slugify(`${parsed.hostname.replace(/^www\./, "")}-${path}`);
    if (fromUrl) return fromUrl;
  } catch {
    // Fall back to the title below.
  }

  return slugify(title);
}

export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function flattenResources(catalog) {
  const rows = [];

  for (const category of catalog.categories ?? []) {
    for (const resource of category.resources ?? []) {
      rows.push({
        ...resource,
        category: category.name,
        categoryId: category.id,
        section: null,
        sectionId: null
      });
    }

    for (const section of category.sections ?? []) {
      for (const resource of section.resources ?? []) {
        rows.push({
          ...resource,
          category: category.name,
          categoryId: category.id,
          section: section.name,
          sectionId: section.id
        });
      }
    }
  }

  return rows;
}

export function flattenForApi(catalog) {
  return flattenResources(catalog).map((resource) => ({
    id: resource.id,
    title: resource.title,
    url: resource.url,
    description: resource.description,
    category: resource.category,
    categoryId: resource.categoryId,
    section: resource.section,
    sectionId: resource.sectionId,
    metadata: resource.metadata
  }));
}

export function inferMetadata({ title, description, categoryName, sectionName }) {
  const text = `${title} ${description}`.toLowerCase();
  const topics = new Set([categoryName]);

  for (const [keyword, topic] of [
    ["vue", "Vue"],
    ["react", "React"],
    ["taro", "Taro"],
    ["wepy", "WePY"],
    ["mpvue", "mpvue"],
    ["typescript", "TypeScript"],
    ["云开发", "云开发"],
    ["组件", "组件"],
    ["ui", "UI"],
    ["商城", "电商"],
    ["电商", "电商"],
    ["游戏", "游戏"],
    ["canvas", "Canvas"],
    ["api", "API"],
    ["sdk", "SDK"],
    ["ide", "IDE"]
  ]) {
    if (text.includes(keyword.toLowerCase())) topics.add(topic);
  }

  if (sectionName) topics.add(sectionName);

  const languages = new Set(["zh-CN"]);
  if (text.includes("typescript")) languages.add("TypeScript");
  if (text.includes("javascript") || text.includes("node.js") || text.includes("nodejs")) {
    languages.add("JavaScript");
  }
  if (text.includes("java ") || text.includes("java版") || text.includes(" java")) {
    languages.add("Java");
  }
  if (text.includes("scala")) languages.add("Scala");
  if (text.includes("vue")) languages.add("Vue");
  if (text.includes("react")) languages.add("React");

  let difficulty = "unknown";
  if (/入门|新手|教程|指南|hello world|boilerplate|template/.test(`${title} ${description}`)) {
    difficulty = "beginner";
  } else if (/框架|sdk|graphql|redux|typescript|云开发|后端/.test(`${title} ${description}`)) {
    difficulty = "intermediate";
  }

  return {
    language: [...languages],
    difficulty,
    topics: [...topics],
    license: "unknown",
    updatedAt: "unknown"
  };
}
