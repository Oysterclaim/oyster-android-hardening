const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

function uniquePaths(paths) {
  return Array.from(new Set(paths.filter(Boolean)));
}

function walkFiles(rootDir, results = []) {
  if (!fs.existsSync(rootDir)) {
    return results;
  }

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, results);
    } else if (entry.isFile()) {
      results.push(entryPath);
    }
  }

  return results;
}

function findAllFiles(searchRoots, filename) {
  const results = [];
  for (const root of searchRoots) {
    walkFiles(root, results);
  }
  return uniquePaths(results.filter((filePath) => path.basename(filePath) === filename));
}

function findPackageGradleHomes(packageRoot) {
  return fs
    .readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(".gradle-user-home"))
    .map((entry) => path.join(packageRoot, entry.name));
}

function ensureBackup(filePath) {
  const backupPath = `${filePath}.codex-bak`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }
}

function extractJarEntries(jarPath, outputDir, entryPaths) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  cp.execFileSync("jar", ["xf", jarPath, ...entryPaths], {
    cwd: outputDir,
    stdio: "inherit",
  });
}

function updateJar(jarPath, rootDir, entryPaths) {
  ensureBackup(jarPath);
  const args = ["uf", jarPath];
  for (const entryPath of entryPaths) {
    args.push("-C", rootDir, entryPath);
  }
  cp.execFileSync("jar", args, { stdio: "inherit" });
}

function compileJavaTool(outputDir, sourceFiles) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  cp.execFileSync("javac", ["--release", "8", "-d", outputDir, ...sourceFiles], {
    stdio: "inherit",
  });
}

function runJavaTool(classpathRoot, mainClass, args) {
  cp.execFileSync("java", ["-cp", classpathRoot, mainClass, ...args], {
    stdio: "inherit",
  });
}

function extractClassesJarFromAar(aarPath, outputDir) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  cp.execFileSync("jar", ["xf", aarPath, "classes.jar"], {
    cwd: outputDir,
    stdio: "inherit",
  });

  const classesJarPath = path.join(outputDir, "classes.jar");
  if (!fs.existsSync(classesJarPath)) {
    throw new Error(`Could not extract classes.jar from ${aarPath}`);
  }

  return classesJarPath;
}

function replaceRuntimeJarEntry(sourceJar, targetJar, classEntries, scratchRoot) {
  const scratchDir = path.join(
    scratchRoot,
    path.basename(targetJar).replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
  extractJarEntries(sourceJar, scratchDir, classEntries);
  const extractedEntries = classEntries.filter((entryPath) =>
    fs.existsSync(path.join(scratchDir, entryPath)),
  );
  if (extractedEntries.length === 0) {
    return false;
  }
  updateJar(targetJar, scratchDir, extractedEntries);
  return true;
}

function patchJarClassWithJavaTool(jarPath, classEntries, scratchRoot, toolClasspathRoot, mainClass, args) {
  const scratchDir = path.join(
    scratchRoot,
    path.basename(jarPath).replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
  extractJarEntries(jarPath, scratchDir, classEntries);
  const extractedEntries = classEntries.filter((entryPath) =>
    fs.existsSync(path.join(scratchDir, entryPath)),
  );
  if (extractedEntries.length === 0) {
    return false;
  }
  for (const entryPath of extractedEntries) {
    runJavaTool(toolClasspathRoot, mainClass, [path.join(scratchDir, entryPath), ...args]);
  }
  updateJar(jarPath, scratchDir, extractedEntries);
  return true;
}

function deleteFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
    return true;
  }
  return false;
}

const packageRoot = process.cwd();
const explicitGradleHome = process.env.GRADLE_USER_HOME && path.resolve(process.env.GRADLE_USER_HOME);
const gradleHomes = explicitGradleHome
  ? [explicitGradleHome]
  : uniquePaths([
      "C:\\g",
      path.join(os.homedir(), ".gradle"),
      ...findPackageGradleHomes(packageRoot),
    ]);
const transformRoots = gradleHomes.map((home) => path.join(home, "caches", "8.14.3", "transforms"));
const moduleCacheRoots = gradleHomes.map((home) => path.join(home, "caches", "modules-2", "files-2.1"));
const localMavenRoots = uniquePaths([
  path.join(packageRoot, "node_modules", "expo", "node_modules", "expo-asset", "local-maven-repo"),
  path.join(packageRoot, "node_modules", "expo-file-system", "local-maven-repo"),
]).filter((rootDir) => fs.existsSync(rootDir));
const normalizedFiles = uniquePaths(
  transformRoots.flatMap((rootDir) => walkFiles(rootDir)).map((filePath) => ({
    filePath,
    normalized: filePath.replace(/\\/g, "/"),
  })),
);

function collectPaths(pattern) {
  return normalizedFiles
    .filter((entry) => pattern.test(entry.normalized))
    .map((entry) => entry.filePath);
}

