package com.sysmuse.expr;

import java.util.*;
import java.util.function.Function;
import java.util.function.Predicate;

public class OperationalParser {
    private final String expr;
    private int pos = 0;
    private final OperationRegistry registry;

    public OperationalParser(String expr, OperationRegistry registry) {
        this.expr = expr.replaceAll("\\s+", ""); // Remove all whitespace
        this.registry = registry;
    }

    public Predicate<Map<String, Object>> parse() {
        Function<Map<String, Object>, Object> node = parseOr();
        return ctx -> {
            Object val = node.apply(ctx);
            if (!(val instanceof Boolean)) throw new RuntimeException("Expected boolean expression result.");
            return (Boolean) val;
        };
    }

    private Function<Map<String, Object>, Object> parseOr() {
        Function<Map<String, Object>, Object> left = parseAnd();
        while (match("||")) {
            Function<Map<String, Object>, Object> right = parseAnd();
            left = wrapBoolean("or", left, right);
        }
        return left;
    }

    private Function<Map<String, Object>, Object> parseAnd() {
        Function<Map<String, Object>, Object> left = parseComparison();
        while (match("&&")) {
            Function<Map<String, Object>, Object> right = parseComparison();
            left = wrapBoolean("and", left, right);
        }
        return left;
    }

    private Function<Map<String, Object>, Object> parseComparison() {
        Function<Map<String, Object>, Object> left = parseValue();
        if (peek("==") || peek("!=") || peek(">=") || peek("<=") || peek(">") || peek("<")) {
            String op = parseOperator();
            Function<Map<String, Object>, Object> right = parseValue();
            return wrapBoolean(op, left, right);
        }
        return left;
    }

    private Function<Map<String, Object>, Object> parseValue() {
        if (match("true")) return ctx -> true;
        if (match("false")) return ctx -> false;

        if (peek("\"")) {
            match("\"");
            int start = pos;
            while (pos < expr.length() && expr.charAt(pos) != '"') pos++;
            String s = expr.substring(start, pos);
            match("\"");
            return ctx -> s;
        }

        if (Character.isDigit(current())) {
            int start = pos;
            while (pos < expr.length() && (Character.isDigit(expr.charAt(pos)) || expr.charAt(pos) == '.')) pos++;
            String num = expr.substring(start, pos);
            return ctx -> num.contains(".") ? Double.parseDouble(num) : Integer.parseInt(num);
        }

        return parseVariable();
    }

    private Function<Map<String, Object>, Object> parseVariable() {
        String name = parseIdentifier();
        return ctx -> ctx.get(name);
    }

    private String parseIdentifier() {
        int start = pos;
        while (pos < expr.length() && (Character.isLetterOrDigit(expr.charAt(pos)) || expr.charAt(pos) == '_')) pos++;
        return expr.substring(start, pos);
    }

    private boolean match(String s) {
        if (peek(s)) {
            pos += s.length();
            return true;
        }
        return false;
    }

    private boolean peek(String s) {
        return expr.startsWith(s, pos);
    }

    private char current() {
        return pos < expr.length() ? expr.charAt(pos) : '\0';
    }

    private String parseOperator() {
        for (String op : List.of("==", "!=", ">=", "<=", ">", "<")) {
            if (match(op)) return op;
        }
        throw new RuntimeException("Expected comparison operator at pos " + pos);
    }

    private Function<Map<String, Object>, Object> wrapBoolean(String opName,
                                                              Function<Map<String, Object>, Object> l,
                                                              Function<Map<String, Object>, Object> r) {
        List<String> argNames = registry.getArgOrder(opName);
        BooleanOperation op = registry.getBoolean(opName);
        return ctx -> {
            Map<String, Object> args = new HashMap<>();
            args.put(argNames.get(0), l.apply(ctx));
            args.put(argNames.get(1), r.apply(ctx));
            return op.apply(args, ctx);
        };
    }
}
