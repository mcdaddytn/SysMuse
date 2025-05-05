package com.sysmuse.util;

import org.json.simple.JSONObject;
import java.util.Map;

/**
 * Interface for classes that generate JSON configuration
 * for the CSV to JSON Converter based on CSV structure
 */
public interface ConfigGenerator {
    
    /**
     * Generate a JSON configuration based on CSV header and first data row
     * 
     * @param headers The CSV header row as an array of column names
     * @param firstDataRow The first data row from the CSV (for type inference)
     * @param columnTypes A map of inferred column types (from CSVToJSONConverter)
     * @return A JSONObject containing the full configuration
     */
    JSONObject generateConfig(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes);
}

