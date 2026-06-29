import { setTimeout as delay } from "node:timers/promises";
import { DATA_FILE, type Catalog, flattenResources, normalizeUrl, readJson } from "./catalog.ts";

interface LinkTarget {
  url: string;
  label: string;
}

const catalog = await readJson<Catalog>(DATA_FILE);
const resources = flattenResources(catalog);
const urls: LinkTarget[] = [
  ...resources.map((resource) => ({ url: resource.url, label: resource.id })),
  ...(catalog.qqGroups ?? []).map((group) => ({ url: group.url, label: group.name }))
];

const unique = [...new Map(urls.map((item) => [normalizeUrl(item.url), item])).values()];
const concurrency = Number.parseInt(process.env.LINK_CHECK_CONCURRENCY ?? "8", 10);
const timeoutMs = Number.parseInt(process.env.LINK_CHECK_TIMEOUT_MS ?? "12000", 10);
const retries = Number.parseInt(process.env.LINK_CHECK_RETRIES ?? "1", 10);
const failures: string[] = [];
let cursor = 0;

async function request(url: string, method: "HEAD" | "GET", signal: AbortSignal): Promise<Response> {
  return fetch(url, {
    method,
    redirect: "follow",
    signal,
    headers: {
      "user-agent": "awesome-wechat-weapp-link-check/1.0"
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkUrl(item: LinkTarget): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response = await request(item.url, "HEAD", controller.signal);
      if ([405, 501].includes(response.status)) {
        response = await request(item.url, "GET", controller.signal);
      }

      if ((response.status >= 200 && response.status < 400) || [401, 403, 429].includes(response.status)) {
        clearTimeout(timeout);
        return;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(timeout);
      if (attempt === retries) {
        failures.push(`${item.label}: ${item.url} (${errorMessage(error)})`);
        return;
      }
      await delay(500 * (attempt + 1));
    }
  }
}

async function worker(): Promise<void> {
  while (cursor < unique.length) {
    const item = unique[cursor];
    cursor += 1;
    await checkUrl(item);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));

if (failures.length > 0) {
  console.error(`Dead link check failed (${failures.length}/${unique.length}):`);
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Checked ${unique.length} links`);
