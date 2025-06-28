package com.sysmuse.expr;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;

import java.io.File;
import java.util.*;
import java.util.function.BiFunction;

public class CustomOperationLoader {

    public static CustomOperation fromJson(JsonNode root, ExpressionManager manager) {
        try {
            String name = root.get("name").asText();
            String returnTypeStr = root.get("returnType").asText();
            Class<?> returnType = classFromName(returnTypeStr);

            // Load args
            LinkedHashMap<String, Class<?>> args = new LinkedHashMap<>();
            JsonNode argsNode = root.get("args");
            argsNode.fields().forEachRemaining(entry -> {
                args.put(entry.getKey(), classFromName(entry.getValue().asText()));
            });

            // Load internal state
            LinkedHashMap<String, Object> internalState = new LinkedHashMap<>();
            LinkedHashMap<String, Class<?>> internalTypes = new LinkedHashMap<>();
            JsonNode stateNode = root.path("internalState");
            JsonNode typesNode = root.path("internalTypes");
            stateNode.fields().forEachRemaining(entry -> {
                internalState.put(entry.getKey(), parseLiteral(entry.getValue()));
            });
            typesNode.fields().forEachRemaining(entry -> {
                internalTypes.put(entry.getKey(), classFromName(entry.getValue().asText()));
            });

            // Load steps
            List<CustomOperation.OperationStep> steps = new ArrayList<>();
            ArrayNode stepsArray = (ArrayNode) root.get("steps");
            for (JsonNode stepNode : stepsArray) {
                String out = stepNode.get("outputVar").asText();
                String expr = stepNode.get("expression").asText();
                ExpressionMode mode = stepNode.has("mode") ? ExpressionMode.valueOf(stepNode.get("mode").asText()) : ExpressionMode.FUNCTIONAL;
                steps.add(new CustomOperation.OperationStep(out, expr, mode));
            }

            return new CustomOperation(returnType, args, internalState, internalTypes, steps, null, manager);
        } catch (Exception e) {
            throw new RuntimeException("Failed to load CustomOperation from JSON", e);
        }
    }

    private static Class<?> classFromName(String type) {
        return switch (type) {
            case "Double" -> Double.class;
            case "Integer" -> Integer.class;
            case "Long" -> Long.class;
            case "String" -> String.class;
            case "Boolean" -> Boolean.class;
            default -> throw new IllegalArgumentException("Unsupported type: " + type);
        };
    }

    private static Object parseLiteral(JsonNode node) {
        if (node.isInt()) return node.intValue();
        if (node.isDouble()) return node.doubleValue();
        if (node.isLong()) return node.longValue();
        if (node.isBoolean()) return node.booleanValue();
        return node.asText();
    }

    public static List<CustomOperation> loadFromFile(File file, ExpressionManager manager) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode root = mapper.readTree(file);
        List<CustomOperation> ops = new ArrayList<>();
        if (root.isArray()) {
            for (JsonNode node : root) {
                ops.add(fromJson(node, manager));
            }
        } else {
            ops.add(fromJson(root, manager));
        }
        return ops;
    }
}
