package com.sysmuse.geom;

import com.sysmuse.geom.configuration.Configuration;
import com.sysmuse.geom.configuration.ConfigurationLoader;
import com.sysmuse.geom.configuration.TargetCriteria;
import com.sysmuse.geom.simulation.Simulator;
import com.sysmuse.geom.output.JSONExporter;
import java.io.File;

/**
 * Main application entry point for the Venn Diagram Generator.
 * 
 * This application generates and analyzes Venn diagrams with customizable parameters,
 * optimizing configurations to match desired region counts and area distributions.
 */
public class VennDiagramApplication {
    
    private static final String DEFAULT_TARGET_FILE = "src/main/resources/configurations/default_target.json";
    private static final String OUTPUT_BASE_DIR = "output";
    
    public static void main(String[] args) {
        try {
            System.out.println("Venn Diagram Generator - Starting Application");
            
            // Create output directories if they don't exist
            createOutputDirectories();
            
            // Initialize configuration loader
            ConfigurationLoader loader = new ConfigurationLoader();
            
            // Create default files if they don't exist
            createDefaultConfiguration(loader);
            
            // Load target criteria
            TargetCriteria target = loader.loadTargetFromJSON(DEFAULT_TARGET_FILE);
            System.out.println("Loaded target criteria: " + target.getTargetRegions() + 
                             " regions, mean area " + target.getTargetMeanArea());
            
            // Create and run simulator
            Simulator simulator = new Simulator(target);
            
            // Parse command line arguments for simulation size
            int iterations = parseIterations(args);
            System.out.println("Running simulation with " + iterations + " iterations...");
            
            // Run the simulation
            simulator.runSimulation(iterations);
            
            // Generate output files
            String timestamp = String.valueOf(System.currentTimeMillis());
            String resultsFile = OUTPUT_BASE_DIR + "/results/simulation_" + timestamp + ".json";
            String reportFile = OUTPUT_BASE_DIR + "/reports/analysis_" + timestamp + ".html";
            
            // Save results
            simulator.saveResultsToJSON(resultsFile);
            simulator.generateHTMLReport(reportFile);
            
            System.out.println("\nSimulation completed successfully!");
            System.out.println("Results saved to: " + resultsFile);
            System.out.println("HTML report: " + reportFile);
            
            // Print summary of best result
            if (simulator.hasBestResult()) {
                System.out.println("\nBest Configuration Summary:");
                System.out.println("- Fitness Score: " + 
                    String.format("%.2f", simulator.getBestFitnessScore()));
                System.out.println("- Regions: " + simulator.getBestMetrics().getTotalRegions());
                System.out.println("- Mean Area: " + 
                    String.format("%.1f", simulator.getBestMetrics().getMeanArea()));
            }
            
        } catch (Exception e) {
            System.err.println("Application error: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }
    
    /**
     * Parse command line arguments to determine number of iterations.
     */
    private static int parseIterations(String[] args) {
        if (args.length > 0) {
            try {
                return Integer.parseInt(args[0]);
            } catch (NumberFormatException e) {
                System.out.println("Invalid iteration count, using default: 1000");
            }
        }
        return 1000; // default
    }
    
    /**
     * Create necessary output directories.
     */
    private static void createOutputDirectories() {
        new File(OUTPUT_BASE_DIR + "/configurations").mkdirs();
        new File(OUTPUT_BASE_DIR + "/results").mkdirs();
        new File(OUTPUT_BASE_DIR + "/reports").mkdirs();
    }
    
    /**
     * Create default configuration files if they don't exist.
     */
    private static void createDefaultConfiguration(ConfigurationLoader loader) {
        try {
            // Create default target criteria if it doesn't exist
            File targetFile = new File(DEFAULT_TARGET_FILE);
            if (!targetFile.exists()) {
                TargetCriteria defaultTarget = new TargetCriteria(
                    150,    // Target number of regions
                    5,      // Target minimum area
                    100,    // Target maximum area
                    25,     // Target mean area
                    20      // Target median area
                );
                defaultTarget.setToleranceRegions(10);
                defaultTarget.setToleranceArea(5.0);
                
                targetFile.getParentFile().mkdirs();
                loader.saveTargetToJSON(defaultTarget, DEFAULT_TARGET_FILE);
                System.out.println("Created default target criteria file: " + DEFAULT_TARGET_FILE);
            }
            
            // Create sample configuration files
            createSampleConfigurations(loader);
            
        } catch (Exception e) {
            System.err.println("Warning: Could not create default configuration: " + e.getMessage());
        }
    }
    
    /**
     * Create sample configuration files for reference.
     */
    private static void createSampleConfigurations(ConfigurationLoader loader) throws Exception {
        // Sample 3-circle configuration
        String sample3File = "src/main/resources/configurations/sample_3_circles.json";
        File file3 = new File(sample3File);
        if (!file3.exists()) {
            Configuration config3 = Configuration.createDefault3Circle();
            file3.getParentFile().mkdirs();
            loader.saveConfigurationToJSON(config3, sample3File);
        }
        
        // Complex 4-circle configuration
        String complex4File = "src/main/resources/configurations/complex_4_circles.json";
        File file4 = new File(complex4File);
        if (!file4.exists()) {
            Configuration config4 = Configuration.createComplex4Circle();
            file4.getParentFile().mkdirs();
            loader.saveConfigurationToJSON(config4, complex4File);
        }
    }
}