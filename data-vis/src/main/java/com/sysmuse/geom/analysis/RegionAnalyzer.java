package com.sysmuse.geom.analysis;

import com.sysmuse.geom.configuration.Configuration;
import com.sysmuse.geom.configuration.VennCircleConfig;
import java.awt.geom.Point2D;
import java.util.*;

/**
 * Analyzes Venn diagram configurations to determine region boundaries and metrics.
 * 
 * This class generates a uniform grid of points and classifies each point based on
 * which circles it falls within, then calculates comprehensive statistics about
 * the resulting regions.
 */
public class RegionAnalyzer {
    
    private final Configuration configuration;
    private final List<GridPoint> gridPoints;
    private final int stepSize;
    
    /**
     * Create a new RegionAnalyzer for the given configuration.
     * 
     * @param configuration The Venn diagram configuration to analyze
     */
    public RegionAnalyzer(Configuration configuration) {
        this.configuration = configuration;
        this.stepSize = configuration.getDotSize() * 2 + configuration.getDotSpacing();
        this.gridPoints = new ArrayList<>();
        generateGrid();
    }
    
    /**
     * Generate a uniform grid of points across the canvas.
     */
    private void generateGrid() {
        int width = configuration.getCanvasWidth();
        int height = configuration.getCanvasHeight();
        
        for (int x = stepSize / 2; x < width; x += stepSize) {
            for (int y = stepSize / 2; y < height; y += stepSize) {
                gridPoints.add(new GridPoint(x, y));
            }
        }
    }
    
    /**
     * Analyze the configuration and return comprehensive region metrics.
     * 
     * @return RegionMetrics containing all statistical information
     */
    public RegionMetrics analyzeRegions() {
        // Classify each grid point
        for (GridPoint point : gridPoints) {
            classifyPoint(point);
        }
        
        // Count points in each unique region combination
        Map<String, Integer> regionCounts = new HashMap<>();
        for (GridPoint point : gridPoints) {
            String regionKey = point.getRegionKey();
            regionCounts.put(regionKey, regionCounts.getOrDefault(regionKey, 0) + 1);
        }
        
        return new RegionMetrics(regionCounts);
    }
    
    /**
     * Classify a single point based on which regions it belongs to.
     * 
     * @param point The GridPoint to classify
     */
    private void classifyPoint(GridPoint point) {
        double px = point.getX();
        double py = point.getY();
        
        // Check outer corpus circle
        Point2D.Double outerCenter = configuration.getOuterCenter();
        double outerDist = distance(px, py, outerCenter.x, outerCenter.y);
        
        if (outerDist <= configuration.getOuterRadius()) {
            point.addRegion("CORPUS");
            
            // Check outer concentric circles
            for (int i = 1; i <= configuration.getNumOuterConcentric(); i++) {
                double radius = configuration.getOuterRadius() * i / (configuration.getNumOuterConcentric() + 1.0);
                if (outerDist <= radius) {
                    point.addRegion("OUTER_ZONE_" + i);
                }
            }
        }
        
        // Check each venn circle
        List<VennCircleConfig> vennCircles = configuration.getVennCircles();
        for (int i = 0; i < vennCircles.size(); i++) {
            VennCircleConfig vennConfig = vennCircles.get(i);
            Point2D.Double center = vennConfig.getPosition();
            double dist = distance(px, py, center.x, center.y);
            
            if (dist <= vennConfig.getRadius()) {
                char setLabel = (char)('A' + i);
                point.addRegion("VENN_" + setLabel);
                
                // Check inner concentric circles for this venn circle
                for (int j = 1; j <= vennConfig.getNumConcentricCircles(); j++) {
                    double radius = vennConfig.getRadius() * j / (vennConfig.getNumConcentricCircles() + 1.0);
                    if (dist <= radius) {
                        point.addRegion("VENN_" + setLabel + "_ZONE_" + j);
                    }
                }
            }
        }
    }
    
    /**
     * Calculate Euclidean distance between two points.
     * 
     * @param x1 X coordinate of first point
     * @param y1 Y coordinate of first point
     * @param x2 X coordinate of second point
     * @param y2 Y coordinate of second point
     * @return Distance between the points
     */
    private double distance(double x1, double y1, double x2, double y2) {
        return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    }
    
    /**
     * Get specific region analysis for regions matching a pattern.
     * 
     * @param regionPattern Pattern to match (e.g., "VENN_A" for all regions containing Venn circle A)
     * @return Map of matching regions to their dot counts
     */
    public Map<String, Integer> getRegionsByPattern(String regionPattern) {
        RegionMetrics metrics = analyzeRegions();
        Map<String, Integer> filteredRegions = new HashMap<>();
        
        for (Map.Entry<String, Integer> entry : metrics.getAllRegionAreas().entrySet()) {
            if (entry.getKey().contains(regionPattern)) {
                filteredRegions.put(entry.getKey(), entry.getValue());
            }
        }
        
        return filteredRegions;
    }
    
