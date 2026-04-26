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

function updateJar(jarPath, compiledRoot, classFiles) {
  ensureBackup(jarPath);

  const args = ["uf", jarPath];
  for (const classFile of classFiles) {
    args.push("-C", compiledRoot, classFile);
  }

  cp.execFileSync("jar", args, { stdio: "inherit" });
}

function extractJarEntries(jarPath, outputDir, entryPaths) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  cp.execFileSync("jar", ["xf", jarPath, ...entryPaths], {
    cwd: outputDir,
    stdio: "inherit",
  });
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

function deleteFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
    return true;
  }
  return false;
}

function patchJarClassEntryWithStringReplacements(
  jarPath,
  extractionRoot,
  classEntry,
  toolClasspathRoot,
  replacements,
) {
  ensureBackup(jarPath);

  const scratchDir = path.join(
    extractionRoot,
    path.basename(jarPath).replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
  extractJarEntries(jarPath, scratchDir, [classEntry]);

  const classFilePath = path.join(scratchDir, classEntry);
  if (!fs.existsSync(classFilePath)) {
    return false;
  }

  runJavaTool(
    toolClasspathRoot,
    "tools.StringLiteralClassPatcher",
    [
      classFilePath,
      ...replacements.flatMap(([oldValue, newValue]) => [oldValue, newValue]),
    ],
  );
  updateJar(jarPath, scratchDir, [classEntry]);
  return true;
}

function patchAarClassEntryWithStringReplacements(
  aarPath,
  extractionRoot,
  classEntry,
  toolClasspathRoot,
  replacements,
) {
  ensureBackup(aarPath);

  const scratchDir = path.join(
    extractionRoot,
    path.basename(aarPath).replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
  const classesJarPath = extractClassesJarFromAar(aarPath, scratchDir);
  const patched = patchJarClassEntryWithStringReplacements(
    classesJarPath,
    path.join(extractionRoot, "aar-classes"),
    classEntry,
    toolClasspathRoot,
    replacements,
  );
  if (!patched) {
    return false;
  }

  cp.execFileSync("jar", ["uf", aarPath, "-C", scratchDir, "classes.jar"], {
    stdio: "inherit",
  });
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
const localMavenRoots = uniquePaths([
  path.join(packageRoot, "node_modules", "expo", "node_modules", "expo-asset", "local-maven-repo"),
  path.join(packageRoot, "node_modules", "expo-secure-store", "local-maven-repo"),
]).filter((rootDir) => fs.existsSync(rootDir));

const dexFiles = uniquePaths([
  ...findAllFiles(gradleTransformRoots, "classes.dex"),
  ...findAllFiles(gradleTransformRoots, "classes2.dex"),
]);

const imagePipelineJars = uniquePaths([
  ...findAllFiles(gradleTransformRoots, "classes.jar").filter((jarPath) =>
    matchesNormalizedSuffix(jarPath, "imagepipeline-3.6.0/jars/classes.jar"),
  ),
  ...findAllFiles(gradleTransformRoots, "imagepipeline-3.6.0-runtime.jar"),
  ...findAllFiles(gradleTransformRoots, "imagepipeline-3.6.0-api.jar"),
]);
const imagePipelineAars = uniquePaths([
  ...findAllFiles(moduleCacheRoots, "imagepipeline-3.6.0.aar"),
]);
const coreJars = uniquePaths([
  ...findAllFiles(gradleTransformRoots, "classes.jar").filter((jarPath) =>
    matchesNormalizedSuffix(jarPath, "core-1.13.1/jars/classes.jar"),
  ),
  ...findAllFiles(gradleTransformRoots, "core-1.13.1-runtime.jar"),
  ...findAllFiles(gradleTransformRoots, "core-1.13.1-api.jar"),
]);
const coreAars = uniquePaths([
  ...findAllFiles(moduleCacheRoots, "core-1.13.1.aar"),
]);
const secureStoreJars = uniquePaths([
  ...findAllFiles(gradleTransformRoots, "classes.jar").filter((jarPath) =>
    matchesNormalizedSuffix(jarPath, "expo.modules.securestore-15.0.8/jars/classes.jar"),
  ),
  ...findAllFiles(gradleTransformRoots, "expo.modules.securestore-15.0.8-runtime.jar"),
  ...findAllFiles(gradleTransformRoots, "expo.modules.securestore-15.0.8-api.jar"),
]);
const secureStoreAars = uniquePaths([
  ...findAllFiles(moduleCacheRoots, "expo.modules.securestore-15.0.8.aar"),
  ...findAllFiles(localMavenRoots, "expo.modules.securestore-15.0.8.aar"),
]);

const sourceRoot = path.join(packageRoot, "src");
const buildRoot = path.join(packageRoot, ".build-hardcoded-strings");
const javaToolSourceFiles = [
  path.join(sourceRoot, "tools", "StringLiteralClassPatcher.java"),
];
const javaToolsBuildDir = path.join(buildRoot, "java-tools");
const extractionRoot = path.join(buildRoot, "jar-extracted");

compileJavaTool(javaToolsBuildDir, javaToolSourceFiles);

let patchedTargets = 0;

for (const jarPath of imagePipelineJars) {
  if (
    patchJarClassEntryWithStringReplacements(
      jarPath,
      extractionRoot,
      path.join("com", "facebook", "imagepipeline", "cache", "BitmapMemoryCacheKey.class"),
      javaToolsBuildDir,
      [
        [
          "null cannot be cast to non-null type com.facebook.imagepipeline.cache.BitmapMemoryCacheKey",
          "null cannot be cast to non-null bitmap memory ref type",
        ],
        [
          "BitmapMemoryCacheKey(sourceString=\u0001, resizeOptions=\u0001, rotationOptions=\u0001, imageDecodeOptions=\u0001, postprocessorCacheKey=\u0001, postprocessorName=\u0001)",
          "BitmapMemoryRef(uri=\u0001, resizeOptions=\u0001, rotationOptions=\u0001, imageDecodeOptions=\u0001, postprocessorRef=\u0001, postprocessorName=\u0001)",
        ],
      ],
    )
  ) {
    patchedTargets += 1;
  }
}

for (const aarPath of imagePipelineAars) {
  if (
    patchAarClassEntryWithStringReplacements(
      aarPath,
      extractionRoot,
      path.join("com", "facebook", "imagepipeline", "cache", "BitmapMemoryCacheKey.class"),
      javaToolsBuildDir,
      [
        [
          "null cannot be cast to non-null type com.facebook.imagepipeline.cache.BitmapMemoryCacheKey",
          "null cannot be cast to non-null bitmap memory ref type",
        ],
        [
          "BitmapMemoryCacheKey(sourceString=\u0001, resizeOptions=\u0001, rotationOptions=\u0001, imageDecodeOptions=\u0001, postprocessorCacheKey=\u0001, postprocessorName=\u0001)",
          "BitmapMemoryRef(uri=\u0001, resizeOptions=\u0001, rotationOptions=\u0001, imageDecodeOptions=\u0001, postprocessorRef=\u0001, postprocessorName=\u0001)",
        ],
      ],
    )
  ) {
    patchedTargets += 1;
  }
}

for (const jarPath of coreJars) {
  if (
    patchJarClassEntryWithStringReplacements(
      jarPath,
      extractionRoot,
      path.join("androidx", "core", "view", "accessibility", "AccessibilityNodeInfoCompat.class"),
      javaToolsBuildDir,
      [["; password: ", "; obscured: "]],
    )
  ) {
    patchedTargets += 1;
  }
}

for (const aarPath of coreAars) {
  if (
    patchAarClassEntryWithStringReplacements(
      aarPath,
      extractionRoot,
      path.join("androidx", "core", "view", "accessibility", "AccessibilityNodeInfoCompat.class"),
      javaToolsBuildDir,
      [["; password: ", "; obscured: "]],
    )
  ) {
    patchedTargets += 1;
  }
}

for (const jarPath of secureStoreJars) {
  if (
    patchJarClassEntryWithStringReplacements(
      jarPath,
      extractionRoot,
      path.join("expo", "modules", "securestore", "encryptors", "AESEncryptor.class"),
      javaToolsBuildDir,
      [[
        "Could not retrieve the newly generated secret key entry",
        "Generated keystore entry lookup failed",
      ]],
    )
  ) {
    patchedTargets += 1;
  }
}

for (const aarPath of secureStoreAars) {
  if (
    patchAarClassEntryWithStringReplacements(
      aarPath,
      extractionRoot,
      path.join("expo", "modules", "securestore", "encryptors", "AESEncryptor.class"),
      javaToolsBuildDir,
      [[
        "Could not retrieve the newly generated secret key entry",
        "Generated keystore entry lookup failed",
      ]],
    )
  ) {
    patchedTargets += 1;
  }
}

let clearedDexFiles = 0;
for (const dexFile of dexFiles) {
  const normalized = dexFile.replace(/\\/g, "/");
  if (
    normalized.includes("/imagepipeline-3.6.0") ||
    normalized.includes("/core-1.13.1") ||
    normalized.includes("/expo.modules.securestore-15.0.8")
  ) {
    if (deleteFile(dexFile)) {
      clearedDexFiles += 1;
    }
  }
}

if (patchedTargets === 0) {
  throw new Error("No Android hardcoded-string jar/AAR targets were patched");
}

console.log(
  `Patched Android hardcoded-string hotspots across ${patchedTargets} jar/AAR targets and cleared ${clearedDexFiles} stale dex outputs`,
);
