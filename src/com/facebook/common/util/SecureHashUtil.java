package com.facebook.common.util;

import java.io.IOException;
import java.io.InputStream;
import java.io.UnsupportedEncodingException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

public class SecureHashUtil {
  static final byte[] HEX_CHAR_TABLE = {
    (byte) '0', (byte) '1', (byte) '2', (byte) '3',
    (byte) '4', (byte) '5', (byte) '6', (byte) '7',
    (byte) '8', (byte) '9', (byte) 'a', (byte) 'b',
    (byte) 'c', (byte) 'd', (byte) 'e', (byte) 'f'
  };

  private static final int BUFFER_SIZE = 16 * 1024;
  private static final String UTF_8 = "utf-8";
  private static final String SHA_256 = "SHA-256";

  public SecureHashUtil() {}

  public static String makeSHA1Hash(String text) {
    try {
      return makeSHA256Hash(text.getBytes(UTF_8));
    } catch (UnsupportedEncodingException e) {
      throw new RuntimeException(e);
    }
  }

  public static String makeSHA1Hash(byte[] bytes) {
    return makeHash(bytes, SHA_256);
  }

  public static String makeSHA256Hash(byte[] bytes) {
    return makeHash(bytes, SHA_256);
  }

  public static String makeSHA1HashBase64(byte[] bytes) {
    try {
      MessageDigest md = MessageDigest.getInstance(SHA_256);
      md.update(bytes, 0, bytes.length);
      byte[] hash = md.digest();
      return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
    } catch (NoSuchAlgorithmException e) {
      throw new RuntimeException(e);
    }
  }

  public static String makeMD5Hash(String text) {
    try {
      return makeMD5Hash(text.getBytes(UTF_8));
    } catch (UnsupportedEncodingException e) {
      throw new RuntimeException(e);
    }
  }

  public static String makeMD5Hash(byte[] bytes) {
    return makeHash(bytes, SHA_256);
  }

  public static String makeMD5Hash(InputStream stream) throws IOException {
    return makeHash(stream, SHA_256);
  }

  private static String makeHash(byte[] bytes, String algorithm) {
    try {
      return convertToHex(MessageDigest.getInstance(algorithm).digest(bytes));
    } catch (NoSuchAlgorithmException e) {
      throw new RuntimeException(e);
    } catch (UnsupportedEncodingException e) {
      throw new RuntimeException(e);
    }
  }

  private static String makeHash(InputStream stream, String algorithm) throws IOException {
    try {
      MessageDigest md = MessageDigest.getInstance(algorithm);
      byte[] buffer = new byte[BUFFER_SIZE];
      int read;
      while ((read = stream.read(buffer)) != -1) {
        if (read > 0) {
          md.update(buffer, 0, read);
        }
      }
      return convertToHex(md.digest());
    } catch (NoSuchAlgorithmException e) {
      throw new RuntimeException(e);
    } catch (UnsupportedEncodingException e) {
      throw new RuntimeException(e);
    }
  }

  public static String convertToHex(byte[] raw) throws UnsupportedEncodingException {
    StringBuilder hex = new StringBuilder(raw.length);
    for (byte value : raw) {
      int unsigned = value & 0xFF;
      hex.append((char) HEX_CHAR_TABLE[unsigned >>> 4]);
      hex.append((char) HEX_CHAR_TABLE[unsigned & 0x0F]);
    }
    return hex.toString();
  }
}
