package com.sysmuse.geom.analysis;

import com.sysmuse.geom.configuration.Configuration;
import com.sysmuse.geom.configuration.ConcentricRadiusIncMode;
import com.sysmuse.geom.configuration.VennCircleConfig;
import java.awt.geom.Point2D;
import java.util.*;

/**
 * Utility class for calculating radii of concentric circles.
 *
 * Provides methods to calculate the radii of concentric circles
 * in both EQUAL and PRESERVEAREA modes.
 */
public class ConcentricCircleCalculator {

    /**
     * Calculate the radius of a specific concentric circle.
     *
     * @param outerRadius The total radius of the enclosing circle
     * @param totalCircles The total number of concentric circles
     * @param circleIndex The index of the circle to calculate (0-based, 0 is innermost)
     * @param mode The mode to use for radius calculation
     * @return The radius of the specified concentric circle
     */
    public static double calculateRadius(double outerRadius, int totalCircles, int circleIndex, ConcentricRadiusIncMode mode) {
        if (circleIndex < 0 || circleIndex >= totalCircles) {
            throw new IllegalArgumentException("Circle index out of bounds: " + circleIndex);
        }

        if (totalCircles <= 1) {
            return outerRadius;
        }

        switch (mode) {
            case PRESERVEAREA:
                return calculatePreserveAreaRadius(outerRadius, totalCircles, circleIndex);
            case EQUAL:
            default:
                return calculateEqualIncrementRadius(outerRadius, totalCircles, circleIndex);
        }
    }

    /**
     * Calculate the radius using the EQUAL mode (equal increments).
     */
    private static double calculateEqualIncrementRadius(double outerRadius, int totalCircles, int circleIndex) {
        return outerRadius * (circleIndex + 1) / (double) totalCircles;
    }

    /**
     * Calculate the radius using the PRESERVEAREA mode (equal area bands).
     */
    private static double calculatePreserveAreaRadius(double outerRadius, int totalCircles, int circleIndex) {
        // Each ring needs to have the same area as the innermost circle
        // Area of innermost circle with radius r0: π * r0²
        // Total area of circle with radius r: π * r²
        // For n rings total (including innermost), r = r0 * √n

        // First calculate the innermost radius (r0) that would give outerRadius as the outermost radius
        // outerRadius = r0 * sqrt(totalCircles)
        // r0 = outerRadius / sqrt(totalCircles)
        double r0 = outerRadius / Math.sqrt(totalCircles);

        // Now calculate the radius for the specified circle index
        return r0 * Math.sqrt(circleIndex + 1);
    }

    /**
     * Generate an array of all concentric circle radii.
     *
     * @param outerRadius The total radius of the enclosing circle
     * @param totalCircles The total number of concentric circles
     * @param mode The mode to use for radius calculation
     * @return Array of radii from innermost to outermost
     */
    public static double[] generateRadii(double outerRadius, int totalCircles, ConcentricRadiusIncMode mode) {
        double[] radii = new double[totalCircles];

        for (int i = 0; i < totalCircles; i++) {
            radii[i] = calculateRadius(outerRadius, totalCircles, i, mode);
        }

        return radii;
    }
}