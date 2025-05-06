package com.sysmuse.util;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

/**
 * Interface for classes that generate JSON configuration
 * for the Conversion Hub based on data structure
 */
public interface ConfigGenerator {
    
    /**
     * Generate a JSON configuration based on header and first data row
     * 
     * @param headers The header row as an array of column names
     * @param firstDataRow The first data row (for type inference)
     * @param columnTypes A map of inferred column types
     * @return A JsonNode containing the full configuration
     */
    JsonNode generateConfig(String[] headers, String[] firstDataRow, Map<String, Object> columnTypes);
}
