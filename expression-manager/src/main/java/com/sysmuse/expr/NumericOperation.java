package com.sysmuse.expr;

import java.util.Map;

@FunctionalInterface
public interface NumericOperation {
    Number apply(Map<String, Object> args, Map<String, Object> context);
}
