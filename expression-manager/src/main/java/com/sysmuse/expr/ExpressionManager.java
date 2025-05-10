package com.sysmuse.expr;

import java.util.*;
import java.util.function.Predicate;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ExpressionManager {

    private static final Logger log = Logger.getLogger("ExpressionManager");

    private final OperationRegistry registry = new OperationRegistry();
    private TypeMismatchMode typeMismatchMode = TypeMismatchMode.WARNING;

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
        List<String> ordered = resolveExecutionOrder(expressions);

        for (String key : ordered) {
            String expr = expressions.get(key);
            Predicate<Map<String, Object>> fn = parse(expr, mode);
            try {
                boolean result = fn.test(context);
                context.put(key, result);
            } catch (Exception e) {
                if (typeMismatchMode == TypeMismatchMode.EXCEPTION) throw e;
                log.warning("Failed to evaluate " + key + ": " + e.getMessage());
                context.put(key, false);
            }
        }

        return context;
    }

    public Predicate<Map<String, Object>> parse(String expr, ExpressionMode mode) {
        switch (mode) {
            case FUNCTIONAL:
                return new FunctionalParser(expr, registry).parse();
            case OPERATIONAL:
                return new OperationalParser(expr, registry).parse();
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
}
