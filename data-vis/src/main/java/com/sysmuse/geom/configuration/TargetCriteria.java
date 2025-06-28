package com.sysmuse.geom.configuration;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.sysmuse.geom.analysis.RegionMetrics;

/**
 * Target criteria for optimization.
 * 
 * Defines the desired characteristics of the generated Venn diagram,
 * including target number of regions and area distribution statistics.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class TargetCriteria {
    
    @JsonProperty("targetRegions")
    private int targetRegions;
    
    @JsonProperty("targetMinArea")
    private double targetMinArea;
    
    @JsonProperty("targetMaxArea")
    private double targetMaxArea;
    
    @JsonProperty("targetMeanArea")
    private double targetMeanArea;
    
    @JsonProperty("targetMedianArea")
    private double targetMedianArea;
    
    @JsonProperty("toleranceRegions")
    private int toleranceRegions = 10;
    
    @JsonProperty("toleranceArea")
    private double toleranceArea = 5.0;
    
    /**
     * Default constructor for Jackson.
     */
    public TargetCriteria() {}
    
    /**
     * Constructor with all target values.
     */
    public TargetCriteria(int targetRegions, double targetMinArea, double targetMaxArea, 
                         double targetMeanArea, double targetMedianArea) {
        this.targetRegions = targetRegions;
        this.targetMinArea = targetMinArea;
        this.targetMaxArea = targetMaxArea;
        this.targetMeanArea = targetMeanArea;
        this.targetMedianArea = targetMedianArea;
    }
    
    /**
     * Check if the given metrics are close enough to the target criteria.
     */
    public boolean isCloseToTarget(RegionMetrics metrics) {
        return Math.abs(metrics.getTotalRegions() - targetRegions) <= toleranceRegions &&
               Math.abs(metrics.getMeanArea() - targetMeanArea) <= toleranceArea;
    }
    
    /**
     * Calculate how well the metrics match the target criteria.
     * Lower scores indicate better matches.
     */
    public double calculateFitness(RegionMetrics metrics) {
        double regionsDiff = Math.abs(metrics.getTotalRegions() - targetRegions);
        double minAreaDiff = Math.abs(metrics.getMinArea() - targetMinArea);
        double maxAreaDiff = Math.abs(metrics.getMaxArea() - targetMaxArea);
        double meanAreaDiff = Math.abs(metrics.getMeanArea() - targetMeanArea);
        double medianAreaDiff = Math.abs(metrics.getMedianArea() - targetMedianArea);
        
        // Weighted fitness score (lower is better)
        return regionsDiff * 2.0 +  // Regions are very important
               minAreaDiff * 0.1 +
               maxAreaDiff * 0.1 +
               meanAreaDiff * 0.5 +
               medianAreaDiff * 0.5;
    }
    
    // Getters and setters
    public int getTargetRegions() { return targetRegions; }
    public void setTargetRegions(int targetRegions) { this.targetRegions = targetRegions; }
    
    public double getTargetMinArea() { return targetMinArea; }
    public void setTargetMinArea(double targetMinArea) { this.targetMinArea = targetMinArea; }
    
    public double getTargetMaxArea() { return targetMaxArea; }
    public void setTargetMaxArea(double targetMaxArea) { this.targetMaxArea = targetMaxArea; }
    
    public double getTargetMeanArea() { return targetMeanArea; }
    public void setTargetMeanArea(double targetMeanArea) { this.targetMeanArea = targetMeanArea; }
    
    public double getTargetMedianArea() { return targetMedianArea; }
    public void setTargetMedianArea(double targetMedianArea) { this.targetMedianArea = targetMedianArea; }
    
    public int getToleranceRegions() { return toleranceRegions; }
    public void setToleranceRegions(int toleranceRegions) { this.toleranceRegions = toleranceRegions; }
    
    public double getToleranceArea() { return toleranceArea; }
    public void setToleranceArea(double toleranceArea) { this.toleranceArea = toleranceArea; }
    
    @Override
    public String toString() {
        return String.format("Target[regions=%d, meanArea=%.1f, tolerance=%d/%.1f]",
                targetRegions, targetMeanArea, toleranceRegions, toleranceArea);
    }
}