package com.sysmuse.expr;

import java.util.*;
import java.util.function.Function;
import java.util.function.Predicate;

public class FunctionalParser {
    private final String expr;
    private int pos = 0;
    private final OperationRegistry registry;

    public FunctionalParser(String expr, OperationRegistry registry) {
        this.expr = expr.trim();
        this.registry = registry;
    }

    public Predicate<Map<String, Object>> parse() {
        Function<Map<String, Object>, Object> fn = parsePrimary();
        return vars -> {
            Object val = fn.apply(vars);
            if (!(val instanceof Boolean)) {
                throw new RuntimeException("Expected boolean result but got: " + val);
            }
            return (Boolean) val;
        };
    }

    private Function<Map<String, Object>, Object> parsePrimary() {
        skipWhitespace();
        if (peek("(")) {
            match("(");
            Function<Map<String, Object>, Object> inner = parsePrimary();
            match(")");
            return inner;
        }

        String id = parseIdentifier();
        skipWhitespace();

        if (match("(")) {
            List<Function<Map<String, Object>, Object>> argFns = new ArrayList<>();
            while (!peek(")")) {
                argFns.add(parsePrimary());
                skipWhitespace();
                if (!peek(")")) match(",");
            }
            match(")");

            if (!registry.contains(id))
                throw new RuntimeException("Unknown function: " + id);

            List<String> argNames = registry.getArgOrder(id);

            if (registry.getBoolean(id) != null) {
                BooleanOperation op = registry.getBoolean(id);
                return ctx -> {
                    Map<String, Object> args = resolveArgs(argFns, argNames, ctx);
                    return op.apply(args, ctx);
                };
            }

            if (registry.getString(id) != null) {
                StringOperation op = registry.getString(id);
                return ctx -> {
                    Map<String, Object> args = resolveArgs(argFns, argNames, ctx);
                    return op.apply(args, ctx);
                };
            }

            if (registry.getNumeric(id) != null) {
                NumericOperation op = registry.getNumeric(id);
                return ctx -> {
                    Map<String, Object> args = resolveArgs(argFns, argNames, ctx);
                    return op.apply(args, ctx);
                };
            }

            throw new RuntimeException("Unregistered function category: " + id);
        }

        return ctx -> ctx.get(id);
    }

    private Map<String, Object> resolveArgs(List<Function<Map<String, Object>, Object>> argFns,
                                            List<String> argNames,
                                            Map<String, Object> ctx) {
        if (argFns.size() != argNames.size())
            throw new RuntimeException("Expected " + argNames.size() + " args but got " + argFns.size());

        Map<String, Object> resolved = new LinkedHashMap<>();
        for (int i = 0; i < argFns.size(); i++) {
            resolved.put(argNames.get(i), argFns.get(i).apply(ctx));
        }
        return resolved;
    }

    private String parseIdentifier() {
        skipWhitespace();
        int start = pos;
        while (pos < expr.length() && (Character.isLetterOrDigit(expr.charAt(pos)) || expr.charAt(pos) == '_')) {
            pos++;
        }
        if (start == pos) throw new RuntimeException("Expected identifier at pos " + pos);
        return expr.substring(start, pos);
    }

    private void skipWhitespace() {
        while (pos < expr.length() && Character.isWhitespace(expr.charAt(pos))) pos++;
    }

    private boolean peek(String s) {
        return expr.startsWith(s, pos);
    }

    private boolean match(String s) {
        if (peek(s)) {
            pos += s.length();
            return true;
        }
        return false;
    }
}
