package com.sysmuse.geom.output;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.File;
import java.io.IOException;
import java.util.Map;

/**
 * Handles JSON export of simulation results and configurations.
 * 
 * Provides methods to export various data structures to JSON files
 * with proper formatting and error handling.
 */
public class JSONExporter {
    
    private final ObjectMapper objectMapper;
    
    /**
     * Create a new JSONExporter with pretty-printing enabled.
     */
    public JSONExporter() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
        this.objectMapper.enable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }
    
    /**
     * Export any object to a JSON file.
     * 
     * @param data The object to export
     * @param filename Path to the output file
     * @throws IOException If the file cannot be written
     */
    public void exportToFile(Object data, String filename) throws IOException {
        File file = new File(filename);
        file.getParentFile().mkdirs(); // Create parent directories if needed
        objectMapper.writeValue(file, data);
    }
    
    /**
     * Export data to a JSON string.
     * 
     * @param data The object to export
     * @return JSON string representation
     * @throws IOException If serialization fails
     */
    public String exportToString(Object data) throws IOException {
        return objectMapper.writeValueAsString(data);
    }
    
    /**
     * Export data with custom formatting options.
     * 
     * @param data The object to export
     * @param filename Path to the output file
     * @param prettyPrint Whether to format the JSON with indentation
     * @throws IOException If the file cannot be written
     */
    public void exportToFile(Object data, String filename, boolean prettyPrint) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        if (prettyPrint) {
            mapper.enable(SerializationFeature.INDENT_OUTPUT);
        }
        
        File file = new File(filename);
        file.getParentFile().mkdirs();
        mapper.writeValue(file, data);
    }
    
    /**
     * Export a summary of large datasets to avoid huge files.
     * 
     * @param data The full dataset
     * @param filename Path to the output file
     * @param maxItems Maximum number of items to include in arrays
     * @throws IOException If the file cannot be written
     */
    public void exportSummary(Map<String, Object> data, String filename, int maxItems) throws IOException {
        Map<String, Object> summary = createSummary(data, maxItems);
        exportToFile(summary, filename);
    }
    
    /**
     * Create a summary version of a data map, limiting array sizes.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> createSummary(Map<String, Object> data, int maxItems) {
        Map<String, Object> summary = new java.util.HashMap<>();
        
        for (Map.Entry<String, Object> entry : data.entrySet()) {
            Object value = entry.getValue();
            
            if (value instanceof java.util.List) {
                java.util.List<?> list = (java.util.List<?>) value;
                if (list.size() > maxItems) {
                    // Keep first maxItems elements
                    summary.put(entry.getKey(), list.subList(0, maxItems));
                    summary.put(entry.getKey() + "_truncated", true);
                    summary.put(entry.getKey() + "_originalSize", list.size());
                } else {
                    summary.put(entry.getKey(), value);
                }
            } else if (value instanceof Map) {
                summary.put(entry.getKey(), createSummary((Map<String, Object>) value, maxItems));
            } else {
                summary.put(entry.getKey(), value);
            }
        }
        
        return summary;
    }
    
    /**
     * Validate that a file can be read as valid JSON.
     * 
     * @param filename Path to the JSON file
     * @return true if the file contains valid JSON
     */
    public boolean validateJSON(String filename) {
        try {
            objectMapper.readTree(new File(filename));
            return true;
        } catch (Exception e) {
            return false;
        }
    }
    
    /**
     * Get the ObjectMapper for direct use if needed.
     * 
     * @return The configured Jackson ObjectMapper
     */
    public ObjectMapper getObjectMapper() {
        return objectMapper;
    }
}