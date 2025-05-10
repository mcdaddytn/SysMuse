package com.sysmuse.expr;

import java.util.*;
import java.util.function.Predicate;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ExpressionManager {

    public enum Mode { FUNCTIONAL, OPERATIONAL }

    private final OperationRegistry registry = new OperationRegistry();
    private TypeMismatchMode typeMismatchMode = TypeMismatchMode.WARNING;
    private static final Logger log = Logger.getLogger("ExpressionManager");

    public void setTypeMismatchMode(TypeMismatchMode mode) {
        this.typeMismatchMode = mode;
    }

    public OperationRegistry getRegistry() {
        return registry;
    }

    public Predicate<Map<String, Object>> parse(String expr, Mode mode) {
        return switch (mode) {
            case FUNCTIONAL -> new FunctionalParser(expr, registry).parse();
            case OPERATIONAL -> new OperationalParser(expr, registry).parse();
        };
    }

    public Map<String, Object> evaluateAll(Map<String, String> expressions,
                                           Map<String, Object> initialContext,
                                           Mode mode) {
        Map<String, Object> context = new LinkedHashMap<>(initialContext);
        List<String> order = resolveExecutionOrder(expressions);

        for (String key : order) {
            String expr = expressions.get(key);
            Predicate<Map<String, Object>> parsed = parse(expr, mode);
            try {
                boolean result = parsed.test(context);
                context.put(key, result);
            } catch (Exception e) {
                if (typeMismatchMode == TypeMismatchMode.EXCEPTION) throw e;
                log.warning("Failed to evaluate " + key + ": " + e.getMessage());
                context.put(key, false);
            }
        }

        return context;
    }

    public List<String> resolveExecutionOrder(Map<String, String> expressions) {
        Map<String, Set<String>> dependencies = new HashMap<>();
        Pattern wordPattern = Pattern.compile("\\b\\w+\\b");
        Pattern templatePattern = Pattern.compile("\\{(.*?)\\}");

        for (Map.Entry<String, String> entry : expressions.entrySet()) {
            String key = entry.getKey();
            String expr = entry.getValue();
            Set<String> deps = new HashSet<>();

            // Find references to other expressions
            Matcher wordMatcher = wordPattern.matcher(expr);
            while (wordMatcher.find()) {
                String token = wordMatcher.group();
                if (!token.equals(key) && expressions.containsKey(token)) {
                    deps.add(token);
                }
            }

            // Template expression dependencies
            if (expr.startsWith("template(")) {
                int quoteStart = expr.indexOf('"');
                int quoteEnd = expr.lastIndexOf('"');
                if (quoteStart >= 0 && quoteEnd > quoteStart) {
                    String tmpl = expr.substring(quoteStart + 1, quoteEnd);
                    Matcher tmplVars = templatePattern.matcher(tmpl);
                    while (tmplVars.find()) {
                        String var = tmplVars.group(1).trim();
                        if (!var.equals(key) && expressions.containsKey(var)) {
                            deps.add(var);
                        }
                    }
                }
            }

            dependencies.put(key, deps);
        }

        // Topological sort
        List<String> sorted = new ArrayList<>();
        Set<String> visited = new HashSet<>();
        Set<String> visiting = new HashSet<>();

        for (String node : expressions.keySet()) {
            visit(node, dependencies, visited, visiting, sorted);
        }

        return sorted;
    }

    private void visit(String node,
                       Map<String, Set<String>> deps,
                       Set<String> visited,
                       Set<String> visiting,
                       List<String> sorted) {
        if (visited.contains(node)) return;
        if (visiting.contains(node)) throw new RuntimeException("Cyclic dependency detected at: " + node);

        visiting.add(node);
        for (String dep : deps.getOrDefault(node, Set.of())) {
            visit(dep, deps, visited, visiting, sorted);
        }
        visiting.remove(node);
        visited.add(node);
        sorted.add(node);
    }

    private boolean safeCheckType(Object a, Object b) {
        if (a == null || b == null || a.getClass().equals(b.getClass())) return true;
        switch (typeMismatchMode) {
            case ACCEPT: return true;
            case WARNING:
                log.warning("[ExpressionManager] Type mismatch: " + a + " vs " + b);
                return true;
            case EXCEPTION:
                throw new RuntimeException("[ExpressionManager] Type mismatch: " + a + " vs " + b);
            default: return true;
        }
    }
}
