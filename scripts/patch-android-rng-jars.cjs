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

function patchJarClassEntriesWithJavaTool(jarPath, extractionRoot, classEntries, toolClasspathRoot, mainClass) {
  ensureBackup(jarPath);

  const scratchDir = path.join(
    extractionRoot,
    path.basename(jarPath).replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
  extractJarEntries(jarPath, scratchDir, classEntries);

  const extractedEntries = classEntries.filter((entry) => fs.existsSync(path.join(scratchDir, entry)));
  if (extractedEntries.length === 0) {
    return false;
  }

  runJavaTool(
    toolClasspathRoot,
    mainClass,
    extractedEntries.map((entry) => path.join(scratchDir, entry)),
  );
  updateJar(jarPath, scratchDir, extractedEntries);
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

const kotlinStdlibJars = uniquePaths([
  ...findAllFiles(moduleCacheRoots, "kotlin-stdlib-2.1.20.jar"),
  ...findAllFiles(gradleTransformRoots, "instrumented-kotlin-stdlib-2.1.20.jar"),
]);
const kotlinStdlibJdk8Jars = uniquePaths([
  ...findAllFiles(moduleCacheRoots, "kotlin-stdlib-jdk8-2.1.20.jar"),
  ...findAllFiles(gradleTransformRoots, "instrumented-kotlin-stdlib-jdk8-2.1.20.jar"),
]);
const okhttpJars = uniquePaths([
  ...findAllFiles(moduleCacheRoots, "okhttp-4.9.2.jar"),
  ...findAllFiles(moduleCacheRoots, "okhttp-4.12.0.jar"),
  ...findAllFiles(gradleTransformRoots, "instrumented-okhttp-4.9.2.jar"),
  ...findAllFiles(gradleTransformRoots, "instrumented-okhttp-4.12.0.jar"),
]);

const sourceRoot = path.join(packageRoot, "src");
const buildRoot = path.join(packageRoot, ".build-rng");
const javaToolSourceFiles = [
  path.join(sourceRoot, "tools", "RandomToSecureRandomClassPatcher.java"),
];
const javaToolsBuildDir = path.join(buildRoot, "java-tools");
const asmExtractRoot = path.join(buildRoot, "asm-extracted");

const kotlinStdlibClassFiles = [
  path.join("kotlin", "random", "AbstractPlatformRandom.class"),
  path.join("kotlin", "random", "FallbackThreadLocalRandom.class"),
  path.join("kotlin", "random", "FallbackThreadLocalRandom$implStorage$1.class"),
  path.join("kotlin", "random", "jdk8", "PlatformThreadLocalRandom.class"),
];
const kotlinStdlibJdk8ClassFiles = [path.join("kotlin", "random", "jdk8", "PlatformThreadLocalRandom.class")];
const okhttpClassFiles = [
  path.join("okhttp3", "OkHttpClient.class"),
  path.join("okhttp3", "internal", "ws", "RealWebSocket.class"),
  path.join("okhttp3", "internal", "ws", "WebSocketWriter.class"),
];

compileJavaTool(javaToolsBuildDir, javaToolSourceFiles);

for (const jarPath of kotlinStdlibJars) {
  patchJarClassEntriesWithJavaTool(
    jarPath,
    asmExtractRoot,
    kotlinStdlibClassFiles,
    javaToolsBuildDir,
    "tools.RandomToSecureRandomClassPatcher",
  );
}

for (const jarPath of kotlinStdlibJdk8Jars) {
  patchJarClassEntriesWithJavaTool(
    jarPath,
    asmExtractRoot,
    kotlinStdlibJdk8ClassFiles,
    javaToolsBuildDir,
    "tools.RandomToSecureRandomClassPatcher",
  );
}

for (const jarPath of okhttpJars) {
  patchJarClassEntriesWithJavaTool(
    jarPath,
    asmExtractRoot,
    okhttpClassFiles,
    javaToolsBuildDir,
    "tools.RandomToSecureRandomClassPatcher",
  );
}

console.log("Patched Android RNG hotspots in Kotlin stdlib and OkHttp jars");
