@echo off
REM Elasticsearch Force Reset Script (Windows)
REM This script deletes and recreates the judicial_statements index WITHOUT prompting

setlocal

if "%ELASTICSEARCH_URL%"=="" (
    set ES_URL=http://localhost:9200
) else (
    set ES_URL=%ELASTICSEARCH_URL%
)

set INDEX_NAME=judicial_statements

echo =====================================================
echo ELASTICSEARCH INDEX FORCE RESET
echo =====================================================
echo.
echo Elasticsearch URL: %ES_URL%
echo Index Name: %INDEX_NAME%
echo.

REM Delete the index if it exists (ignore errors)
echo Deleting index '%INDEX_NAME%' if it exists...
curl -s -X DELETE "%ES_URL%/%INDEX_NAME%" > nul 2>&1
echo Delete operation completed
echo.

echo Creating new index with mappings...

REM Create compact JSON for Windows
set JSON={"mappings":{"properties":{"text":{"type":"text","analyzer":"standard"},"trialId":{"type":"integer"},"sessionId":{"type":"integer"},"speakerId":{"type":"integer"},"speakerType":{"type":"keyword"},"speakerPrefix":{"type":"keyword"},"speakerHandle":{"type":"keyword"},"startLineNumber":{"type":"integer"},"endLineNumber":{"type":"integer"},"startTime":{"type":"text"},"endTime":{"type":"text"},"sessionDate":{"type":"date"},"sessionType":{"type":"keyword"},"caseNumber":{"type":"keyword"},"trialName":{"type":"text"}}},"settings":{"number_of_shards":1,"number_of_replicas":0,"analysis":{"analyzer":{"standard":{"type":"standard","stopwords":"_none_"}}}}}

curl -s -X PUT "%ES_URL%/%INDEX_NAME%" -H "Content-Type: application/json" -d "%JSON%" > nul
echo Index created
echo.

REM Final verification
curl -s "%ES_URL%/%INDEX_NAME%/_count" 2>nul | findstr "count"
echo.
echo RESET COMPLETE - Index is empty and ready for use

endlocal