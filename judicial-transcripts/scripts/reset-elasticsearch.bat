@echo off
REM Elasticsearch Reset Script (Windows)
REM This script deletes and recreates the judicial_statements index

setlocal enabledelayedexpansion

if "%ELASTICSEARCH_URL%"=="" (
    set ES_URL=http://localhost:9200
) else (
    set ES_URL=%ELASTICSEARCH_URL%
)

set INDEX_NAME=judicial_statements

echo =====================================================
echo ELASTICSEARCH INDEX RESET (Batch Script)
echo =====================================================
echo.
echo Elasticsearch URL: %ES_URL%
echo Index Name: %INDEX_NAME%
echo.

REM Check if Elasticsearch is reachable
echo Checking Elasticsearch connection...
curl -s -o nul -w "%%{http_code}" "%ES_URL%" > temp_status.txt
set /p STATUS=<temp_status.txt
del temp_status.txt

if not "%STATUS%"=="200" (
    echo ERROR: Cannot connect to Elasticsearch at %ES_URL%
    exit /b 1
)
echo Connected to Elasticsearch
echo.

REM Check if index exists
echo Checking current index status...
curl -s -o nul -w "%%{http_code}" "%ES_URL%/%INDEX_NAME%" > temp_status.txt
set /p STATUS=<temp_status.txt
del temp_status.txt

if "%STATUS%"=="200" (
    REM Get document count
    curl -s "%ES_URL%/%INDEX_NAME%/_count" > temp_count.txt
    echo Index '%INDEX_NAME%' exists
    type temp_count.txt | findstr "count"
    del temp_count.txt
    
    REM Prompt for confirmation
    set /p CONFIRM="Are you sure you want to DELETE all data? (yes/no): "
    if /i not "!CONFIRM!"=="yes" (
        echo Operation cancelled.
        exit /b 0
    )
    
    REM Delete the index
    echo.
    echo Deleting index '%INDEX_NAME%'...
    curl -s -X DELETE "%ES_URL%/%INDEX_NAME%" -o temp_response.txt -w "\n%%{http_code}" > temp_status.txt
    set /p HTTP_STATUS=<temp_status.txt
    
    if "!HTTP_STATUS!"=="200" (
        echo Index deleted successfully
    ) else (
        echo Failed to delete index
        type temp_response.txt
        del temp_response.txt
        del temp_status.txt
        exit /b 1
    )
    del temp_response.txt
    del temp_status.txt
) else (
    echo Index '%INDEX_NAME%' does not exist
)

echo.
echo Creating new index with mappings...

REM Create the JSON file for mapping
echo { > temp_mapping.json
echo   "mappings": { >> temp_mapping.json
echo     "properties": { >> temp_mapping.json
echo       "text": { >> temp_mapping.json
echo         "type": "text", >> temp_mapping.json
echo         "analyzer": "standard" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "trialId": { >> temp_mapping.json
echo         "type": "integer" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "sessionId": { >> temp_mapping.json
echo         "type": "integer" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "speakerId": { >> temp_mapping.json
echo         "type": "integer" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "speakerType": { >> temp_mapping.json
echo         "type": "keyword" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "speakerPrefix": { >> temp_mapping.json
echo         "type": "keyword" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "speakerHandle": { >> temp_mapping.json
echo         "type": "keyword" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "startLineNumber": { >> temp_mapping.json
echo         "type": "integer" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "endLineNumber": { >> temp_mapping.json
echo         "type": "integer" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "startTime": { >> temp_mapping.json
echo         "type": "text" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "endTime": { >> temp_mapping.json
echo         "type": "text" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "sessionDate": { >> temp_mapping.json
echo         "type": "date" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "sessionType": { >> temp_mapping.json
echo         "type": "keyword" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "caseNumber": { >> temp_mapping.json
echo         "type": "keyword" >> temp_mapping.json
echo       }, >> temp_mapping.json
echo       "trialName": { >> temp_mapping.json
echo         "type": "text" >> temp_mapping.json
echo       } >> temp_mapping.json
echo     } >> temp_mapping.json
echo   }, >> temp_mapping.json
echo   "settings": { >> temp_mapping.json
echo     "number_of_shards": 1, >> temp_mapping.json
echo     "number_of_replicas": 0, >> temp_mapping.json
echo     "analysis": { >> temp_mapping.json
echo       "analyzer": { >> temp_mapping.json
echo         "standard": { >> temp_mapping.json
echo           "type": "standard", >> temp_mapping.json
echo           "stopwords": "_none_" >> temp_mapping.json
echo         } >> temp_mapping.json
echo       } >> temp_mapping.json
echo     } >> temp_mapping.json
echo   } >> temp_mapping.json
echo } >> temp_mapping.json

REM Create the index
curl -s -X PUT "%ES_URL%/%INDEX_NAME%" -H "Content-Type: application/json" -d @temp_mapping.json -o temp_response.txt -w "\n%%{http_code}" > temp_status.txt
set /p HTTP_STATUS=<temp_status.txt

if "%HTTP_STATUS%"=="200" (
    echo Index created successfully with mappings
) else (
    echo Failed to create index
    type temp_response.txt
    del temp_mapping.json
    del temp_response.txt
    del temp_status.txt
    exit /b 1
)

del temp_mapping.json
del temp_response.txt
del temp_status.txt

REM Check index health
echo.
echo Checking index health...
curl -s "%ES_URL%/_cluster/health/%INDEX_NAME%?pretty" | findstr "status"

REM Final verification
echo.
echo Verifying index...
curl -s "%ES_URL%/%INDEX_NAME%/_count" | findstr "count"

echo.
echo =====================================================
echo ELASTICSEARCH RESET COMPLETE
echo =====================================================
echo.
echo To resync data from the database, run:
echo   npm run es:reset:sync
echo.

endlocal