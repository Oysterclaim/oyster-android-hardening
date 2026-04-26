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

function updateAarClassesJar(aarPath, compiledRoot, classFiles) {
  ensureBackup(aarPath);

  const scratchDir = path.join(
    os.tmpdir(),
    "codex-aar-patches",
    `${path.basename(aarPath).replace(/[^a-zA-Z0-9._-]/g, "_")}-${process.pid}`,
  );
  const classesJarPath = extractClassesJarFromAar(aarPath, scratchDir);
  updateJar(classesJarPath, compiledRoot, classFiles);
  cp.execFileSync("jar", ["uf", aarPath, "-C", scratchDir, "classes.jar"], {
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

const imagePipelineRuntimeJars = findAllFiles(
  gradleTransformRoots,
  "imagepipeline-base-3.6.0-runtime.jar",
);
const imagePipelineClassesJars = findAllFiles(gradleTransformRoots, "classes.jar").filter((jarPath) =>
  matchesNormalizedSuffix(jarPath, "imagepipeline-base-3.6.0/jars/classes.jar"),
);
const imagePipelineAars = findAllFiles(moduleCacheRoots, "imagepipeline-base-3.6.0.aar");

if (
  imagePipelineRuntimeJars.length === 0 &&
  imagePipelineClassesJars.length === 0 &&
  imagePipelineAars.length === 0
) {
  throw new Error(
    "Could not find any imagepipeline-base runtime jar, transformed classes.jar, or AAR",
  );
}

const sourceRoot = path.join(packageRoot, "src");
const buildRoot = path.join(packageRoot, ".build-tempfile");
const extractionRoot = path.join(buildRoot, "imagepipeline-tempfile");
const javaToolSourceFiles = [
  path.join(sourceRoot, "tools", "DefaultDiskStorageTempFileClassPatcher.java"),
];
const javaToolsBuildDir = path.join(buildRoot, "java-tools-imagepipeline-tempfile");

compileJavaTool(javaToolsBuildDir, javaToolSourceFiles);

const classEntries = [
  path.join("com", "facebook", "cache", "disk", "DefaultDiskStorage$FileInfo.class"),
];

for (const jarPath of imagePipelineRuntimeJars) {
  patchJarClassEntriesWithJavaTool(
    jarPath,
    extractionRoot,
    classEntries,
    javaToolsBuildDir,
    "tools.DefaultDiskStorageTempFileClassPatcher",
  );
}

for (const jarPath of imagePipelineClassesJars) {
  patchJarClassEntriesWithJavaTool(
    jarPath,
    extractionRoot,
    classEntries,
    javaToolsBuildDir,
    "tools.DefaultDiskStorageTempFileClassPatcher",
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
    classEntries,
    javaToolsBuildDir,
    "tools.DefaultDiskStorageTempFileClassPatcher",
  );
  cp.execFileSync("jar", ["uf", aarPath, "-C", scratchDir, "classes.jar"], {
    stdio: "inherit",
  });
}

console.log("Patched imagepipeline temp-file class in Android jars and AARs");
