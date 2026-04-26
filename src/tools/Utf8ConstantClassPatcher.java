package tools;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

public final class Utf8ConstantClassPatcher {
  private Utf8ConstantClassPatcher() {}

  public static void main(String[] args) throws IOException {
    if (args.length < 3 || args.length % 2 == 0) {
      throw new IllegalArgumentException(
          "Usage: Utf8ConstantClassPatcher <class-file> <old-utf8> <new-utf8> [<old-utf8> <new-utf8> ...]");
    }

    Path classFile = Paths.get(args[0]);
    Map<String, String> replacements = new HashMap<>();
    for (int index = 1; index < args.length; index += 2) {
      replacements.put(args[index], args[index + 1]);
    }

    byte[] classBytes = Files.readAllBytes(classFile);
    DataInputStream input = new DataInputStream(new ByteArrayInputStream(classBytes));
    ByteArrayOutputStream outputBuffer = new ByteArrayOutputStream(classBytes.length + 512);
    DataOutputStream output = new DataOutputStream(outputBuffer);

    int magic = input.readInt();
    if (magic != 0xCAFEBABE) {
      throw new IllegalArgumentException("Not a valid Java class file: " + classFile);
    }
    output.writeInt(magic);
    output.writeShort(input.readUnsignedShort());
    output.writeShort(input.readUnsignedShort());

    int constantPoolCount = input.readUnsignedShort();
    output.writeShort(constantPoolCount);

    for (int index = 1; index < constantPoolCount; index++) {
      int tag = input.readUnsignedByte();
      output.writeByte(tag);
      switch (tag) {
        case 1:
          int length = input.readUnsignedShort();
          byte[] utf8Bytes = new byte[length];
          input.readFully(utf8Bytes);
          String utf8 = new String(utf8Bytes, StandardCharsets.UTF_8);
          String replacement = replacements.getOrDefault(utf8, utf8);
          byte[] replacementBytes = replacement.getBytes(StandardCharsets.UTF_8);
          output.writeShort(replacementBytes.length);
          output.write(replacementBytes);
          break;
        case 3:
        case 4:
          output.writeInt(input.readInt());
          break;
        case 5:
        case 6:
          output.writeLong(input.readLong());
          index++;
          break;
        case 7:
        case 8:
        case 16:
        case 19:
        case 20:
          output.writeShort(input.readUnsignedShort());
          break;
        case 9:
        case 10:
        case 11:
        case 12:
        case 17:
        case 18:
          output.writeShort(input.readUnsignedShort());
          output.writeShort(input.readUnsignedShort());
          break;
        case 15:
          output.writeByte(input.readUnsignedByte());
          output.writeShort(input.readUnsignedShort());
          break;
        default:
          throw new IllegalStateException("Unsupported constant pool tag: " + tag);
      }
    }

    ByteArrayOutputStream remainderBuffer = new ByteArrayOutputStream();
    byte[] copyBuffer = new byte[8192];
    int bytesRead;
    while ((bytesRead = input.read(copyBuffer)) != -1) {
      remainderBuffer.write(copyBuffer, 0, bytesRead);
    }
    byte[] remainder = remainderBuffer.toByteArray();
    output.write(remainder);
    Files.write(classFile, outputBuffer.toByteArray());
  }
}
