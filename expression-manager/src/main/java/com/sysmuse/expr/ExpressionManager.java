package com.sysmuse.expr;

<<<<<<< HEAD
import java.util.*;
import java.util.function.Predicate;
=======
import com.sysmuse.util.LoggingUtil;

import java.util.*;
<<<<<<< HEAD
import java.util.function.Function;
>>>>>>> origin/main
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ExpressionManager {

<<<<<<< HEAD
    public enum Mode { FUNCTIONAL, OPERATIONAL }

    private final OperationRegistry registry = new OperationRegistry();
    private TypeMismatchMode typeMismatchMode = TypeMismatchMode.WARNING;
    private static final Logger log = Logger.getLogger("ExpressionManager");

    public void setTypeMismatchMode(TypeMismatchMode mode) {
        this.typeMismatchMode = mode;
=======
    //private static final Logger log = Logger.getLogger("ExpressionManager");

    private final OperationRegistry registry = new OperationRegistry();
    private final Map<String, Class<?>> typeHints = new HashMap<>();
    private TypeMismatchMode typeMismatchMode = TypeMismatchMode.WARNING;
    private TypeConversionMode typeConversionMode = TypeConversionMode.NONE;

    public static void simpleMathTest() throws Exception {
        Integer int1 = null;
        Integer int2 = null;
        Integer int3 = null;
        Float flt1 = null;
        Float flt2 = null;
        Float flt3 = null;
        Number num1 = null;
        Number num2 = null;
        Number num3 = null;

        int1= 7;
        int2= 2;

        //num1 = int1;
        //num2 = int2;
        num1 = int1.doubleValue();
        num2 = int2.doubleValue();
        flt1 = int1.floatValue();
        flt2 = int2.floatValue();
        //num3 = num1 / num2;
        num3 = int1 / int2;
        flt3 = (float) (int1 / int2);
        flt3 = flt1 / flt2;

        LoggingUtil.info(String.format("result num3(Class%s)=: %d", num3.getClass().toString(), num3));
    }

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
            //simpleMathTest();
            //LoggingUtil.setDebugToInfo(true);
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
        BooleanOperations.register(mgr.getRegistry());

        // Evaluate
        LoggingUtil.debug("=== Evaluating Expressions ===");
        //Map<String, Object> result = mgr.evaluateAll(expressions, params, ExpressionMode.FUNCTIONAL);
        result = mgr.evaluateAll(expressions, params, expressionMode);

        // Output final results
        LoggingUtil.debug("=== Final Context ===");
        //result.forEach((k, v) -> LoggingUtil.debug("%-15s : %s%n", k, v));
        result.forEach((k, v) -> LoggingUtil.debug("%-15s : %s", k, v));
>>>>>>> origin/main
    }
=======

public class ExpressionManager {

    private final OperationRegistry registry = new OperationRegistry();
    private TypeMismatchMode typeMismatchMode = TypeMismatchMode.EXCEPTION;
    private TypeConversionMode typeConversionMode = TypeConversionMode.LOSSLESS;
    private final Map<String, Class<?>> expectedTypes = new HashMap<>();
>>>>>>> origin/main

    public OperationRegistry getRegistry() {
        return registry;
    }

<<<<<<< HEAD
    public Predicate<Map<String, Object>> parse(String expr, Mode mode) {
        return switch (mode) {
            case FUNCTIONAL -> new FunctionalParser(expr, registry).parse();
            case OPERATIONAL -> new OperationalParser(expr, registry).parse();
        };
=======
    public void setTypeMismatchMode(TypeMismatchMode mode) {
        this.typeMismatchMode = mode;
>>>>>>> origin/main
    }

    public TypeMismatchMode getTypeMismatchMode() {
        return typeMismatchMode;
    }

    public void setTypeConversionMode(TypeConversionMode mode) {
        this.typeConversionMode = mode;
    }

    public TypeConversionMode getTypeConversionMode() {
        return typeConversionMode;
    }

    public void setExpectedType(String key, Class<?> type) {
        expectedTypes.put(key, type);
    }

    public Class<?> getExpectedType(String key) {
        return expectedTypes.get(key);
    }

    public Map<String, Object> evaluateAll(Map<String, String> expressions,
<<<<<<< HEAD
                                           Map<String, Object> initialContext,
<<<<<<< HEAD
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
=======
=======
                                           Map<String, Object> params,
>>>>>>> origin/main
                                           ExpressionMode mode) {
        Map<String, Object> context = new LinkedHashMap<>(params);

        for (Map.Entry<String, String> entry : expressions.entrySet()) {
            String key = entry.getKey();
            String expression = entry.getValue();

<<<<<<< HEAD
        for (String key : ordered) {
            String expr = expressions.get(key);
            Function<Map<String, Object>, Object> fn = parse(expr, mode);
            LoggingUtil.debug("Evaluating [" + key + "]: " + expr);
            logContextSnapshot(context);
            try {
                Object result = fn.apply(context);
                context.put(key, result);
                if (result != null) {
                    typeHints.put(key, result.getClass());
                }
                LoggingUtil.debug("Result for [" + key + "]: " + result + "\n");
            } catch (Exception e) {
                if (typeMismatchMode == TypeMismatchMode.EXCEPTION) throw e;
                LoggingUtil.warn("Failed to evaluate [" + key + "]: " + e.getMessage());
                context.put(key, null);
                typeHints.put(key, Object.class);
>>>>>>> origin/main
            }
=======
            Object result = evaluateExpression(expression, context, mode);
            LoggingUtil.debug("Evaluated expression '" + key + "': " + expression + " => " + result);
            context.put(key, result);
>>>>>>> origin/main
        }

        return context;
    }

<<<<<<< HEAD
<<<<<<< HEAD
    public List<String> resolveExecutionOrder(Map<String, String> expressions) {
        Map<String, Set<String>> dependencies = new HashMap<>();
=======
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
>>>>>>> origin/main
        Pattern wordPattern = Pattern.compile("\\b\\w+\\b");
        Pattern templatePattern = Pattern.compile("\\{(.*?)\\}");

        for (Map.Entry<String, String> entry : expressions.entrySet()) {
            String key = entry.getKey();
            String expr = entry.getValue();
<<<<<<< HEAD
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
=======
            Set<String> refVars = new HashSet<>();
=======
    public Object evaluateExpression(String expression,
                                     Map<String, Object> context,
                                     ExpressionMode mode) {
        Map<String, Object> workingContext = new LinkedHashMap<>(context);

        if (mode == ExpressionMode.FUNCTIONAL) {
            FunctionalParser parser = new FunctionalParser(expression, registry);
            return parser.parseAny().apply(workingContext);
        } else {
            OperationalParser parser = new OperationalParser(expression, registry);
            return parser.parseAny().apply(workingContext);
        }
    }

    public Object evaluateOperation(GenericOperation op,
                                    Map<String, Object> args,
                                    ExpressionMode mode) {
        if (op instanceof CustomOperation co) {
            return co.execute(args, this);
        }
        return op.apply(args, Map.of());
    }

    public static Object convert(Object input, Class<?> targetType,
                                 TypeConversionMode convMode,
                                 TypeMismatchMode mismatchMode) {
        if (input == null) return null;
        if (targetType.isInstance(input)) return input;
>>>>>>> origin/main

        if (Number.class.isAssignableFrom(targetType)) {
            if (input instanceof String s) {
                try {
                    input = Double.parseDouble(s);
                } catch (NumberFormatException ex) {
                    if (mismatchMode == TypeMismatchMode.EXCEPTION)
                        throw new IllegalArgumentException("Cannot convert string to number: " + s);
                    if (mismatchMode == TypeMismatchMode.WARNING)
                        LoggingUtil.warn("Lossy or invalid conversion: " + s);
                    return null;
                }
            }

<<<<<<< HEAD
>>>>>>> origin/main
            if (expr.startsWith("template(")) {
                int quoteStart = expr.indexOf('"');
                int quoteEnd = expr.lastIndexOf('"');
                if (quoteStart >= 0 && quoteEnd > quoteStart) {
                    String tmpl = expr.substring(quoteStart + 1, quoteEnd);
                    Matcher tmplVars = templatePattern.matcher(tmpl);
                    while (tmplVars.find()) {
                        String var = tmplVars.group(1).trim();
                        if (!var.equals(key) && expressions.containsKey(var)) {
<<<<<<< HEAD
                            deps.add(var);
=======
                            refVars.add(var);
>>>>>>> origin/main
                        }
=======
            if (input instanceof Number n) {
                Number converted = switch (targetType.getSimpleName()) {
                    case "Integer" -> n.intValue();
                    case "Double" -> n.doubleValue();
                    case "Float" -> n.floatValue();
                    case "Long" -> n.longValue();
                    case "Short" -> n.shortValue();
                    case "Byte" -> n.byteValue();
                    default -> throw new IllegalArgumentException("Unsupported numeric type: " + targetType);
                };

                if (convMode == TypeConversionMode.LOSSLESS && !targetType.isInstance(n)) {
                    double original = n.doubleValue();
                    double roundtrip = ((Number) converted).doubleValue();
                    if (Math.abs(original - roundtrip) > 1e-10) {
                        if (mismatchMode == TypeMismatchMode.EXCEPTION)
                            throw new IllegalArgumentException("Lossy conversion blocked: " + original + " to " + targetType);
                        if (mismatchMode == TypeMismatchMode.WARNING)
                            LoggingUtil.warn("Lossy conversion: " + original + " to " + targetType);
>>>>>>> origin/main
                    }
                }

<<<<<<< HEAD
<<<<<<< HEAD
            dependencies.put(key, deps);
        }

        // Topological sort
=======
            deps.put(key, refVars);
        }

>>>>>>> origin/main
        List<String> sorted = new ArrayList<>();
        Set<String> visited = new HashSet<>();
        Set<String> visiting = new HashSet<>();

<<<<<<< HEAD
        for (String node : expressions.keySet()) {
            visit(node, dependencies, visited, visiting, sorted);
=======
        for (String key : expressions.keySet()) {
            visit(key, deps, visited, visiting, sorted);
>>>>>>> origin/main
        }

        return sorted;
    }

    private void visit(String node,
                       Map<String, Set<String>> deps,
                       Set<String> visited,
                       Set<String> visiting,
                       List<String> sorted) {
        if (visited.contains(node)) return;
<<<<<<< HEAD
        if (visiting.contains(node)) throw new RuntimeException("Cyclic dependency detected at: " + node);
=======
        if (visiting.contains(node)) throw new RuntimeException("Cyclic dependency: " + node);
>>>>>>> origin/main

        visiting.add(node);
        for (String dep : deps.getOrDefault(node, Set.of())) {
            visit(dep, deps, visited, visiting, sorted);
        }
        visiting.remove(node);
        visited.add(node);
        sorted.add(node);
    }

<<<<<<< HEAD
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
=======
    private void logContextSnapshot(Map<String, Object> ctx) {
        LoggingUtil.debug("Current context:");
        for (Map.Entry<String, Object> e : ctx.entrySet()) {
            LoggingUtil.debug("  " + e.getKey() + " = " + e.getValue());
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
                    LoggingUtil.warn("Type mismatch for " + name + ": expected " + expected + ", found " + actual);
                    break;
                case ACCEPT:
                    return true;
=======
                return converted;
>>>>>>> origin/main
            }
        }

        if (targetType == Boolean.class && input instanceof String s) {
            return Boolean.parseBoolean(s);
        }

        if (targetType == String.class) return input.toString();

        if (mismatchMode == TypeMismatchMode.EXCEPTION)
            throw new IllegalArgumentException("Cannot convert from " + input.getClass() + " to " + targetType);
        if (mismatchMode == TypeMismatchMode.WARNING)
            LoggingUtil.warn("Unsupported conversion from " + input.getClass() + " to " + targetType);

        return null;
    }
>>>>>>> origin/main
}
