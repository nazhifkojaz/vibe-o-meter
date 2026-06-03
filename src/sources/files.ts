import fs from "fs";
import path from "path";

export function collectJsonlFiles(dir: string): string[] {
  return collectFilesByExtension(dir, ".jsonl");
}

function collectFilesByExtension(dir: string, extension: string): string[] {
  const files: string[] = [];

  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectFilesByExtension(fullPath, extension));
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        files.push(fullPath);
      }
    }
  } catch {}

  return files;
}

export function exists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
