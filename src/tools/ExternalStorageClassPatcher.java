package tools;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import jdk.internal.org.objectweb.asm.ClassReader;
import jdk.internal.org.objectweb.asm.ClassVisitor;
import jdk.internal.org.objectweb.asm.ClassWriter;
import jdk.internal.org.objectweb.asm.MethodVisitor;
import jdk.internal.org.objectweb.asm.Opcodes;

public final class ExternalStorageClassPatcher {
  private static final String STATFS_HELPER = "com/facebook/common/statfs/StatFsHelper";
  private static final String DEFAULT_DISK_STORAGE = "com/facebook/cache/disk/DefaultDiskStorage";
  private static final String FILE_PROVIDER = "androidx/core/content/FileProvider";
  private static final String ENSURE_INITIALIZED = "ensureInitialized";
  private static final String ENSURE_INITIALIZED_DESC = "()V";
  private static final String IS_EXTERNAL = "isExternal";
  private static final String IS_EXTERNAL_DESC =
      "(Ljava/io/File;Lcom/facebook/cache/common/CacheErrorLogger;)Z";
  private static final String ENVIRONMENT = "android/os/Environment";

  private ExternalStorageClassPatcher() {}

  public static void main(String[] args) throws IOException {
    for (String arg : args) {
      patchInPlace(Path.of(arg));
    }
  }

  private static void patchInPlace(Path classFile) throws IOException {
    byte[] before = Files.readAllBytes(classFile);
    byte[] after = patch(before);
    if (!Arrays.equals(before, after)) {
      Files.write(classFile, after);
    }
  }

  private static byte[] patch(byte[] source) {
    ClassReader reader = new ClassReader(source);
    ClassWriter writer = new ClassWriter(ClassWriter.COMPUTE_FRAMES | ClassWriter.COMPUTE_MAXS);
    reader.accept(new ExternalStorageVisitor(writer), ClassReader.EXPAND_FRAMES);
    return writer.toByteArray();
  }

  private static final class ExternalStorageVisitor extends ClassVisitor {
    private String className;

    ExternalStorageVisitor(ClassVisitor delegate) {
      super(Opcodes.ASM8, delegate);
    }

    @Override
    public void visit(
        int version,
        int access,
        String name,
        String signature,
        String superName,
        String[] interfaces) {
      className = name;
      super.visit(version, access, name, signature, superName, interfaces);
    }

    @Override
    public MethodVisitor visitMethod(
        int access,
        String name,
        String descriptor,
        String signature,
        String[] exceptions) {
      MethodVisitor delegate = super.visitMethod(access, name, descriptor, signature, exceptions);

      if (DEFAULT_DISK_STORAGE.equals(className)
          && IS_EXTERNAL.equals(name)
          && IS_EXTERNAL_DESC.equals(descriptor)) {
        writeAlwaysInternalMethod(delegate);
        return null;
      }

      if (STATFS_HELPER.equals(className)
          && ENSURE_INITIALIZED.equals(name)
          && ENSURE_INITIALIZED_DESC.equals(descriptor)) {
        return new MethodVisitor(Opcodes.ASM8, delegate) {
          @Override
          public void visitMethodInsn(
              int opcode, String owner, String methodName, String methodDescriptor, boolean isInterface) {
            if (opcode == Opcodes.INVOKESTATIC
                && ENVIRONMENT.equals(owner)
                && "getExternalStorageDirectory".equals(methodName)
                && "()Ljava/io/File;".equals(methodDescriptor)) {
              super.visitMethodInsn(
                  opcode,
                  ENVIRONMENT,
                  "getDataDirectory",
                  methodDescriptor,
                  isInterface);
              return;
            }
            super.visitMethodInsn(opcode, owner, methodName, methodDescriptor, isInterface);
          }
        };
      }

      if (FILE_PROVIDER.equals(className)) {
        return new MethodVisitor(Opcodes.ASM8, delegate) {
          @Override
          public void visitMethodInsn(
              int opcode, String owner, String methodName, String methodDescriptor, boolean isInterface) {
            if (opcode == Opcodes.INVOKESTATIC
                && ENVIRONMENT.equals(owner)
                && "getExternalStorageDirectory".equals(methodName)
                && "()Ljava/io/File;".equals(methodDescriptor)) {
              super.visitMethodInsn(
                  opcode,
                  ENVIRONMENT,
                  "getDataDirectory",
                  methodDescriptor,
                  isInterface);
              return;
            }
            super.visitMethodInsn(opcode, owner, methodName, methodDescriptor, isInterface);
          }
        };
      }

      return delegate;
    }

    private void writeAlwaysInternalMethod(MethodVisitor mv) {
      mv.visitCode();
      mv.visitInsn(Opcodes.ICONST_0);
      mv.visitInsn(Opcodes.IRETURN);
      mv.visitMaxs(1, 2);
      mv.visitEnd();
    }
  }
}
