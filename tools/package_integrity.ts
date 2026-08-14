import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type PackageIntegrityEntry = Readonly<{
  path: string;
  sha256: string;
}>;

export type PackageIntegrityManifest = Readonly<{
  schemaVersion: 1;
  algorithm: "SHA-256";
  files: ReadonlyArray<PackageIntegrityEntry>;
}>;

export type PackageIntegrityIssue =
  | Readonly<{
    tag: "changed";
    path: string;
    expectedSha256: string;
    actualSha256: string;
  }>
  | Readonly<{
    tag: "missing";
    path: string;
    expectedSha256: string;
  }>
  | Readonly<{
    tag: "extra";
    path: string;
    actualSha256: string;
  }>;

export type PackageIntegrityCheck =
  | Readonly<{ tag: "valid"; entryCount: number }>
  | Readonly<{ tag: "invalid"; issues: ReadonlyArray<PackageIntegrityIssue> }>;

const MANIFEST_PATH = "package.integrity.json";
const BEHAVIOR_DIRECTORIES = ["assets", "browser", "internal", "server", "tools"] as const;
const SHA256 = /^[0-9a-f]{64}$/;

export async function createPackageIntegrityManifest(
  root: string | URL = new URL("../", import.meta.url),
): Promise<PackageIntegrityManifest> {
  const rootPath = await resolvePackageRoot(root);
  return await createManifestAtRoot(rootPath);
}

async function createManifestAtRoot(rootPath: string): Promise<PackageIntegrityManifest> {
  const paths = await collectBehaviorPaths(rootPath);
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      sha256: await hashFile(safeAbsolutePath(rootPath, path)),
    })),
  );
  return { schemaVersion: 1, algorithm: "SHA-256", files };
}

export async function checkPackageIntegrity(
  root: string | URL = new URL("../", import.meta.url),
): Promise<PackageIntegrityCheck> {
  const rootPath = await resolvePackageRoot(root);
  const expected = await readManifest(rootPath);
  const actual = await createManifestAtRoot(rootPath);
  const expectedByPath = new Map(expected.files.map((entry) => [entry.path, entry]));
  const actualByPath = new Map(actual.files.map((entry) => [entry.path, entry]));
  const issues: PackageIntegrityIssue[] = [];

  for (const entry of expected.files) {
    const current = actualByPath.get(entry.path);
    if (current === undefined) {
      issues.push({
        tag: "missing",
        path: entry.path,
        expectedSha256: entry.sha256,
      });
    } else if (current.sha256 !== entry.sha256) {
      issues.push({
        tag: "changed",
        path: entry.path,
        expectedSha256: entry.sha256,
        actualSha256: current.sha256,
      });
    }
  }

  for (const entry of actual.files) {
    if (!expectedByPath.has(entry.path)) {
      issues.push({ tag: "extra", path: entry.path, actualSha256: entry.sha256 });
    }
  }

  issues.sort(compareIssues);
  return issues.length === 0
    ? { tag: "valid", entryCount: actual.files.length }
    : { tag: "invalid", issues };
}

export async function writePackageIntegrity(
  root: string | URL = new URL("../", import.meta.url),
): Promise<PackageIntegrityManifest> {
  const rootPath = await resolvePackageRoot(root);
  const manifest = await createManifestAtRoot(rootPath);
  const path = safeAbsolutePath(rootPath, MANIFEST_PATH);
  await rejectSymlinkIfPresent(path, MANIFEST_PATH);
  await Deno.writeTextFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function resolvePackageRoot(root: string | URL): Promise<string> {
  const requested = root instanceof URL ? fileURLToPath(root) : root;
  const absolute = resolve(requested);
  const info = await Deno.lstat(absolute);
  if (info.isSymlink) throw new Error(`package root must not be a symbolic link: ${absolute}`);
  if (!info.isDirectory) throw new Error(`package root is not a directory: ${absolute}`);
  return await Deno.realPath(absolute);
}

async function collectBehaviorPaths(rootPath: string): Promise<string[]> {
  const paths = new Set<string>();
  await addRequiredFile(rootPath, "deno.json", paths);
  const topLevelEntries = await sortedDirectoryEntries(rootPath);
  for (const entry of topLevelEntries) {
    if (!entry.name.endsWith(".ts")) continue;
    const path = entry.name;
    if (entry.isSymlink) throw symbolicLinkError(path);
    if (!entry.isFile) throw new Error(`unsupported behavior path: ${path}`);
    paths.add(path);
  }
  for (const directory of BEHAVIOR_DIRECTORIES) {
    await collectDirectory(rootPath, directory, paths);
  }
  return [...paths].sort(compareText);
}

async function addRequiredFile(
  rootPath: string,
  path: string,
  paths: Set<string>,
): Promise<void> {
  const info = await Deno.lstat(safeAbsolutePath(rootPath, path));
  if (info.isSymlink) throw symbolicLinkError(path);
  if (!info.isFile) throw new Error(`required behavior file is not regular: ${path}`);
  paths.add(path);
}

async function collectDirectory(
  rootPath: string,
  directory: string,
  paths: Set<string>,
): Promise<void> {
  const absolute = safeAbsolutePath(rootPath, directory);
  const directoryInfo = await Deno.lstat(absolute);
  if (directoryInfo.isSymlink) throw symbolicLinkError(directory);
  if (!directoryInfo.isDirectory) {
    throw new Error(`required behavior directory is not a directory: ${directory}`);
  }
  for (const entry of await sortedDirectoryEntries(absolute)) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymlink) throw symbolicLinkError(path);
    if (entry.isDirectory) {
      await collectDirectory(rootPath, path, paths);
    } else if (entry.isFile) {
      paths.add(path);
    } else {
      throw new Error(`unsupported behavior path: ${path}`);
    }
  }
}

