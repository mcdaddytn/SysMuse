package com.sysmuse.expr;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class CustomOperationLoaderTest {

    private ExpressionManager manager;

    @BeforeEach
    public void setup() {
        manager = new ExpressionManager();
        NumericOperations.register(manager.getRegistry());
        StringOperations.register(manager.getRegistry());
        BooleanOperations.register(manager.getRegistry());
    }

    @Test
    public void testLoadAndExecuteCustomOperationsFromJson() throws Exception {
        File file = new File("config/custom_operations_test.json");
        //File file = new File("src/test/resources/custom_operations_test.json");
        List<CustomOperation> ops = CustomOperationLoader.loadFromFile(file, manager);

        manager.getRegistry().registerCustom("sumThenDouble", ops.get(0), List.of("x", "y"));
        manager.getRegistry().registerCustom("useInternalBaseAndNestedOp", ops.get(1), List.of("x"));

        Map<String, Object> result1 = ops.get(0).execute(Map.of("x", 4, "y", 6), manager);
        assertEquals(20.0, result1.get("result"));

        Map<String, Object> result2 = ops.get(1).execute(Map.of("x", 5), manager);
        assertEquals(21.0, result2.get("result"));
    }
}
