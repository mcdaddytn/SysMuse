package com.sysmuse.expr;

import java.util.Map;

@FunctionalInterface
public interface BooleanOperation {
    Boolean apply(Map<String, Object> args, Map<String, Object> context);
}
