package com.sysmuse.geom.output;

import com.sysmuse.geom.configuration.Configuration;
import com.sysmuse.geom.configuration.VennCircleConfig;
import java.awt.geom.Point2D;

/**
 * Generates SVG visualizations of Venn diagram configurations.
 * 
 * Creates scalable vector graphics representations of configurations
 * including circles, concentric zones, and dot grids.
 */
public class SVGGenerator {
    
    /**
     * Generate a complete SVG visualization of a configuration.
     * 
     * @param config The configuration to visualize
     * @return SVG string representation
     */
    public String generateSVG(Configuration config) {
        StringBuilder svg = new StringBuilder();
        
        // SVG header
        svg.append("<svg width='").append(config.getCanvasWidth())
           .append("' height='").append(config.getCanvasHeight())
           .append("' xmlns='http://www.w3.org/2000/svg'>\n");
        
        // Background
        svg.append("<rect width='").append(config.getCanvasWidth())
           .append("' height='").append(config.getCanvasHeight())
           .append("' fill='#f8f9fa'/>\n");
        
        // Generate uniform grid pattern
        generateDotGrid(svg, config);
        
        // Outer corpus circle
        generateOuterCircle(svg, config);
        
        // Outer concentric circles
        generateOuterConcentricCircles(svg, config);
        
        // Venn circles
        generateVennCircles(svg, config);
        
        // Labels and title
        generateLabels(svg, config);
        
        svg.append("</svg>\n");
        
        return svg.toString();
    }
    
    /**
     * Generate the uniform dot grid.
     */
    private void generateDotGrid(StringBuilder svg, Configuration config) {
        int stepSize = config.getDotSize() * 2 + config.getDotSpacing();
        
        svg.append("<!-- Uniform dot grid -->\n");
        for (int x = stepSize / 2; x < config.getCanvasWidth(); x += stepSize) {
            for (int y = stepSize / 2; y < config.getCanvasHeight(); y += stepSize) {
                svg.append("<circle cx='").append(x)
                   .append("' cy='").append(y)
                   .append("' r='").append(config.getDotSize())
                   .append("' fill='#333'/>\n");
            }
        }
    }
    
    /**
     * Generate the outer corpus circle.
     */
    private void generateOuterCircle(StringBuilder svg, Configuration config) {
        Point2D.Double center = config.getOuterCenter();
        svg.append("<!-- Outer corpus circle -->\n");
        svg.append("<circle cx='").append(center.x)
           .append("' cy='").append(center.y)
           .append("' r='").append(config.getOuterRadius())
           .append("' fill='none' stroke='#2c3e50' stroke-width='3' stroke-dasharray='8,4'/>\n");
    }
    
    /**
     * Generate outer concentric circles.
     */
    private void generateOuterConcentricCircles(StringBuilder svg, Configuration config) {
        Point2D.Double center = config.getOuterCenter();
        int numConcentric = config.getNumOuterConcentric();
        
        if (numConcentric > 0) {
            svg.append("<!-- Outer concentric circles -->\n");
            for (int i = 1; i <= numConcentric; i++) {
                double radius = config.getOuterRadius() * i / (numConcentric + 1.0);
                svg.append("<circle cx='").append(center.x)
                   .append("' cy='").append(center.y)
                   .append("' r='").append(radius)
                   .append("' fill='none' stroke='#8e44ad' stroke-width='2' stroke-opacity='0.8'/>\n");
            }
        }
    }
    
    /**
     * Generate Venn circles with their concentric circles.
     */
    private void generateVennCircles(StringBuilder svg, Configuration config) {
        String[] colors = {"#ff6b6b", "#4ecdc4", "#45b7d1", "#f39c12", "#9b59b6", "#e67e22"};
        
        svg.append("<!-- Venn circles -->\n");
        for (int i = 0; i < config.getVennCircles().size(); i++) {
            VennCircleConfig vennConfig = config.getVennCircles().get(i);
            Point2D.Double center = vennConfig.getPosition();
            String color = colors[i % colors.length];
            
            // Main venn circle
            svg.append("<circle cx='").append(center.x)
               .append("' cy='").append(center.y)
               .append("' r='").append(vennConfig.getRadius())
               .append("' fill='").append(color)
               .append("' fill-opacity='0.15' stroke='").append(color)
               .append("' stroke-width='2'/>\n");
            
            // Inner concentric circles for this venn circle
            for (int j = 1; j <= vennConfig.getNumConcentricCircles(); j++) {
                double radius = vennConfig.getRadius() * j / (vennConfig.getNumConcentricCircles() + 1.0);
                svg.append("<circle cx='").append(center.x)
                   .append("' cy='").append(center.y)
                   .append("' r='").append(radius)
                   .append("' fill='none' stroke='").append(color)
                   .append("' stroke-width='1.5' stroke-opacity='0.8'/>\n");
            }
        }
    }
    
