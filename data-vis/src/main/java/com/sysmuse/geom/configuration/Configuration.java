package com.sysmuse.geom.configuration;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.awt.geom.Point2D;
import java.util.ArrayList;
import java.util.List;

/**
 * Main configuration class for Venn diagram generation.
 *
 * Contains all parameters needed to generate a Venn diagram including
 * dot properties, canvas size, outer circle configuration, and individual
 * Venn circle configurations.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Configuration {

    @JsonProperty("dotSize")
    private int dotSize;

    @JsonProperty("dotSpacing")
    private int dotSpacing;

    @JsonProperty("outerRadius")
    private int outerRadius;

    @JsonProperty("numOuterConcentric")
    private int numOuterConcentric;

    @JsonProperty("canvasWidth")
    private int canvasWidth;

    @JsonProperty("canvasHeight")
    private int canvasHeight;

    @JsonProperty("vennCircles")
    private List<VennCircleConfig> vennCircles;

    @JsonProperty("outerCenter")
    private Point2D.Double outerCenter;

    @JsonProperty("concentricRadiusMode")
    private ConcentricRadiusIncMode concentricRadiusMode = ConcentricRadiusIncMode.PRESERVEAREA; // Default to the new mode

    /**
     * Default constructor for Jackson.
     */
    public Configuration() {
        this.vennCircles = new ArrayList<>();
    }

    /**
     * Constructor for simple configuration with identical venn circles.
     */
    public Configuration(int dotSize, int dotSpacing, int numVennCircles,
                         int vennRadius, int outerRadius, int numOuterConcentric,
                         int numInnerConcentric, int canvasWidth, int canvasHeight) {
        this();
        this.dotSize = dotSize;
        this.dotSpacing = dotSpacing;
        this.outerRadius = outerRadius;
        this.numOuterConcentric = numOuterConcentric;
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.outerCenter = new Point2D.Double(canvasWidth/2.0, canvasHeight/2.0);

        // Create identical venn circles
        for (int i = 0; i < numVennCircles; i++) {
            vennCircles.add(new VennCircleConfig(vennRadius, numInnerConcentric));
        }
        calculateVennPositions();
    }

    /**
     * Calculate and set positions for all venn circles based on their count,
     * ensuring they are contained within the outer circle.
     */
    public void calculateVennPositions() {
        if (vennCircles.isEmpty()) return;

        double centerX = canvasWidth / 2.0;
        double centerY = canvasHeight / 2.0;

        // Calculate max radius of Venn circles
        double maxVennRadius = vennCircles.stream()
                .mapToDouble(VennCircleConfig::getRadius)
                .max()
                .orElse(0);

        // Calculate available space for positioning (outer radius minus max Venn radius)
        // This ensures that even the edge of the largest Venn circle stays within the outer circle
        double availableRadius = outerRadius - maxVennRadius;

        // Safety check to ensure we have positive space
        if (availableRadius <= 0) {
            // Outer radius is too small, adjust Venn circle sizes
            double scale = (outerRadius * 0.9) / maxVennRadius; // Scale to 90% of outer radius

            for (VennCircleConfig venn : vennCircles) {
                venn.setRadius((int)(venn.getRadius() * scale));
            }

            // Recalculate available radius
            maxVennRadius = vennCircles.stream()
                    .mapToDouble(VennCircleConfig::getRadius)
                    .max()
                    .orElse(0);
            availableRadius = outerRadius - maxVennRadius;
        }

        if (vennCircles.size() == 1) {
            // Single circle at center
            vennCircles.get(0).setPosition(new Point2D.Double(centerX, centerY));
        } else if (vennCircles.size() == 2) {
            // Two circles with proper overlap
            // For 2 circles, optimal distance is around 0.7 * radius
            double avgRadius = vennCircles.stream()
                    .mapToDouble(VennCircleConfig::getRadius)
                    .average()
                    .orElse(150);

            // Limit positioning to available radius
            double distance = Math.min(avgRadius * 0.7, availableRadius * 0.8);

            vennCircles.get(0).setPosition(new Point2D.Double(centerX - distance, centerY));
            vennCircles.get(1).setPosition(new Point2D.Double(centerX + distance, centerY));
        } else if (vennCircles.size() == 3) {
            // Three circles in equilateral triangle formation
            double avgRadius = vennCircles.stream()
                    .mapToDouble(VennCircleConfig::getRadius)
                    .average()
                    .orElse(150);

            // For 3 circles, optimal distance is around 1.0 * radius
            // Limit to available radius to stay within outer circle
            double distance = Math.min(avgRadius * 1.0, availableRadius * 0.8);

            // Position in equilateral triangle
            // Angle for equilateral triangle = 120 degrees = 2π/3 radians
            double angle = 2 * Math.PI / 3;

            for (int i = 0; i < 3; i++) {
                double theta = i * angle;
                double x = centerX + distance * Math.cos(theta);
                double y = centerY + distance * Math.sin(theta);
                vennCircles.get(i).setPosition(new Point2D.Double(x, y));
            }
        } else {
            // For more than 3 circles, arrange in a regular polygon
            double angle = 2 * Math.PI / vennCircles.size();

            double avgRadius = vennCircles.stream()
                    .mapToDouble(VennCircleConfig::getRadius)
                    .average()
                    .orElse(150);

            // Scale based on number of circles, but limit to available radius
            double distanceFactor = 1.0 + 0.2 / vennCircles.size();
            double distance = Math.min(avgRadius * distanceFactor, availableRadius * 0.8);

            for (int i = 0; i < vennCircles.size(); i++) {
                double theta = i * angle;
                double x = centerX + distance * Math.cos(theta);
                double y = centerY + distance * Math.sin(theta);
                vennCircles.get(i).setPosition(new Point2D.Double(x, y));
            }
        }
    }

    /**
     * Create a default 3-circle configuration.
     */
    public static Configuration createDefault3Circle() {
        Configuration config = new Configuration();
        config.dotSize = 2;
        config.dotSpacing = 4;
        config.outerRadius = 280;
        config.numOuterConcentric = 3;
        config.canvasWidth = 800;
        config.canvasHeight = 600;
        config.outerCenter = new Point2D.Double(400, 300);
        config.concentricRadiusMode = ConcentricRadiusIncMode.PRESERVEAREA;

        config.vennCircles.add(new VennCircleConfig(150, 2));
        config.vennCircles.add(new VennCircleConfig(150, 2));
        config.vennCircles.add(new VennCircleConfig(150, 2));

        config.calculateVennPositions();
        return config;
    }

    /**
     * Create a complex 4-circle configuration with different settings.
     */
    public static Configuration createComplex4Circle() {
        Configuration config = new Configuration();
        config.dotSize = 2;
        config.dotSpacing = 6;
        config.outerRadius = 300;
        config.numOuterConcentric = 4;
        config.canvasWidth = 800;
        config.canvasHeight = 600;
        config.outerCenter = new Point2D.Double(400, 300);
        config.concentricRadiusMode = ConcentricRadiusIncMode.PRESERVEAREA;

        config.vennCircles.add(new VennCircleConfig(120, 1));
        config.vennCircles.add(new VennCircleConfig(130, 2));
        config.vennCircles.add(new VennCircleConfig(125, 0));
        config.vennCircles.add(new VennCircleConfig(135, 3));

        config.calculateVennPositions();
        return config;
    }

    // Getters and setters
    public int getDotSize() { return dotSize; }
    public void setDotSize(int dotSize) { this.dotSize = dotSize; }

    public int getDotSpacing() { return dotSpacing; }
    public void setDotSpacing(int dotSpacing) { this.dotSpacing = dotSpacing; }

    public int getOuterRadius() { return outerRadius; }
    public void setOuterRadius(int outerRadius) { this.outerRadius = outerRadius; }

    public int getNumOuterConcentric() { return numOuterConcentric; }
    public void setNumOuterConcentric(int numOuterConcentric) { this.numOuterConcentric = numOuterConcentric; }

    public int getCanvasWidth() { return canvasWidth; }
    public void setCanvasWidth(int canvasWidth) { this.canvasWidth = canvasWidth; }

    public int getCanvasHeight() { return canvasHeight; }
    public void setCanvasHeight(int canvasHeight) { this.canvasHeight = canvasHeight; }

    public List<VennCircleConfig> getVennCircles() { return vennCircles; }
    public void setVennCircles(List<VennCircleConfig> vennCircles) { this.vennCircles = vennCircles; }

    public Point2D.Double getOuterCenter() { return outerCenter; }
    public void setOuterCenter(Point2D.Double outerCenter) { this.outerCenter = outerCenter; }

    public ConcentricRadiusIncMode getConcentricRadiusMode() { return concentricRadiusMode; }
    public void setConcentricRadiusMode(ConcentricRadiusIncMode mode) { this.concentricRadiusMode = mode; }

    public int getNumVennCircles() { return vennCircles.size(); }

    @Override
    public String toString() {
        return String.format("Config[dots=%d, spacing=%d, venn=%d, outerR=%d, outerConc=%d, mode=%s]",
                dotSize, dotSpacing, vennCircles.size(), outerRadius, numOuterConcentric, concentricRadiusMode);
    }
}