const assetRuntimeJars = collectPaths(/\/expo\.modules\.asset-[^/]+-runtime\.jar$/);
const filesystemSourceJars = collectPaths(/\/expo\.modules\.filesystem-[^/]+\/jars\/classes\.jar$/);
const filesystemRuntimeJars = collectPaths(/\/expo\.modules\.filesystem-[^/]+-runtime\.jar$/);
const filesystemAars = uniquePaths([
  ...findAllFiles(moduleCacheRoots, "expo.modules.filesystem-19.0.17.aar"),
  ...findAllFiles(localMavenRoots, "expo.modules.filesystem-19.0.17.aar"),
]);
const dexFiles = uniquePaths([
  ...collectPaths(/\/expo\.modules\.asset-[^/]+(?:-runtime)?\/.+\/classes(?:\d+)?\.dex$/),
  ...collectPaths(/\/expo\.modules\.filesystem-[^/]+(?:-runtime)?\/.+\/classes(?:\d+)?\.dex$/),
]);

if (
  assetRuntimeJars.length === 0 &&
  filesystemSourceJars.length === 0 &&
  filesystemRuntimeJars.length === 0 &&
  filesystemAars.length === 0
) {
  console.log("No Expo asset/filesystem runtime jars are available to patch yet");
  process.exit(0);
}

const scratchRoot = path.join(packageRoot, ".build-expo-md5-runtime");
fs.rmSync(scratchRoot, { recursive: true, force: true });
fs.mkdirSync(scratchRoot, { recursive: true });
const javaToolsBuildDir = path.join(scratchRoot, "java-tools");
const sourceRoot = path.join(packageRoot, "src");
compileJavaTool(javaToolsBuildDir, [
  path.join(sourceRoot, "tools", "Utf8ConstantClassPatcher.java"),
]);

let patchedTargets = 0;

const assetUtf8Args = [
  "MD5", "SHA-256",
  "getMD5HashOfFilePath", "getSha256HashOfFilePath",
  "getMD5HashOfFileContent", "getSha256HashOfFileContent",
  "access$getMD5HashOfFilePath", "access$getSha256HashOfFilePath",
  "access$getMD5HashOfFileContent", "access$getSha256HashOfFileContent",
  "getMD5HashOfFilePath$lambda$0", "getSha256HashOfFilePath$lambda$0",
  "getMD5HashOfFileContent$lambda$3$lambda$2$lambda$1", "getSha256HashOfFileContent$lambda$3$lambda$2$lambda$1",
  "$i$a$-use-AssetModule$getMD5HashOfFileContent$1$1", "$i$a$-use-AssetModule$getSha256HashOfFileContent$1$1",
  "$i$a$-use-AssetModule$getMD5HashOfFileContent$1", "$i$a$-use-AssetModule$getSha256HashOfFileContent$1",
];

for (const jarPath of assetRuntimeJars) {
  if (
    patchJarClassWithJavaTool(
      jarPath,
      [path.join("expo", "modules", "asset", "AssetModule.class")],
      scratchRoot,
      javaToolsBuildDir,
      "tools.Utf8ConstantClassPatcher",
      assetUtf8Args,
    )
  ) {
    patchedTargets += 1;
  }
}

for (const sourceJar of filesystemSourceJars) {
  for (const runtimeJar of filesystemRuntimeJars) {
    if (
      replaceRuntimeJarEntry(
        sourceJar,
        runtimeJar,
        [path.join("expo", "modules", "filesystem", "FileSystemFile.class")],
        scratchRoot,
      )
    ) {
      patchedTargets += 1;
    }
  }
}

for (const sourceJar of filesystemSourceJars) {
  for (const aarPath of filesystemAars) {
    ensureBackup(aarPath);
    const scratchDir = path.join(
      scratchRoot,
      path.basename(aarPath).replace(/[^a-zA-Z0-9._-]/g, "_"),
    );
    const classesJarPath = extractClassesJarFromAar(aarPath, scratchDir);
    if (
      replaceRuntimeJarEntry(
        sourceJar,
        classesJarPath,
        [path.join("expo", "modules", "filesystem", "FileSystemFile.class")],
        path.join(scratchRoot, "filesystem-aar"),
      )
    ) {
      cp.execFileSync("jar", ["uf", aarPath, "-C", scratchDir, "classes.jar"], {
        stdio: "inherit",
      });
      patchedTargets += 1;
    }
  }
}

let clearedDexFiles = 0;
for (const dexFile of dexFiles) {
  if (deleteFile(dexFile)) {
    clearedDexFiles += 1;
  }
}

if (patchedTargets === 0) {
  console.log("Expo asset/filesystem MD5 patch found no eligible runtime jars to update");
  process.exit(0);
}

console.log(
  `Patched Expo asset/filesystem MD5 residues across ${patchedTargets} jar targets and cleared ${clearedDexFiles} stale dex outputs`,
);
