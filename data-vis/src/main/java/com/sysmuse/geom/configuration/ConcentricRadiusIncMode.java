package com.sysmuse.geom.configuration;

/**
 * Enum defining different modes for calculating the radii of concentric circles.
 *
 * Two modes are supported:
 * - EQUAL: Equal increments between concentric circle radii
 * - PRESERVEAREA: Concentric circles where each annular band has the same area
 */
public enum ConcentricRadiusIncMode {
    /**
     * Equal increments between concentric circle radii.
     * This is the original method where radii are spaced linearly.
     */
    EQUAL,

    /**
     * Concentric circles where each annular band has the same area.
     * This uses a square root formula to calculate radii.
     */
    PRESERVEAREA
}