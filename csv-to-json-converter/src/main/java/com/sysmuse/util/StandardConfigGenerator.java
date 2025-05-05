package com.sysmuse.util;

import org.json.simple.JSONObject;
import java.util.Map;

/**
 * Standard implementation of ConfigGenerator that creates a basic configuration
 * based on the CSV headers and inferred data types
 */
public class StandardConfigGenerator implements ConfigGenerator {
    
    /**
     * Generate a standard configuration based on CSV header and first data row
     */
    @Override
    public JSONObject generateConfig(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes) {
        JSONObject config = new JSONObject();
        
        // Add default parameters
        JSONObject parameters = new JSONObject();
        parameters.put("maxImportRows", null);
        config.put("parameters", parameters);
        
        // Add column configurations
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
