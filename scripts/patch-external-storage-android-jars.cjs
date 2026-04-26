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

function compileJavaTool(outputDir, sourceFiles) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  cp.execFileSync(
    "javac",
    [
      "--add-exports",
      "java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED",
      "-d",
      outputDir,
      ...sourceFiles,
    ],
    { stdio: "inherit" },
  );
}

function extractJarEntries(jarPath, outputDir, entryPaths) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  cp.execFileSync("jar", ["xf", jarPath, ...entryPaths], {
    cwd: outputDir,
    stdio: "inherit",
  });
}

function updateJar(jarPath, compiledRoot, classFiles) {
  ensureBackup(jarPath);
  const args = ["uf", jarPath];
  for (const classFile of classFiles) {
    args.push("-C", compiledRoot, classFile);
  }
  cp.execFileSync("jar", args, { stdio: "inherit" });
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

function runJavaTool(classpathRoot, mainClass, args) {
  cp.execFileSync(
    "java",
    [
      "--add-exports",
      "java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED",
      "-cp",
      classpathRoot,
      mainClass,
      ...args,
    ],
    { stdio: "inherit" },
  );
}

function patchJarClassEntriesWithJavaTool(
  jarPath,
  extractionRoot,
  classEntries,
  toolClasspathRoot,
  mainClass,
) {
  ensureBackup(jarPath);

  const scratchDir = path.join(
    extractionRoot,
    path.basename(jarPath).replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
  extractJarEntries(jarPath, scratchDir, classEntries);

  const extractedPaths = classEntries
    .map((entry) => path.join(scratchDir, entry))
    .filter((entryPath) => fs.existsSync(entryPath));

  if (extractedPaths.length === 0) {
    return false;
  }

  runJavaTool(toolClasspathRoot, mainClass, extractedPaths);
  updateJar(
    jarPath,
    scratchDir,
    classEntries.filter((entry) => fs.existsSync(path.join(scratchDir, entry))),
  );
  return true;
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
const gradleTransformRoots = gradleHomes.map((home) =>
  path.join(home, "caches", "8.14.3", "transforms"),
);
const moduleCacheRoots = gradleHomes.map((home) =>
  path.join(home, "caches", "modules-2", "files-2.1"),
);
const dexFiles = uniquePaths([
  ...findAllFiles(gradleTransformRoots, "classes.dex"),
  ...findAllFiles(gradleTransformRoots, "classes2.dex"),
]);

const fbcoreRuntimeJars = uniquePaths([
  ...findAllFiles(gradleTransformRoots, "classes.jar").filter((jarPath) =>
    matchesNormalizedSuffix(jarPath, "fbcore-3.6.0/jars/classes.jar"),
  ),
  ...findAllFiles(gradleTransformRoots, "fbcore-3.6.0-runtime.jar"),
  ...findAllFiles(moduleCacheRoots, "fbcore-3.6.0.jar"),
]);
const fbcoreAars = findAllFiles(moduleCacheRoots, "fbcore-3.6.0.aar");
const coreRuntimeJars = uniquePaths([
  ...findAllFiles(gradleTransformRoots, "classes.jar").filter((jarPath) =>
    matchesNormalizedSuffix(jarPath, "core-1.13.1/jars/classes.jar"),
  ),
  ...findAllFiles(gradleTransformRoots, "core-1.13.1-runtime.jar"),
  ...findAllFiles(gradleTransformRoots, "core-1.13.1-api.jar"),
]);
const coreAars = findAllFiles(moduleCacheRoots, "core-1.13.1.aar");
const imagePipelineRuntimeJars = findAllFiles(
  gradleTransformRoots,
  "imagepipeline-base-3.6.0-runtime.jar",
);
const imagePipelineClassesJars = findAllFiles(gradleTransformRoots, "classes.jar").filter((jarPath) =>
  matchesNormalizedSuffix(jarPath, "imagepipeline-base-3.6.0/jars/classes.jar"),
);
const imagePipelineAars = findAllFiles(moduleCacheRoots, "imagepipeline-base-3.6.0.aar");

if (
  fbcoreRuntimeJars.length === 0 &&
  fbcoreAars.length === 0 &&
  coreRuntimeJars.length === 0 &&
  coreAars.length === 0 &&
  imagePipelineRuntimeJars.length === 0 &&
  imagePipelineClassesJars.length === 0 &&
  imagePipelineAars.length === 0
) {
  throw new Error("Could not find any fbcore/core/imagepipeline-base jars or AARs to patch");
}

const sourceRoot = path.join(packageRoot, "src");
const buildRoot = path.join(packageRoot, ".build-external-storage");
const extractionRoot = path.join(buildRoot, "external-storage");
const javaToolSourceFiles = [
  path.join(sourceRoot, "tools", "ExternalStorageClassPatcher.java"),
];
const javaToolsBuildDir = path.join(buildRoot, "java-tools-external-storage");

compileJavaTool(javaToolsBuildDir, javaToolSourceFiles);

const fbcoreClassEntries = [
  path.join("com", "facebook", "common", "statfs", "StatFsHelper.class"),
];
const coreClassEntries = [
  path.join("androidx", "core", "content", "FileProvider.class"),
];
const imagePipelineClassEntries = [
  path.join("com", "facebook", "cache", "disk", "DefaultDiskStorage.class"),
];

for (const jarPath of fbcoreRuntimeJars) {
  patchJarClassEntriesWithJavaTool(
    jarPath,
    extractionRoot,
    fbcoreClassEntries,
    javaToolsBuildDir,
    "tools.ExternalStorageClassPatcher",
  );
}

for (const aarPath of fbcoreAars) {
  ensureBackup(aarPath);
  const scratchDir = path.join(
    extractionRoot,
    path.basename(aarPath).replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
  const classesJarPath = extractClassesJarFromAar(aarPath, scratchDir);
  patchJarClassEntriesWithJavaTool(
    classesJarPath,
    path.join(extractionRoot, "fbcore-classes-jars"),
    fbcoreClassEntries,
    javaToolsBuildDir,
    "tools.ExternalStorageClassPatcher",
  );
  cp.execFileSync("jar", ["uf", aarPath, "-C", scratchDir, "classes.jar"], {
    stdio: "inherit",
  });
}

for (const jarPath of coreRuntimeJars) {
  patchJarClassEntriesWithJavaTool(
    jarPath,
    extractionRoot,
    coreClassEntries,
    javaToolsBuildDir,
    "tools.ExternalStorageClassPatcher",
  );
}

for (const aarPath of coreAars) {
  ensureBackup(aarPath);
  const scratchDir = path.join(
    extractionRoot,
    path.basename(aarPath).replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
  const classesJarPath = extractClassesJarFromAar(aarPath, scratchDir);
  patchJarClassEntriesWithJavaTool(
    classesJarPath,
    path.join(extractionRoot, "core-classes-jars"),
    coreClassEntries,
    javaToolsBuildDir,
    "tools.ExternalStorageClassPatcher",
  );
  cp.execFileSync("jar", ["uf", aarPath, "-C", scratchDir, "classes.jar"], {
    stdio: "inherit",
  });
}

for (const jarPath of imagePipelineRuntimeJars) {
  patchJarClassEntriesWithJavaTool(
    jarPath,
    extractionRoot,
    imagePipelineClassEntries,
    javaToolsBuildDir,
    "tools.ExternalStorageClassPatcher",
  );
}

for (const jarPath of imagePipelineClassesJars) {
  patchJarClassEntriesWithJavaTool(
    jarPath,
    extractionRoot,
    imagePipelineClassEntries,
    javaToolsBuildDir,
    "tools.ExternalStorageClassPatcher",
  );
}

for (const aarPath of imagePipelineAars) {
  ensureBackup(aarPath);
  const scratchDir = path.join(
    extractionRoot,
    path.basename(aarPath).replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
  const classesJarPath = extractClassesJarFromAar(aarPath, scratchDir);
  patchJarClassEntriesWithJavaTool(
    classesJarPath,
    path.join(extractionRoot, "classes-jars"),
    imagePipelineClassEntries,
    javaToolsBuildDir,
    "tools.ExternalStorageClassPatcher",
  );
  cp.execFileSync("jar", ["uf", aarPath, "-C", scratchDir, "classes.jar"], {
    stdio: "inherit",
  });
}

let clearedDexFiles = 0;
for (const dexFile of dexFiles) {
  const normalized = dexFile.replace(/\\/g, "/");
  if (
    normalized.includes("/fbcore-3.6.0") ||
    normalized.includes("/core-1.13.1") ||
    normalized.includes("/imagepipeline-base-3.6.0")
  ) {
    if (deleteFile(dexFile)) {
      clearedDexFiles += 1;
    }
  }
}

console.log(
  `Patched Android external-storage hotspots in fbcore, AndroidX core, and imagepipeline-base jars/AARs and cleared ${clearedDexFiles} stale dex outputs`,
);
