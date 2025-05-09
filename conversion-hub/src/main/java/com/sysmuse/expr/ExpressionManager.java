// ExpressionManager.java — Regenerated Stable Version

package com.sysmuse.expr;

import com.sysmuse.util.LoggingUtil;
import java.util.*;
import java.util.function.*;
import java.util.stream.Collectors;

public class ExpressionManager {
    private static final ExpressionManager instance = new ExpressionManager();
    public static ExpressionManager getInstance() { return instance; }

    public interface Operation extends BiFunction<Map<String, Object>, Map<String, Boolean>, Boolean> {}
    public final Map<String, Operation> registeredOps = new HashMap<>();
    public final Map<String, List<String>> opArgOrder = new HashMap<>();

    public void registerDefaultOps_Simple() {
        register("equals", (vars, ctx) -> Objects.equals(vars.get("left"), vars.get("right")), List.of("left", "right"));
        register("contains", (vars, ctx) -> {
            Object l = vars.get("left"), r = vars.get("right");
            return (l instanceof String && r instanceof String) && ((String) l).contains((String) r);
        }, List.of("left", "right"));
        register(">", (vars, ctx) -> toDouble(vars.get("left")) > toDouble(vars.get("right")), List.of("left", "right"));
        register("<", (vars, ctx) -> toDouble(vars.get("left")) < toDouble(vars.get("right")), List.of("left", "right"));
        register("not", (vars, ctx) -> !((Boolean) vars.get("value")), List.of("value"));
        register("and", (vars, ctx) -> (Boolean) vars.get("left") && (Boolean) vars.get("right"), List.of("left", "right"));
        register("or", (vars, ctx) -> (Boolean) vars.get("left") || (Boolean) vars.get("right"), List.of("left", "right"));

        register("==", (vars, ctx) -> Objects.equals(vars.get("left"), vars.get("right")), List.of("left", "right"));
        register("!=", (vars, ctx) -> !Objects.equals(vars.get("left"), vars.get("right")), List.of("left", "right"));
    }