    /**
     * Generate labels for circles and title.
     */
    private void generateLabels(StringBuilder svg, Configuration config) {
        svg.append("<!-- Labels -->\n");
        
        // Venn circle labels
        for (int i = 0; i < config.getVennCircles().size(); i++) {
            VennCircleConfig vennConfig = config.getVennCircles().get(i);
            Point2D.Double center = vennConfig.getPosition();
            char label = (char)('A' + i);
            
            double labelY = center.y - vennConfig.getRadius() - 20;
            svg.append("<text x='").append(center.x)
               .append("' y='").append(labelY)
               .append("' text-anchor='middle' font-family='Arial, sans-serif' font-size='18' font-weight='bold'")
               .append(" fill='#333' stroke='#fff' stroke-width='1'>Set ").append(label).append("</text>\n");
        }
        
        // Corpus label
        Point2D.Double outerCenter = config.getOuterCenter();
        double corpusLabelX = outerCenter.x - config.getOuterRadius() + 50;
        double corpusLabelY = outerCenter.y - config.getOuterRadius() + 30;
        svg.append("<text x='").append(corpusLabelX)
           .append("' y='").append(corpusLabelY)
           .append("' text-anchor='middle' font-family='Arial, sans-serif' font-size='16' font-weight='bold'")
           .append(" fill='#2c3e50' stroke='#fff' stroke-width='1'>Corpus</text>\n");
        
        // Title
        svg.append("<rect x='150' y='10' width='500' height='35' fill='#fff' fill-opacity='0.9' stroke='#333' stroke-width='1'/>\n");
        svg.append("<text x='").append(config.getCanvasWidth() / 2)
           .append("' y='30' text-anchor='middle' font-family='Arial, sans-serif' font-size='24' font-weight='bold'")
           .append(" fill='#333'>Venn Diagram Configuration</text>\n");
    }
    
    /**
     * Generate a simple SVG with just the circles (no dots) for quick preview.
     * 
     * @param config The configuration to visualize
     * @return Simplified SVG string
     */
    public String generateSimpleSVG(Configuration config) {
        StringBuilder svg = new StringBuilder();
        
        // SVG header
        svg.append("<svg width='400' height='300' xmlns='http://www.w3.org/2000/svg'>\n");
        
        // Background
        svg.append("<rect width='400' height='300' fill='#f8f9fa'/>\n");
        
        // Scale factors for simplified view
        double scaleX = 400.0 / config.getCanvasWidth();
        double scaleY = 300.0 / config.getCanvasHeight();
        double scale = Math.min(scaleX, scaleY) * 0.8; // 80% to add margins
        
        // Calculate centered offset
        double offsetX = (400 - config.getCanvasWidth() * scale) / 2;
        double offsetY = (300 - config.getCanvasHeight() * scale) / 2;
        
        // Outer circle
        Point2D.Double outerCenter = config.getOuterCenter();
        double outerX = outerCenter.x * scale + offsetX;
        double outerY = outerCenter.y * scale + offsetY;
        double outerR = config.getOuterRadius() * scale;
        
        svg.append("<circle cx='").append(outerX)
           .append("' cy='").append(outerY)
           .append("' r='").append(outerR)
           .append("' fill='none' stroke='#2c3e50' stroke-width='2' stroke-dasharray='4,2'/>\n");
        
        // Venn circles
        String[] colors = {"#ff6b6b", "#4ecdc4", "#45b7d1", "#f39c12", "#9b59b6"};
        for (int i = 0; i < config.getVennCircles().size(); i++) {
            VennCircleConfig vennConfig = config.getVennCircles().get(i);
            Point2D.Double center = vennConfig.getPosition();
            String color = colors[i % colors.length];
            
            double x = center.x * scale + offsetX;
            double y = center.y * scale + offsetY;
            double r = vennConfig.getRadius() * scale;
            
            svg.append("<circle cx='").append(x)
               .append("' cy='").append(y)
               .append("' r='").append(r)
               .append("' fill='").append(color)
               .append("' fill-opacity='0.3' stroke='").append(color)
               .append("' stroke-width='2'/>\n");
        }
        
        svg.append("</svg>\n");
        return svg.toString();
    }
    
    /**
     * Generate SVG for a specific region highlighting.
     * 
     * @param config The configuration
     * @param regionKey The region to highlight
     * @return SVG string with highlighted region
     */
    public String generateRegionHighlightSVG(Configuration config, String regionKey) {
        // This would implement region-specific highlighting
        // For now, return the standard SVG
        return generateSVG(config);
    }
    
    /**
     * Generate an SVG legend explaining the colors and symbols.
     * 
     * @param config The configuration to create legend for
     * @return SVG legend string
     */
    public String generateLegend(Configuration config) {
        StringBuilder svg = new StringBuilder();
        String[] colors = {"#ff6b6b", "#4ecdc4", "#45b7d1", "#f39c12", "#9b59b6", "#e67e22"};
        
        int legendHeight = config.getVennCircles().size() * 30 + 60;
        svg.append("<svg width='200' height='").append(legendHeight).append("' xmlns='http://www.w3.org/2000/svg'>\n");
        
        // Background
        svg.append("<rect width='200' height='").append(legendHeight).append("' fill='#fff' stroke='#333' stroke-width='1'/>\n");
        
        // Title
        svg.append("<text x='100' y='20' text-anchor='middle' font-family='Arial, sans-serif' font-size='16' font-weight='bold' fill='#333'>Legend</text>\n");
        
        // Venn circle entries
        for (int i = 0; i < config.getVennCircles().size(); i++) {
            char label = (char)('A' + i);
            String color = colors[i % colors.length];
            int y = 40 + i * 30;
            
            svg.append("<circle cx='20' cy='").append(y)
               .append("' r='8' fill='").append(color)
               .append("' fill-opacity='0.3' stroke='").append(color)
               .append("' stroke-width='2'/>\n");
            
            svg.append("<text x='35' y='").append(y + 5)
               .append("' font-family='Arial, sans-serif' font-size='14' fill='#333'>Set ").append(label).append("</text>\n");
        }
        
        // Corpus entry
        int corpusY = 40 + config.getVennCircles().size() * 30;
        svg.append("<circle cx='20' cy='").append(corpusY)
           .append("' r='8' fill='none' stroke='#2c3e50' stroke-width='2' stroke-dasharray='2,1'/>\n");
        svg.append("<text x='35' y='").append(corpusY + 5)
           .append("' font-family='Arial, sans-serif' font-size='14' fill='#333'>Corpus</text>\n");
        
        svg.append("</svg>\n");
        return svg.toString();
    }
}