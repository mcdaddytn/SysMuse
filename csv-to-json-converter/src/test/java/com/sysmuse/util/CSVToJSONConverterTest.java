package com.sysmuse.util;

import java.nio.file.Paths;
import java.util.Properties;

/**
 * Simple test class for CSVToJSONConverter
 */
public class CSVToJSONConverterTest {
    
    public static void main(String[] args) {
        try {
            // Create a properties object with test settings
            Properties props = new Properties();
            
            // Set input file path
            props.setProperty("input.csv.path", "src/test/resources");
            props.setProperty("input.csv.filename", "sample.csv");
            
            // Set configuration
            props.setProperty("config.directory", "src/test/resources");
            props.setProperty("config.filename", "config.json");
            
            // For applicable format testing
            // Use standard config generator
            props.setProperty("config.generator.class", "com.sysmuse.util.config.StandardConfigGenerator");
            
            // Or use ApplicableFormat config generator
            // props.setProperty("config.generator.class", "com.sysmuse.util.config.ApplicableFormatConfigGenerator");
            // props.setProperty("applicable.format.compound.expressions", 
            //                  "Automated Email AND Domain Services,Solicitation OR Subscribed Newsletter OR System XML reasoning");
            
            // Create converter instance
            CSVToJSONConverter converter = new CSVToJSONConverter();
            converter.setProperties(props);
            
            // Set config directory
            converter.setConfigDirectory(props.getProperty("config.directory"));
            
            // Paths for input and config
            String csvPath = Paths.get(props.getProperty("input.csv.path"), 
                                     props.getProperty("input.csv.filename")).toString();
            
            String configPath = Paths.get(props.getProperty("config.directory"), 
                                        props.getProperty("config.filename")).toString();
            
            // Convert with explicit config path
            // converter.convert(csvPath, configPath);
            
            // Or convert without config path (will generate config)
            converter.convert(csvPath, null);
            
            System.out.println("Test completed successfully!");
            
        } catch (Exception e) {
            System.err.println("Test failed with error: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
