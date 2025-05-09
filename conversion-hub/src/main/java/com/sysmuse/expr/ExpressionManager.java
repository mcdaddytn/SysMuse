package com.sysmuse.expr;

import com.sysmuse.util.LoggingUtil;
import java.util.*;
import java.util.function.*;

public class ExpressionManager {
    private static final ExpressionManager instance = new ExpressionManager();
    public static ExpressionManager getInstance() { return instance; }

    public interface Operation extends BiFunction<Map<String, Object>, Map<String, Boolean>, Boolean> {}
    public final Map<String, Operation> registeredOps = new HashMap<>();
    public final Map<String, List<String>> opArgOrder = new HashMap<>();

    public void registerDefaultOps() {
        register("equals", (vars, ctx) -> vars.get("left").equals(vars.get("right")), List.of("left", "right"));
        register("contains", (vars, ctx) -> ((String) vars.get("left")).contains((String) vars.get("right")), List.of("left", "right"));

        register("gt", (vars, ctx) -> toDouble(vars.get("left")) > toDouble(vars.get("right")), List.of("left", "right"));
        register("lt", (vars, ctx) -> toDouble(vars.get("left")) < toDouble(vars.get("right")), List.of("left", "right"));
        register("ge", (vars, ctx) -> toDouble(vars.get("left")) >= toDouble(vars.get("right")), List.of("left", "right"));
        register("le", (vars, ctx) -> toDouble(vars.get("left")) <= toDouble(vars.get("right")), List.of("left", "right"));
        register("eq", (vars, ctx) -> toDouble(vars.get("left")) == toDouble(vars.get("right")), List.of("left", "right"));
        register("ne", (vars, ctx) -> toDouble(vars.get("left")) != toDouble(vars.get("right")), List.of("left", "right"));

        register(">", registeredOps.get("gt"), List.of("left", "right"));
        register("<", registeredOps.get("lt"), List.of("left", "right"));
        register(">=", registeredOps.get("ge"), List.of("left", "right"));
        register("<=", registeredOps.get("le"), List.of("left", "right"));
        register("==", registeredOps.get("eq"), List.of("left", "right"));
        register("!=", registeredOps.get("ne"), List.of("left", "right"));

        register("not", (vars, ctx) -> !((Boolean) vars.get("value")), List.of("value"));
        register("and", (vars, ctx) -> (Boolean) vars.get("left") && (Boolean) vars.get("right"), List.of("left", "right"));
        register("or",  (vars, ctx) -> (Boolean) vars.get("left") || (Boolean) vars.get("right"), List.of("left", "right"));
    }

    private void register(String name, Operation op, List<String> args) {
        registeredOps.put(name, op);
        opArgOrder.put(name, args);
    }

    private double toDouble(Object obj) {
        if (obj == null) throw new RuntimeException("Cannot convert null to double");
        if (obj instanceof Number) return ((Number) obj).doubleValue();
        return Double.parseDouble(obj.toString());
    }

