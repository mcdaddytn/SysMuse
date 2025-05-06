package com.sysmuse.util;

import org.json.simple.JSONObject;
import org.json.simple.JSONArray;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.io.FileWriter;
import java.io.IOException;
import java.util.List;
import java.util.Arrays;

/**
 * Utility class for converting org.json.simple JSON objects to Jackson JSON objects
 * while preserving a specified field order, and writing the result to a file.
 */
public class OrderedJsonConverter {

    /**
     * Convert a JSONObject to an ordered Jackson JSON format and write to a file
     * 
     * @param jsonObj The JSONObject to convert
     * @param orderedFields List of field names in the desired order
     * @param outputFilePath Path to the output file
     * @param prettyPrint Whether to format the output with indentation
     * @throws IOException If an I/O error occurs during writing
     */
    public static void convertAndWriteToFile(JSONObject jsonObj, List<String> orderedFields, 
            String outputFilePath, boolean prettyPrint) throws IOException {
        // Create Jackson ObjectMapper
        ObjectMapper mapper = new ObjectMapper();
        if (prettyPrint) {
            mapper.enable(SerializationFeature.INDENT_OUTPUT);
        }
        
        // Convert to ordered JSON
        ObjectNode rootNode = convertToOrderedJson(jsonObj, orderedFields, mapper);
        
        // Write to file
        try (FileWriter file = new FileWriter(outputFilePath)) {
            file.write(mapper.writeValueAsString(rootNode));
        }
    }
    
    /**
     * Convert a JSONArray to an ordered Jackson JSON format and write to a file
     * 
     * @param jsonArray The JSONArray to convert
     * @param orderedFields List of field names in the desired order for objects in the array
     * @param outputFilePath Path to the output file
     * @param prettyPrint Whether to format the output with indentation
     * @throws IOException If an I/O error occurs during writing
     */
    public static void convertAndWriteToFile(JSONArray jsonArray, List<String> orderedFields, 
            String outputFilePath, boolean prettyPrint) throws IOException {
        // Create Jackson ObjectMapper
        ObjectMapper mapper = new ObjectMapper();
        if (prettyPrint) {
            mapper.enable(SerializationFeature.INDENT_OUTPUT);
        }
        
        // Convert to ordered JSON
        ArrayNode rootArray = convertToOrderedJson(jsonArray, orderedFields, mapper);
        
        // Write to file
        try (FileWriter file = new FileWriter(outputFilePath)) {
            file.write(mapper.writeValueAsString(rootArray));
        }
    }
    
