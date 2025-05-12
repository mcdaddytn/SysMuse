package com.sysmuse.expr;

import java.util.LinkedHashMap;
import java.util.Map;

public interface GenericOperation {
    Class<?> getReturnType();
    LinkedHashMap<String, Class<?>> getExpectedArgs();
    Object apply(Map<String, Object> args, Map<String, Object> context);
}
