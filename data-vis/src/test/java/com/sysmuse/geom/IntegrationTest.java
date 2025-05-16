//package com.sysmuse.geom.test;
package com.sysmuse.geom.test;

import com.sysmuse.geom.configuration.*;
import com.sysmuse.geom.analysis.*;
import com.sysmuse.geom.simulation.*;
import com.sysmuse.geom.output.*;

/**
 * Comprehensive test suite for the Venn Diagram Generator system.
 */
public class IntegrationTest {

    public static void main(String[] args) {
        System.out.println("=== Venn Diagram Generator Integration Test ===\n");

        try {
            // Test 1: Configuration Management
            testConfigurationManagement();

            // Test 2: Region Analysis
            testRegionAnalysis();

            // Test 3: Simulation
            testSimulation();

            // Test 4: Output Generation
            testOutputGeneration();

            System.out.println("All tests completed successfully!");

        } catch (Exception e) {
            System.err.println("Test failed: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static void testConfigurationManagement() throws Exception {
        System.out.println("Test 1: Configuration Management");

        // Create a test configuration
        Configuration config = Configuration.createDefault3Circle();
        System.out.println("Created default 3-circle configuration");

        // Test JSON serialization
        ConfigurationLoader loader = new ConfigurationLoader();
        loader.saveConfigurationToJSON(config, "test_config.json");
        Configuration loadedConfig = loader.loadFromJSON("test_config.json");
        System.out.println("JSON serialization/deserialization works");

        // Verify configuration
        assert loadedConfig.getNumVennCircles() == 3;
        System.out.println("Configuration validation passed");

        System.out.println("Configuration: " + config + "\n");
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
        jsonExporter.exportToFile(testData, "test_output.json");
        System.out.println("  JSON export works");

        // Test HTML report (simplified)
        HTMLReportGenerator htmlGen = new HTMLReportGenerator();
        java.util.Map<String, Object> reportData = new java.util.HashMap<>();
        reportData.put("bestConfiguration", config);
        reportData.put("targetCriteria", new TargetCriteria(100, 5, 50, 20, 15));
        reportData.put("bestResults", java.util.List.of(
            new SimulationResult(config, metrics, 10.5, 1, "test")
        ));
        htmlGen.generateReport(reportData, "test_report.html");
        System.out.println("  HTML report generation works");

        System.out.println();
    }
}