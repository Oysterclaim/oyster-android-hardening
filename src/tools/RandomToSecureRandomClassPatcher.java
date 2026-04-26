package tools;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import jdk.internal.org.objectweb.asm.ClassReader;
import jdk.internal.org.objectweb.asm.ClassVisitor;
import jdk.internal.org.objectweb.asm.ClassWriter;
import jdk.internal.org.objectweb.asm.Handle;
import jdk.internal.org.objectweb.asm.Label;
import jdk.internal.org.objectweb.asm.MethodVisitor;
import jdk.internal.org.objectweb.asm.Opcodes;
import jdk.internal.org.objectweb.asm.Type;

public final class RandomToSecureRandomClassPatcher {
  private static final String RANDOM_INTERNAL = "java/util/Random";
  private static final String THREAD_LOCAL_RANDOM_INTERNAL = "java/util/concurrent/ThreadLocalRandom";
  private static final String SECURE_RANDOM_INTERNAL = "java/security/SecureRandom";
  private static final String RANDOM_DESC = "Ljava/util/Random;";
  private static final String THREAD_LOCAL_RANDOM_DESC = "Ljava/util/concurrent/ThreadLocalRandom;";
  private static final String SECURE_RANDOM_DESC = "Ljava/security/SecureRandom;";

  private RandomToSecureRandomClassPatcher() {}

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
    ClassWriter writer = new ClassWriter(0);
    reader.accept(new SecureRandomRemappingVisitor(writer), ClassReader.EXPAND_FRAMES);
    return writer.toByteArray();
  }

  private static String remapDesc(String value) {
    if (value == null) {
      return null;
    }

    return value
      .replace(RANDOM_DESC, SECURE_RANDOM_DESC)
      .replace(THREAD_LOCAL_RANDOM_DESC, SECURE_RANDOM_DESC);
  }

  private static String remapInternal(String value) {
    if (RANDOM_INTERNAL.equals(value) || THREAD_LOCAL_RANDOM_INTERNAL.equals(value)) {
      return SECURE_RANDOM_INTERNAL;
    }

    return value;
  }

  private static String[] remapArray(String[] values) {
    if (values == null) {
      return null;
    }

    String[] next = new String[values.length];
    for (int i = 0; i < values.length; i += 1) {
      next[i] = remapInternal(values[i]);
    }
    return next;
  }

  private static Object remapFrameValue(Object value) {
    if (value instanceof String) {
      return remapInternal((String) value);
    }
    return value;
  }

  private static Object[] remapFrameValues(Object[] values) {
    if (values == null) {
      return null;
    }

    Object[] next = new Object[values.length];
    for (int i = 0; i < values.length; i += 1) {
      next[i] = remapFrameValue(values[i]);
    }
    return next;
  }

  private static Object remapLdcValue(Object value) {
    if (value instanceof Type) {
      Type type = (Type) value;
      return Type.getType(remapDesc(type.getDescriptor()));
    }

    if (value instanceof Handle) {
      Handle handle = (Handle) value;
      return new Handle(
        handle.getTag(),
        remapInternal(handle.getOwner()),
        handle.getName(),
        remapDesc(handle.getDesc()),
        handle.isInterface()
      );
    }

    return value;
  }

  private static final class SecureRandomRemappingVisitor extends ClassVisitor {
    SecureRandomRemappingVisitor(ClassVisitor delegate) {
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
      super.visit(
        version,
        access,
        name,
        remapDesc(signature),
        remapInternal(superName),
        remapArray(interfaces)
      );
    }

    @Override
    public jdk.internal.org.objectweb.asm.FieldVisitor visitField(
      int access,
      String name,
      String descriptor,
      String signature,
      Object value
    ) {
      return super.visitField(access, name, remapDesc(descriptor), remapDesc(signature), value);
    }

    @Override
    public MethodVisitor visitMethod(
      int access,
      String name,
      String descriptor,
      String signature,
      String[] exceptions
    ) {
      MethodVisitor delegate =
        super.visitMethod(access, name, remapDesc(descriptor), remapDesc(signature), remapArray(exceptions));

      return new MethodVisitor(Opcodes.ASM8, delegate) {
        @Override
        public void visitTypeInsn(int opcode, String type) {
          super.visitTypeInsn(opcode, remapInternal(type));
        }

        @Override
        public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
          super.visitFieldInsn(opcode, remapInternal(owner), name, remapDesc(descriptor));
        }

        @Override
        public void visitMethodInsn(
          int opcode,
          String owner,
          String name,
          String descriptor,
          boolean isInterface
        ) {
          if (
            opcode == Opcodes.INVOKESTATIC &&
            THREAD_LOCAL_RANDOM_INTERNAL.equals(owner) &&
            "current".equals(name) &&
            "()Ljava/util/concurrent/ThreadLocalRandom;".equals(descriptor)
          ) {
            super.visitTypeInsn(Opcodes.NEW, SECURE_RANDOM_INTERNAL);
            super.visitInsn(Opcodes.DUP);
            super.visitMethodInsn(
              Opcodes.INVOKESPECIAL,
              SECURE_RANDOM_INTERNAL,
              "<init>",
              "()V",
              false
            );
            return;
          }

          super.visitMethodInsn(
            opcode,
            remapInternal(owner),
            name,
            remapDesc(descriptor),
            isInterface
          );
        }

        @Override
        public void visitInvokeDynamicInsn(
          String name,
          String descriptor,
          Handle bootstrapMethodHandle,
          Object... bootstrapMethodArguments
        ) {
          Object[] remappedArguments = new Object[bootstrapMethodArguments.length];
          for (int i = 0; i < bootstrapMethodArguments.length; i += 1) {
            remappedArguments[i] = remapLdcValue(bootstrapMethodArguments[i]);
          }

          super.visitInvokeDynamicInsn(
            name,
            remapDesc(descriptor),
            (Handle) remapLdcValue(bootstrapMethodHandle),
            remappedArguments
          );
        }

        @Override
        public void visitLdcInsn(Object value) {
          super.visitLdcInsn(remapLdcValue(value));
        }

        @Override
        public void visitLocalVariable(
          String name,
          String descriptor,
          String signature,
          Label start,
          Label end,
          int index
        ) {
          super.visitLocalVariable(name, remapDesc(descriptor), remapDesc(signature), start, end, index);
        }

        @Override
        public void visitTryCatchBlock(Label start, Label end, Label handler, String type) {
          super.visitTryCatchBlock(start, end, handler, remapInternal(type));
        }

        @Override
        public void visitFrame(int type, int numLocal, Object[] local, int numStack, Object[] stack) {
          super.visitFrame(
            type,
            numLocal,
            remapFrameValues(local),
            numStack,
            remapFrameValues(stack)
          );
        }
      };
    }
  }
}
