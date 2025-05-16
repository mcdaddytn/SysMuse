package com.sysmuse.geom.simulation;

import com.sysmuse.geom.configuration.Configuration;
import com.sysmuse.geom.configuration.TargetCriteria;
import com.sysmuse.geom.configuration.VennCircleConfig;
import com.sysmuse.geom.analysis.RegionAnalyzer;
import com.sysmuse.geom.analysis.RegionMetrics;
import com.sysmuse.geom.output.JSONExporter;
import com.sysmuse.geom.output.HTMLReportGenerator;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Main simulation engine that runs optimization to find configurations
 * matching target criteria.
 * 
 * Uses a two-phase approach: exploration for broad search, then convergent
 * refinement around promising configurations.
 */
public class Simulator {
    
    private final TargetCriteria targetCriteria;
    private final List<SimulationResult> allResults;
    private final List<SimulationResult> bestResults;
    private final Random random;
    private final ConvergentOptimizer optimizer;
    private final JSONExporter jsonExporter;
    private final HTMLReportGenerator htmlGenerator;
    
    // Progress tracking
    private int totalIterations;
    private int currentIteration;
    private String currentPhase;
    private int explorationIterations;
    
    /**
     * Create a new Simulator with the specified target criteria.
     * 
     * @param targetCriteria The criteria to optimize towards
     */
    public Simulator(TargetCriteria targetCriteria) {
        this.targetCriteria = targetCriteria;
        this.allResults = new ArrayList<>();
        this.bestResults = new ArrayList<>();
        this.random = new Random();
        this.optimizer = new ConvergentOptimizer();
        this.jsonExporter = new JSONExporter();
        this.htmlGenerator = new HTMLReportGenerator();
        this.currentPhase = "initialization";
    }
    
    /**
     * Run the complete simulation with the specified number of iterations.
     * 
     * @param iterations Total number of iterations to run
     */
    public void runSimulation(int iterations) {
        this.totalIterations = iterations;
        this.currentIteration = 0;
        
        System.out.println("Starting simulation with " + iterations + " iterations...");
        System.out.println("Target: " + targetCriteria);
        
        // Phase 1: Broad exploration (50% of iterations)
        this.explorationIterations = iterations / 2;
        runExplorationPhase(explorationIterations);
        
        // Phase 2: Convergent refinement (50% of iterations)
        int refinementIterations = iterations - explorationIterations;
        runRefinementPhase(refinementIterations);
        
        // Final sorting and analysis
        finalizeResults();
        
        System.out.println("Simulation completed!");
        if (!bestResults.isEmpty()) {
            System.out.println("Best fitness score: " + String.format("%.2f", bestResults.get(0).getFitnessScore()));
            System.out.println("Best configuration: " + bestResults.get(0).getConfiguration());
        }
    }
    
    /**
     * Run the exploration phase - broad random search.
     */
    private void runExplorationPhase(int iterations) {
        this.currentPhase = "exploration";
        System.out.println("Phase 1: Exploration (" + iterations + " iterations)");
        
        for (int i = 0; i < iterations; i++) {
            this.currentIteration = i;
            
            if (i % 100 == 0) {
                System.out.println("Exploration progress: " + i + "/" + iterations + 
                    " (Best so far: " + (bestResults.isEmpty() ? "N/A" : String.format("%.2f", bestResults.get(0).getFitnessScore())) + ")");
            }
            
            Configuration config = generateRandomConfiguration();
            evaluateConfiguration(config, i, "exploration");
        }
        
        System.out.println("Exploration phase completed. Found " + 
            allResults.stream().filter(r -> targetCriteria.isCloseToTarget(r.getMetrics())).count() + 
            " configurations close to target.");
    }
    
    /**
     * Run the refinement phase - convergent optimization around good solutions.
     */
    private void runRefinementPhase(int iterations) {
        this.currentPhase = "refinement";
        System.out.println("Phase 2: Refinement (" + iterations + " iterations)");
        
        // Find configurations close to target for seeding refinement
        List<Configuration> seedConfigurations = findSeedConfigurations();
        
        for (int i = 0; i < iterations; i++) {
            this.currentIteration = explorationIterations + i;
            
            if (i % 100 == 0) {
                System.out.println("Refinement progress: " + i + "/" + iterations + 
                    " (Best so far: " + String.format("%.2f", bestResults.get(0).getFitnessScore()) + ")");
            }
            
            Configuration config;
            if (!seedConfigurations.isEmpty() && random.nextDouble() < 0.7) {
                // 70% chance to refine existing good configuration
                Configuration seed = seedConfigurations.get(random.nextInt(seedConfigurations.size()));
                try {
                    config = optimizer.refineConfiguration(seed);
                } catch (Exception e) {
                    // Fall back to random generation if refinement fails
                    config = generateRandomConfiguration();
                }
            } else {
                // 30% chance for random exploration
                config = generateRandomConfiguration();
            }
            
            evaluateConfiguration(config, explorationIterations + i, "refinement");
        }
        
        System.out.println("Refinement phase completed.");
    }
    
