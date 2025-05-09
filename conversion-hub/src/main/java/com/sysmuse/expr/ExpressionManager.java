// ExpressionManager.java
package com.sysmuse.expr;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.function.*;
import com.sysmuse.util.LoggingUtil;

public class ExpressionManager {
    private static final ExpressionManager instance = new ExpressionManager();
    public static ExpressionManager getInstance() { return instance; }

    public interface Operation extends BiFunction<Map<String, Object>, Map<String, Boolean>, Boolean> {}

    public final Map<String, Operation> registeredOps = new HashMap<>();
    public final Map<String, List<String>> opArgOrder = new HashMap<>();

    public void registerDefaultOps() {
        register("equals", (vars, ctx) -> vars.get("left").equals(vars.get("right")), List.of("left", "right"));
        register("contains", (vars, ctx) -> ((String) vars.get("left")).contains((String) vars.get("right")), List.of("left", "right"));
        register("oneOf", (vars, ctx) -> {
            Object val = vars.get("value");
            List<?> set = (List<?>) vars.get("set");
            return set.contains(val);
        }, List.of("value", "set"));
        register("isSubstringOf", (vars, ctx) -> ((String) vars.get("right")).contains((String) vars.get("left")), List.of("left", "right"));

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
        register("or", (vars, ctx) -> (Boolean) vars.get("left") || (Boolean) vars.get("right"), List.of("left", "right"));
        register("ref", (vars, ctx) -> ctx.get((String) vars.get("name")), List.of("name"));
    }

    private void register(String name, Operation op, List<String> argOrder) {
        registeredOps.put(name, op);
        opArgOrder.put(name, argOrder);
    }

    private double toDouble(Object obj) {
        if (obj instanceof Number) return ((Number) obj).doubleValue();
        return Double.parseDouble(obj.toString());
    }

    public Map<String, Boolean> evaluateExpressions(LinkedHashMap<String, String> expressions,
                                                    LinkedHashMap<String, Object> parameters) {
        Map<String, Boolean> context = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : expressions.entrySet()) {
            String name = entry.getKey();
            String expression = entry.getValue();
            try {
                Predicate<Map<String, Object>> parsed = parseExpression(expression);
                Map<String, Object> vars = new HashMap<>(parameters);
                vars.putAll(context);
                boolean result = parsed.test(vars);
                context.put(name, result);
            } catch (Exception e) {
                com.sysmuse.util.LoggingUtil.error("Failed to evaluate expression '" + name + "': " + expression, e);
                context.put(name, false); // fallback default if desired
            }
        }
        return context;
    }

    public Predicate<Map<String, Object>> parseExpression(String expr) {
        return new ExpressionParser(expr).parse();
    }

    private class ExpressionParser {
        private final String expr;
        private int pos = 0;

        ExpressionParser(String expr) { this.expr = expr.replaceAll("\\s+", ""); }

        public Predicate<Map<String, Object>> parse() {
            Predicate<Map<String, Object>> result = parseTernary();
            if (pos < expr.length()) throw new RuntimeException("Unexpected: " + expr.charAt(pos));
            return result;
        }

        private Predicate<Map<String, Object>> parseTernary() {
            Predicate<Map<String, Object>> condition = parseOr();
            if (match("?")) {
                Predicate<Map<String, Object>> ifTrue = parseOr();
                expect(":");
                Predicate<Map<String, Object>> ifFalse = parseOr();
                return vars -> condition.test(vars) ? ifTrue.test(vars) : ifFalse.test(vars);
            }
            return condition;
        }

        private Predicate<Map<String, Object>> parseOr() {
            Predicate<Map<String, Object>> result = parseAnd();
            while (match("||") || match("OR")) {
                Predicate<Map<String, Object>> right = parseAnd();
                result = result.or(right);
            }
            return result;
        }

        private Predicate<Map<String, Object>> parseAnd() {
            Predicate<Map<String, Object>> result = parseNot();
            while (match("&&") || match("AND")) {
                Predicate<Map<String, Object>> right = parseNot();
                result = result.and(right);
            }
            return result;
        }

        private Predicate<Map<String, Object>> parseNot() {
            if (match("!") || match("NOT")) return parseNot().negate();
            return parsePrimary();
        }

        private Predicate<Map<String, Object>> parsePrimary() {
            if (match("(")) {
                Predicate<Map<String, Object>> inner = parseOr();
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
                    List<String> paramOrder = opArgOrder.get(id);
                    if (paramOrder == null || paramOrder.size() != args.size())
                        throw new RuntimeException("Invalid args for op: " + id);
                    for (int i = 0; i < args.size(); i++) {
                        finalArgs.put(paramOrder.get(i), args.get(i));
                    }
                }

                return vars -> {
                    Map<String, Boolean> boolCtx = new HashMap<>();
                    for (Map.Entry<String, Object> entry : vars.entrySet()) {
                        if (entry.getValue() instanceof Boolean) {
                            boolCtx.put(entry.getKey(), (Boolean) entry.getValue());
                        }
                    }
                    return op.apply(finalArgs, boolCtx);
                };
            } else {
                return vars -> (Boolean) vars.get(id);
            }
        }

        private boolean peekDigit() {
            return pos < expr.length() && Character.isDigit(expr.charAt(pos));
        }

        private String parseIdentifier() {
            int start = pos;
            while (pos < expr.length() && (Character.isLetterOrDigit(expr.charAt(pos)) || expr.charAt(pos) == '_')) {
                pos++;
            }
            return expr.substring(start, pos);
        }

        private boolean match(String s) {
            if (expr.regionMatches(true, pos, s, 0, s.length())) {
                pos += s.length();
                return true;
            }
            return false;
        }

        private boolean peek(String s) { return expr.startsWith(s, pos); }
        private void expect(String s) { if (!match(s)) throw new RuntimeException("Expected: " + s); }

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
            if ("true".equals(token)) return true;
            if ("false".equals(token)) return false;
            try {
                return Integer.parseInt(token);
            } catch (Exception e) {
                try {
                    return Double.parseDouble(token);
                } catch (Exception e2) {
                    return token;
                }
            }
        }
    }
}
