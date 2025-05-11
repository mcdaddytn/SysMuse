package com.sysmuse.expr;

import java.util.List;
import java.util.Map;
import java.util.Objects;

public class BooleanOperations {

    public static void register(OperationRegistry registry) {
        // Logical AND
        registry.registerBoolean("and",
                (args, ctx) -> asBool(args.get("a")) && asBool(args.get("b")),
                List.of("a", "b"), "&&");

        // Logical OR
        registry.registerBoolean("or",
                (args, ctx) -> asBool(args.get("a")) || asBool(args.get("b")),
                List.of("a", "b"), "||");

        // Logical NOT (unary)
        registry.registerBoolean("not",
                (args, ctx) -> !asBool(args.get("value")),
                List.of("value"), "!");

        // Comparisons (still Boolean, likely also needs separate registration in future)
        registry.registerBoolean("greaterThan",
                (args, ctx) -> get(args, "a") > get(args, "b"),
                List.of("a", "b"), ">");

        registry.registerBoolean("lessThan",
                (args, ctx) -> get(args, "a") < get(args, "b"),
                List.of("a", "b"), "<");

        registry.registerBoolean("greaterThanOrEqual",
                (args, ctx) -> get(args, "a") >= get(args, "b"),
                List.of("a", "b"), ">=");

        registry.registerBoolean("lessThanOrEqual",
                (args, ctx) -> get(args, "a") <= get(args, "b"),
                List.of("a", "b"), "<=");

        registry.registerBoolean("equals",
                (args, ctx) -> Objects.equals(args.get("a"), args.get("b")),
                List.of("a", "b"), "==", "eq");

        registry.registerBoolean("notEquals",
                (args, ctx) -> !Objects.equals(args.get("a"), args.get("b")),
                List.of("a", "b"), "!=", "neq");
    }

    private static double get(Map<String, Object> args, String key) {
        Object val = args.get(key);
        if (val == null) {
            throw new RuntimeException("Expected number for argument: " + key + " but got: null");
        }
        if (val instanceof Number n) return n.doubleValue();
        if (val instanceof String s) return Double.parseDouble(s);
        throw new RuntimeException("Expected number for argument: " + key + " but got: " + val.getClass());
    }

    private static boolean asBool(Object val) {
        if (val instanceof Boolean b) return b;
        if (val instanceof String s) return Boolean.parseBoolean(s);
        throw new RuntimeException("Expected boolean but got: " + val);
    }
}