    /**
     * Convert a JSONObject to an ordered Jackson ObjectNode
     * 
     * @param jsonObj The JSONObject to convert
     * @param orderedFields List of field names in the desired order
     * @param mapper The Jackson ObjectMapper to use for creating nodes
     * @return An ordered ObjectNode representation of the input
     */
    public static ObjectNode convertToOrderedJson(JSONObject jsonObj, List<String> orderedFields, 
            ObjectMapper mapper) {
        ObjectNode rootNode = mapper.createObjectNode();
        
        // First, handle the top-level sections in a specific order
        // Start with parameters section
        if (jsonObj.containsKey("parameters")) {
            JSONObject params = (JSONObject) jsonObj.get("parameters");
            ObjectNode paramsNode = mapper.createObjectNode();
            
            for (Object key : params.keySet()) {
                String paramName = (String) key;
                Object paramValue = params.get(paramName);
                addValueToNode(paramsNode, paramName, paramValue, mapper);
            }
            
            rootNode.set("parameters", paramsNode);
        }
        
        // Then handle columns section preserving the provided field order
        if (jsonObj.containsKey("columns")) {
            JSONObject columns = (JSONObject) jsonObj.get("columns");
            ObjectNode columnsNode = mapper.createObjectNode();
            
            // First add columns in the specified order
            for (String fieldName : orderedFields) {
                if (columns.containsKey(fieldName)) {
                    JSONObject columnConfig = (JSONObject) columns.get(fieldName);
                    ObjectNode columnNode = mapper.createObjectNode();
                    
                    for (Object key : columnConfig.keySet()) {
                        String propName = (String) key;
                        Object propValue = columnConfig.get(propName);
                        addValueToNode(columnNode, propName, propValue, mapper);
                    }
                    
                    columnsNode.set(fieldName, columnNode);
                }
            }
            
            // Add any columns that weren't in the orderedFields list
            for (Object key : columns.keySet()) {
                String columnName = (String) key;
                if (!orderedFields.contains(columnName) && !columnsNode.has(columnName)) {
                    JSONObject columnConfig = (JSONObject) columns.get(columnName);
                    ObjectNode columnNode = mapper.createObjectNode();
                    
                    for (Object configKey : columnConfig.keySet()) {
                        String propName = (String) configKey;
                        Object propValue = columnConfig.get(propName);
                        addValueToNode(columnNode, propName, propValue, mapper);
                    }
                    
                    columnsNode.set(columnName, columnNode);
                }
            }
            
            rootNode.set("columns", columnsNode);
        }
        
        // Add derived boolean fields
        if (jsonObj.containsKey("derivedBooleanFields")) {
            JSONObject derivedFields = (JSONObject) jsonObj.get("derivedBooleanFields");
            ObjectNode derivedNode = mapper.createObjectNode();
            
            for (Object key : derivedFields.keySet()) {
                String fieldName = (String) key;
                JSONObject fieldConfig = (JSONObject) derivedFields.get(fieldName);
                ObjectNode fieldNode = convertJsonObjectToObjectNode(fieldConfig, mapper);
                derivedNode.set(fieldName, fieldNode);
            }
            
            rootNode.set("derivedBooleanFields", derivedNode);
        }
        
        // Add aggregate text fields
        if (jsonObj.containsKey("aggregateTextFields")) {
            JSONObject aggregateFields = (JSONObject) jsonObj.get("aggregateTextFields");
            ObjectNode aggregateNode = mapper.createObjectNode();
            
            for (Object key : aggregateFields.keySet()) {
                String fieldName = (String) key;
                JSONObject fieldConfig = (JSONObject) aggregateFields.get(fieldName);
                ObjectNode fieldNode = convertJsonObjectToObjectNode(fieldConfig, mapper);
                aggregateNode.set(fieldName, fieldNode);
            }
            
            rootNode.set("aggregateTextFields", aggregateNode);
        }
        
        // Add suppressed fields
        if (jsonObj.containsKey("suppressedFields")) {
            JSONObject suppressed = (JSONObject) jsonObj.get("suppressedFields");
            ObjectNode suppressedNode = mapper.createObjectNode();
            
            for (Object key : suppressed.keySet()) {
                String fieldToSuppress = (String) key;
                String conditionField = (String) suppressed.get(fieldToSuppress);
                suppressedNode.put(fieldToSuppress, conditionField);
            }
            
            rootNode.set("suppressedFields", suppressedNode);
        }
        
        // Add any remaining fields that weren't handled above
        for (Object key : jsonObj.keySet()) {
            String fieldName = (String) key;
            if (!rootNode.has(fieldName)) {
                Object value = jsonObj.get(fieldName);
                addValueToNode(rootNode, fieldName, value, mapper);
            }
        }
        
        return rootNode;
    }
    