    public Map<String, Boolean> evaluateExpressions(LinkedHashMap<String, String> expressions,
                                                    LinkedHashMap<String, Object> parameters) {
        Map<String, Boolean> context = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : expressions.entrySet()) {
            try {
                Predicate<Map<String, Object>> parsed = parseExpression(entry.getValue());
                Map<String, Object> vars = new HashMap<>(parameters);
                vars.putAll(context);
                boolean result = parsed.test(vars);
                context.put(entry.getKey(), result);
            } catch (Exception e) {
                LoggingUtil.error("Failed to evaluate expression '" + entry.getKey() + "': " + entry.getValue(), e);
                context.put(entry.getKey(), false);
            }
        }
        return context;
    }

    public Predicate<Map<String, Object>> parseExpression(String expr) {
        return new ExpressionParser(expr).wrap();
    }

    private class ExpressionParser {
        private final String expr;
        private int pos = 0;

        ExpressionParser(String expr) {
            this.expr = expr.replaceAll("\\s+", "");
        }

        public Predicate<Map<String, Object>> wrap() {
            Function<Map<String, Object>, Object> fn = parseTernary();
            return vars -> {
                Object val = fn.apply(vars);
                if (!(val instanceof Boolean))
                    throw new RuntimeException("Expression must return a boolean but got: " + val);
                return (Boolean) val;
            };
        }

        private Function<Map<String, Object>, Object> parseTernary() {
            Function<Map<String, Object>, Object> condition = parseOr();
            if (match("?")) {
                Function<Map<String, Object>, Object> ifTrue = parseOr();
                expect(":");
                Function<Map<String, Object>, Object> ifFalse = parseOr();
                return vars -> (Boolean) condition.apply(vars) ? ifTrue.apply(vars) : ifFalse.apply(vars);
            }
            return condition;
        }

        private Function<Map<String, Object>, Object> parseOr() {
            Function<Map<String, Object>, Object> result = parseAnd();
            while (match("||") || match("OR")) {
                final Function<Map<String, Object>, Object> left = result;
                Function<Map<String, Object>, Object> right = parseAnd();
                result = vars -> (Boolean) left.apply(vars) || (Boolean) right.apply(vars);
            }
            return result;
        }

        private Function<Map<String, Object>, Object> parseAnd() {
            Function<Map<String, Object>, Object> result = parseComparison();
            while (match("&&") || match("AND")) {
                final Function<Map<String, Object>, Object> left = result;
                Function<Map<String, Object>, Object> right = parseComparison();
                result = vars -> (Boolean) left.apply(vars) && (Boolean) right.apply(vars);
            }
            return result;
        }

        private Function<Map<String, Object>, Object> parseComparison() {
            Function<Map<String, Object>, Object> left = parseNot();
            if (peek(">=") || peek("<=") || peek("==") || peek("!=") || peek(">") || peek("<")) {
                String op = parseOperator();
                Function<Map<String, Object>, Object> right = parseNot();
                return vars -> {
                    Object leftVal = left.apply(vars);
                    Object rightVal = right.apply(vars);
                    Map<String, Object> args = new HashMap<>();
                    args.put("left", leftVal);
                    args.put("right", rightVal);
                    return registeredOps.get(op).apply(args, extractBooleanMap(vars));
                };
            }
            return left;
        }

        private Function<Map<String, Object>, Object> parseNot() {
            if (match("!") || match("NOT")) {
                Function<Map<String, Object>, Object> inner = parseNot();
                return vars -> !(Boolean) inner.apply(vars);
            }
            return parsePrimary();
        }

        private Function<Map<String, Object>, Object> parsePrimary() {
            if (match("(")) {
                Function<Map<String, Object>, Object> inner = parseOr();
                expect(")");
                return inner;
            }

            String id = parseIdentifier();
            if (match("(")) {
                List<Object> args = new ArrayList<>();
                Map<String, Object> namedArgs = new HashMap<>();
                boolean usedNames = false;

                while (!peek(")")) {
                    if (peek("\"") || peek("true") || peek("false") || peekDigit()) {
                        Object literal = parseValue();
                        if (usedNames) throw new RuntimeException("Cannot mix named and unnamed args");
                        args.add(literal);
                    } else {
                        String key = parseIdentifier();
                        if (match("=")) {
                            Object val = parseValue();
                            namedArgs.put(key, val);
                            usedNames = true;
                        } else {
                            if (usedNames) throw new RuntimeException("Cannot mix named and unnamed args");
                            args.add(key);
                        }
                    }
                    if (peek(")")) break;
                    expect(",");
                }
                expect(")");

                Operation op = registeredOps.get(id);
                if (op == null) throw new RuntimeException("Unknown op: " + id);

                Map<String, Object> finalArgs = new HashMap<>();
                if (!namedArgs.isEmpty()) {
                    finalArgs.putAll(namedArgs);
                } else {
                    List<String> order = opArgOrder.get(id);
                    if (order == null || order.size() != args.size())
                        throw new RuntimeException("Invalid number of args for op: " + id);
                    for (int i = 0; i < args.size(); i++) {
                        finalArgs.put(order.get(i), args.get(i));
                    }
                }

                return vars -> op.apply(finalArgs, extractBooleanMap(vars));
            } else {
                try {
                    Object literal = parseLiteralFrom(id);
                    return vars -> literal;
                } catch (Exception ex) {
                    return vars -> {
                        if (!vars.containsKey(id)) {
                            throw new RuntimeException("Undefined variable: " + id);
                        }
                        return vars.get(id);
                    };
                }
            }
        }

        private String parseOperator() {
            if (match(">=")) return ">=";
            if (match("<=")) return "<=";
            if (match("==")) return "==";
            if (match("!=")) return "!=";
            if (match(">")) return ">";
            if (match("<")) return "<";
            throw new RuntimeException("Expected comparison operator at pos " + pos);
        }

        private Map<String, Boolean> extractBooleanMap(Map<String, Object> vars) {
            Map<String, Boolean> map = new HashMap<>();
            for (Map.Entry<String, Object> e : vars.entrySet()) {
                if (e.getValue() instanceof Boolean) map.put(e.getKey(), (Boolean) e.getValue());
            }
            return map;
        }

        private boolean peek(String s) { return expr.startsWith(s, pos); }
        private boolean match(String s) {
            if (expr.regionMatches(true, pos, s, 0, s.length())) {
                pos += s.length();
                return true;
            }
            return false;
        }
        private void expect(String s) {
            if (!match(s)) throw new RuntimeException("Expected: " + s);
        }
        private boolean peekDigit() {
            return pos < expr.length() && Character.isDigit(expr.charAt(pos));
        }
        private String parseIdentifier() {
            int start = pos;
            while (pos < expr.length() && (Character.isLetterOrDigit(expr.charAt(pos)) || expr.charAt(pos) == '_')) pos++;
            return expr.substring(start, pos);
        }

        private Object parseValue() {
            if (match("true")) return true;
            if (match("false")) return false;
            if (match("\"")) {
                int start = pos;
                while (pos < expr.length() && expr.charAt(pos) != '"') pos++;
                String val = expr.substring(start, pos);
                pos++;
                return val;
            }
            int start = pos;
            while (pos < expr.length() && (Character.isDigit(expr.charAt(pos)) || expr.charAt(pos) == '.')) pos++;
            String num = expr.substring(start, pos);
            return num.contains(".") ? Double.parseDouble(num) : Integer.parseInt(num);
        }

        private Object parseLiteralFrom(String token) {
            if ("true".equalsIgnoreCase(token)) return true;
            if ("false".equalsIgnoreCase(token)) return false;
            try {
                return Integer.parseInt(token);
            } catch (NumberFormatException e) {
                try {
                    return Double.parseDouble(token);
                } catch (NumberFormatException e2) {
                    throw new IllegalArgumentException("Not a literal: " + token);
                }
            }
        }
    }
}
