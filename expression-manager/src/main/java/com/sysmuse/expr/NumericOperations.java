package com.sysmuse.expr;

import java.util.*;

public class NumericOperations {
    public static void register(OperationRegistry registry) {
        // Arithmetic operations
        registry.registerNumeric("add", (args, ctx) -> get(args, "a") + get(args, "b"), List.of("a", "b"), "+", "plus");
        registry.registerNumeric("sub", (args, ctx) -> get(args, "a") - get(args, "b"), List.of("a", "b"), "-", "minus");
        registry.registerNumeric("mul", (args, ctx) -> get(args, "a") * get(args, "b"), List.of("a", "b"), "*", "times");
        registry.registerNumeric("div", (args, ctx) -> get(args, "a") / get(args, "b"), List.of("a", "b"), "/", "divide");
        registry.registerNumeric("mod", (args, ctx) -> get(args, "a") % get(args, "b"), List.of("a", "b"), "%", "modulo");

        // Unary
        registry.registerNumeric("neg", (args, ctx) -> -get(args, "value"), List.of("value"), "negate");
        registry.registerNumeric("abs", (args, ctx) -> Math.abs(get(args, "value")), List.of("value"));

        // Min/Max
        registry.registerNumeric("min", (args, ctx) -> Math.min(get(args, "a"), get(args, "b")), List.of("a", "b"));
        registry.registerNumeric("max", (args, ctx) -> Math.max(get(args, "a"), get(args, "b")), List.of("a", "b"));

        // Comparisons as Boolean operations
        registry.registerBoolean("greaterThan", (args, ctx) -> get(args, "a") > get(args, "b"), List.of("a", "b"), ">");
        registry.registerBoolean("lessThan", (args, ctx) -> get(args, "a") < get(args, "b"), List.of("a", "b"), "<");
        registry.registerBoolean("greaterThanOrEqual", (args, ctx) -> get(args, "a") >= get(args, "b"), List.of("a", "b"), ">=");
        registry.registerBoolean("lessThanOrEqual", (args, ctx) -> get(args, "a") <= get(args, "b"), List.of("a", "b"), "<=");
    }

    private static double get(Map<String, Object> args, String key) {
        Object val = args.get(key);
        if (val instanceof Number n) return n.doubleValue();
        if (val instanceof String s) return Double.parseDouble(s);
        throw new RuntimeException("Expected number for argument: " + key + " but got: " + val);
    }
}
