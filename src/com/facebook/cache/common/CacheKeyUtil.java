package com.facebook.cache.common;

import com.facebook.common.util.SecureHashUtil;
import java.io.UnsupportedEncodingException;
import java.util.ArrayList;
import java.util.List;

public final class CacheKeyUtil {
  public static final CacheKeyUtil INSTANCE = new CacheKeyUtil();

  private CacheKeyUtil() {}

  public static final List<String> getResourceIds(CacheKey key) {
    try {
      List<String> resourceIds = new ArrayList<>();
      if (key instanceof MultiCacheKey) {
        for (CacheKey nestedKey : ((MultiCacheKey) key).getCacheKeys()) {
          resourceIds.add(INSTANCE.secureHashKey(nestedKey));
        }
      } else {
        resourceIds.add(key.isResourceIdForDebugging() ? key.getUriString() : INSTANCE.secureHashKey(key));
      }
      return resourceIds;
    } catch (UnsupportedEncodingException e) {
      throw new RuntimeException(e);
    }
  }

  public static final String getFirstResourceId(CacheKey key) {
    try {
      if (key instanceof MultiCacheKey) {
        return INSTANCE.secureHashKey(((MultiCacheKey) key).getCacheKeys().get(0));
      }
      return INSTANCE.secureHashKey(key);
    } catch (UnsupportedEncodingException e) {
      throw new RuntimeException(e);
    }
  }

  private final String secureHashKey(CacheKey key) throws UnsupportedEncodingException {
    return SecureHashUtil.makeSHA256Hash(key.getUriString().getBytes("UTF-8"));
  }
}