    /**
     * Convert a JSONArray to an ordered Jackson ArrayNode
     * 
     * @param jsonArray The JSONArray to convert
     * @param orderedFields List of field names in the desired order for objects in the array
     * @param mapper The Jackson ObjectMapper to use for creating nodes
     * @return An ordered ArrayNode representation of the input
     */
    public static ArrayNode convertToOrderedJson(JSONArray jsonArray, List<String> orderedFields, 
            ObjectMapper mapper) {
        ArrayNode arrayNode = mapper.createArrayNode();
        
        for (Object item : jsonArray) {
            if (item instanceof JSONObject) {
                JSONObject jsonObj = (JSONObject) item;
                ObjectNode objectNode = mapper.createObjectNode();
                
                // Add fields in the specified order first
                for (String fieldName : orderedFields) {
                    if (jsonObj.containsKey(fieldName)) {
                        Object value = jsonObj.get(fieldName);
                        addValueToNode(objectNode, fieldName, value, mapper);
                    }
                }
                
                // Add any remaining fields
                for (Object key : jsonObj.keySet()) {
                    String fieldName = (String) key;
                    if (!orderedFields.contains(fieldName)) {
                        Object value = jsonObj.get(fieldName);
                        addValueToNode(objectNode, fieldName, value, mapper);
                    }
                }
                
                arrayNode.add(objectNode);
            } else if (item instanceof JSONArray) {
                arrayNode.add(convertJsonArrayToArrayNode((JSONArray) item, mapper));
            } else {
                addValueToArrayNode(arrayNode, item, mapper);
            }
        }
        
        return arrayNode;
    }
    
    /**
     * Convert a org.json.simple JSONObject to a Jackson ObjectNode
     */
    private static ObjectNode convertJsonObjectToObjectNode(JSONObject jsonObj, ObjectMapper mapper) {
        ObjectNode node = mapper.createObjectNode();
        
        for (Object key : jsonObj.keySet()) {
            String fieldName = (String) key;
            Object fieldValue = jsonObj.get(fieldName);
            addValueToNode(node, fieldName, fieldValue, mapper);
        }
        
        return node;
    }
    
    /**
     * Convert a org.json.simple JSONArray to a Jackson ArrayNode
     */
    private static ArrayNode convertJsonArrayToArrayNode(JSONArray jsonArray, ObjectMapper mapper) {
        ArrayNode arrayNode = mapper.createArrayNode();
        
        for (Object item : jsonArray) {
            addValueToArrayNode(arrayNode, item, mapper);
        }
        
        return arrayNode;
    }
    
    /**
     * Add a value to a Jackson ObjectNode with proper type conversion
     */
    private static void addValueToNode(ObjectNode node, String fieldName, Object value, ObjectMapper mapper) {
        if (value instanceof JSONObject) {
            node.set(fieldName, convertJsonObjectToObjectNode((JSONObject) value, mapper));
        } else if (value instanceof JSONArray) {
            node.set(fieldName, convertJsonArrayToArrayNode((JSONArray) value, mapper));
        } else if (value instanceof String) {
            node.put(fieldName, (String) value);
        } else if (value instanceof Long) {
            node.put(fieldName, (Long) value);
        } else if (value instanceof Integer) {
            node.put(fieldName, (Integer) value);
        } else if (value instanceof Double) {
            node.put(fieldName, (Double) value);
        } else if (value instanceof Float) {
            node.put(fieldName, (Float) value);
        } else if (value instanceof Boolean) {
            node.put(fieldName, (Boolean) value);
        } else if (value == null) {
            node.putNull(fieldName);
        }
    }
    
    /**
     * Add a value to a Jackson ArrayNode with proper type conversion
     */
    private static void addValueToArrayNode(ArrayNode arrayNode, Object value, ObjectMapper mapper) {
        if (value instanceof JSONObject) {
            arrayNode.add(convertJsonObjectToObjectNode((JSONObject) value, mapper));
        } else if (value instanceof JSONArray) {
            arrayNode.add(convertJsonArrayToArrayNode((JSONArray) value, mapper));
        } else if (value instanceof String) {
            arrayNode.add((String) value);
        } else if (value instanceof Long) {
            arrayNode.add((Long) value);
        } else if (value instanceof Integer) {
            arrayNode.add((Integer) value);
        } else if (value instanceof Double) {
            arrayNode.add((Double) value);
        } else if (value instanceof Float) {
            arrayNode.add((Float) value);
        } else if (value instanceof Boolean) {
            arrayNode.add((Boolean) value);
        } else if (value == null) {
            arrayNode.addNull();
        }
    }
}