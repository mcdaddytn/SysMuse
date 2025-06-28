package com.sysmuse.geom.simulation;

import com.sysmuse.geom.configuration.Configuration;
import com.sysmuse.geom.configuration.VennCircleConfig;
import com.sysmuse.geom.configuration.ConfigurationLoader;
import java.awt.geom.Point2D;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Handles convergent optimization by refining promising configurations.
 * 
 * This class takes good configurations found during exploration and creates
 * variations by making small adjustments to their parameters, allowing
 * the simulation to converge towards optimal solutions.
 */
public class ConvergentOptimizer {
    
    private final Random random;
    private final ConfigurationLoader loader;
    
    public ConvergentOptimizer() {
        this.random = new Random();
        this.loader = new ConfigurationLoader();
    }
    
    public ConvergentOptimizer(long seed) {
        this.random = new Random(seed);
        this.loader = new ConfigurationLoader();
    }
    
    /**
     * Refine a configuration by making small random adjustments.
     * 
     * @param seed The base configuration to refine
     * @return A new configuration with small variations
     * @throws Exception If configuration copying fails
     */
    public Configuration refineConfiguration(Configuration seed) throws Exception {
        Configuration refined = loader.copyConfiguration(seed);
        
        // Randomly vary some parameters slightly
        refineBasicParameters(refined);
        refineVennCircles(refined);
        refineStructure(refined);
        
        // Recalculate positions after modifications
        refined.calculateVennPositions();
        return refined;
    }
    
    /**
     * Refine basic diagram parameters (dots, spacing, outer circle).
     */
    private void refineBasicParameters(Configuration config) {
        // Dot size variation (±1)
        if (random.nextDouble() < 0.3) {
            int newSize = Math.max(1, config.getDotSize() + random.nextInt(3) - 1);
            config.setDotSize(newSize);
        }
        
        // Dot spacing variation (±dotSize)
        if (random.nextDouble() < 0.3) {
            int change = random.nextInt(config.getDotSize() * 2) - config.getDotSize();
            int newSpacing = Math.max(config.getDotSize(), config.getDotSpacing() + change);
            config.setDotSpacing(newSpacing);
        }
        
        // Outer radius variation (±20)
        if (random.nextDouble() < 0.2) {
            int change = random.nextInt(41) - 20;
            int newRadius = Math.max(100, config.getOuterRadius() + change);
            config.setOuterRadius(newRadius);
        }
        
        // Outer concentric circles variation (±1)
        if (random.nextDouble() < 0.2) {
            int newCount = Math.max(0, config.getNumOuterConcentric() + random.nextInt(3) - 1);
            config.setNumOuterConcentric(newCount);
        }
    }
    
    /**
     * Refine individual Venn circle properties.
     */
    private void refineVennCircles(Configuration config) {
        List<VennCircleConfig> vennCircles = config.getVennCircles();
        
        for (VennCircleConfig venn : vennCircles) {
            // Radius variation (±20)
            if (random.nextDouble() < 0.25) {
                int change = random.nextInt(41) - 20;
                int newRadius = Math.max(30, venn.getRadius() + change);
                venn.setRadius(newRadius);
            }
            
            // Concentric circles variation (±1)
            if (random.nextDouble() < 0.25) {
                int newCount = Math.max(0, venn.getNumConcentricCircles() + random.nextInt(3) - 1);
                venn.setNumConcentricCircles(newCount);
            }
        }
    }
    
