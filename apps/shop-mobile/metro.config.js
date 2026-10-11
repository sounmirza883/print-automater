const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// pnpm's non-hoisted, symlinked node_modules needs both of these for
// Metro to find workspace packages (@print-automated/*, consumed as
// raw TS source -- packages/api-client, packages/design-tokens) and
// their own dependencies.
config.resolver.unstable_enableSymlinks = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.watchFolders = [workspaceRoot];

// Git worktrees checked out inside this repo (.worktrees/, plus the ones
// Claude Code creates under .claude/worktrees/) are full copies of the
// monorepo, each with its own node_modules. Because watchFolders is the
// whole workspace root, Metro would crawl and watch every one of them --
// ~134k of the ~152k directories under the root when this was added --
// and without Watchman (Expo's default) that alone pushes startup past
// Metro's 4-minute limit: "Failed to start watch mode", after which every
// request 500s. Anchored to this workspace root on purpose, so a
// worktree's own copy of this file does not block the worktree it runs in.
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const underWorkspaceRoot = (...segments) => {
  const source = path
    .join(workspaceRoot, ...segments)
    .split(path.sep)
    .map(escapeRegExp)
    .join("[\\\\/]")
    // Windows reports the drive letter in either case depending on the shell.
    .replace(/^[A-Za-z](?=:)/, (drive) => `[${drive.toLowerCase()}${drive.toUpperCase()}]`);
  return new RegExp(`^${source}(?:[\\\\/]|$)`);
};
config.resolver.blockList = [
  ...[config.resolver.blockList].flat().filter(Boolean),
  underWorkspaceRoot(".worktrees"),
  underWorkspaceRoot(".claude", "worktrees"),
];

// Those same workspace packages' own source uses NodeNext-style ".js"
// specifiers on their relative imports (e.g. "./tokens.js" resolving to
// tokens.ts) -- required so Node's native ESM loader can run them
// directly (services/api and services/worker depend on exactly that
// when they consume a workspace package at runtime; changing it there
// would break that, not fix this -- see apps/customer-web/next.config.ts's
// identical note for webpack). Metro doesn't map ".js" to ".ts"/".tsx"
// by default either: try the normal resolution first, and only for a
// relative ".js" specifier that fails, retry against ".ts"/".tsx".
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
      const withoutExtension = moduleName.slice(0, -3);
      for (const ext of [".ts", ".tsx"]) {
        try {
          return context.resolveRequest(context, `${withoutExtension}${ext}`, platform);
        } catch {
          // try the next candidate extension
        }
      }
    }
    throw error;
  }
};

module.exports = config;
