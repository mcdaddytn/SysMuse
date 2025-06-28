package com.sysmuse.geom.analysis;

import java.util.HashSet;
import java.util.Set;

/**
 * Represents a point in the grid with its coordinates and region memberships.
 * 
 * Each GridPoint tracks which regions it belongs to based on its position
 * relative to the various circles in the Venn diagram.
 */
public class GridPoint {
    
    private final int x;
    private final int y;
    private final Set<String> regions;
    
    /**
     * Create a new GridPoint at the specified coordinates.
     * 
     * @param x X coordinate of the point
     * @param y Y coordinate of the point
     */
    public GridPoint(int x, int y) {
        this.x = x;
        this.y = y;
        this.regions = new HashSet<>();
    }
    
    /**
     * Add a region to this point's membership.
     * 
     * @param region Name of the region to add
     */
    public void addRegion(String region) {
        regions.add(region);
    }
    
    /**
     * Remove a region from this point's membership.
     * 
     * @param region Name of the region to remove
     */
    public void removeRegion(String region) {
        regions.remove(region);
    }
    
    /**
     * Check if this point belongs to a specific region.
     * 
     * @param region Name of the region to check
     * @return true if the point belongs to the region
     */
    public boolean belongsToRegion(String region) {
        return regions.contains(region);
    }
    
    /**
     * Get a copy of all regions this point belongs to.
     * 
     * @return Set of region names
     */
    public Set<String> getRegions() {
        return new HashSet<>(regions);
    }
    
    /**
     * Clear all region memberships.
     */
    public void clearRegions() {
        regions.clear();
    }
    
    /**
     * Get the number of regions this point belongs to.
     * 
     * @return Number of regions
     */
    public int getRegionCount() {
        return regions.size();
    }
    
    /**
     * Get a string key representing the unique combination of regions.
     * This is used for grouping points that belong to the same set of regions.
     * 
     * @return Comma-separated, sorted list of region names
     */
    public String getRegionKey() {
        if (regions.isEmpty()) {
            return "OUTSIDE_ALL";
        }
        return String.join(",", regions.stream().sorted().toArray(String[]::new));
    }
    
    // Getters
    public int getX() { return x; }
    public int getY() { return y; }
    
    @Override
    public String toString() {
        return String.format("GridPoint[(%d,%d), regions=%s]", x, y, regions);
    }
    
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        
        GridPoint gridPoint = (GridPoint) o;
        return x == gridPoint.x && y == gridPoint.y;
    }
    
    @Override
    public int hashCode() {
        return 31 * x + y;
    }
}