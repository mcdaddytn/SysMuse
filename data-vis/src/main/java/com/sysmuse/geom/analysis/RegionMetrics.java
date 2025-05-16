package com.sysmuse.geom.analysis;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.*;

/**
 * Statistical metrics about regions in a Venn diagram.
 * 
 * Contains information about the number of regions, their areas (dot counts),
 * and various statistical measures like mean, median, and standard deviation.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class RegionMetrics {
    
    @JsonProperty("totalRegions")
    private int totalRegions;
    
    @JsonProperty("regionAreas")
    private Map<String, Integer> regionAreas;
    
    @JsonProperty("minArea")
    private double minArea;
    
    @JsonProperty("maxArea")
    private double maxArea;
    
    @JsonProperty("meanArea")
    private double meanArea;
    
    @JsonProperty("medianArea")
    private double medianArea;
    
    @JsonProperty("areaStdDev")
    private double areaStdDev;
    
    @JsonProperty("totalDots")
    private int totalDots;
    
    /**
     * Default constructor for Jackson.
     */
    public RegionMetrics() {
        this.regionAreas = new HashMap<>();
    }
    
    /**
     * Create metrics from a map of region areas.
     * 
     * @param regionAreas Map of region names to dot counts
     */
    public RegionMetrics(Map<String, Integer> regionAreas) {
        this.regionAreas = new HashMap<>(regionAreas);
        this.totalRegions = regionAreas.size();
        this.totalDots = regionAreas.values().stream().mapToInt(Integer::intValue).sum();
        calculateStatistics();
    }
    
    /**
     * Calculate statistical measures from the region areas.
     */
    private void calculateStatistics() {
        if (regionAreas.isEmpty()) {
            minArea = maxArea = meanArea = medianArea = areaStdDev = 0;
            return;
        }
        
        List<Integer> areas = new ArrayList<>(regionAreas.values());
        areas.sort(Integer::compareTo);
        
        minArea = areas.get(0);
        maxArea = areas.get(areas.size() - 1);
        meanArea = areas.stream().mapToInt(Integer::intValue).average().orElse(0);
        
        // Calculate median
        medianArea = areas.size() % 2 == 0 ? 
            (areas.get(areas.size()/2 - 1) + areas.get(areas.size()/2)) / 2.0 :
            areas.get(areas.size()/2);
        
        // Calculate standard deviation
        double variance = areas.stream()
            .mapToDouble(area -> Math.pow(area - meanArea, 2))
            .average().orElse(0);
        areaStdDev = Math.sqrt(variance);
    }
    
    /**
     * Get the area of a specific region.
     * 
     * @param regionName Name of the region
     * @return Area (dot count) of the region, or 0 if not found
     */
    public int getRegionArea(String regionName) {
        return regionAreas.getOrDefault(regionName, 0);
    }
    
    /**
     * Get all regions with their areas.
     * 
     * @return Map of region names to areas
     */
    public Map<String, Integer> getAllRegionAreas() {
        return new HashMap<>(regionAreas);
    }
    
    /**
     * Get the top N regions by area.
     * 
     * @param n Number of top regions to return
     * @return List of region names sorted by area (descending)
     */
    public List<String> getTopRegions(int n) {
        return regionAreas.entrySet().stream()
            .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
            .limit(n)
            .map(Map.Entry::getKey)
            .collect(java.util.stream.Collectors.toList());
    }
    
    /**
     * Get regions with area within a specified range.
     * 
     * @param minArea Minimum area (inclusive)
     * @param maxArea Maximum area (inclusive)
     * @return List of region names within the area range
     */
    public List<String> getRegionsInAreaRange(int minArea, int maxArea) {
        return regionAreas.entrySet().stream()
            .filter(entry -> entry.getValue() >= minArea && entry.getValue() <= maxArea)
            .map(Map.Entry::getKey)
            .collect(java.util.stream.Collectors.toList());
    }
    
    /**
     * Calculate the coefficient of variation (stdDev / mean).
     * This measures the relative variability of region areas.
     * 
     * @return Coefficient of variation, or 0 if mean is 0
     */
    public double getCoefficientOfVariation() {
        return meanArea > 0 ? areaStdDev / meanArea : 0;
    }
    
    /**
     * Get the interquartile range (IQR) of region areas.
     * 
     * @return Array with [Q1, Q3] values
     */
    public double[] getInterquartileRange() {
        if (regionAreas.isEmpty()) {
            return new double[]{0, 0};
        }
        
        List<Integer> areas = new ArrayList<>(regionAreas.values());
        areas.sort(Integer::compareTo);
        
        int n = areas.size();
        int q1Index = n / 4;
        int q3Index = 3 * n / 4;
        
        double q1 = areas.get(q1Index);
        double q3 = areas.get(q3Index);
        
        return new double[]{q1, q3};
    }
    
    // Getters and setters
    public int getTotalRegions() { return totalRegions; }
    public void setTotalRegions(int totalRegions) { this.totalRegions = totalRegions; }
    
    public Map<String, Integer> getRegionAreas() { return regionAreas; }
    public void setRegionAreas(Map<String, Integer> regionAreas) { 
        this.regionAreas = regionAreas;
        calculateStatistics();
    }
    
    public double getMinArea() { return minArea; }
    public void setMinArea(double minArea) { this.minArea = minArea; }
    
    public double getMaxArea() { return maxArea; }
    public void setMaxArea(double maxArea) { this.maxArea = maxArea; }
    
    public double getMeanArea() { return meanArea; }
    public void setMeanArea(double meanArea) { this.meanArea = meanArea; }
    
    public double getMedianArea() { return medianArea; }
    public void setMedianArea(double medianArea) { this.medianArea = medianArea; }
    
    public double getAreaStdDev() { return areaStdDev; }
    public void setAreaStdDev(double areaStdDev) { this.areaStdDev = areaStdDev; }
    
    public int getTotalDots() { return totalDots; }
    public void setTotalDots(int totalDots) { this.totalDots = totalDots; }
    
    @Override
    public String toString() {
        return String.format("Regions: %d, Areas[min=%.1f, max=%.1f, mean=%.1f, median=%.1f, stdDev=%.1f], TotalDots: %d",
                totalRegions, minArea, maxArea, meanArea, medianArea, areaStdDev, totalDots);
    }
}