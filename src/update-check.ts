import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const CURRENT_VERSION = getLocalVersion();
const CACHE_FILE = path.join(os.homedir(), ".cache", "vibe-o-meter", "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheData {
  lastChecked: number;
  latestVersion: string;
}

function getLocalVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json");
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

export async function checkForUpdate(): Promise<void> {
  try {
    const cached = readCache();
    if (cached && Date.now() - cached.lastChecked < CACHE_TTL_MS) {
      if (cached.latestVersion !== CURRENT_VERSION) {
        printWarning(cached.latestVersion);
      }
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://registry.npmjs.org/vibe-o-meter/latest", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return;

    const data = await res.json();
    const latestVersion: string = data.version;
    if (!latestVersion) return;

    writeCache({ lastChecked: Date.now(), latestVersion });

    if (latestVersion !== CURRENT_VERSION) {
      printWarning(latestVersion);
    }
  } catch {}
}

function printWarning(latest: string): void {
  console.error(
    `\n\u001B[33mWarning:\u001B[0m You're running vibe-o-meter@${CURRENT_VERSION}, but \u001B[1m${latest}\u001B[0m is available.\n` +
    `Run \u001B[1mnpx vibe-o-meter@latest\u001B[0m to update.`
  );
}

function readCache(): CacheData | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(data: CacheData): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch {}
}
