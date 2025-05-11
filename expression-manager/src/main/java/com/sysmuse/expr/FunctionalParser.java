package com.sysmuse.expr;

import java.util.*;
import java.util.function.Function;
import java.util.function.Predicate;

public class FunctionalParser {
<<<<<<< HEAD
    private final String expr;
    private int pos = 0;
    private final OperationRegistry registry;
=======

    private final String expr;
    private final OperationRegistry registry;
    private int pos = 0;
>>>>>>> origin/main

    public FunctionalParser(String expr, OperationRegistry registry) {
        this.expr = expr.trim();
        this.registry = registry;
    }

<<<<<<< HEAD
    public Predicate<Map<String, Object>> parse() {
        Function<Map<String, Object>, Object> fn = parsePrimary();
        return vars -> {
            Object val = fn.apply(vars);
=======
    public Function<Map<String, Object>, Object> parseAny() {
        return parsePrimary();
    }

    public Predicate<Map<String, Object>> parse() {
        Function<Map<String, Object>, Object> fn = parsePrimary();
        return ctx -> {
            Object val = fn.apply(ctx);
>>>>>>> origin/main
            if (!(val instanceof Boolean)) {
                throw new RuntimeException("Expected boolean result but got: " + val);
            }
            return (Boolean) val;
        };
    }

    private Function<Map<String, Object>, Object> parsePrimary() {
        skipWhitespace();
<<<<<<< HEAD
=======

        if (peek("\"")) {
            return parseStringLiteral();
        }

        if (Character.isDigit(current()) || peek("-")) {
            return parseNumberLiteral();
        }

>>>>>>> origin/main
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

<<<<<<< HEAD
            if (!registry.contains(id))
                throw new RuntimeException("Unknown function: " + id);
=======
            if (!registry.contains(id)) {
                throw new RuntimeException("Unknown function: " + id);
            }
>>>>>>> origin/main

            List<String> argNames = registry.getArgOrder(id);

            if (registry.getBoolean(id) != null) {
                BooleanOperation op = registry.getBoolean(id);
<<<<<<< HEAD
                return ctx -> {
                    Map<String, Object> args = resolveArgs(argFns, argNames, ctx);
                    return op.apply(args, ctx);
                };
=======
                return ctx -> op.apply(resolveArgs(argFns, argNames, ctx), ctx);
>>>>>>> origin/main
            }

            if (registry.getString(id) != null) {
                StringOperation op = registry.getString(id);
<<<<<<< HEAD
                return ctx -> {
                    Map<String, Object> args = resolveArgs(argFns, argNames, ctx);
                    return op.apply(args, ctx);
                };
=======
                return ctx -> op.apply(resolveArgs(argFns, argNames, ctx), ctx);
>>>>>>> origin/main
            }

            if (registry.getNumeric(id) != null) {
                NumericOperation op = registry.getNumeric(id);
<<<<<<< HEAD
                return ctx -> {
                    Map<String, Object> args = resolveArgs(argFns, argNames, ctx);
                    return op.apply(args, ctx);
                };
=======
                return ctx -> op.apply(resolveArgs(argFns, argNames, ctx), ctx);
>>>>>>> origin/main
            }

            throw new RuntimeException("Unregistered function category: " + id);
        }

<<<<<<< HEAD
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
=======
        // Otherwise, treat as variable reference
        return ctx -> ctx.get(id);
    }

    private Function<Map<String, Object>, Object> parseStringLiteral() {
        match("\"");
        int start = pos;
        while (pos < expr.length() && expr.charAt(pos) != '"') pos++;
        if (pos >= expr.length()) {
            throw new RuntimeException("Unterminated string literal");
        }
        String s = expr.substring(start, pos);
        match("\"");
        return ctx -> s;
    }

    private Function<Map<String, Object>, Object> parseNumberLiteral() {
        int start = pos;
        if (peek("-")) pos++;
        while (pos < expr.length() && (Character.isDigit(expr.charAt(pos)) || expr.charAt(pos) == '.')) {
            pos++;
        }
        String num = expr.substring(start, pos);
        return ctx -> num.contains(".") ? Double.parseDouble(num) : Integer.parseInt(num);
    }

    private Map<String, Object> resolveArgs(List<Function<Map<String, Object>, Object>> argFns,
                                            List<String> argNames,
                                            Map<String, Object> ctx) {
        if (argFns.size() != argNames.size()) {
            throw new RuntimeException("Expected " + argNames.size() + " args, got " + argFns.size());
        }

        Map<String, Object> args = new HashMap<>();
        for (int i = 0; i < argFns.size(); i++) {
            args.put(argNames.get(i), argFns.get(i).apply(ctx));
        }
        return args;
>>>>>>> origin/main
    }

    private String parseIdentifier() {
        skipWhitespace();
        int start = pos;
<<<<<<< HEAD
        while (pos < expr.length() && (Character.isLetterOrDigit(expr.charAt(pos)) || expr.charAt(pos) == '_')) {
            pos++;
        }
        if (start == pos) throw new RuntimeException("Expected identifier at pos " + pos);
=======
        while (pos < expr.length() &&
                (Character.isLetterOrDigit(expr.charAt(pos)) || expr.charAt(pos) == '_')) {
            pos++;
        }
        if (start == pos) {
            throw new RuntimeException("Expected identifier at pos " + pos);
        }
>>>>>>> origin/main
        return expr.substring(start, pos);
    }

    private void skipWhitespace() {
<<<<<<< HEAD
        while (pos < expr.length() && Character.isWhitespace(expr.charAt(pos))) pos++;
=======
        while (pos < expr.length() && Character.isWhitespace(expr.charAt(pos))) {
            pos++;
        }
>>>>>>> origin/main
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
<<<<<<< HEAD
=======

    private char current() {
        return pos < expr.length() ? expr.charAt(pos) : '\0';
    }
>>>>>>> origin/main
}