    /**
     * Get intersection analysis between specific Venn circles.
     * 
     * @param circles Array of circle indices to check intersection for
     * @return Map of intersection regions to their dot counts
     */
    public Map<String, Integer> getIntersectionAnalysis(int... circles) {
        RegionMetrics metrics = analyzeRegions();
        Map<String, Integer> intersections = new HashMap<>();
        
        // Build pattern for the specific intersection
        Set<String> requiredCircles = new HashSet<>();
        for (int circleIndex : circles) {
            if (circleIndex < configuration.getNumVennCircles()) {
                char setLabel = (char)('A' + circleIndex);
                requiredCircles.add("VENN_" + setLabel);
            }
        }
        
        // Find regions that contain exactly these circles
        for (Map.Entry<String, Integer> entry : metrics.getAllRegionAreas().entrySet()) {
            String regionKey = entry.getKey();
            String[] regions = regionKey.split(",");
            
            boolean hasAllRequired = true;
            boolean hasOnlyRequired = true;
            
            for (String required : requiredCircles) {
                boolean found = false;
                for (String region : regions) {
                    if (region.startsWith(required)) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    hasAllRequired = false;
                    break;
                }
            }
            
            // Check if it has any other Venn circles
            for (String region : regions) {
                if (region.startsWith("VENN_") && !region.contains("_ZONE_")) {
                    String vennCircle = region.substring(0, 6); // "VENN_X"
                    if (!requiredCircles.contains(vennCircle)) {
                        hasOnlyRequired = false;
                        break;
                    }
                }
            }
            
            if (hasAllRequired && hasOnlyRequired) {
                intersections.put(regionKey, entry.getValue());
            }
        }
        
        return intersections;
    }
    
    /**
     * Get detailed analysis of a specific region.
     * 
     * @param regionKey Key identifying the region
     * @return Analysis details including area, constituent circles, and concentric zones
     */
    public RegionAnalysisDetail getRegionDetail(String regionKey) {
        RegionMetrics metrics = analyzeRegions();
        int area = metrics.getRegionArea(regionKey);
        
        // Parse the region key to identify components
        String[] regions = regionKey.split(",");
        Set<String> vennCircles = new HashSet<>();
        Set<String> concentricZones = new HashSet<>();
        boolean inCorpus = false;
        
        for (String region : regions) {
            if (region.equals("CORPUS")) {
                inCorpus = true;
            } else if (region.startsWith("VENN_") && !region.contains("_ZONE_")) {
                vennCircles.add(region);
            } else if (region.contains("_ZONE_")) {
                concentricZones.add(region);
            }
        }
        
        return new RegionAnalysisDetail(regionKey, area, vennCircles, concentricZones, inCorpus);
    }
    
    /**
     * Get the grid points for debugging or visualization purposes.
     * 
     * @return List of all grid points
     */
    public List<GridPoint> getGridPoints() {
        return new ArrayList<>(gridPoints);
    }
    
    /**
     * Get the step size used for the grid.
     * 
     * @return Step size in pixels
     */
    public int getStepSize() {
        return stepSize;
    }
    
    /**
     * Get the total number of grid points.
     * 
     * @return Total grid points
     */
    public int getTotalGridPoints() {
        return gridPoints.size();
    }
    
    /**
     * Detailed analysis of a specific region.
     */
    public static class RegionAnalysisDetail {
        private final String regionKey;
        private final int area;
        private final Set<String> vennCircles;
        private final Set<String> concentricZones;
        private final boolean inCorpus;
        
        public RegionAnalysisDetail(String regionKey, int area, Set<String> vennCircles, 
                                  Set<String> concentricZones, boolean inCorpus) {
            this.regionKey = regionKey;
            this.area = area;
            this.vennCircles = new HashSet<>(vennCircles);
            this.concentricZones = new HashSet<>(concentricZones);
            this.inCorpus = inCorpus;
        }
        
        public String getRegionKey() { return regionKey; }
        public int getArea() { return area; }
        public Set<String> getVennCircles() { return new HashSet<>(vennCircles); }
        public Set<String> getConcentricZones() { return new HashSet<>(concentricZones); }
        public boolean isInCorpus() { return inCorpus; }
        public int getVennCircleCount() { return vennCircles.size(); }
        public int getConcentricZoneCount() { return concentricZones.size(); }
        
        @Override
        public String toString() {
            return String.format("Region[%s, area=%d, venn=%d, zones=%d, inCorpus=%b]",
                    regionKey, area, vennCircles.size(), concentricZones.size(), inCorpus);
        }
    }
}