package com.sysmuse.util;

import java.util.Map;
import java.util.Properties;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Standard implementation of ConfigGenerator that creates a basic configuration
 * based on the CSV headers and inferred data types.
 * Updated to support uniqueKey field for multi-file overlay functionality.
 */
public class StandardConfigGenerator implements ConfigGenerator {

    private Properties properties;
    private ObjectMapper mapper;

    /**
     * Default constructor
     */
    public StandardConfigGenerator() {
        this.properties = new Properties();
        this.mapper = new ObjectMapper();
    }

    /**
     * Constructor with properties
     */
    public StandardConfigGenerator(Properties properties) {
        this.properties = properties;
        this.mapper = new ObjectMapper();
    }

    /**
     * Set properties
     */
    public void setProperties(Properties properties) {
        this.properties = properties;
    }

    /**
     * Generate a standard configuration based on CSV header and first data row
     */
    @Override
    public JsonNode generateConfig(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes) {
        ObjectNode config = mapper.createObjectNode();

        // Add parameters from properties file
        ObjectNode parameters = mapper.createObjectNode();

        // Set maxImportRows from properties if available
        String maxImportRows = properties.getProperty("maxImportRows");
        if (maxImportRows != null && !maxImportRows.equals("0")) {
            try {
                int maxRows = Integer.parseInt(maxImportRows);
                parameters.put("maxImportRows", maxRows);
            } catch (NumberFormatException e) {
                parameters.putNull("maxImportRows");
            }
        } else {
            parameters.putNull("maxImportRows");
        }

        config.set("parameters", parameters);

        // Add column configurations (preserving original order)
        ObjectNode columns = mapper.createObjectNode();

        // Check if a uniqueKey field is specified in properties
        String uniqueKeyField = properties.getProperty("uniqueKey.field");

        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) {
                continue; // Skip empty headers
            }

            ObjectNode columnConfig = mapper.createObjectNode();
            // Get the type from the columnTypes map or default to STRING
            String type = columnTypes.containsKey(header) ?
                    columnTypes.get(header).toString() : "STRING";
            columnConfig.put("type", type);

            // Add visibility property (default to true)
            columnConfig.put("visible", true);

            // Check if this is the unique key field
            if (uniqueKeyField != null && header.equals(uniqueKeyField)) {
                columnConfig.put("uniqueKey", true);
                System.out.println("Setting " + header + " as uniqueKey field based on properties");
            } else if (uniqueKeyField == null &&
                    (header.toLowerCase().contains("id") ||
                            header.toLowerCase().endsWith("key") ||
                            header.toLowerCase().equals("identifier"))) {
                // If no explicit uniqueKey is set, try to identify a likely candidate
                // like fields with 'id', 'key', or 'identifier' in their name
                columnConfig.put("uniqueKey", true);
                System.out.println("Auto-detected " + header + " as a potential uniqueKey field");

                // Only set the first one we find as unique key
                uniqueKeyField = header;
            }

            columns.set(header, columnConfig);
        }

        config.set("columns", columns);

        return config;
    }
}
