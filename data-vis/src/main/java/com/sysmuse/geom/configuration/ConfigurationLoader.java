package com.sysmuse.geom.configuration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.File;
import java.io.IOException;

/**
 * Utility class for loading and saving configuration files.
 * 
 * Handles JSON serialization and deserialization of Configuration and
 * TargetCriteria objects using Jackson.
 */
public class ConfigurationLoader {
    
    private final ObjectMapper objectMapper;
    
    /**
     * Constructor initializes the Jackson ObjectMapper with pretty printing.
     */
    public ConfigurationLoader() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
    }
    
    /**
     * Load a Configuration from a JSON file.
     * 
     * @param filename Path to the JSON configuration file
     * @return Configuration object
     * @throws IOException If the file cannot be read or parsed
     */
    public Configuration loadFromJSON(String filename) throws IOException {
        File file = new File(filename);
        if (!file.exists()) {
            throw new IOException("Configuration file not found: " + filename);
        }
        
        Configuration config = objectMapper.readValue(file, Configuration.class);
        // Ensure positions are calculated after loading
        config.calculateVennPositions();
        return config;
    }
    
    /**
     * Load TargetCriteria from a JSON file.
     * 
     * @param filename Path to the JSON target criteria file
     * @return TargetCriteria object
     * @throws IOException If the file cannot be read or parsed
     */
    public TargetCriteria loadTargetFromJSON(String filename) throws IOException {
        File file = new File(filename);
        if (!file.exists()) {
            throw new IOException("Target criteria file not found: " + filename);
        }
        
        return objectMapper.readValue(file, TargetCriteria.class);
    }
    
    /**
     * Save a Configuration to a JSON file.
     * 
     * @param config Configuration object to save
     * @param filename Path where to save the JSON file
     * @throws IOException If the file cannot be written
     */
    public void saveConfigurationToJSON(Configuration config, String filename) throws IOException {
        File file = new File(filename);
        file.getParentFile().mkdirs(); // Create parent directories if needed
        objectMapper.writeValue(file, config);
    }
    
    /**
     * Save TargetCriteria to a JSON file.
     * 
     * @param target TargetCriteria object to save
     * @param filename Path where to save the JSON file
     * @throws IOException If the file cannot be written
     */
    public void saveTargetToJSON(TargetCriteria target, String filename) throws IOException {
        File file = new File(filename);
        file.getParentFile().mkdirs(); // Create parent directories if needed
        objectMapper.writeValue(file, target);
    }
    
    /**
     * Create a copy of a Configuration object.
     * This is useful for creating variations during simulation.
     * 
     * @param original Configuration to copy
     * @return New Configuration object with same values
     * @throws IOException If serialization fails
     */
    public Configuration copyConfiguration(Configuration original) throws IOException {
        // Deep copy using JSON serialization
        String json = objectMapper.writeValueAsString(original);
        Configuration copy = objectMapper.readValue(json, Configuration.class);
        copy.calculateVennPositions(); // Recalculate positions
        return copy;
    }
    
    /**
     * Validate that a configuration file is valid.
     * 
     * @param filename Path to configuration file
     * @return true if valid, false otherwise
     */
    public boolean validateConfiguration(String filename) {
        try {
            Configuration config = loadFromJSON(filename);
            return validateConfiguration(config);
        } catch (Exception e) {
            return false;
        }
    }
    
    /**
     * Validate a Configuration object.
     * 
     * @param config Configuration to validate
     * @return true if valid, false otherwise
     */
    public boolean validateConfiguration(Configuration config) {
        if (config == null) return false;
        if (config.getDotSize() <= 0) return false;
        if (config.getDotSpacing() < 0) return false;
        if (config.getOuterRadius() <= 0) return false;
        if (config.getCanvasWidth() <= 0 || config.getCanvasHeight() <= 0) return false;
        if (config.getVennCircles() == null || config.getVennCircles().isEmpty()) return false;
        
        // Validate each venn circle
        for (VennCircleConfig venn : config.getVennCircles()) {
            if (venn.getRadius() <= 0) return false;
            if (venn.getNumConcentricCircles() < 0) return false;
        }
        
        return true;
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