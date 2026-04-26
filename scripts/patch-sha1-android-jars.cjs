const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

function uniquePaths(paths) {
  return Array.from(new Set(paths.filter(Boolean)));
}

function walkFiles(rootDir, filename, results = []) {
  if (!fs.existsSync(rootDir)) {
    return results;
  }

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, filename, results);
    } else if (entry.isFile() && entry.name === filename) {
      results.push(entryPath);
    }
  }

  return results;
}

function findAllFiles(searchRoots, filename) {
  const results = [];
  for (const root of searchRoots) {
    walkFiles(root, filename, results);
  }
  return uniquePaths(results);
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

function matchesNormalizedSuffix(filePath, suffix) {
  return filePath.replace(/\\/g, "/").endsWith(suffix.replace(/\\/g, "/"));
}

function compileSources(outputDir, classpathEntries, sourceFiles) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const args = ["--release", "8"];
  const filteredClasspath = classpathEntries.filter(Boolean);
  if (filteredClasspath.length > 0) {
    args.push("-classpath", filteredClasspath.join(path.delimiter));
  }
  args.push("-d", outputDir, ...sourceFiles);

  cp.execFileSync("javac", args, { stdio: "inherit" });
}

function updateJar(jarPath, compiledRoot, classFiles) {
  ensureBackup(jarPath);
  cp.execFileSync("jar", ["uf", jarPath, ...classFiles.flatMap((classFile) => ["-C", compiledRoot, classFile])], {
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

function updateAarClassesJar(aarPath, compiledRoot, classFiles, scratchRoot) {
  ensureBackup(aarPath);
  const scratchDir = path.join(
    scratchRoot,
    path.basename(aarPath).replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
  const classesJarPath = extractClassesJarFromAar(aarPath, scratchDir);
  updateJar(classesJarPath, compiledRoot, classFiles);
  cp.execFileSync("jar", ["uf", aarPath, "-C", scratchDir, "classes.jar"], {
    stdio: "inherit",
  });
}

function deleteFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
    return true;
  }
  return false;
}

const packageRoot = process.cwd();
const packageGradleHomes = findPackageGradleHomes(packageRoot);
const explicitGradleHome = process.env.GRADLE_USER_HOME && path.resolve(process.env.GRADLE_USER_HOME);
const gradleHomes = explicitGradleHome
  ? [explicitGradleHome]
  : uniquePaths([
      "C:\\g",
      path.join(os.homedir(), ".gradle"),
      ...packageGradleHomes,
    ]);
const gradleTransformRoots = gradleHomes.map((home) => path.join(home, "caches", "8.14.3", "transforms"));
const moduleCacheRoots = gradleHomes.map((home) => path.join(home, "caches", "modules-2", "files-2.1"));
const dexFiles = uniquePaths([
  ...findAllFiles(gradleTransformRoots, "classes.dex"),
  ...findAllFiles(gradleTransformRoots, "classes2.dex"),
]);

const fbcoreJars = uniquePaths([
  ...findAllFiles(gradleTransformRoots, "classes.jar").filter((jarPath) =>
    matchesNormalizedSuffix(jarPath, "fbcore-3.6.0/jars/classes.jar"),
  ),
  ...findAllFiles(gradleTransformRoots, "fbcore-3.6.0-runtime.jar"),
  ...findAllFiles(gradleTransformRoots, "fbcore-3.6.0-api.jar"),
]);
const fbcoreAars = uniquePaths([
  ...findAllFiles(moduleCacheRoots, "fbcore-3.6.0.aar"),
]);
const imagePipelineBaseJars = uniquePaths([
  ...findAllFiles(gradleTransformRoots, "classes.jar").filter((jarPath) =>
    matchesNormalizedSuffix(jarPath, "imagepipeline-base-3.6.0/jars/classes.jar"),
  ),
  ...findAllFiles(gradleTransformRoots, "imagepipeline-base-3.6.0-runtime.jar"),
  ...findAllFiles(gradleTransformRoots, "imagepipeline-base-3.6.0-api.jar"),
]);
const imagePipelineBaseAars = uniquePaths([
  ...findAllFiles(moduleCacheRoots, "imagepipeline-base-3.6.0.aar"),
]);

if (
  fbcoreJars.length === 0 &&
  fbcoreAars.length === 0 &&
  imagePipelineBaseJars.length === 0 &&
  imagePipelineBaseAars.length === 0
) {
  throw new Error("Could not find fbcore/imagepipeline-base jars or AARs to patch");
}

const sourceRoot = path.join(packageRoot, "src");
const buildRoot = path.join(packageRoot, ".build-sha1");
const sourceFiles = [
  path.join(sourceRoot, "com", "facebook", "common", "util", "SecureHashUtil.java"),
  path.join(sourceRoot, "com", "facebook", "cache", "common", "CacheKeyUtil.java"),
];
const classFiles = [
  path.join("com", "facebook", "common", "util", "SecureHashUtil.class"),
  path.join("com", "facebook", "cache", "common", "CacheKeyUtil.class"),
];

compileSources(buildRoot, [imagePipelineBaseJars[0], fbcoreJars[0]], sourceFiles);

let patchedTargets = 0;

for (const jarPath of fbcoreJars) {
  updateJar(jarPath, buildRoot, [classFiles[0]]);
  patchedTargets += 1;
}

for (const aarPath of fbcoreAars) {
  updateAarClassesJar(aarPath, buildRoot, [classFiles[0]], path.join(buildRoot, "aar-fbcore"));
  patchedTargets += 1;
}

for (const jarPath of imagePipelineBaseJars) {
  updateJar(jarPath, buildRoot, [classFiles[1]]);
  patchedTargets += 1;
}

for (const aarPath of imagePipelineBaseAars) {
  updateAarClassesJar(
    aarPath,
    buildRoot,
    [classFiles[1]],
    path.join(buildRoot, "aar-imagepipeline-base"),
  );
  patchedTargets += 1;
}

let clearedDexFiles = 0;
for (const dexFile of dexFiles) {
  const normalized = dexFile.replace(/\\/g, "/");
  if (
    normalized.includes("/fbcore-3.6.0") ||
    normalized.includes("/imagepipeline-base-3.6.0")
  ) {
    if (deleteFile(dexFile)) {
      clearedDexFiles += 1;
    }
  }
}

console.log(
  `Patched Android SHA-1 hotspots across ${patchedTargets} fbcore/imagepipeline-base jar/AAR targets and cleared ${clearedDexFiles} stale dex outputs`,
);
