@echo off
REM Data Visualization Suite - Windows Project Setup Script

echo Setting up Data Visualization Suite project structure...

REM Create main directory structure
mkdir data-vis\src\main\java\com\sysmuse\geom\configuration 2>nul
mkdir data-vis\src\main\java\com\sysmuse\geom\analysis 2>nul
mkdir data-vis\src\main\java\com\sysmuse\geom\simulation 2>nul
mkdir data-vis\src\main\java\com\sysmuse\geom\output 2>nul
mkdir data-vis\src\main\resources\configurations 2>nul
mkdir data-vis\src\test\java\com\sysmuse\geom 2>nul
mkdir data-vis\output\configurations 2>nul
mkdir data-vis\output\results 2>nul
mkdir data-vis\output\reports 2>nul

echo Created directory structure

echo.
echo Next steps:
echo 1. Copy the Java source files to their respective directories:
echo    - VennDiagramApplication.java to src\main\java\com\sysmuse\geom\
echo    - Configuration package files to src\main\java\com\sysmuse\geom\configuration\
echo    - Analysis package files to src\main\java\com\sysmuse\geom\analysis\
echo    - Simulation package files to src\main\java\com\sysmuse\geom\simulation\
echo    - Output package files to src\main\java\com\sysmuse\geom\output\
echo 2. Copy pom.xml to the root directory
echo 3. Copy JSON configuration files to src\main\resources\configurations\
echo 4. Run 'mvn clean compile' to build the project
echo 5. Run 'mvn exec:java' to execute the application

echo.
echo Project structure:
echo data-vis\
echo ├── README.md
echo ├── pom.xml
echo ├── src\main\java\com\sysmuse\geom\
echo │   ├── VennDiagramApplication.java
echo │   ├── configuration\
echo │   │   ├── Configuration.java
echo │   │   ├── VennCircleConfig.java
echo │   │   ├── TargetCriteria.java
echo │   │   └── ConfigurationLoader.java
echo │   ├── analysis\
echo │   │   ├── RegionAnalyzer.java
echo │   │   ├── RegionMetrics.java
echo │   │   └── GridPoint.java
echo │   ├── simulation\
echo │   │   ├── Simulator.java
echo │   │   ├── SimulationResult.java
echo │   │   └── ConvergentOptimizer.java
echo │   └── output\
echo │       ├── HTMLReportGenerator.java
echo │       ├── SVGGenerator.java
echo │       └── JSONExporter.java
echo ├── src\main\resources\configurations\
echo │   ├── default_target.json
echo │   ├── sample_3_circles.json
echo │   └── complex_4_circles.json
echo ├── src\test\java\com\sysmuse\geom\
echo │   └── IntegrationTest.java
echo └── output\
echo     ├── configurations\
echo     ├── results\
echo     └── reports\

echo.
echo ✅ Data Visualization Suite setup complete!
echo.
echo This project is designed to be extensible for multiple visualization types:
echo - Venn diagrams (currently implemented)
echo - Network diagrams (future)
echo - Hierarchical visualizations (future)
echo - Statistical plots (future)
echo - Interactive dashboards (future)
echo.
echo To build and run the project:
echo 1. Navigate to the project directory: cd data-vis
echo 2. Compile: mvn clean compile
echo 3. Test: mvn test
echo 4. Run: mvn exec:java
echo 5. Or create executable JAR: mvn package

pause
