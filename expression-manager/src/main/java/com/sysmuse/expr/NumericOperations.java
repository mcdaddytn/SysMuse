package com.sysmuse.expr;

import java.util.List;
import java.util.Map;
import java.util.Objects;

public class NumericOperations {

    public static void register(OperationRegistry registry) {
        // Functional numeric operations
        registry.registerNumeric("add",
                (args, ctx) -> get(args, "a") + get(args, "b"),
                List.of("a", "b"), "plus");

        registry.registerNumeric("sub",
                (args, ctx) -> get(args, "a") - get(args, "b"),
                List.of("a", "b"), "minus");

        registry.registerNumeric("mul",
                (args, ctx) -> get(args, "a") * get(args, "b"),
                List.of("a", "b"), "times");

        registry.registerNumeric("div",
                (args, ctx) -> get(args, "a") / get(args, "b"),
                List.of("a", "b"), "divide");

        registry.registerNumeric("mod",
                (args, ctx) -> get(args, "a") % get(args, "b"),
                List.of("a", "b"), "modulo");

        // Operational numeric operators (true infix operators)
        registry.registerNumericOperator("+",
                (args, ctx) -> get(args, "left") + get(args, "right"),
                List.of("left", "right"));

        registry.registerNumericOperator("-",
                (args, ctx) -> get(args, "left") - get(args, "right"),
                List.of("left", "right"));

        registry.registerNumericOperator("*",
                (args, ctx) -> get(args, "left") * get(args, "right"),
                List.of("left", "right"));

        registry.registerNumericOperator("/",
                (args, ctx) -> get(args, "left") / get(args, "right"),
                List.of("left", "right"));

        registry.registerNumericOperator("%",
                (args, ctx) -> get(args, "left") % get(args, "right"),
                List.of("left", "right"));

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
                List.of("a", "b"), "!=");
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
