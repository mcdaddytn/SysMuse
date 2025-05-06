package com.sysmuse.util;

import java.util.Map;
import java.util.Properties;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Standard implementation of ConfigGenerator that creates a basic configuration
 * based on the CSV headers and inferred data types
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

            columns.set(header, columnConfig);
        }

        config.set("columns", columns);

        return config;
    }
}
