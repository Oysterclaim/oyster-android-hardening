package tools;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import jdk.internal.org.objectweb.asm.ClassReader;
import jdk.internal.org.objectweb.asm.ClassVisitor;
import jdk.internal.org.objectweb.asm.ClassWriter;
import jdk.internal.org.objectweb.asm.Label;
import jdk.internal.org.objectweb.asm.MethodVisitor;
import jdk.internal.org.objectweb.asm.Opcodes;

public final class DefaultDiskStorageTempFileClassPatcher {
  private static final String TARGET_CLASS = "com/facebook/cache/disk/DefaultDiskStorage$FileInfo";
  private static final String TARGET_METHOD = "createTempFile";
  private static final String TARGET_DESC = "(Ljava/io/File;)Ljava/io/File;";

  private DefaultDiskStorageTempFileClassPatcher() {}

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
    reader.accept(new TempFileVisitor(writer), ClassReader.EXPAND_FRAMES);
    return writer.toByteArray();
  }

  private static final class TempFileVisitor extends ClassVisitor {
    private String className;

    TempFileVisitor(ClassVisitor delegate) {
      super(Opcodes.ASM8, delegate);
    }

    @Override
    public void visit(
      int version,
      int access,
      String name,
      String signature,
      String superName,
      String[] interfaces
    ) {
      className = name;
      super.visit(version, access, name, signature, superName, interfaces);
    }

    @Override
    public MethodVisitor visitMethod(
      int access,
      String name,
      String descriptor,
      String signature,
      String[] exceptions
    ) {
      MethodVisitor delegate = super.visitMethod(access, name, descriptor, signature, exceptions);

      if (TARGET_CLASS.equals(className) && TARGET_METHOD.equals(name) && TARGET_DESC.equals(descriptor)) {
        writePatchedCreateTempFile(delegate);
        return new MethodVisitor(Opcodes.ASM8) {};
      }

      return delegate;
    }

    private void writePatchedCreateTempFile(MethodVisitor mv) {
      Label loopStart = new Label();
      Label loopContinue = new Label();
      Label failure = new Label();

      mv.visitCode();
      mv.visitInsn(Opcodes.ICONST_0);
      mv.visitVarInsn(Opcodes.ISTORE, 2);

      mv.visitLabel(loopStart);
      mv.visitVarInsn(Opcodes.ILOAD, 2);
      mv.visitIntInsn(Opcodes.BIPUSH, 10);
      mv.visitJumpInsn(Opcodes.IF_ICMPGE, failure);

      mv.visitTypeInsn(Opcodes.NEW, "java/io/File");
      mv.visitInsn(Opcodes.DUP);
      mv.visitVarInsn(Opcodes.ALOAD, 1);
      mv.visitTypeInsn(Opcodes.NEW, "java/lang/StringBuilder");
      mv.visitInsn(Opcodes.DUP);
      mv.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
      mv.visitVarInsn(Opcodes.ALOAD, 0);
      mv.visitFieldInsn(
        Opcodes.GETFIELD,
        TARGET_CLASS,
        "resourceId",
        "Ljava/lang/String;"
      );
      mv.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        "java/lang/StringBuilder",
        "append",
        "(Ljava/lang/String;)Ljava/lang/StringBuilder;",
        false
      );
      mv.visitLdcInsn(".");
      mv.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        "java/lang/StringBuilder",
        "append",
        "(Ljava/lang/String;)Ljava/lang/StringBuilder;",
        false
      );
      mv.visitMethodInsn(
        Opcodes.INVOKESTATIC,
        "java/util/UUID",
        "randomUUID",
        "()Ljava/util/UUID;",
        false
      );
      mv.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        "java/util/UUID",
        "toString",
        "()Ljava/lang/String;",
        false
      );
      mv.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        "java/lang/StringBuilder",
        "append",
        "(Ljava/lang/String;)Ljava/lang/StringBuilder;",
        false
      );
      mv.visitLdcInsn(".tmp");
      mv.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        "java/lang/StringBuilder",
        "append",
        "(Ljava/lang/String;)Ljava/lang/StringBuilder;",
        false
      );
      mv.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        "java/lang/StringBuilder",
        "toString",
        "()Ljava/lang/String;",
        false
      );
      mv.visitMethodInsn(
        Opcodes.INVOKESPECIAL,
        "java/io/File",
        "<init>",
        "(Ljava/io/File;Ljava/lang/String;)V",
        false
      );
      mv.visitVarInsn(Opcodes.ASTORE, 3);

      mv.visitVarInsn(Opcodes.ALOAD, 3);
      mv.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        "java/io/File",
        "createNewFile",
        "()Z",
        false
      );
      mv.visitJumpInsn(Opcodes.IFEQ, loopContinue);
      mv.visitVarInsn(Opcodes.ALOAD, 3);
      mv.visitInsn(Opcodes.ARETURN);

      mv.visitLabel(loopContinue);
      mv.visitIincInsn(2, 1);
      mv.visitJumpInsn(Opcodes.GOTO, loopStart);

      mv.visitLabel(failure);
      mv.visitTypeInsn(Opcodes.NEW, "java/io/IOException");
      mv.visitInsn(Opcodes.DUP);
      mv.visitTypeInsn(Opcodes.NEW, "java/lang/StringBuilder");
      mv.visitInsn(Opcodes.DUP);
      mv.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
      mv.visitLdcInsn("Failed to create temp file for ");
      mv.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        "java/lang/StringBuilder",
        "append",
        "(Ljava/lang/String;)Ljava/lang/StringBuilder;",
        false
      );
      mv.visitVarInsn(Opcodes.ALOAD, 0);
      mv.visitFieldInsn(
        Opcodes.GETFIELD,
        TARGET_CLASS,
        "resourceId",
        "Ljava/lang/String;"
      );
      mv.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        "java/lang/StringBuilder",
        "append",
        "(Ljava/lang/String;)Ljava/lang/StringBuilder;",
        false
      );
      mv.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        "java/lang/StringBuilder",
        "toString",
        "()Ljava/lang/String;",
        false
      );
      mv.visitMethodInsn(
        Opcodes.INVOKESPECIAL,
        "java/io/IOException",
        "<init>",
        "(Ljava/lang/String;)V",
        false
      );
      mv.visitInsn(Opcodes.ATHROW);
      mv.visitMaxs(0, 0);
      mv.visitEnd();
    }
  }
}
