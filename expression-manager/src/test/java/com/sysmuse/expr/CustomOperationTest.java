package com.sysmuse.expr;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class CustomOperationTest {

    private ExpressionManager manager;

    @BeforeEach
    public void setup() {
        manager = new ExpressionManager();
        NumericOperations.register(manager.getRegistry());
        StringOperations.register(manager.getRegistry());
        BooleanOperations.register(manager.getRegistry());
    }

    @Test
    public void testSingleStepCustomOperation() {
        LinkedHashMap<String, Class<?>> externalArgs = new LinkedHashMap<>();
        externalArgs.put("x", Double.class);
        externalArgs.put("y", Double.class);

        CustomOperation.OperationStep step = new CustomOperation.OperationStep(
                "result", "mul(x, y)", ExpressionMode.FUNCTIONAL);

        CustomOperation op = new CustomOperation(
                Double.class,
                externalArgs,
                new LinkedHashMap<>(),
                new LinkedHashMap<>(),
                List.of(step),
                null,
                manager);

        Map<String, Object> args = Map.of("x", 2, "y", 3);
        Object result = op.execute(args, manager).get("result");
        assertEquals(6.0, result);
    }

    @Test
    public void testTwoStepWithInternal() {
        LinkedHashMap<String, Class<?>> externalArgs = new LinkedHashMap<>();
        externalArgs.put("a", Double.class);
        externalArgs.put("b", Double.class);

        LinkedHashMap<String, Object> internalState = new LinkedHashMap<>();
        internalState.put("base", 10);

        LinkedHashMap<String, Class<?>> internalTypes = new LinkedHashMap<>();
        internalTypes.put("base", Integer.class);

        List<CustomOperation.OperationStep> steps = List.of(
                new CustomOperation.OperationStep("sum", "add(base, a)", ExpressionMode.FUNCTIONAL),
                new CustomOperation.OperationStep("result", "mul(sum, b)", ExpressionMode.FUNCTIONAL)
        );

        CustomOperation op = new CustomOperation(
                Double.class,
                externalArgs,
                internalState,
                internalTypes,
                steps,
                null,
                manager);

        Map<String, Object> args = Map.of("a", 5, "b", 2);
        Object result = op.execute(args, manager).get("result");
        assertEquals(30.0, result);
    }

    @Test
    public void testNestedCustomOp() {
        LinkedHashMap<String, Class<?>> innerArgs = new LinkedHashMap<>();
        innerArgs.put("a", Double.class);
        innerArgs.put("b", Double.class);

        List<CustomOperation.OperationStep> innerSteps = List.of(
                new CustomOperation.OperationStep("sum", "add(a, b)", ExpressionMode.FUNCTIONAL)
        );

        CustomOperation inner = new CustomOperation(
                Double.class,
                innerArgs,
                new LinkedHashMap<>(),
                new LinkedHashMap<>(),
                innerSteps,
                null,
                manager);

        manager.getRegistry().registerCustom("sumOp", inner, List.of("a", "b"));

        LinkedHashMap<String, Class<?>> outerArgs = new LinkedHashMap<>();
        outerArgs.put("a", Double.class);
        outerArgs.put("b", Double.class);

        CustomOperation outer = new CustomOperation(
                Double.class,
                outerArgs,
                new LinkedHashMap<>(),
                new LinkedHashMap<>(),
                List.of(new CustomOperation.OperationStep("result", "sumOp(a, b)", ExpressionMode.FUNCTIONAL)),
                null,
                manager);

        Map<String, Object> args = Map.of("a", 4, "b", 5);
        Object result = outer.execute(args, manager).get("result");
        assertEquals(9.0, result);
    }
}
