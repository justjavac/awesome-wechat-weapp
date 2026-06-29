import { readFile } from "node:fs/promises";
import { DATA_FILE, inferMetadata, makeResourceId, slugify, writeJson } from "./catalog.mjs";

const CATEGORY_IDS = new Map([
  ["置顶", "featured"],
  ["官方文档", "official-docs"],
  ["工具", "tools"],
  ["插件", "plugins"],
  ["组件", "components"],
  ["后端SDK组件", "backend-sdk"],
  ["Demo", "demo"]
]);

const SKIP_HEADINGS = new Set(["QQ交流群", "目录"]);

function parseListItem(line) {
  const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\)(.*?)\s*$/);
  if (!match) return null;

  const tail = match[3].trim().replace(/\\$/, "").trim();
  let note = "";
  let description = "";
  if (tail.startsWith("-")) {
    description = tail.slice(1).trim();
  } else {
    const descriptionStart = tail.indexOf(" - ");
    if (descriptionStart >= 0) {
      note = tail.slice(0, descriptionStart).trim();
      description = tail.slice(descriptionStart + 3).trim();
    } else {
      note = tail;
    }
  }

  return {
    title: match[1].trim(),
    url: match[2].trim(),
    description,
    note
  };
}

function ensureCategory(catalog, name) {
  const id = CATEGORY_IDS.get(name) ?? slugify(name);
  let category = catalog.categories.find((item) => item.id === id);
  if (!category) {
    category = { id, name, resources: [] };
    catalog.categories.push(category);
  }
  return category;
}

function ensureSection(category, name) {
  category.sections ??= [];
  const id = slugify(name) || `section-${category.sections.length + 1}`;
  let section = category.sections.find((item) => item.id === id);
  if (!section) {
    section = { id, name, resources: [] };
    category.sections.push(section);
  }
  return section;
}

function uniqueId(resource, usedIds) {
  const base = makeResourceId(resource.title, resource.url) || "resource";
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

const readme = await readFile("README.md", "utf8");
const catalog = {
  name: "awesome-wechat-weapp",
  title: "微信小程序开发资源汇总",
  description:
    "本文收集了微信小程序开发过程中会使用到的资料、问题以及第三方组件库。本文不是一篇关于如何学习微信小程序的入门指南，也非参考手册，只是一些资料的整理。",
  generatedFrom: "data/resources.json",
  duplicatePolicy: {
    allowCategoryIds: ["featured"]
  },
  qqGroups: [
    {
      name: "微信小程序1号群",
      url: "https://jq.qq.com/?_wv=1027&k=5vqgNd0",
      note: "593495800 （已满）"
    },
    {
      name: "微信小程序2号群",
      url: "https://jq.qq.com/?_wv=1027&k=51d5Ckf",
      note: "578063690"
    },
    {
      name: "微信小程序3号群",
      url: "https://jq.qq.com/?_wv=1027&k=5pNiKHt",
      note: "682463867"
    }
  ],
  categories: []
};

let currentCategory = null;
let currentSection = null;
const usedIds = new Set();

for (const line of readme.split(/\r?\n/)) {
  const h2 = line.match(/^##\s+(.+?)\s*$/);
  if (h2) {
    const name = h2[1].trim();
    currentSection = null;
    currentCategory = SKIP_HEADINGS.has(name) ? null : ensureCategory(catalog, name);
    continue;
  }

  const h3 = line.match(/^###\s+(.+?)\s*$/);
  if (h3 && currentCategory) {
    currentSection = ensureSection(currentCategory, h3[1].trim());
    continue;
  }

  if (!currentCategory || !line.startsWith("- [")) continue;

  const parsed = parseListItem(line);
  if (!parsed) {
    throw new Error(`Unable to parse resource line: ${line}`);
  }

  const resource = {
    id: uniqueId(parsed, usedIds),
    title: parsed.title,
    url: parsed.url,
    description: parsed.description,
    note: parsed.note,
    metadata: inferMetadata({
      ...parsed,
      categoryName: currentCategory.name,
      sectionName: currentSection?.name
    })
  };

  if (currentSection) {
    currentSection.resources.push(resource);
  } else {
    currentCategory.resources.push(resource);
  }
}

await writeJson(DATA_FILE, catalog);
console.log(`Imported ${usedIds.size} resources into ${DATA_FILE}`);
