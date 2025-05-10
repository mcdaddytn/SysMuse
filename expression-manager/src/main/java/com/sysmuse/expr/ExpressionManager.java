package com.sysmuse.expr;

import java.io.File;
import java.util.*;
import java.util.function.Function;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ExpressionManager {

    private static final Logger log = Logger.getLogger("ExpressionManager");

    private final OperationRegistry registry = new OperationRegistry();
    private final Map<String, Class<?>> typeHints = new HashMap<>();
    private TypeMismatchMode typeMismatchMode = TypeMismatchMode.WARNING;

    public static void main(String[] args) throws Exception {
        String jsonPath = null;
        Map<String, Object> result = null;
        ExpressionMode expressionMode = ExpressionMode.FUNCTIONAL;

        if (args.length != 1) {
            //System.err.println("Usage: java ExpressionManager <path-to-json>");
            //System.exit(1);
            //jsonPath = "F:\\syscode\\SysMuse\\expression-manager\\config\\test_verified_pass.json";
            jsonPath = "F:\\syscode\\SysMuse\\expression-manager\\config\\test_operational_expressions.json";
            expressionMode = ExpressionMode.OPERATIONAL;
        }
        else {
            jsonPath = args[0];
        }

        File file = new File(jsonPath);
        if (!file.exists()) {
            System.err.println("File not found: " + jsonPath);
            System.exit(2);
        }

        // Load JSON
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        Map<String, Object> raw = mapper.readValue(file, Map.class);

        @SuppressWarnings("unchecked")
        Map<String, Object> params = (Map<String, Object>) raw.get("params");

        @SuppressWarnings("unchecked")
        Map<String, String> expressions = (Map<String, String>) raw.get("expressions");

        // Initialize manager
        ExpressionManager mgr = new ExpressionManager();
        mgr.setTypeMismatchMode(TypeMismatchMode.WARNING);
        NumericOperations.register(mgr.getRegistry());
        StringOperations.register(mgr.getRegistry());

        // Evaluate
        System.out.println("=== Evaluating Expressions ===");
        //Map<String, Object> result = mgr.evaluateAll(expressions, params, ExpressionMode.FUNCTIONAL);
        result = mgr.evaluateAll(expressions, params, expressionMode);

        // Output final results
        System.out.println("=== Final Context ===");
        result.forEach((k, v) -> System.out.printf("%-15s : %s%n", k, v));
    }

    public OperationRegistry getRegistry() {
        return registry;
    }

    public void setTypeMismatchMode(TypeMismatchMode mode) {
        this.typeMismatchMode = mode;
    }

    public Map<String, Object> evaluateAll(Map<String, String> expressions,
                                           Map<String, Object> initialContext,
                                           ExpressionMode mode) {
        Map<String, Object> context = new LinkedHashMap<>(initialContext);
        for (Map.Entry<String, Object> entry : initialContext.entrySet()) {
            typeHints.put(entry.getKey(), entry.getValue() != null ? entry.getValue().getClass() : Object.class);
        }

        List<String> ordered = resolveExecutionOrder(expressions);

        for (String key : ordered) {
            String expr = expressions.get(key);
            Function<Map<String, Object>, Object> fn = parse(expr, mode);
            log.info("Evaluating [" + key + "]: " + expr);
            logContextSnapshot(context);
            try {
                Object result = fn.apply(context);
                context.put(key, result);
                if (result != null) {
                    typeHints.put(key, result.getClass());
                }
                log.info("Result for [" + key + "]: " + result + "\n");
            } catch (Exception e) {
                if (typeMismatchMode == TypeMismatchMode.EXCEPTION) throw e;
                log.warning("Failed to evaluate [" + key + "]: " + e.getMessage());
                context.put(key, null);
                typeHints.put(key, Object.class);
            }
        }

        return context;
    }

    public Function<Map<String, Object>, Object> parse(String expr, ExpressionMode mode) {
        switch (mode) {
            case FUNCTIONAL:
                return new FunctionalParser(expr, registry).parseAny();
            case OPERATIONAL:
                return new OperationalParser(expr, registry).parseAny();
            default:
                throw new IllegalArgumentException("Unsupported ExpressionMode: " + mode);
        }
    }

    public List<String> resolveExecutionOrder(Map<String, String> expressions) {
        Map<String, Set<String>> deps = new HashMap<>();
        Pattern wordPattern = Pattern.compile("\\b\\w+\\b");
        Pattern templatePattern = Pattern.compile("\\{(.*?)\\}");

        for (Map.Entry<String, String> entry : expressions.entrySet()) {
            String key = entry.getKey();
            String expr = entry.getValue();
            Set<String> refVars = new HashSet<>();

            Matcher matcher = wordPattern.matcher(expr);
            while (matcher.find()) {
                String token = matcher.group();
                if (!token.equals(key) && expressions.containsKey(token)) {
                    refVars.add(token);
                }
            }

            if (expr.startsWith("template(")) {
                int quoteStart = expr.indexOf('"');
                int quoteEnd = expr.lastIndexOf('"');
                if (quoteStart >= 0 && quoteEnd > quoteStart) {
                    String tmpl = expr.substring(quoteStart + 1, quoteEnd);
                    Matcher tmplVars = templatePattern.matcher(tmpl);
                    while (tmplVars.find()) {
                        String var = tmplVars.group(1).trim();
                        if (!var.equals(key) && expressions.containsKey(var)) {
                            refVars.add(var);
                        }
                    }
                }
            }

            deps.put(key, refVars);
        }

        List<String> sorted = new ArrayList<>();
        Set<String> visited = new HashSet<>();
        Set<String> visiting = new HashSet<>();

        for (String key : expressions.keySet()) {
            visit(key, deps, visited, visiting, sorted);
        }

        return sorted;
    }

    private void visit(String node,
                       Map<String, Set<String>> deps,
                       Set<String> visited,
                       Set<String> visiting,
                       List<String> sorted) {
        if (visited.contains(node)) return;
        if (visiting.contains(node)) throw new RuntimeException("Cyclic dependency: " + node);

        visiting.add(node);
        for (String dep : deps.getOrDefault(node, Set.of())) {
            visit(dep, deps, visited, visiting, sorted);
        }
        visiting.remove(node);
        visited.add(node);
        sorted.add(node);
    }

    private void logContextSnapshot(Map<String, Object> ctx) {
        log.info("Current context:");
        for (Map.Entry<String, Object> e : ctx.entrySet()) {
            log.info("  " + e.getKey() + " = " + e.getValue());
        }
    }

    public Class<?> getType(String name) {
        return typeHints.get(name);
    }

    public boolean checkType(String name, Class<?> expected) {
        Class<?> actual = typeHints.get(name);
        if (actual == null) return false;
        boolean match = expected.isAssignableFrom(actual);
        if (!match) {
            switch (typeMismatchMode) {
                case EXCEPTION:
                    throw new RuntimeException("Type mismatch for " + name + ": expected " + expected + ", found " + actual);
                case WARNING:
                    log.warning("Type mismatch for " + name + ": expected " + expected + ", found " + actual);
                    break;
                case ACCEPT:
                    return true;
            }
        }
        return match;
    }
}
