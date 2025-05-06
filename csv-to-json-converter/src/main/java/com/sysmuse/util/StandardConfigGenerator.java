package com.sysmuse.util;

import org.json.simple.JSONObject;
import java.util.Map;
import java.util.Properties;

/**
 * Standard implementation of ConfigGenerator that creates a basic configuration
 * based on the CSV headers and inferred data types
 */
public class StandardConfigGenerator implements ConfigGenerator {

    private Properties properties;

    /**
     * Default constructor
     */
    public StandardConfigGenerator() {
        this.properties = new Properties();
    }

    /**
     * Constructor with properties
     */
    public StandardConfigGenerator(Properties properties) {
        this.properties = properties;
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
    public JSONObject generateConfig(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes) {
        JSONObject config = new JSONObject();

        // Add parameters from properties file
        JSONObject parameters = new JSONObject();

        // Set maxImportRows from properties if available
        String maxImportRows = properties.getProperty("maxImportRows");
        if (maxImportRows != null && !maxImportRows.equals("0")) {
            try {
                int maxRows = Integer.parseInt(maxImportRows);
                parameters.put("maxImportRows", maxRows);
            } catch (NumberFormatException e) {
                parameters.put("maxImportRows", null);
            }
        } else {
            parameters.put("maxImportRows", null);
        }

        config.put("parameters", parameters);

        // Add column configurations (preserving original order)
        JSONObject columns = new JSONObject();

        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) {
                continue; // Skip empty headers
            }

            JSONObject columnConfig = new JSONObject();
            // Get the type from the columnTypes map or default to STRING
            String type = columnTypes.containsKey(header) ?
                    columnTypes.get(header).toString() : "STRING";
            columnConfig.put("type", type);
            columns.put(header, columnConfig);
        }

        config.put("columns", columns);

        return config;
    }
}
