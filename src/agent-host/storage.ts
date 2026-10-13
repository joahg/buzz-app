// The app's agent storage (`agents/state`, see src-tauri agent_state.rs) as a
// Storage: one file per key, each replaced whole through a rename. Reads go to
// the files every time, so this host sees what the app saves while it runs.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const SAFE = /^[A-Za-z0-9._-]$/;

/** The file name for `key`, as the app names it. */
export function encodeKey(key: string) {
  let name = "";
  for (const byte of new TextEncoder().encode(key)) {
    const char = String.fromCharCode(byte);
    name += SAFE.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return name;
}

/** The key a file name holds, or undefined for a file that is not one. */
export function decodeKey(name: string) {
  if (!name || name.startsWith(".") || name.endsWith(".tmp")) return undefined;
  if (!/^(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})+$/.test(name)) return undefined;
  try {
    return decodeURIComponent(name);
  } catch {
    return undefined;
  }
}

export function stateStorage(dir: string): Storage {
  const path = (key: string) => join(dir, encodeKey(key));
  const keys = () => {
    try {
      return readdirSync(dir).flatMap((name) => decodeKey(name) ?? []);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };
  return {
    get length() {
      return keys().length;
    },
    key: (index: number) => keys()[index] ?? null,
    getItem(key: string) {
      try {
        return readFileSync(path(key), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    setItem(key: string, value: string) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temporary = join(dir, `.${process.pid}.${Date.now()}.tmp`);
      writeFileSync(temporary, String(value), { mode: 0o600 });
      renameSync(temporary, path(key));
    },
    removeItem(key: string) {
      rmSync(path(key), { force: true });
    },
    clear() {
      for (const key of keys()) rmSync(path(key), { force: true });
    },
  };
}
