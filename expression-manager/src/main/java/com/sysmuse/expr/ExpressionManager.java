package com.sysmuse.expr;

import com.sysmuse.util.LoggingUtil;

import java.util.*;

public class ExpressionManager {

    private final OperationRegistry registry = new OperationRegistry();
    private TypeMismatchMode typeMismatchMode = TypeMismatchMode.EXCEPTION;
    private TypeConversionMode typeConversionMode = TypeConversionMode.LOSSLESS;
    private final Map<String, Class<?>> expectedTypes = new HashMap<>();

    public OperationRegistry getRegistry() {
        return registry;
    }

    public void setTypeMismatchMode(TypeMismatchMode mode) {
        this.typeMismatchMode = mode;
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
                                           Map<String, Object> params,
                                           ExpressionMode mode) {
        Map<String, Object> context = new LinkedHashMap<>(params);

        for (Map.Entry<String, String> entry : expressions.entrySet()) {
            String key = entry.getKey();
            String expression = entry.getValue();

            Object result = evaluateExpression(expression, context, mode);
            LoggingUtil.debug("Evaluated expression '" + key + "': " + expression + " => " + result);
            context.put(key, result);
        }

        return context;
    }

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
                    }
                }

                return converted;
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
}
