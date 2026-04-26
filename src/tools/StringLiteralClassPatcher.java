package tools;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import jdk.internal.org.objectweb.asm.ClassReader;
import jdk.internal.org.objectweb.asm.ClassVisitor;
import jdk.internal.org.objectweb.asm.ClassWriter;
import jdk.internal.org.objectweb.asm.MethodVisitor;
import jdk.internal.org.objectweb.asm.Opcodes;

public final class StringLiteralClassPatcher {
  private StringLiteralClassPatcher() {}

  public static void main(String[] args) throws IOException {
    if (args.length < 3 || args.length % 2 == 0) {
      throw new IllegalArgumentException(
          "Usage: StringLiteralClassPatcher <class-file> <old-string> <new-string> [<old-string> <new-string> ...]");
    }

    Path classFile = Path.of(args[0]);
    Map<String, String> replacements = new HashMap<>();
    for (int index = 1; index < args.length; index += 2) {
      replacements.put(args[index], args[index + 1]);
    }

    byte[] classBytes = Files.readAllBytes(classFile);
    ClassReader classReader = new ClassReader(classBytes);
    ClassWriter classWriter = new ClassWriter(0);
    ClassVisitor classVisitor =
        new ClassVisitor(Opcodes.ASM8, classWriter) {
          @Override
          public MethodVisitor visitMethod(
              int access, String name, String descriptor, String signature, String[] exceptions) {
            MethodVisitor methodVisitor =
                super.visitMethod(access, name, descriptor, signature, exceptions);
            return new MethodVisitor(Opcodes.ASM8, methodVisitor) {
              @Override
              public void visitLdcInsn(Object value) {
                if (value instanceof String) {
                  String replacement = replacements.get(value);
                  if (replacement != null) {
                    super.visitLdcInsn(replacement);
                    return;
                  }
                }
                super.visitLdcInsn(value);
              }

              @Override
              public void visitInvokeDynamicInsn(
                  String name,
                  String descriptor,
                  jdk.internal.org.objectweb.asm.Handle bootstrapMethodHandle,
                  Object... bootstrapMethodArguments) {
                Object[] rewrittenArgs = bootstrapMethodArguments;
                for (int index = 0; index < bootstrapMethodArguments.length; index++) {
                  Object argument = bootstrapMethodArguments[index];
                  if (argument instanceof String) {
                    String replacement = replacements.get(argument);
                    if (replacement != null) {
                      if (rewrittenArgs == bootstrapMethodArguments) {
                        rewrittenArgs = bootstrapMethodArguments.clone();
                      }
                      rewrittenArgs[index] = replacement;
                    }
                  }
                }
                super.visitInvokeDynamicInsn(name, descriptor, bootstrapMethodHandle, rewrittenArgs);
              }
            };
          }
        };

    classReader.accept(classVisitor, 0);
    Files.write(classFile, classWriter.toByteArray());
  }
}
