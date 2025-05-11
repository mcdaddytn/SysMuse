package com.sysmuse.expr;

import com.sysmuse.util.LoggingUtil;

import java.util.*;
import java.util.function.Function;
import java.util.function.Predicate;

public class OperationalParser {

    private final String expr;
    private int pos = 0;
    private final OperationRegistry registry;

    public OperationalParser(String expr, OperationRegistry registry) {
        this.expr = expr.replaceAll("\\s+", "");
        this.registry = registry;
    }

    public Function<Map<String, Object>, Object> parseAny() {
        return parseComparison();
    }

    public Predicate<Map<String, Object>> parse() {
        Function<Map<String, Object>, Object> root = parseComparison();
        return ctx -> {
            Object val = root.apply(ctx);
            if (!(val instanceof Boolean)) {
                throw new RuntimeException("Expected boolean result but got: " + val);
            }
            return (Boolean) val;
        };
    }

    private Function<Map<String, Object>, Object> parseComparison() {
        Function<Map<String, Object>, Object> left = parseExpr();
        while (peek("==") || peek("!=") || peek(">=") || peek("<=") || peek(">") || peek("<")) {
            String op = parseComparisonOperator();
            Function<Map<String, Object>, Object> right = parseExpr();
            left = wrapBoolean(op, left, right);
        }
        return left;
    }

    private Function<Map<String, Object>, Object> parseExpr() {
        LoggingUtil.debug("parseExpr: starting at pos=" + pos + " char='" + current() + "'");
        Function<Map<String, Object>, Object> left = parseTerm();
        while (peek("+") || peek("-")) {
            String op = parseOperator();
            Function<Map<String, Object>, Object> right = parseTerm();
            left = wrapNumeric(op, left, right);
        }
        return left;
    }

    private Function<Map<String, Object>, Object> parseTerm() {
        LoggingUtil.debug("parseTerm: starting at pos=" + pos + " char='" + current() + "'");
        Function<Map<String, Object>, Object> left = parseFactor();
        while (peek("*") || peek("/") || peek("%")) {
            String op = parseOperator();
            Function<Map<String, Object>, Object> right = parseFactor();
            left = wrapNumeric(op, left, right);
        }
        return left;
    }

    private Function<Map<String, Object>, Object> parseFactor() {
        LoggingUtil.debug("parseFactor: starting at pos=" + pos + " char='" + current() + "'");
        if (match("(")) {
            Function<Map<String, Object>, Object> expr = parseComparison();
            match(")");
            return expr;
        }

        if (match("true")) return ctx -> true;
        if (match("false")) return ctx -> false;

        if (peek("\"")) return parseStringLiteral();
        if (Character.isDigit(current()) || peek("-")) return parseNumberLiteral();

        return parseVariable();
    }

    private Function<Map<String, Object>, Object> parseVariable() {
        String name = parseIdentifier();
        return ctx -> ctx.get(name);
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

    private Function<Map<String, Object>, Object> parseStringLiteral() {
        match("\"");
        int start = pos;
        while (pos < expr.length() && expr.charAt(pos) != '"') pos++;
        String s = expr.substring(start, pos);
        match("\"");
        return ctx -> s;
    }

    private String parseIdentifier() {
        int start = pos;
        while (pos < expr.length() &&
                (Character.isLetterOrDigit(expr.charAt(pos)) || expr.charAt(pos) == '_')) {
            pos++;
        }
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
        LoggingUtil.debug("parseOperator at pos=" + pos);
        for (String op : List.of("+", "-", "*", "/", "%")) {
            if (match(op)) return op;
        }
        throw new RuntimeException("Expected operator at pos " + pos);
    }

    private String parseComparisonOperator() {
        for (String op : List.of("==", "!=", ">=", "<=", ">", "<")) {
            if (match(op)) return op;
        }
        throw new RuntimeException("Expected comparison operator at pos " + pos);
    }

    private Function<Map<String, Object>, Object> wrapNumeric(String op,
                                                              Function<Map<String, Object>, Object> l,
                                                              Function<Map<String, Object>, Object> r) {
        NumericOperation nOp = registry.getNumericOperator(op);
        if (nOp == null) throw new RuntimeException("Unknown numeric operator: " + op);
        List<String> args = registry.getArgOrder(op);
        return ctx -> {
            Map<String, Object> call = new HashMap<>();
            call.put(args.get(0), l.apply(ctx));
            call.put(args.get(1), r.apply(ctx));
            return nOp.apply(call, ctx);
        };
    }

    private Function<Map<String, Object>, Object> wrapBoolean(String op,
                                                              Function<Map<String, Object>, Object> l,
                                                              Function<Map<String, Object>, Object> r) {
        BooleanOperation bOp = registry.getBoolean(op);
        if (bOp == null) throw new RuntimeException("Unknown boolean operator: " + op);
        List<String> args = registry.getArgOrder(op);
        return ctx -> bOp.apply(Map.of(
                args.get(0), l.apply(ctx),
                args.get(1), r.apply(ctx)
        ), ctx);
    }
}
