package com.sysmuse.geom.configuration;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.awt.geom.Point2D;

/**
 * Configuration for individual Venn circles.
 * 
 * Each Venn circle can have its own radius and number of concentric circles,
 * allowing for asymmetric diagram designs.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class VennCircleConfig {
    
    @JsonProperty("radius")
    private int radius;
    
    @JsonProperty("numConcentricCircles")
    private int numConcentricCircles;
    
    @JsonProperty("position")
    private Point2D.Double position;
    
    /**
     * Default constructor for Jackson.
     */
    public VennCircleConfig() {}
    
    /**
     * Constructor with radius and concentric circles.
     */
    public VennCircleConfig(int radius, int numConcentricCircles) {
        this.radius = radius;
        this.numConcentricCircles = numConcentricCircles;
    }
    
    /**
     * Constructor with all parameters.
     */
    public VennCircleConfig(int radius, int numConcentricCircles, Point2D.Double position) {
        this.radius = radius;
        this.numConcentricCircles = numConcentricCircles;
        this.position = position;
    }
    
    /**
     * Copy constructor.
     */
    public VennCircleConfig(VennCircleConfig other) {
        this.radius = other.radius;
        this.numConcentricCircles = other.numConcentricCircles;
        this.position = other.position != null ? 
            new Point2D.Double(other.position.x, other.position.y) : null;
    }
    
    // Getters and setters
    public int getRadius() { return radius; }
    public void setRadius(int radius) { this.radius = radius; }
    
    public int getNumConcentricCircles() { return numConcentricCircles; }
    public void setNumConcentricCircles(int numConcentricCircles) { 
        this.numConcentricCircles = numConcentricCircles; 
    }
    
    public Point2D.Double getPosition() { return position; }
    public void setPosition(Point2D.Double position) { this.position = position; }
    
    @Override
    public String toString() {
        return String.format("VennCircle[radius=%d, concentric=%d, pos=%s]", 
                radius, numConcentricCircles, 
                position != null ? String.format("(%.1f,%.1f)", position.x, position.y) : "null");
    }
    
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        
        VennCircleConfig that = (VennCircleConfig) o;
        return radius == that.radius && 
               numConcentricCircles == that.numConcentricCircles &&
               java.util.Objects.equals(position, that.position);
    }
    
    @Override
    public int hashCode() {
        return java.util.Objects.hash(radius, numConcentricCircles, position);
    }
}