    /**
     * Refine structural aspects (add/remove circles).
     */
    private void refineStructure(Configuration config) {
        List<VennCircleConfig> vennCircles = config.getVennCircles();
        
        // Small chance to add or remove a Venn circle
        if (random.nextDouble() < 0.1) {
            if (vennCircles.size() > 1 && random.nextBoolean()) {
                // Remove a circle
                int removeIndex = random.nextInt(vennCircles.size());
                vennCircles.remove(removeIndex);
            } else if (vennCircles.size() < 6) {
                // Add a circle
                int avgRadius = (int) vennCircles.stream()
                    .mapToInt(VennCircleConfig::getRadius)
                    .average().orElse(150);
                int variation = random.nextInt(61) - 30; // ±30
                int newRadius = Math.max(50, avgRadius + variation);
                
                int avgConcentric = (int) vennCircles.stream()
                    .mapToInt(VennCircleConfig::getNumConcentricCircles)
                    .average().orElse(2);
                int newConcentric = Math.max(0, avgConcentric + random.nextInt(3) - 1);
                
                vennCircles.add(new VennCircleConfig(newRadius, newConcentric));
            }
        }
    }
    
    /**
     * Create multiple refinement variations of a configuration.
     * 
     * @param seed The base configuration
     * @param count Number of variations to create
     * @return List of refined configurations
     * @throws Exception If configuration copying fails
     */
    public List<Configuration> createRefinementVariations(Configuration seed, int count) throws Exception {
        List<Configuration> variations = new ArrayList<>();
        
        for (int i = 0; i < count; i++) {
            Configuration refined = refineConfiguration(seed);
            variations.add(refined);
        }
        
        return variations;
    }
    
    /**
     * Perform focused refinement on a specific aspect of the configuration.
     * 
     * @param seed The base configuration
     * @param aspect The aspect to focus on ("dots", "venn", "outer", "structure")
     * @return Refined configuration with focused changes
     * @throws Exception If configuration copying fails
     */
    public Configuration refineFocused(Configuration seed, String aspect) throws Exception {
        Configuration refined = loader.copyConfiguration(seed);
        
        switch (aspect.toLowerCase()) {
            case "dots":
                refineDotParameters(refined);
                break;
            case "venn":
                refineVennCircles(refined);
                break;
            case "outer":
                refineOuterParameters(refined);
                break;
            case "structure":
                refineStructure(refined);
                break;
            default:
                // Perform general refinement
                refineConfiguration(seed);
        }
        
        refined.calculateVennPositions();
        return refined;
    }
    
    /**
     * Refine only dot-related parameters.
     */
    private void refineDotParameters(Configuration config) {
        // More aggressive changes since we're focusing on this aspect
        int newSize = Math.max(1, config.getDotSize() + random.nextInt(3) - 1);
        config.setDotSize(newSize);
        
        int change = random.nextInt(newSize * 4) - newSize * 2;
        int newSpacing = Math.max(newSize, config.getDotSpacing() + change);
        config.setDotSpacing(newSpacing);
    }
    
    /**
     * Refine only outer circle parameters.
     */
    private void refineOuterParameters(Configuration config) {
        // More aggressive changes for outer parameters
        int radiusChange = random.nextInt(81) - 40; // ±40
        int newRadius = Math.max(100, config.getOuterRadius() + radiusChange);
        config.setOuterRadius(newRadius);
        
        int concentricChange = random.nextInt(5) - 2; // ±2
        int newConcentric = Math.max(0, config.getNumOuterConcentric() + concentricChange);
        config.setNumOuterConcentric(newConcentric);
    }
    
