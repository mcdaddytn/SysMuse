package com.sysmuse.expr;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
<<<<<<< HEAD
import java.util.Map;

=======
import java.util.List;
import java.util.Map;

<<<<<<< HEAD
import com.sysmuse.util.LoggingUtil;

>>>>>>> origin/main
=======
>>>>>>> origin/main
import static org.junit.jupiter.api.Assertions.*;

public class ExpressionManagerTest {

    private ExpressionManager manager;

    @BeforeEach
    public void setup() {
        manager = new ExpressionManager();
        manager.setTypeMismatchMode(TypeMismatchMode.EXCEPTION);
<<<<<<< HEAD
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
=======

        // Register core operations
        NumericOperations.register(manager.getRegistry());
        StringOperations.register(manager.getRegistry());
        BooleanOperations.register(manager.getRegistry());

        // Register basic equality op
        manager.getRegistry().registerBoolean(
                "equals",
                new BooleanBaseOperation(List.of("a", "b"),
                        (args, ctx) -> args.get("a").equals(args.get("b"))),
                List.of("a", "b"), "==", "eq");
    }

    @Test
    public void testArithmeticFlow() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("x", 5);
        params.put("y", 3);

        Map<String, String> expressions = new LinkedHashMap<>();
        expressions.put("sum", "add(x, y)");
        expressions.put("product", "mul(sum, 2)");
        expressions.put("isLarge", "greaterThan(product, 10)");

        Map<String, Object> result = manager.evaluateAll(expressions, params, ExpressionMode.FUNCTIONAL);

        assertEquals(8.0, result.get("sum"));
        assertEquals(16.0, result.get("product"));
        assertEquals(true, result.get("isLarge"));
    }

    @Test
    public void testStringOps() {
        Map<String, Object> params = Map.of("filename", "archive.tar.gz");

        Map<String, String> expressions = new LinkedHashMap<>();
        expressions.put("base", "removeExt(filename)");
        expressions.put("caps", "toUpper(base)");

        Map<String, Object> result = manager.evaluateAll(expressions, params, ExpressionMode.FUNCTIONAL);

        assertEquals("archive.tar", result.get("base"));
        assertEquals("ARCHIVE.TAR", result.get("caps"));
    }

    @Test
    public void testTemplateComposition() {
        Map<String, Object> params = Map.of(
                "username", "alice",
                "score", 92
        );

        Map<String, String> expressions = new LinkedHashMap<>();
        expressions.put("isPassing", "greaterThan(score, 70)");
        expressions.put("summary", "template(\"User {username} has score {score} - passing: {isPassing}\")");

        Map<String, Object> result = manager.evaluateAll(expressions, params, ExpressionMode.FUNCTIONAL);

        assertEquals(true, result.get("isPassing"));
        assertEquals("User alice has score 92 - passing: true", result.get("summary"));
<<<<<<< HEAD
        LoggingUtil.info("testTemplateComposition passed");
>>>>>>> origin/main
=======
>>>>>>> origin/main
    }

    @Test
    public void testOperationalSyntax() {
<<<<<<< HEAD
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("score", 88);

        Map<String, String> expressions = new LinkedHashMap<>();
        expressions.put("pass", "score >= 70");
        expressions.put("excellent", "score >= 85");

        Map<String, Object> results = manager.evaluateAll(expressions, params, ExpressionManager.Mode.OPERATIONAL);

        assertEquals(true, results.get("pass"));
        assertEquals(true, results.get("excellent"));
=======
        Map<String, Object> params = Map.of("score", 85);

        Map<String, String> expressions = new LinkedHashMap<>();
        expressions.put("passed", "score >= 60");
        expressions.put("excellent", "score >= 90");

        Map<String, Object> result = manager.evaluateAll(expressions, params, ExpressionMode.OPERATIONAL);

        assertEquals(true, result.get("passed"));
        assertEquals(false, result.get("excellent"));
<<<<<<< HEAD
        LoggingUtil.info("testOperationalSyntax passed");
>>>>>>> origin/main
=======
>>>>>>> origin/main
    }
}
