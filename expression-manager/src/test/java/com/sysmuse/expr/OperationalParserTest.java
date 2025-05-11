package com.sysmuse.expr;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

public class OperationalParserTest {

    private ExpressionManager manager;

    @BeforeEach
    public void setup() {
        manager = new ExpressionManager();
        manager.setTypeMismatchMode(TypeMismatchMode.EXCEPTION);

        // Register core operations
        NumericOperations.register(manager.getRegistry());
        StringOperations.register(manager.getRegistry());
        BooleanOperations.register(manager.getRegistry());

        // Basic equality for strings
        manager.getRegistry().registerBoolean("equals",
                (args, ctx) -> args.get("a").equals(args.get("b")),
                List.of("a", "b"), "==");
    }

    @Test
    public void testBasicOperationalExpressions() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("x", 4);
        params.put("y", 3);
        params.put("username", "admin");
        params.put("role", "user");
        params.put("score", 92);

        Map<String, String> expressions = new LinkedHashMap<>();
        expressions.put("sum", "x + y");
        expressions.put("product", "sum * 2");
        expressions.put("isBig", "product > 10");
        expressions.put("roleIsUser", "role == \"user\"");
        expressions.put("hasHighScore", "score > 90");

        Map<String, Object> result = manager.evaluateAll(expressions, params, ExpressionMode.OPERATIONAL);

        assertEquals(7.0, result.get("sum"));
        assertEquals(14.0, result.get("product"));
        assertEquals(true, result.get("isBig"));
        assertEquals(true, result.get("roleIsUser"));
        assertEquals(true, result.get("hasHighScore"));
    }
}
