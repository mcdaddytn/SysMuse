# Venn Diagram Generator

A sophisticated Java application for generating and analyzing Venn diagrams with customizable parameters, designed for document corpus visualization and region analysis.

## Project Structure
New structure:

venn-diagram-generator/
+-- README.md
+-- pom.xml
+-- setup-project.bat (Windows)
+-- setup-project.sh (Linux/Mac)
+-- src/main/java/com/sysmuse/geom/
¦   +-- VennDiagramApplication.java
¦   +-- configuration/
¦   ¦   +-- Configuration.java
¦   ¦   +-- VennCircleConfig.java
¦   ¦   +-- TargetCriteria.java
¦   ¦   +-- ConfigurationLoader.java
¦   +-- analysis/
¦   ¦   +-- RegionAnalyzer.java
¦   ¦   +-- RegionMetrics.java
¦   ¦   +-- GridPoint.java
¦   +-- simulation/
¦   ¦   +-- Simulator.java 
¦   ¦   +-- SimulationResult.java
¦   ¦   +-- ConvergentOptimizer.java
¦   +-- output/
¦       +-- HTMLReportGenerator.java
¦       +-- SVGGenerator.java
¦       +-- JSONExporter.java
+-- src/main/resources/configurations/
¦   +-- default_target.json
¦   +-- sample_3_circles.json
¦   +-- complex_4_circles.json
+-- src/test/java/com/sysmuse/geom/
¦   +-- IntegrationTest.java
+-- output/
    +-- configurations/
    +-- results/
    +-- reports/

Old structure:

```
venn-diagram-generator/
+-- README.md
+-- pom.xml
+-- src/
¦   +-- main/
¦       +-- java/
¦       ¦   +-- com/
¦       ¦       +-- sysmuse/
¦       ¦           +-- geom/
¦       ¦               +-- VennDiagramApplication.java
¦       ¦               +-- configuration/
¦       ¦               ¦   +-- Configuration.java
¦       ¦               ¦   +-- VennCircleConfig.java
¦       ¦               ¦   +-- TargetCriteria.java
¦       ¦               ¦   +-- ConfigurationLoader.java
¦       ¦               +-- analysis/
¦       ¦               ¦   +-- RegionAnalyzer.java
¦       ¦               ¦   +-- RegionMetrics.java
¦       ¦               ¦   +-- GridPoint.java
¦       ¦               +-- simulation/
¦       ¦               ¦   +-- Simulator.java
¦       ¦               ¦   +-- SimulationResult.java
¦       ¦               ¦   +-- ConvergentOptimizer.java
¦       ¦               +-- output/
¦       ¦                   +-- HTMLReportGenerator.java
¦       ¦                   +-- SVGGenerator.java
¦       ¦                   +-- JSONExporter.java
¦       +-- resources/
¦           +-- configurations/
¦               +-- default_target.json
¦               +-- sample_3_circles.json
¦               +-- complex_4_circles.json
+-- output/
¦   +-- configurations/
¦   +-- results/
¦   +-- reports/
+-- test/
    +-- java/
        +-- com/
            +-- sysmuse/
                +-- geom/
                    +-- TestVennDiagramGenerator.java
                    +-- TestConfiguration.java
                    +-- TestSimulation.java
```

## Features

- **Variable Configuration Support**: Each Venn circle can have different radius and concentric circles
- **JSON-Based Configuration**: Flexible input using Jackson library for easy configuration management
- **Convergent Optimization**: Two-phase simulation with exploration and refinement phases
- **Comprehensive Analysis**: Detailed region analysis with statistical metrics
- **HTML Visualization**: Generate HTML reports with SVG visualizations
- **Complete JSON Output**: All simulation results saved in structured JSON format

## Getting Started

### Prerequisites

- Java 11 or higher
- Maven 3.6 or higher

### Dependencies

```xml
<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
    <version>2.15.2</version>
</dependency>
```

### Building the Project

```bash
mvn clean compile
```

### Running a Simulation

```bash
mvn exec:java -Dexec.mainClass="com.sysmuse.geom.VennDiagramApplication"
```

## Configuration

### Target Criteria (JSON)

```json
{
  "targetRegions": 150,
  "targetMinArea": 5,
  "targetMaxArea": 100,
  "targetMeanArea": 25,
  "targetMedianArea": 20,
  "toleranceRegions": 10,
  "toleranceArea": 5.0
}
```

### Venn Diagram Configuration (JSON)

```json
{
  "dotSize": 2,
  "dotSpacing": 4,
  "outerRadius": 280,
  "numOuterConcentric": 3,
  "canvasWidth": 800,
  "canvasHeight": 600,
  "vennCircles": [
    {
      "radius": 150,
      "numConcentricCircles": 2
    },
    {
      "radius": 140,
      "numConcentricCircles": 3
    },
    {
      "radius": 160,
      "numConcentricCircles": 1
    }
  ]
}
```

## Output

The application generates:

1. **JSON Results**: Complete simulation results in `output/results/`
2. **HTML Reports**: Visual reports with SVG diagrams in `output/reports/`
3. **Configuration Files**: Generated configurations in `output/configurations/`

## API Usage

```java
// Load configuration
ConfigurationLoader loader = new ConfigurationLoader();
Configuration config = loader.loadFromJSON("config.json");
TargetCriteria target = loader.loadTargetFromJSON("target.json");

// Run simulation
Simulator simulator = new Simulator(target);
simulator.runSimulation(1000);

// Generate outputs
simulator.saveResultsToJSON("output/results/simulation_results.json");
simulator.generateHTMLReport("output/reports/analysis.html");
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
