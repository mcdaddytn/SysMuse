package com.sysmuse.geom.output;

import com.sysmuse.geom.configuration.Configuration;
import com.sysmuse.geom.configuration.TargetCriteria;
import com.sysmuse.geom.simulation.SimulationResult;
import com.sysmuse.geom.analysis.RegionMetrics;
import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.List;
import java.util.Map;

/**
 * Generates HTML reports with visualizations and analysis results.
 */
public class HTMLReportGenerator {
    
    private final SVGGenerator svgGenerator;
    
    public HTMLReportGenerator() {
        this.svgGenerator = new SVGGenerator();
    }
    
    @SuppressWarnings("unchecked")
    public void generateReport(Map<String, Object> reportData, String filename) throws IOException {
        TargetCriteria target = (TargetCriteria) reportData.get("targetCriteria");
        List<SimulationResult> bestResults = (List<SimulationResult>) reportData.get("bestResults");
        Configuration bestConfig = (Configuration) reportData.get("bestConfiguration");
        
        try (PrintWriter writer = new PrintWriter(new FileWriter(filename))) {
            writer.println("<!DOCTYPE html>");
            writer.println("<html><head>");
            writer.println("<title>Venn Diagram Analysis Report</title>");
            writer.println("<style>");
            writer.println("body { font-family: Arial, sans-serif; margin: 20px; }");
            writer.println("table { border-collapse: collapse; width: 100%; margin: 20px 0; }");
            writer.println("th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }");
            writer.println("th { background-color: #f2f2f2; }");
            writer.println(".svg-container { text-align: center; margin: 20px 0; }");
            writer.println("</style>");
            writer.println("</head><body>");
            
            writer.println("<h1>Venn Diagram Configuration Analysis</h1>");
            
            if (target != null) {
                writer.println("<h2>Target Criteria</h2>");
                writer.println("<p>Target Regions: " + target.getTargetRegions() + "</p>");
                writer.println("<p>Target Mean Area: " + target.getTargetMeanArea() + "</p>");
            }
            
            if (bestConfig != null) {
                writer.println("<h2>Best Configuration</h2>");
                writer.println("<div class='svg-container'>");
                writer.println(svgGenerator.generateSVG(bestConfig));
                writer.println("</div>");
            }
            
            if (bestResults != null && !bestResults.isEmpty()) {
                writer.println("<h2>Top Results</h2>");
                writer.println("<table>");
                writer.println("<tr><th>Rank</th><th>Score</th><th>Regions</th><th>Mean Area</th></tr>");
                for (int i = 0; i < bestResults.size(); i++) {
                    SimulationResult result = bestResults.get(i);
                    writer.println("<tr>");
                    writer.println("<td>" + (i + 1) + "</td>");
                    writer.println("<td>" + String.format("%.2f", result.getFitnessScore()) + "</td>");
                    writer.println("<td>" + result.getMetrics().getTotalRegions() + "</td>");
                    writer.println("<td>" + String.format("%.1f", result.getMetrics().getMeanArea()) + "</td>");
                    writer.println("</tr>");
                }
                writer.println("</table>");
            }
            
            writer.println("</body></html>");
        }
    }
}