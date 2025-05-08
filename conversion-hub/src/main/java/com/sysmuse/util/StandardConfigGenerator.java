package com.sysmuse.util;

import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Standard implementation of ConfigGenerator that creates a basic configuration
 * based on the CSV headers and inferred data types.
 * Updated to use SystemConfig exclusively and proper logging.
 */
public class StandardConfigGenerator implements ConfigGenerator {

    private SystemConfig systemConfig;
    private ObjectMapper mapper;

    /**
     * Default constructor
     */
    public StandardConfigGenerator() {
        this.mapper = new ObjectMapper();
        this.systemConfig = new SystemConfig(); // Initialize with defaults
    }

    /**
     * Constructor with SystemConfig
     */
    public StandardConfigGenerator(SystemConfig systemConfig) {
        this.systemConfig = systemConfig;
        this.mapper = new ObjectMapper();
    }

    /**
     * Set system configuration
     */
    @Override
    public void setSystemConfig(SystemConfig systemConfig) {
        this.systemConfig = systemConfig;
    }

    /**
     * Generate a standard configuration based on CSV header and first data row
     */
    @Override
    public JsonNode generateConfig(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes) {
        ObjectNode config = mapper.createObjectNode();

        // Add parameters node
        ObjectNode parameters = mapper.createObjectNode();

        // Set maxImportRows from system config if available
        int maxImportRows = systemConfig.getMaxImportRows();
        if (maxImportRows > 0) {
            parameters.put("maxImportRows", maxImportRows);
        } else {
            parameters.putNull("maxImportRows");
        }

        config.set("parameters", parameters);

        // Add column configurations (preserving original order)
        ObjectNode columns = mapper.createObjectNode();

        // Check if a uniqueKey field is specified in system config
        String uniqueKeyField = null;

        // Auto-detect if not explicitly set
        boolean uniqueKeyFound = false;
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

            // Check if this should be the unique key field
            if (!uniqueKeyFound &&
                    (header.toLowerCase().contains("id") ||
                            header.toLowerCase().endsWith("key") ||
                            header.toLowerCase().equals("identifier"))) {
                // Auto-detect a likely candidate for uniqueKey
                columnConfig.put("uniqueKey", true);
                uniqueKeyFound = true;
                uniqueKeyField = header;
                LoggingUtil.info("Auto-detected " + header + " as a potential uniqueKey field");
            }

            columns.set(header, columnConfig);
        }

        // If no key was detected automatically, use the first column
        if (!uniqueKeyFound && headers.length > 0) {
            String firstHeader = headers[0];
            if (firstHeader != null && !firstHeader.trim().isEmpty()) {
                ObjectNode columnConfig = columns.has(firstHeader) ?
                        (ObjectNode) columns.get(firstHeader) : mapper.createObjectNode();

                columnConfig.put("uniqueKey", true);
                columns.set(firstHeader, columnConfig);
                LoggingUtil.info("Setting first column '" + firstHeader + "' as uniqueKey since no ID field was detected");
            }
        }

        config.set("columns", columns);

        return config;
    }
}
