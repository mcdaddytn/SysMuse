
Install for win:
https://www.xpdfreader.com/download.html
https://dl.xpdfreader.com/XpdfReader-win64-4.05.exe

Add to path (install dir):
C:\frame\utilities\XpdfReader-win64


https://dl.xpdfreader.com/xpdf-tools-win-4.05.zip


Add to path (install dir):
C:\frame\utilities\xpdf-tools-win-4.05\bin64



npm install pdf-parse pdf2json pdf-text-extract

[capture package.json, checkin]
npm install

ts-node convert-pdfs.ts config.json


On windows
F:
cd \syscode\SysMuse\utility\convert-pdfs


npm install
ts-node convert-pdfs.ts config.json

# works
npx ts-node convert-pdfs.ts config.json

# does not work
npx ts-node --esm convert-pdfs.ts config.json