    public void registerDefaultOps() {
        register("equals", (vars, ctx) -> Objects.equals(vars.get("left"), vars.get("right")), List.of("left", "right"));
        register("contains", (vars, ctx) -> {
            Object l = vars.get("left"), r = vars.get("right");
            return (l instanceof String && r instanceof String) && ((String) l).contains((String) r);
        }, List.of("left", "right"));

        // Numeric comparisons (safe for numbers only)
        register(">", (vars, ctx) -> toDouble(vars.get("left")) > toDouble(vars.get("right")), List.of("left", "right"));
        register("<", (vars, ctx) -> toDouble(vars.get("left")) < toDouble(vars.get("right")), List.of("left", "right"));
        register(">=", (vars, ctx) -> toDouble(vars.get("left")) >= toDouble(vars.get("right")), List.of("left", "right"));
        register("<=", (vars, ctx) -> toDouble(vars.get("left")) <= toDouble(vars.get("right")), List.of("left", "right"));

        // Generic equality
        register("==", (vars, ctx) -> Objects.equals(vars.get("left"), vars.get("right")), List.of("left", "right"));
        register("!=", (vars, ctx) -> !Objects.equals(vars.get("left"), vars.get("right")), List.of("left", "right"));

        // Boolean logic
        register("not", (vars, ctx) -> !((Boolean) vars.get("value")), List.of("value"));
        register("and", (vars, ctx) -> (Boolean) vars.get("left") && (Boolean) vars.get("right"), List.of("left", "right"));
        register("or", (vars, ctx) -> (Boolean) vars.get("left") || (Boolean) vars.get("right"), List.of("left", "right"));

        // Set membership
        register("oneOf", (vars, ctx) -> {
            Object val = vars.get("value");
            Object list = vars.get("set");
            if (list instanceof List) return ((List<?>) list).contains(val);
            if (list instanceof Set) return ((Set<?>) list).contains(val);
            return false;
        }, List.of("value", "set"));
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
            String name = entry.getKey();
            String expr = entry.getValue();
            try {
                Predicate<Map<String, Object>> parsed = parseExpression(expr);
                Map<String, Object> vars = new HashMap<>(parameters);
                vars.putAll(context);
                boolean result = parsed.test(vars);
                context.put(name, result);
                LoggingUtil.info("Evaluated [" + name + "]: " + expr + " → " + result);
            } catch (Exception e) {
                LoggingUtil.error("Failed to evaluate expression '" + name + "': " + expr, e);
                context.put(name, false);
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
            Function<Map<String, Object>, Object> fn = parseOr();
            return vars -> {
                Object val = fn.apply(vars);
                if (!(val instanceof Boolean))
                    throw new RuntimeException("Expression must return a boolean but got: " + val);
                return (Boolean) val;
            };
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
            Function<Map<String, Object>, Object> left = parsePrimary();
            if (peek("==") || peek("!=") || peek(">=") || peek("<=") || peek(">") || peek("<")) {
                String op = parseOperator();
                Function<Map<String, Object>, Object> right = parsePrimary();
                return vars -> {
                    Object l = left.apply(vars), r = right.apply(vars);
                    Map<String, Object> args = new HashMap<>();
                    args.put("left", l);
                    args.put("right", r);
                    return registeredOps.get(op).apply(args, extractBooleanMap(vars));
                };
            }
            return left;
        }

        private Function<Map<String, Object>, Object> parsePrimary_Newest() {
            LoggingUtil.info("parsePrimary: entering at pos=" + pos + " char='" + (pos < expr.length() ? expr.charAt(pos) : "EOF") + "'");

            if (match("(")) {
                Function<Map<String, Object>, Object> inner = parseOr();
                expect(")");
                return inner;
            }

            // Constants
            if (peek("\"") || peekDigit() || peek("t") || peek("f") || peek("[")) {
                Object value = parseValue();
                LoggingUtil.info("parsePrimary: parsed constant value=" + value);
                return vars -> value;
            }

            String id = parseIdentifier();
            LoggingUtil.info("parsePrimary: parsed identifier=" + id);

            // Special handling for NOT(expr)
            if (id.equals("not") && peek("(")) {
                match("(");
                Function<Map<String, Object>, Object> inner = parseOr(); // not a simple value!
                expect(")");
                return vars -> !(Boolean) inner.apply(vars);
            }

            // Function call (e.g., equals(a, b))
            if (peek("(")) {
                match("(");
                List<Function<Map<String, Object>, Object>> args = new ArrayList<>();
                if (!peek(")")) {
                    do {
                        args.add(parseOr());
                    } while (match(","));
                }
                expect(")");

                if (!registeredOps.containsKey(id))
                    throw new RuntimeException("Unknown function: " + id);

                Operation op = registeredOps.get(id);
                List<String> order = opArgOrder.getOrDefault(id, List.of());

                return vars -> {
                    Map<String, Object> finalArgs = new LinkedHashMap<>();
                    for (int i = 0; i < args.size(); i++) {
                        Object evaluated = args.get(i).apply(vars);
                        if (i < order.size()) {
                            finalArgs.put(order.get(i), evaluated);
                        } else {
                            finalArgs.put("arg" + i, evaluated);
                        }
                    }

                    Map<String, Boolean> boolVars = vars.entrySet().stream()
                            .filter(e -> e.getValue() instanceof Boolean)
                            .collect(Collectors.toMap(Map.Entry::getKey, e -> (Boolean) e.getValue()));

                    return op.apply(finalArgs, boolVars);
                };
            }

            // Zero-arg registered function like ceoIsVIP
            /*
            if (registeredOps.containsKey(id) && opArgOrder.getOrDefault(id, List.of()).isEmpty()) {
                LoggingUtil.info("parsePrimary: matched zero-arg op: " + id);
                return vars -> registeredOps.get(id).apply(Map.of(), vars);
            }
             */
// Zero-arg registered function like ceoIsVIP
            if (registeredOps.containsKey(id) && opArgOrder.getOrDefault(id, List.of()).isEmpty()) {
                LoggingUtil.info("parsePrimary: matched zero-arg op: " + id);
                return vars -> {
                    Map<String, Boolean> boolVars = vars.entrySet().stream()
                            .filter(e -> e.getValue() instanceof Boolean)
                            .collect(Collectors.toMap(Map.Entry::getKey, e -> (Boolean) e.getValue()));
                    return registeredOps.get(id).apply(Map.of(), boolVars);
                };
            }

// Named expression reference (previously computed like 'vipCheck', etc.)
/*
            if (expressions.containsKey(id)) {
                LoggingUtil.info("parsePrimary: matched expression reference: " + id);
                return vars -> {
                    Object val = vars.get(id);
                    if (val == null) throw new RuntimeException("Undefined variable: " + id);
                    return val;
                };
            }
// Fallback to raw variable reference
            return vars -> {
                LoggingUtil.info("parsePrimary: treating as variable reference: " + id);
                Object val = vars.get(id);
                if (val == null) throw new RuntimeException("Undefined variable: " + id);
                return val;
            };

 */

// At this point, treat identifier as variable reference or boolean expression
            return vars -> {
                LoggingUtil.info("parsePrimary: treating as variable reference: " + id);
                Object val = vars.get(id);
                if (val == null)
                    throw new RuntimeException("Undefined variable: " + id);
                if (!(val instanceof Boolean))
                    throw new RuntimeException("Expected boolean but got: " + val);
                return (Boolean) val;
            };

        }

        private Function<Map<String, Object>, Object> parsePrimary() {
            LoggingUtil.info("parsePrimary: entering at pos=" + pos + " char='" + (pos < expr.length() ? expr.charAt(pos) : "EOF") + "'");
            if (match("(")) {
                Function<Map<String, Object>, Object> inner = parseOr();
                expect(")");
                return inner;
            }

            if (peek("\"") || peekDigit() || peek("t") || peek("f") || peek("[")) {
            //if (peek("\"") || peekDigit() || peek("true") || peek("false") || peekDigit() || peek("[")) {
                Object value = parseValue();
                return vars -> value;
            }

            String id = parseIdentifier();
            LoggingUtil.info("parsePrimary: parsed identifier=" + id);

            if (match("(")) {
                List<Object> args = new ArrayList<>();
                Map<String, Object> namedArgs = new HashMap<>();
                boolean usedNames = false;

                while (!peek(")")) {
                    if (peek("\"") || peek("true") || peek("false") || peekDigit() || peek("[")) {
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
                            args.add((Function<Map<String, Object>, Object>) vars -> {
                                if (!vars.containsKey(key)) throw new RuntimeException("Undefined variable: " + key);
                                return vars.get(key);
                            });
                        }
                    }
                    if (!peek(")")) expect(",");
                }
                expect(")");

                ExpressionManager.Operation op = registeredOps.get(id);
                if (op == null) throw new RuntimeException("Unknown operation: " + id);
                List<String> order = opArgOrder.get(id);
                if (order == null) throw new RuntimeException("No argument order registered for op: " + id);

                if (!namedArgs.isEmpty()) {
                    return vars -> op.apply(namedArgs, extractBooleanMap(vars));
                }

                if (order.size() != args.size()) {
                    throw new RuntimeException("Expected " + order.size() + " arguments but got " + args.size() + " for op: " + id);
                }

                return vars -> {
                    Map<String, Object> resolvedArgs = new HashMap<>();
                    for (int i = 0; i < args.size(); i++) {
                        Object arg = args.get(i);
                        Object value = (arg instanceof Function)
                                ? ((Function<Map<String, Object>, Object>) arg).apply(vars)
                                : arg;
                        resolvedArgs.put(order.get(i), value);
                    }
                    return op.apply(resolvedArgs, extractBooleanMap(vars));
                };
            }

            // Allow zero-arg custom op shortcut
            if (registeredOps.containsKey(id) && opArgOrder.get(id).isEmpty()) {
                return vars -> registeredOps.get(id).apply(Map.of(), extractBooleanMap(vars));
            }

            // Otherwise: it's a variable reference
            return vars -> {
                if (!vars.containsKey(id)) throw new RuntimeException("Undefined variable: " + id);
                return vars.get(id);
            };
        }