    /**
     * Find configurations that are close to the target criteria for seeding refinement.
     */
    private List<Configuration> findSeedConfigurations() {
        List<Configuration> seeds = new ArrayList<>();
        
        // First try to find configurations actually close to target
        for (SimulationResult result : allResults) {
            if (targetCriteria.isCloseToTarget(result.getMetrics())) {
                seeds.add(result.getConfiguration());
            }
        }
        
        // If no close configurations found, use the best ones
        if (seeds.isEmpty()) {
            seeds = bestResults.stream()
                .limit(5)
                .map(SimulationResult::getConfiguration)
                .collect(Collectors.toList());
        }
        
        // Also add some hybrid configurations
        if (seeds.size() >= 2) {
            try {
                // Create a few hybrid configurations
                for (int i = 0; i < Math.min(3, seeds.size() - 1); i++) {
                    Configuration hybrid = optimizer.createHybrid(
                        seeds.subList(i, Math.min(i + 3, seeds.size()))
                    );
                    seeds.add(hybrid);
                }
            } catch (Exception e) {
                System.out.println("Warning: Could not create hybrid configurations: " + e.getMessage());
            }
        }
        
        System.out.println("Found " + seeds.size() + " seed configurations for refinement");
        return seeds;
    }
    
    /**
     * Generate a random configuration for exploration.
     */
    private Configuration generateRandomConfiguration() {
        int dotSize = 1 + random.nextInt(4);  // 1-4
        int dotSpacing = dotSize + random.nextInt(dotSize * 3);  // dotSize to dotSize*4
        int numVennCircles = 1 + random.nextInt(5);  // 1-5 circles
        int outerRadius = 150 + random.nextInt(200);  // 150-350
        int numOuterConcentric = random.nextInt(5);  // 0-4
        int canvasWidth = 800;
        int canvasHeight = 600;
        
        Configuration config = new Configuration();
        config.setDotSize(dotSize);
        config.setDotSpacing(dotSpacing);
        config.setOuterRadius(outerRadius);
        config.setNumOuterConcentric(numOuterConcentric);
        config.setCanvasWidth(canvasWidth);
        config.setCanvasHeight(canvasHeight);
        config.setOuterCenter(new java.awt.geom.Point2D.Double(canvasWidth/2.0, canvasHeight/2.0));
        
        // Create venn circles with individual configurations
        List<VennCircleConfig> vennCircles = new ArrayList<>();
        for (int i = 0; i < numVennCircles; i++) {
            int vennRadius = 50 + random.nextInt(150);  // 50-200
            int numInnerConcentric = random.nextInt(4);  // 0-3
            vennCircles.add(new VennCircleConfig(vennRadius, numInnerConcentric));
        }
        
        config.setVennCircles(vennCircles);
        config.calculateVennPositions();
        return config;
    }
    
    /**
     * Evaluate a configuration and add it to results.
     */
    private void evaluateConfiguration(Configuration config, int iteration, String phase) {
        try {
            RegionAnalyzer analyzer = new RegionAnalyzer(config);
            RegionMetrics metrics = analyzer.analyzeRegions();
            double fitnessScore = targetCriteria.calculateFitness(metrics);
            
            SimulationResult result = new SimulationResult(config, metrics, fitnessScore, iteration, phase);
            allResults.add(result);
            addToBestResults(result);
            
        } catch (Exception e) {
            System.err.println("Error evaluating configuration at iteration " + iteration + ": " + e.getMessage());
        }
    }
    
    /**
     * Add a result to the best results list, maintaining sorted order and size limit.
     */
    private void addToBestResults(SimulationResult result) {
        bestResults.add(result);
        bestResults.sort(Comparator.comparing(SimulationResult::getFitnessScore));
        
        // Keep only top 10 results
        if (bestResults.size() > 10) {
            bestResults.subList(10, bestResults.size()).clear();
        }
    }
    
