//package com.sysmuse.geom.test;
package com.sysmuse.geom;

import com.sysmuse.geom.configuration.*;
import com.sysmuse.geom.analysis.*;
import com.sysmuse.geom.simulation.*;
import com.sysmuse.geom.output.*;
import java.io.File;

/**
 * Comprehensive test suite for the Venn Diagram Generator system.
 */
public class IntegrationTest {

    // Create output directory for test files
    private static final String TEST_OUTPUT_DIR = "test-output";

    public static void main(String[] args) {
        System.out.println("=== Venn Diagram Generator Integration Test ===\n");

        try {
            // Create test output directory
            setupTestEnvironment();

            // Test 1: Configuration Management
            testConfigurationManagement();

            // Test 2: Region Analysis
            testRegionAnalysis();

            // Test 3: Simulation
            testSimulation();

            // Test 4: Output Generation
            testOutputGeneration();

            System.out.println("All tests completed successfully!");
            System.out.println("Test files created in: " + TEST_OUTPUT_DIR);

        } catch (Exception e) {
            System.err.println("Test failed: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static void setupTestEnvironment() {
        File outputDir = new File(TEST_OUTPUT_DIR);
        if (!outputDir.exists()) {
            outputDir.mkdirs();
        }
        System.out.println("Created test output directory: " + TEST_OUTPUT_DIR);
    }

    private static void testConfigurationManagement() throws Exception {
        System.out.println("Test 1: Configuration Management");

        // Create a test configuration
        Configuration config = Configuration.createDefault3Circle();
        System.out.println("  Created default 3-circle configuration");

        // Test JSON serialization with proper path
        ConfigurationLoader loader = new ConfigurationLoader();
        String configPath = TEST_OUTPUT_DIR + "/test_config.json";
        loader.saveConfigurationToJSON(config, configPath);
        Configuration loadedConfig = loader.loadFromJSON(configPath);
        System.out.println("  JSON serialization/deserialization works");

        // Verify configuration
        assert loadedConfig.getNumVennCircles() == 3;
        System.out.println("  Configuration validation passed");

        System.out.println("  Configuration: " + config + "\n");
    }

    private static void testRegionAnalysis() throws Exception {
        System.out.println("Test 2: Region Analysis");

        // Create a simple configuration for testing
        Configuration config = new Configuration(2, 4, 3, 150, 280, 2, 1, 800, 600);

        // Analyze regions
        RegionAnalyzer analyzer = new RegionAnalyzer(config);
        RegionMetrics metrics = analyzer.analyzeRegions();

        System.out.println("  Region analysis completed");
        System.out.println("  Total regions: " + metrics.getTotalRegions());
        System.out.println("  Total dots: " + metrics.getTotalDots());
        System.out.println("  Mean area: " + String.format("%.1f", metrics.getMeanArea()));
        System.out.println("  Min/Max area: " + String.format("%.1f/%.1f", metrics.getMinArea(), metrics.getMaxArea()));

        // Test detailed analysis
        var detail = analyzer.getRegionDetail("CORPUS,VENN_A");
        if (detail != null) {
            System.out.println("  Region detail analysis works");
        }

        System.out.println();
    }

    private static void testSimulation() throws Exception {
        System.out.println("Test 3: Simulation");

        // Create target criteria
        TargetCriteria target = new TargetCriteria(50, 3, 30, 10, 8);
        target.setToleranceRegions(5);
        target.setToleranceArea(2.0);

        // Run a small simulation
        Simulator simulator = new Simulator(target);
        System.out.println("  Running simulation with 100 iterations...");
        simulator.runSimulation(100);

        System.out.println("  Simulation completed");
        System.out.println("  Best fitness score: " +
                String.format("%.2f", simulator.getBestFitnessScore()));
        System.out.println("  Best regions: " +
                simulator.getBestMetrics().getTotalRegions());

        // Save simulation results to test directory
        String resultsPath = TEST_OUTPUT_DIR + "/test_simulation_results.json";
        simulator.saveResultsToJSON(resultsPath);
        System.out.println("  Simulation results saved to " + resultsPath);

        System.out.println();
    }

    private static void testOutputGeneration() throws Exception {
        System.out.println("Test 4: Output Generation");

        // Create test data
        Configuration config = Configuration.createDefault3Circle();
        RegionAnalyzer analyzer = new RegionAnalyzer(config);
        RegionMetrics metrics = analyzer.analyzeRegions();

        // Test SVG generation
        SVGGenerator svgGen = new SVGGenerator();
        String svg = svgGen.generateSVG(config);
        assert svg.contains("<svg");
        System.out.println("  SVG generation works");

        // Test JSON export
        JSONExporter jsonExporter = new JSONExporter();
        java.util.Map<String, Object> testData = new java.util.HashMap<>();
        testData.put("configuration", config);
        testData.put("metrics", metrics);
        String jsonPath = TEST_OUTPUT_DIR + "/test_output.json";
        jsonExporter.exportToFile(testData, jsonPath);
        System.out.println("  JSON export works");

        // Test HTML report (simplified)
        HTMLReportGenerator htmlGen = new HTMLReportGenerator();
        java.util.Map<String, Object> reportData = new java.util.HashMap<>();
        reportData.put("bestConfiguration", config);
        reportData.put("targetCriteria", new TargetCriteria(100, 5, 50, 20, 15));
        reportData.put("bestResults", java.util.List.of(
                new SimulationResult(config, metrics, 10.5, 1, "test")
        ));
        String htmlPath = TEST_OUTPUT_DIR + "/test_report.html";
        htmlGen.generateReport(reportData, htmlPath);
        System.out.println("  HTML report generation works");

        // Save SVG for inspection
        try (java.io.FileWriter writer = new java.io.FileWriter(TEST_OUTPUT_DIR + "/test_diagram.svg")) {
            writer.write(svg);
        }
        System.out.println("  SVG saved for inspection");

        System.out.println();
    }
}