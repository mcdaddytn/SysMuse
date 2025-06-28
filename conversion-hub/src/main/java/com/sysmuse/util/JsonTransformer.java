package com.sysmuse.util;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

//import java.io.File;
import java.util.Iterator;
import java.util.Map;

import java.io.*;
import java.util.*;


public class JsonTransformer {
    public enum JsonTransformType {
        InvisibleBooleans,
        InvisibleStrings,
        InvisibleSnippets,
        InvisibleReasoning
    }

    private static Properties loadDefaultProperties() {
        Properties defaultProps = new Properties();
        try (InputStream in = ConversionHub.class.getClassLoader().getResourceAsStream("application.properties")) {
            if (in != null) {
                defaultProps.load(in);
                LoggingUtil.info("Loaded default properties");
            } else {
                LoggingUtil.info("Default properties file not found, using built-in defaults");
            }
        } catch (IOException e) {
            LoggingUtil.error("Error loading default properties: " + e.getMessage());
        }
        return defaultProps;
    }
    public static void main(String[] args) throws Exception {
        ObjectMapper mapper = null;
        ObjectNode root = null;
        ObjectNode columns = null;
        JsonTransformType transformType = JsonTransformType.InvisibleStrings;
        //JsonTransformType transformType = JsonTransformType.InvisibleBooleans;
        String filePath = "config.json";
        String inputFileName = "config.json";
        String outputFileName = "config_xform.json";
        String inputFilePath = null;
        String outputFilePath = null;
        String configDir = null;

        Properties defaultProps = loadDefaultProperties();

        if (configDir == null) {
            configDir = defaultProps.getProperty("config.directory", "");
            //inputFileName = defaultProps.getProperty("config.filename", "");
        }

        inputFilePath = configDir + File.separator + inputFileName;
        outputFilePath = configDir + File.separator + outputFileName;
        LoggingUtil.info("JsonTransformer transforming(mode=%s) %s to %s", transformType, inputFilePath, outputFilePath);

        mapper = new ObjectMapper();
        root = (ObjectNode) mapper.readTree(new File(inputFilePath));
        columns = (ObjectNode) root.get("columns");

        Iterator<Map.Entry<String, com.fasterxml.jackson.databind.JsonNode>> fields = columns.fields();
        while (fields.hasNext()) {
            Map.Entry<String, com.fasterxml.jackson.databind.JsonNode> entry = fields.next();
            String key = entry.getKey();
            ObjectNode column = (ObjectNode) entry.getValue();

            boolean isUniqueKey = column.has("uniqueKey") && column.get("uniqueKey").asBoolean();
            String type = column.has("type") ? column.get("type").asText() : "";
            String name = column.has("type") ? column.get("type").asText() : "";
            // make all visible by default
            column.put("visible", true);

            // Rule 1 and 2: Set visible = true for all non-unique BOOLEAN or STRING
            if (!isUniqueKey && "STRING".equals(type)) {
                if (transformType == JsonTransformType.InvisibleStrings) {
                    column.put("visible", false);
                }
                if (transformType == JsonTransformType.InvisibleSnippets && key.toLowerCase().contains("snippets")) {
                    column.put("visible", false);
                }
                if (transformType == JsonTransformType.InvisibleReasoning && key.toLowerCase().contains("reasoning")) {
                    column.put("visible", false);
                }
            }
            else {
                if (transformType == JsonTransformType.InvisibleBooleans && "BOOLEAN".equals(type)) {
                    column.put("visible", true);
                }
            }
        }

        // Output to file or console
        mapper.writerWithDefaultPrettyPrinter().writeValue(new File(outputFilePath), root);
        System.out.println(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root));
    }
}