    /**
     * Finalize results by performing final sorting and analysis.
     */
    private void finalizeResults() {
        // Sort all results by fitness score
        allResults.sort(Comparator.comparing(SimulationResult::getFitnessScore));
        
        // Print summary statistics
        System.out.println("\nSimulation Summary:");
        System.out.println("Total configurations tested: " + allResults.size());
        System.out.println("Configurations close to target: " + 
            allResults.stream().filter(r -> targetCriteria.isCloseToTarget(r.getMetrics())).count());
        
        if (!allResults.isEmpty()) {
            DoubleSummaryStatistics fitnessStats = allResults.stream()
                .mapToDouble(SimulationResult::getFitnessScore)
                .summaryStatistics();
            
            System.out.println("Fitness score range: " + 
                String.format("%.2f - %.2f (avg: %.2f)", 
                    fitnessStats.getMin(), fitnessStats.getMax(), fitnessStats.getAverage()));
        }
    }
    
    /**
     * Save all simulation results to a JSON file.
     */
    public void saveResultsToJSON(String filename) throws Exception {
        Map<String, Object> output = new HashMap<>();
        output.put("targetCriteria", targetCriteria);
        output.put("totalIterations", totalIterations);
        output.put("totalConfigurations", allResults.size());
        output.put("bestResults", bestResults);
        output.put("allResults", allResults);
        
        // Add summary statistics
        Map<String, Object> summary = createSummaryStatistics();
        output.put("summary", summary);
        
        jsonExporter.exportToFile(output, filename);
        System.out.println("Results saved to JSON: " + filename);
    }
    
    /**
     * Generate an HTML report with visualization of the best configuration.
     */
    public void generateHTMLReport(String filename) throws Exception {
        if (bestResults.isEmpty()) {
            throw new IllegalStateException("No results available for report generation");
        }
        
        Map<String, Object> reportData = new HashMap<>();
        reportData.put("targetCriteria", targetCriteria);
        reportData.put("bestResults", bestResults);
        reportData.put("summary", createSummaryStatistics());
        reportData.put("bestConfiguration", bestResults.get(0).getConfiguration());
        
        htmlGenerator.generateReport(reportData, filename);
        System.out.println("HTML report generated: " + filename);
    }
    
    /**
     * Create summary statistics for the simulation.
     */
    private Map<String, Object> createSummaryStatistics() {
        Map<String, Object> summary = new HashMap<>();
        
        if (allResults.isEmpty()) {
            return summary;
        }
        
        // Fitness score statistics
        DoubleSummaryStatistics fitnessStats = allResults.stream()
            .mapToDouble(SimulationResult::getFitnessScore)
            .summaryStatistics();
        
        summary.put("fitnessScore", Map.of(
            "min", fitnessStats.getMin(),
            "max", fitnessStats.getMax(),
            "average", fitnessStats.getAverage(),
            "count", fitnessStats.getCount()
        ));
        
        // Region count statistics
        IntSummaryStatistics regionStats = allResults.stream()
            .mapToInt(r -> r.getMetrics().getTotalRegions())
            .summaryStatistics();
        
        summary.put("regionCount", Map.of(
            "min", regionStats.getMin(),
            "max", regionStats.getMax(),
            "average", regionStats.getAverage()
        ));
        
        // Phase breakdown
        Map<String, Long> phaseBreakdown = allResults.stream()
            .collect(Collectors.groupingBy(
                r -> r.getPhase() != null ? r.getPhase() : "unknown",
                Collectors.counting()
            ));
        summary.put("phaseBreakdown", phaseBreakdown);
        
        // Close to target count
        long closeToTarget = allResults.stream()
            .filter(r -> targetCriteria.isCloseToTarget(r.getMetrics()))
            .count();
        summary.put("closeToTargetCount", closeToTarget);
        
        return summary;
    }
    
    // Getters for accessing results
    public List<SimulationResult> getAllResults() {
        return new ArrayList<>(allResults);
    }
    
    public List<SimulationResult> getBestResults() {
        return new ArrayList<>(bestResults);
    }
    
    public boolean hasBestResult() {
        return !bestResults.isEmpty();
    }
    
    public SimulationResult getBestResult() {
        return bestResults.isEmpty() ? null : bestResults.get(0);
    }
    
    public double getBestFitnessScore() {
        return bestResults.isEmpty() ? Double.MAX_VALUE : bestResults.get(0).getFitnessScore();
    }
    
    public RegionMetrics getBestMetrics() {
        return bestResults.isEmpty() ? null : bestResults.get(0).getMetrics();
    }
    
    public String getCurrentPhase() {
        return currentPhase;
    }
    
    public int getCurrentIteration() {
        return currentIteration;
    }
    
    public int getTotalIterations() {
        return totalIterations;
    }
    
    public double getProgress() {
        return totalIterations > 0 ? (double) currentIteration / totalIterations : 0.0;
    }
}