        private Function<Map<String, Object>, Object> parsePrimary_Old() {
            if (match("(")) {
                Function<Map<String, Object>, Object> inner = parseOr();
                expect(")");
                return inner;
            }
            if (peek("\"")) {
                Object literal = parseValue();
                return vars -> literal;
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
                            //args.add(key);
                            args.add((Function<Map<String, Object>, Object>) vars -> {
                                if (!vars.containsKey(key)) throw new RuntimeException("Undefined variable: " + key);
                                return vars.get(key);
                            });
                        }
                    }
                    if (peek(")")) break;
                    expect(",");
                }
                expect(")");

                Operation op = registeredOps.get(id);
                if (op == null) throw new RuntimeException("Unknown op: " + id);

                List<String> order = opArgOrder.get(id);
                if (order == null) throw new RuntimeException("No argument order registered for op: " + id);

                if (!namedArgs.isEmpty()) {
                    // Use named args directly
                    return vars -> op.apply(namedArgs, extractBooleanMap(vars));
                } else {
                    if (order.size() != args.size()) {
                        throw new RuntimeException("Expected " + order.size() + " arguments but got " + args.size() + " for op: " + id);
                    }

                    // Defer argument evaluation until runtime
                    return vars -> {
                        Map<String, Object> resolvedArgs = new HashMap<>();
                        for (int i = 0; i < args.size(); i++) {
                            Object arg = args.get(i);
                            Object value = (arg instanceof Function)
                                    ? ((Function<Map<String, Object>, Object>) arg).apply(vars)
                                    : arg;
                            resolvedArgs.put(order.get(i), value);
                        }
                        return op.apply(resolvedArgs, extractBooleanMap(vars));
                    };
                }
            } else {
                // Check if it's a zero-arg op (allow calling without parentheses)
                if (registeredOps.containsKey(id) && opArgOrder.get(id).isEmpty()) {
                    return vars -> registeredOps.get(id).apply(Map.of(), extractBooleanMap(vars));
                }

                // Otherwise, it's a variable reference
                return vars -> {
                    if (!vars.containsKey(id)) {
                        throw new RuntimeException("Undefined variable: " + id);
                    }
                    return vars.get(id);
                };
            }
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

        private Object parseValue_Old5() {
            LoggingUtil.info("parseValue: entering at position " + pos + " char='" + (pos < expr.length() ? expr.charAt(pos) : "EOF") + "'");

            // String literal
            if (peek("\"")) {
                match("\"");
                int start = pos;
                while (pos < expr.length() && expr.charAt(pos) != '"') pos++;
                if (pos >= expr.length()) throw new RuntimeException("Unterminated string literal");
                String val = expr.substring(start, pos);
                pos++; // skip closing quote
                LoggingUtil.info("parseValue: parsed string '" + val + "'");
                return val;
            }

            // Boolean
            if (match("true")) {
                LoggingUtil.info("parseValue: parsed boolean true");
                return true;
            }
            if (match("false")) {
                LoggingUtil.info("parseValue: parsed boolean false");
                return false;
            }

            // List literal
            if (peek("[")) {
                match("[");
                List<Object> list = new ArrayList<>();
                while (!peek("]")) {
                    list.add(parseValue());
                    if (!peek("]")) expect(",");
                }
                expect("]");
                LoggingUtil.info("parseValue: parsed list " + list);
                return list;
            }

            // Number
            int start = pos;
            boolean hasDot = false;
            while (pos < expr.length()) {
                char ch = expr.charAt(pos);
                if (Character.isDigit(ch)) {
                    pos++;
                } else if (ch == '.' && !hasDot) {
                    hasDot = true;
                    pos++;
                } else {
                    break;
                }
            }

            if (start == pos) throw new RuntimeException("Expected value at pos " + pos);
            String numStr = expr.substring(start, pos);
            LoggingUtil.info("parseValue: parsed number " + numStr);
            return hasDot ? Double.parseDouble(numStr) : Integer.parseInt(numStr);
        }

        private Object parseValue_Old4() {
            // String literal
            if (peek("\"")) {
                match("\"");
                int start = pos;
                while (pos < expr.length() && expr.charAt(pos) != '\"') pos++;
                if (pos >= expr.length()) throw new RuntimeException("Unterminated string literal");
                String val = expr.substring(start, pos);
                pos++; // skip closing quote
                return val;
            }

            // Boolean
            if (match("true")) return true;
            if (match("false")) return false;

            // List literal
            if (peek("[")) {
                match("[");
                List<Object> list = new ArrayList<>();
                while (!peek("]")) {
                    list.add(parseValue());
                    if (!peek("]")) expect(",");
                }
                expect("]");
                return list;
            }

            // Number (int or float)
            int start = pos;
            boolean hasDot = false;
            while (pos < expr.length()) {
                char ch = expr.charAt(pos);
                if (Character.isDigit(ch)) {
                    pos++;
                } else if (ch == '.' && !hasDot) {
                    hasDot = true;
                    pos++;
                } else {
                    break;
                }
            }

            if (start == pos) throw new RuntimeException("Expected value at pos " + pos);
            String numStr = expr.substring(start, pos);
            return hasDot ? Double.parseDouble(numStr) : Integer.parseInt(numStr);
        }

        private Object parseValue_Old3() {
            // String literal
            if (peek("\"")) {
                match("\""); // consume opening quote
                int start = pos;
                while (pos < expr.length() && expr.charAt(pos) != '\"') pos++;
                if (pos >= expr.length()) throw new RuntimeException("Unterminated string literal");
                String val = expr.substring(start, pos);
                pos++; // consume closing quote
                return val;
            }

            // Boolean
            if (match("true")) return true;
            if (match("false")) return false;

            // List literal: ["a", "b", 3]
            if (peek("[")) {
                match("[");
                List<Object> list = new ArrayList<>();
                while (!peek("]")) {
                    list.add(parseValue());
                    if (!peek("]")) expect(",");
                }
                expect("]");
                return list;
            }

            // Number (int or float)
            int start = pos;
            boolean hasDot = false;
            while (pos < expr.length()) {
                char ch = expr.charAt(pos);
                if (Character.isDigit(ch)) {
                    pos++;
                } else if (ch == '.' && !hasDot) {
                    hasDot = true;
                    pos++;
                } else {
                    break;
                }
            }

            if (start == pos) throw new RuntimeException("Expected value at pos " + pos);

            String numStr = expr.substring(start, pos);
            return hasDot ? Double.parseDouble(numStr) : Integer.parseInt(numStr);
        }

        private Object parseValue_Old2() {
            // Boolean
            if (match("true")) return true;
            if (match("false")) return false;

            // String literal
            if (peek("\"")) {
                match("\""); // consume opening quote
                int start = pos;
                while (pos < expr.length() && expr.charAt(pos) != '\"') pos++;
                if (pos >= expr.length()) throw new RuntimeException("Unterminated string literal");
                String val = expr.substring(start, pos);
                pos++; // consume closing quote
                return val;
            }

            // List literal
            if (peek("[")) {
                match("["); // consume opening [
                List<Object> list = new ArrayList<>();
                while (!peek("]")) {
                    list.add(parseValue());
                    if (!peek("]")) expect(",");
                }
                expect("]"); // consume closing ]
                return list;
            }

            // Number (integer or decimal)
            int start = pos;
            while (pos < expr.length() && (Character.isDigit(expr.charAt(pos)) || expr.charAt(pos) == '.')) {
                pos++;
            }
            String num = expr.substring(start, pos);
            if (num.isEmpty()) throw new RuntimeException("Expected value at pos " + pos);
            return num.contains(".") ? Double.parseDouble(num) : Integer.parseInt(num);
        }

        private Object parseValue() {
            if (match("true")) return true;
            if (match("false")) return false;

            if (match("\"")) {
                int start = pos;
                while (pos < expr.length() && expr.charAt(pos) != '\"') pos++;
                if (pos >= expr.length()) throw new RuntimeException("Unterminated string literal");
                String val = expr.substring(start, pos);
                pos++; // skip closing quote
                return val;
            }

            if (peek("[")) {
                match("["); // consume [
                List<Object> list = new ArrayList<>();
                while (!peek("]")) {
                    Object val = parseValue();
                    list.add(val);
                    if (!peek("]")) expect(",");
                }
                expect("]"); // consume ]
                return list;
            }

            // Try number
            int start = pos;
            while (pos < expr.length() && (Character.isDigit(expr.charAt(pos)) || expr.charAt(pos) == '.')) pos++;
            String num = expr.substring(start, pos);
            if (num.isEmpty()) throw new RuntimeException("Expected value at pos " + pos);
            return num.contains(".") ? Double.parseDouble(num) : Integer.parseInt(num);
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
        private Map<String, Boolean> extractBooleanMap(Map<String, Object> vars) {
            Map<String, Boolean> map = new HashMap<>();
            for (Map.Entry<String, Object> e : vars.entrySet()) {
                if (e.getValue() instanceof Boolean) map.put(e.getKey(), (Boolean) e.getValue());
            }
            return map;
        }
    }
}
