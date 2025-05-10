package com.sysmuse.expr;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

public class ExpressionManagerTest {

    private ExpressionManager manager;

    @BeforeEach
    public void setup() {
        manager = new ExpressionManager();
        manager.setTypeMismatchMode(TypeMismatchMode.EXCEPTION);
        manager.getRegistry().registerBoolean("equals", (args, ctx) ->
                args.get("a").equals(args.get("b")), 
                java.util.List.of("a", "b"), "==", "eq");

        NumericOperations.register(manager.getRegistry());
        StringOperations.register(manager.getRegistry());
    }

    @Test
    public void testBooleanAndArithmeticFlow() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("x", 10);
        params.put("y", 2);
        params.put("z", 5);

        Map<String, String> expressions = new LinkedHashMap<>();
        expressions.put("sum", "add(x, y)");
        expressions.put("isSumCorrect", "equals(sum, 12)");
        expressions.put("product", "mul(sum, z)");
        expressions.put("templateOut", "template(\"{product} = ({x} + {y}) * {z}\")");

        Map<String, Object> results = manager.evaluateAll(expressions, params, ExpressionManager.Mode.FUNCTIONAL);

        assertEquals(12.0, results.get("sum"));
        assertTrue((Boolean) results.get("isSumCorrect"));
        assertEquals(60.0, results.get("product"));
        assertEquals("60.0 = (10 + 2) * 5", results.get("templateOut"));
    }

    @Test
    public void testStringOperations() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("filename", "report.csv");

        Map<String, String> expressions = new LinkedHashMap<>();
        expressions.put("baseName", "removeExt(filename)");
        expressions.put("fileCaps", "toUpper(baseName)");

        Map<String, Object> results = manager.evaluateAll(expressions, params, ExpressionManager.Mode.FUNCTIONAL);

        assertEquals("report", results.get("baseName"));
        assertEquals("REPORT", results.get("fileCaps"));
    }

    @Test
    public void testOperationalSyntax() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("score", 88);

        Map<String, String> expressions = new LinkedHashMap<>();
        expressions.put("pass", "score >= 70");
        expressions.put("excellent", "score >= 85");

        Map<String, Object> results = manager.evaluateAll(expressions, params, ExpressionManager.Mode.OPERATIONAL);

        assertEquals(true, results.get("pass"));
        assertEquals(true, results.get("excellent"));
    }
}
