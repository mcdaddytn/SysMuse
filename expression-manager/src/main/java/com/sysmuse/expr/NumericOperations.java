package com.sysmuse.expr;

import java.util.List;
import java.util.Map;

public class NumericOperations {

    public static void register(OperationRegistry registry) {
        // Functional numeric operations
        registry.registerNumeric("add",
                new NumericBaseOperation(Double.class, List.of("a", "b"),
                        (args, ctx) -> get(args, "a") + get(args, "b")),
                List.of("a", "b"), "plus");

        registry.registerNumeric("sub",
                new NumericBaseOperation(Double.class, List.of("a", "b"),
                        (args, ctx) -> get(args, "a") - get(args, "b")),
                List.of("a", "b"), "minus");

        registry.registerNumeric("mul",
                new NumericBaseOperation(Double.class, List.of("a", "b"),
                        (args, ctx) -> get(args, "a") * get(args, "b")),
                List.of("a", "b"), "times");

        registry.registerNumeric("div",
                new NumericBaseOperation(Double.class, List.of("a", "b"),
                        (args, ctx) -> get(args, "a") / get(args, "b")),
                List.of("a", "b"), "divide");

        registry.registerNumeric("mod",
                new NumericBaseOperation(Double.class, List.of("a", "b"),
                        (args, ctx) -> get(args, "a") % get(args, "b")),
                List.of("a", "b"), "modulo");

        // Operational numeric operators
        registry.registerNumericOperator("+",
                new NumericBaseOperation(Double.class, List.of("left", "right"),
                        (args, ctx) -> get(args, "left") + get(args, "right")),
                List.of("left", "right"));

        registry.registerNumericOperator("-",
                new NumericBaseOperation(Double.class, List.of("left", "right"),
                        (args, ctx) -> get(args, "left") - get(args, "right")),
                List.of("left", "right"));

        registry.registerNumericOperator("*",
                new NumericBaseOperation(Double.class, List.of("left", "right"),
                        (args, ctx) -> get(args, "left") * get(args, "right")),
                List.of("left", "right"));

        registry.registerNumericOperator("/",
                new NumericBaseOperation(Double.class, List.of("left", "right"),
                        (args, ctx) -> get(args, "left") / get(args, "right")),
                List.of("left", "right"));

        registry.registerNumericOperator("%",
                new NumericBaseOperation(Double.class, List.of("left", "right"),
                        (args, ctx) -> get(args, "left") % get(args, "right")),
                List.of("left", "right"));
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
}