async function sortedDirectoryEntries(path: string): Promise<Deno.DirEntry[]> {
  const entries: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(path)) entries.push(entry);
  return entries.sort((left, right) => compareText(left.name, right.name));
}

async function readManifest(rootPath: string): Promise<PackageIntegrityManifest> {
  const path = safeAbsolutePath(rootPath, MANIFEST_PATH);
  const info = await Deno.lstat(path);
  if (info.isSymlink) throw symbolicLinkError(MANIFEST_PATH);
  if (!info.isFile) throw new Error(`${MANIFEST_PATH} is not a regular file`);
  const parsed = JSON.parse(await Deno.readTextFile(path)) as unknown;
  return validateManifest(rootPath, parsed);
}

function validateManifest(rootPath: string, input: unknown): PackageIntegrityManifest {
  ensureExactRecord(input, ["schemaVersion", "algorithm", "files"], "integrity manifest");
  if (input.schemaVersion !== 1 || input.algorithm !== "SHA-256" || !Array.isArray(input.files)) {
    throw new Error("invalid integrity manifest header");
  }
  const files = input.files.map((entry, index) => validateManifestEntry(rootPath, entry, index));
  if (files.length === 0) throw new Error("integrity manifest must not be empty");
  const paths = files.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) {
    throw new Error("integrity manifest has duplicate paths");
  }
  if (paths.some((path, index) => index > 0 && compareText(paths[index - 1]!, path) >= 0)) {
    throw new Error("integrity manifest paths are not sorted");
  }
  return { schemaVersion: 1, algorithm: "SHA-256", files };
}

function validateManifestEntry(
  rootPath: string,
  input: unknown,
  index: number,
): PackageIntegrityEntry {
  ensureExactRecord(input, ["path", "sha256"], `integrity manifest entry ${index}`);
  if (typeof input.path !== "string" || input.path === MANIFEST_PATH) {
    throw new Error(`invalid integrity path at entry ${index}`);
  }
  safeAbsolutePath(rootPath, input.path);
  if (typeof input.sha256 !== "string" || !SHA256.test(input.sha256)) {
    throw new Error(`invalid SHA-256 at integrity manifest entry ${index}`);
  }
  return { path: input.path, sha256: input.sha256 };
}

function ensureExactRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
  label: string,
): asserts input is Readonly<Record<string, unknown>> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} is not an object`);
  }
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== expectedKeys.length ||
    !keys.every((key) => typeof key === "string" && expectedKeys.includes(key))
  ) {
    throw new Error(`${label} has unexpected keys`);
  }
}

function safeAbsolutePath(rootPath: string, path: string): string {
  if (
    path.length === 0 || path.includes("\\") || path.includes("\0") || isAbsolute(path) ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`unsafe integrity path: ${path}`);
  }
  const absolute = resolve(rootPath, path.split("/").join(sep));
  const fromRoot = relative(rootPath, absolute);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`integrity path escapes package root: ${path}`);
  }
  return absolute;
}

async function hashFile(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rejectSymlinkIfPresent(path: string, relativePath: string): Promise<void> {
  try {
    const info = await Deno.lstat(path);
    if (info.isSymlink) throw symbolicLinkError(relativePath);
    if (!info.isFile) throw new Error(`${relativePath} is not a regular file`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

function symbolicLinkError(path: string): Error {
  return new Error(`behavior closure contains a symbolic link: ${path}`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIssues(left: PackageIntegrityIssue, right: PackageIntegrityIssue): number {
  const pathOrder = compareText(left.path, right.path);
  return pathOrder === 0 ? compareText(left.tag, right.tag) : pathOrder;
}

function formatIssues(issues: ReadonlyArray<PackageIntegrityIssue>): string {
  return issues.map((issue) => {
    switch (issue.tag) {
      case "changed":
        return `changed ${issue.path}: expected ${issue.expectedSha256}, got ${issue.actualSha256}`;
      case "missing":
        return `missing ${issue.path}: expected ${issue.expectedSha256}`;
      case "extra":
        return `extra ${issue.path}: got ${issue.actualSha256}`;
    }
  }).join("\n");
}

async function main(args: ReadonlyArray<string>): Promise<void> {
  const write = args.includes("--write");
  if (write && args.includes("--check")) throw new Error("choose either --check or --write");
  const rootArgument = args.find((argument) => argument.startsWith("--root="));
  const root = rootArgument?.slice("--root=".length) ??
    fileURLToPath(new URL("../", import.meta.url));
  const known = args.every((argument) =>
    argument === "--check" || argument === "--write" || argument.startsWith("--root=")
  );
  if (!known) throw new Error("unknown package integrity argument");

  if (write) {
    const manifest = await writePackageIntegrity(root);
    console.log(`wrote ${MANIFEST_PATH} with ${manifest.files.length} entries`);
    return;
  }
  const result = await checkPackageIntegrity(root);
  if (result.tag === "invalid") {
    throw new Error(`package integrity check failed\n${formatIssues(result.issues)}`);
  }
  console.log(`package integrity valid with ${result.entryCount} entries`);
}

if (import.meta.main) await main(Deno.args);
