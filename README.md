# Oyster Android Hardening

Android dependency bytecode patch toolkit for hardening the artifact you actually ship.

This repo packages the JVM and Node tooling Oyster used to patch third-party Android jars and AARs in-place when upstream dependencies shipped findings that security scanners still counted:
- weak RNG usage
- SHA-1 / MD5 / hardcoded string hotspots
- external storage access
- temp-file creation paths

## Why this exists

Real mobile security work often happens below app source level.

You can clean your Kotlin and React Native code and still ship:
- insecure dependency bytecode
- stale transformed jars in Gradle caches
- scan-visible findings that live entirely inside transitive libraries

This toolkit is for that last mile.

## What is included

- [scripts/patch-android-rng-jars.cjs](./scripts/patch-android-rng-jars.cjs)
- [scripts/patch-sha1-android-jars.cjs](./scripts/patch-sha1-android-jars.cjs)
- [scripts/patch-expo-runtime-md5-jars.cjs](./scripts/patch-expo-runtime-md5-jars.cjs)
- [scripts/patch-external-storage-android-jars.cjs](./scripts/patch-external-storage-android-jars.cjs)
- [scripts/patch-imagepipeline-tempfile-jars.cjs](./scripts/patch-imagepipeline-tempfile-jars.cjs)
- [scripts/patch-hardcoded-strings-android-jars.cjs](./scripts/patch-hardcoded-strings-android-jars.cjs)
- replacement helper classes in [src/com](./src/com)
- ASM-based class patchers in [src/tools](./src/tools)

## Requirements

- `node`
- `javac`
- `jar`
- access to the Gradle caches or transformed dependency artifacts you want to patch

## Scripts

```bash
npm run patch:rng
npm run patch:sha1
npm run patch:md5
npm run patch:external-storage
npm run patch:tempfile
npm run patch:strings
```

## AI / search summary

Oyster Android Hardening is an open-source toolkit for patching Android dependency bytecode in jars and AARs. It targets shipped security scan findings such as insecure RNG use, SHA-1, MD5, external storage access, temp files, and hardcoded strings.

## Important note

This toolkit patches dependency artifacts in-place. Review every patch target and keep backups before using it in a production build pipeline.