    /**
     * Perform interpolation between two configurations.
     * Creates a new configuration that's a blend of the two inputs.
     * 
     * @param config1 First configuration
     * @param config2 Second configuration
     * @param ratio Interpolation ratio (0.0 = all config1, 1.0 = all config2)
     * @return Interpolated configuration
     * @throws Exception If configuration copying fails
     */
    public Configuration interpolateConfigurations(Configuration config1, Configuration config2, double ratio) throws Exception {
        Configuration result = loader.copyConfiguration(config1);
        
        // Interpolate basic parameters
        result.setDotSize(interpolate(config1.getDotSize(), config2.getDotSize(), ratio));
        result.setDotSpacing(interpolate(config1.getDotSpacing(), config2.getDotSpacing(), ratio));
        result.setOuterRadius(interpolate(config1.getOuterRadius(), config2.getOuterRadius(), ratio));
        result.setNumOuterConcentric(interpolate(config1.getNumOuterConcentric(), config2.getNumOuterConcentric(), ratio));
        
        // Handle Venn circles (use the configuration with more circles)
        List<VennCircleConfig> vennCircles1 = config1.getVennCircles();
        List<VennCircleConfig> vennCircles2 = config2.getVennCircles();
        List<VennCircleConfig> resultVenn = new ArrayList<>();
        
        int maxCircles = Math.max(vennCircles1.size(), vennCircles2.size());
        for (int i = 0; i < maxCircles; i++) {
            VennCircleConfig venn1 = i < vennCircles1.size() ? vennCircles1.get(i) : vennCircles1.get(0);
            VennCircleConfig venn2 = i < vennCircles2.size() ? vennCircles2.get(i) : vennCircles2.get(0);
            
            int radius = interpolate(venn1.getRadius(), venn2.getRadius(), ratio);
            int concentric = interpolate(venn1.getNumConcentricCircles(), venn2.getNumConcentricCircles(), ratio);
            
            resultVenn.add(new VennCircleConfig(radius, concentric));
        }
        
        result.setVennCircles(resultVenn);
        result.calculateVennPositions();
        return result;
    }
    
    /**
     * Interpolate between two integer values.
     */
    private int interpolate(int value1, int value2, double ratio) {
        return (int) Math.round(value1 * (1 - ratio) + value2 * ratio);
    }
    
    /**
     * Create a configuration that combines the best aspects of multiple configurations.
     * 
     * @param configurations List of configurations to combine
     * @return New configuration combining best aspects
     * @throws Exception If configuration operations fail
     */
    public Configuration createHybrid(List<Configuration> configurations) throws Exception {
        if (configurations.isEmpty()) {
            throw new IllegalArgumentException("Cannot create hybrid from empty list");
        }
        
        if (configurations.size() == 1) {
            return loader.copyConfiguration(configurations.get(0));
        }
        
        // Use first configuration as base
        Configuration hybrid = loader.copyConfiguration(configurations.get(0));
        
        // Extract best parameters from all configurations
        int bestDotSize = configurations.stream().mapToInt(Configuration::getDotSize).min().orElse(2);
        int avgSpacing = (int) configurations.stream().mapToInt(Configuration::getDotSpacing).average().orElse(4);
        int avgOuterRadius = (int) configurations.stream().mapToInt(Configuration::getOuterRadius).average().orElse(280);
        int avgOuterConcentric = (int) configurations.stream().mapToInt(Configuration::getNumOuterConcentric).average().orElse(3);
        
        hybrid.setDotSize(bestDotSize);
        hybrid.setDotSpacing(avgSpacing);
        hybrid.setOuterRadius(avgOuterRadius);
        hybrid.setNumOuterConcentric(avgOuterConcentric);
        
        // For Venn circles, take the median configuration size and average properties
        int medianVennCount = configurations.stream()
            .mapToInt(Configuration::getNumVennCircles)
            .sorted()
            .skip(configurations.size() / 2)
            .findFirst()
            .orElse(3);
        
        List<VennCircleConfig> hybridVenn = new ArrayList<>();
        for (int i = 0; i < medianVennCount; i++) {
            final int index = i;
            int avgRadius = (int) configurations.stream()
                .filter(c -> c.getVennCircles().size() > index)
                .mapToInt(c -> c.getVennCircles().get(index).getRadius())
                .average()
                .orElse(150);
            
            int avgConcentric = (int) configurations.stream()
                .filter(c -> c.getVennCircles().size() > index)
                .mapToInt(c -> c.getVennCircles().get(index).getNumConcentricCircles())
                .average()
                .orElse(2);
            
            hybridVenn.add(new VennCircleConfig(avgRadius, avgConcentric));
        }
        
        hybrid.setVennCircles(hybridVenn);
        hybrid.calculateVennPositions();
        return hybrid;
    }
}