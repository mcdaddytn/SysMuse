package com.sysmuse.geom.simulation;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.sysmuse.geom.configuration.Configuration;
import com.sysmuse.geom.analysis.RegionMetrics;

/**
 * Represents the result of analyzing a single configuration during simulation.
 *
 * Contains the configuration used, the metrics calculated from analysis,
 * the fitness score, and metadata about when it was generated.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class SimulationResult {

    @JsonProperty("configuration")
    private Configuration configuration;

    @JsonProperty("metrics")
    private RegionMetrics metrics;

    @JsonProperty("fitnessScore")
    private double fitnessScore;

    @JsonProperty("iteration")
    private int iteration;

    @JsonProperty("phase")
    private String phase; // "exploration" or "refinement"

    @JsonProperty("timestamp")
    private long timestamp;

    /**
     * Default constructor for Jackson.
     */
    public SimulationResult() {
        this.timestamp = System.currentTimeMillis();
    }

    /**
     * Create a new simulation result.
     *
     * @param configuration The configuration that was tested
     * @param metrics The analysis results
     * @param fitnessScore The calculated fitness score
     * @param iteration The iteration number when this was generated
     */
    public SimulationResult(Configuration configuration, RegionMetrics metrics,
                          double fitnessScore, int iteration) {
        this();
        this.configuration = configuration;
        this.metrics = metrics;
        this.fitnessScore = fitnessScore;
        this.iteration = iteration;
    }

    /**
     * Create a new simulation result with phase information.
     *
     * @param configuration The configuration that was tested
     * @param metrics The analysis results
     * @param fitnessScore The calculated fitness score
     * @param iteration The iteration number when this was generated
     * @param phase The simulation phase ("exploration" or "refinement")
     */
    public SimulationResult(Configuration configuration, RegionMetrics metrics,
                          double fitnessScore, int iteration, String phase) {
        this(configuration, metrics, fitnessScore, iteration);
        this.phase = phase;
    }

    /**
     * Check if this result is better than another (lower fitness score is better).
     *
     * @param other The other result to compare against
     * @return true if this result has a better (lower) fitness score
     */
    public boolean isBetterThan(SimulationResult other) {
        return other == null || this.fitnessScore < other.fitnessScore;
    }

    /**
     * Get a summary of the key metrics for quick comparison.
     *
     * @return Formatted string with key metrics
     */
    public String getSummary() {
        return String.format("Iter %d: Score=%.2f, Regions=%d, MeanArea=%.1f, VennCircles=%d",
                iteration, fitnessScore,
                metrics != null ? metrics.getTotalRegions() : 0,
                metrics != null ? metrics.getMeanArea() : 0,
                configuration != null ? configuration.getNumVennCircles() : 0);
    }

    /**
     * Get the efficiency ratio (regions per fitness score).
     * Lower is better since lower fitness scores are better.
     *
     * @return Efficiency ratio
     */
    public double getEfficiencyRatio() {
        if (fitnessScore == 0 || metrics == null) return Double.MAX_VALUE;
        return metrics.getTotalRegions() / fitnessScore;
    }

    // Getters and setters
    public Configuration getConfiguration() { return configuration; }
    public void setConfiguration(Configuration configuration) { this.configuration = configuration; }

    public RegionMetrics getMetrics() { return metrics; }
    public void setMetrics(RegionMetrics metrics) { this.metrics = metrics; }

    public double getFitnessScore() { return fitnessScore; }
    public void setFitnessScore(double fitnessScore) { this.fitnessScore = fitnessScore; }

    public int getIteration() { return iteration; }
    public void setIteration(int iteration) { this.iteration = iteration; }

    public String getPhase() { return phase; }
    public void setPhase(String phase) { this.phase = phase; }

    public long getTimestamp() { return timestamp; }
    public void setTimestamp(long timestamp) { this.timestamp = timestamp; }

    @Override
    public String toString() {
        return getSummary();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;

        SimulationResult that = (SimulationResult) o;
        return iteration == that.iteration &&
               Double.compare(that.fitnessScore, fitnessScore) == 0 &&
               java.util.Objects.equals(configuration, that.configuration);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(fitnessScore, iteration, timestamp);
    }
}