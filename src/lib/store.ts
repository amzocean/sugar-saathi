import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { AppError } from "./errors";

export type Snapshot<T> = { value: T; version: string };
export interface Store {
  read<T>(key: string): Promise<Snapshot<T> | null>;
  write<T>(key: string, value: T, expected: string | null): Promise<void>;
}
export class Conflict extends Error {}

const localLocks = new Map<string, Promise<void>>();
const digest = (body: string) => createHash("sha256").update(body).digest("hex");

export class LocalStore implements Store {
  constructor(private directory: string) {}

  private filename(key: string) {
    if (!/^(journals\/\d{4}-\d{2}|system\/login-window)\.json$/.test(key)) throw new Error("Invalid storage key");
    return path.join(this.directory, ...key.split("/"));
  }

  async read<T>(key: string): Promise<Snapshot<T> | null> {
    try {
      const body = await readFile(this.filename(key), "utf8");
      return { value: JSON.parse(body) as T, version: digest(body) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write<T>(key: string, value: T, expected: string | null) {
    const filename = this.filename(key);
    const previous = localLocks.get(filename) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    localLocks.set(filename, tail);
    await previous;
    try {
      const actual = await this.read(key);
      if ((actual?.version ?? null) !== expected) throw new Conflict();
      await mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await rename(temporary, filename);
    } finally {
      release();
      if (localLocks.get(filename) === tail) localLocks.delete(filename);
    }
  }
}

export class BlobStore implements Store {
  async read<T>(key: string): Promise<Snapshot<T> | null> {
    const result = await get(key, { access: "private", useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200) throw new Error("Unexpected storage response");
    return { value: await new Response(result.stream).json() as T, version: result.blob.etag };
  }

  async write<T>(key: string, value: T, expected: string | null) {
    try {
      await put(key, JSON.stringify(value), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
        allowOverwrite: expected !== null,
        ...(expected ? { ifMatch: expected } : {}),
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError ||
        (error instanceof Error && /already exists/i.test(error.message))) throw new Conflict();
      throw error;
    }
  }
}

export function storage(): Store {
  if (process.env.DATA_STORAGE === "local") {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new AppError(503, "Local storage is development-only. Configure a private Blob store for deployment.");
    }
    return new LocalStore(process.env.SAATHI_LOCAL_DIRECTORY || path.join(process.cwd(), ".local-data"));
  }
  // The SDK also resolves rotating OIDC tokens from Vercel's request context.
  if (process.env.DATA_STORAGE === "blob" &&
    (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)) return new BlobStore();
  throw new AppError(503, "Private storage is not configured. Use local mode for development or connect a private Vercel Blob store.");
}

export async function update<T, R>(store: Store, key: string, initial: () => T, mutate: (value: T) => R): Promise<R> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = await store.read<T>(key);
    const value = before ? structuredClone(before.value) : initial();
    const result = mutate(value);
    if (before && JSON.stringify(value) === JSON.stringify(before.value)) return result;
    try {
      await store.write(key, value, before?.version ?? null);
      return result;
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
    }
  }
  throw new AppError(409, "Another save happened at the same time. Please retry; your record has not been discarded.");
}
