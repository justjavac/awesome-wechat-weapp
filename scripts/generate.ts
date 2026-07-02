import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  API_FILE,
  DATA_FILE,
  type Catalog,
  type Resource,
  flattenForApi,
  readData,
  slugForHeading,
  writeJson
} from "./catalog.ts";

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/[\\[\]]/g, "\\$&");
}

function escapeMarkdownLinkUrl(value: string): string {
  return value.replace(/[()\\]/g, (character) => {
    if (character === "(") return "%28";
    if (character === ")") return "%29";
    return "%5C";
  });
}

function renderResource(resource: Resource): string {
  const suffix = resource.description ? ` - ${resource.description}` : "";
  const note = resource.note ? ` ${resource.note}` : "";
  return `- [${escapeMarkdownLinkText(resource.title)}](${escapeMarkdownLinkUrl(resource.url)})${note}${suffix}`;
}

function renderReadme(catalog: Catalog): string {
  const toc = catalog.categories
    .filter((category) => category.id !== "featured")
    .map((category) => `- [${category.name}](#${slugForHeading(category.name)})`)
    .join("\n");

  const parts = [
    `<h1 align="center">${catalog.title}</h1>`,
    "",
    catalog.description,
    "本仓库中的资料整理自网络，也有一些来自网友推荐。在[这里](https://github.com/justjavac/awesome-wechat-weapp/graphs/contributors)可以看到项目贡献者的完整名单。",
    "如果这个仓库对你有帮助，欢迎 star。如果这个仓库帮你提升了技能找到了工作，可以请我喝杯咖啡：",
    "",
    "> 本 README 由 `data/resources.yaml` 自动生成。请不要手工编辑资源列表。",
    "",
    '<p align="center"><img src="https://dl.deno.js.cn/buy-me-a-coffee-wechat.png" width="320" height="320" alt="" /></p>',
    "",
    "## QQ交流群",
    "",
    ...(catalog.qqGroups ?? []).map((group) => `- [${group.name}](${group.url})：${group.note}`),
    "",
    "## 目录",
    "",
    toc,
    "",
    "## 数据维护",
    "",
    "- 资源数据源：[`data/resources.yaml`](data/resources.yaml)",
    "- 搜索页：[`public/index.html`](public/index.html)",
    "- API：[`public/api/resources.json`](public/api/resources.json)",
    "- 本地校验：`npm run check`",
    ""
  ];

  for (const category of catalog.categories) {
    parts.push(`## ${category.name}`, "");

    for (const resource of category.resources ?? []) {
      parts.push(renderResource(resource));
    }

    if ((category.resources ?? []).length > 0) {
      parts.push("");
    }

    for (const section of category.sections ?? []) {
      parts.push(`### ${section.name}`, "");
      for (const resource of section.resources ?? []) {
        parts.push(renderResource(resource));
      }
      parts.push("");
    }

    if (category.id !== "featured") {
      parts.push("[↑ 返回目录 ↑](#目录)", "");
    }
  }

  return `${parts.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

async function writeIfChanged(file: string, content: string, check: boolean): Promise<boolean> {
  let current = null;
  try {
    current = await readFile(file, "utf8");
  } catch {
    // The file will be created below.
  }

  if (current === content) return false;
  if (check) {
    throw new Error(`${file} is out of date. Run npm run generate.`);
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return true;
}

const check = process.argv.includes("--check");
const catalog = await readData<Catalog>(DATA_FILE);
const readmeChanged = await writeIfChanged("README.md", renderReadme(catalog), check);
const api = {
  name: catalog.name,
  title: catalog.title,
  description: catalog.description,
  generatedFrom: DATA_FILE,
  resources: flattenForApi(catalog)
};

if (check) {
  const apiBefore = await readFile(API_FILE, "utf8").catch(() => null);
  if (apiBefore !== `${JSON.stringify(api, null, 2)}\n`) {
    throw new Error(`${API_FILE} is out of date. Run npm run generate.`);
  }
} else {
  await writeJson(API_FILE, api);
}

if (!check) {
  console.log(`Generated README.md${readmeChanged ? "" : " (unchanged)"}`);
  console.log(`Generated ${API_FILE}`);
}
