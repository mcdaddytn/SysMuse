package com.sysmuse.expr;

import java.util.*;
import java.util.function.BiFunction;

public class CustomOperation extends BaseOperation
        implements NumericOperation, BooleanOperation, StringOperation {

    private final LinkedHashMap<String, Object> internalState;
    private final LinkedHashMap<String, Class<?>> internalTypes;
    private final List<OperationStep> steps;
    private final ExpressionManager manager;

    public CustomOperation(Class<?> returnType,
                           LinkedHashMap<String, Class<?>> externalArgs,
                           LinkedHashMap<String, Object> internalState,
                           LinkedHashMap<String, Class<?>> internalTypes,
                           List<OperationStep> steps,
                           BiFunction<Map<String, Object>, Map<String, Object>, Object> implementation,
                           ExpressionManager manager) {

        super(returnType, externalArgs, implementation);
        this.internalState = internalState;
        this.internalTypes = internalTypes;
        this.steps = steps;
        this.manager = manager;
    }

    public LinkedHashMap<String, Object> getInternalState() {
        return new LinkedHashMap<>(internalState);
    }

    public LinkedHashMap<String, Class<?>> getInternalTypes() {
        return new LinkedHashMap<>(internalTypes);
    }

    public Map<String, Object> execute(Map<String, Object> args, ExpressionManager manager) {
        Map<String, Object> ctx = new LinkedHashMap<>(internalState);

        for (Map.Entry<String, Class<?>> entry : getExpectedArgs().entrySet()) {
            Object value = args.get(entry.getKey());
            if (value == null) throw new RuntimeException("Missing external arg: " + entry.getKey());

            Object converted = ExpressionManager.convert(
                    value, entry.getValue(),
                    manager.getTypeConversionMode(),
                    manager.getTypeMismatchMode()
            );
            ctx.put(entry.getKey(), converted);
        }

        for (Map.Entry<String, Object> entry : internalState.entrySet()) {
            Class<?> expected = internalTypes.get(entry.getKey());
            Object value = entry.getValue();
            if (expected != null && !expected.isInstance(value)) {
                Object converted = ExpressionManager.convert(
                        value, expected,
                        manager.getTypeConversionMode(),
                        manager.getTypeMismatchMode()
                );
                ctx.put(entry.getKey(), converted);
            }
        }

        for (OperationStep step : steps) {
            Object result = manager.evaluateExpression(step.getExpression(), ctx, step.getMode());
            ctx.put(step.getOutputVar(), result);
        }

        return ctx;
    }

    public String getFinalResultKey() {
        return steps.isEmpty() ? null : steps.get(steps.size() - 1).getOutputVar();
    }

    @Override
    public Object apply(Map<String, Object> args, Map<String, Object> context) {
        Map<String, Object> resultCtx = execute(args, this.manager);
        String finalKey = getFinalResultKey();
        if (finalKey == null || !resultCtx.containsKey(finalKey)) {
            throw new RuntimeException("Final result not available from steps");
        }
        return resultCtx.get(finalKey);
    }

    public static class OperationStep {
        private final String outputVar;
        private final String expression;
        private final ExpressionMode mode;

        public OperationStep(String outputVar, String expression, ExpressionMode mode) {
            this.outputVar = outputVar;
            this.expression = expression;
            this.mode = mode;
        }

        public String getOutputVar() {
            return outputVar;
        }

        public String getExpression() {
            return expression;
        }

        public ExpressionMode getMode() {
            return mode;
        }
    }
}
