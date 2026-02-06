# Archive-Dirs (Robocopy wrapper)

This package provides a **resume-friendly** way to copy/archive a list of directories to a destination drive on Windows.

- Uses **Robocopy** (built into Windows) for reliable copying and restartability.
- Reads a newline-delimited list of source directories from a flat text file.
- Continues processing the remaining items even if one directory errors.
- Creates a timestamped log folder under the destination root with per-item logs plus a summary CSV/JSON.

---

## Files

- `Archive-Dirs.ps1` — PowerShell implementation (core logic)
- `Archive-Dirs.bat` — Batch wrapper (easy to run from CMD or double-click)

---

## List file format

A plain text file, one directory per line:

```text
# Lines starting with # are comments
I:\GLP Documents
I:\Other Folder
\\NAS01\Share\Some Folder
```

Blank lines are ignored.

---

## How destination mapping works

Two mapping modes are supported:

### 1) Default: include device prefix (recommended)
This reduces collisions when two sources have the same leaf folder name.

Examples:

- `I:\GLP Documents` → `H:\GrassLabelArchive\I\GLP Documents`
- `\\NAS01\Share\GLP Documents` → `H:\GrassLabelArchive\UNC\NAS01\Share\GLP Documents`

### 2) Flatten: no device prefix
This places each source directly under the destination root using only the leaf folder name.

Examples:

- `I:\GLP Documents` → `H:\GrassLabelArchive\GLP Documents`
- `\\NAS01\Share\GLP Documents` → `H:\GrassLabelArchive\GLP Documents`

**Warning:** if multiple sources share the same leaf folder name, they will collide in this mode.

---

## Resume behavior (skip existing by default)

By default, the script is configured to **skip copying files that already exist in the destination**, so you can cancel and restart a job and it will continue without re-copying.

Implementation detail:
- Uses Robocopy plus exclusion flags: `/XO /XN /XC` to only copy files that are missing in destination.

If you want Robocopy to overwrite/update files, you can disable this via the `--overwrite` option (batch) or `-SkipExisting:$false` (PowerShell).

---

## Running via the batch file

### Default behavior (include device + skip existing)
```bat
Archive-Dirs.bat "C:\lists\dirs.txt" "H:\GrassLabelArchive"
```

### Flatten destination mapping (no drive/UNC prefix)
```bat
Archive-Dirs.bat "C:\lists\dirs.txt" "H:\GrassLabelArchive" --no-device
```

### Allow overwriting/updating existing destination files
```bat
Archive-Dirs.bat "C:\lists\dirs.txt" "H:\GrassLabelArchive" --overwrite
```

You can combine options:
```bat
Archive-Dirs.bat "C:\lists\dirs.txt" "H:\GrassLabelArchive" --no-device --overwrite
```

---

## Running PowerShell directly

Default behavior:
```powershell
powershell.exe -ExecutionPolicy Bypass -File .\Archive-Dirs.ps1 -ListFile "C:\lists\dirs.txt" -DestRoot "H:\GrassLabelArchive"
```

Flatten destination mapping:
```powershell
powershell.exe -ExecutionPolicy Bypass -File .\Archive-Dirs.ps1 -ListFile "C:\lists\dirs.txt" -DestRoot "H:\GrassLabelArchive" -IncludeDevice:$false
```

Allow overwrites (disable skip-existing):
```powershell
powershell.exe -ExecutionPolicy Bypass -File .\Archive-Dirs.ps1 -ListFile "C:\lists\dirs.txt" -DestRoot "H:\GrassLabelArchive" -SkipExisting:$false
```

---

## Logs and summaries

Each run creates a timestamped folder under `DestRoot`, for example:

`H:\GrassLabelArchive\_archive_logs_20260206_193012\`

Inside:
- `robocopy_<...>.log` per source directory
- `summary.csv`
- `summary.json`

Robocopy exit codes:
- `0–7` are generally “success” (including “some files skipped”).
- `>=8` indicates failure for that item.

The script reports per-item Status:
- `OK` = Robocopy exit code < 8
- `FAILED` = Robocopy exit code >= 8
- `ERROR` = script-level exception (e.g., source path missing)

---

## Customization notes

If you need:
- preserving NTFS ACLs (permissions): change `/COPY:DAT` to `/COPY:DATS` and consider running elevated.
- more retries on flaky networks: increase `/R` and `/W`.

Those changes are in `Archive-Dirs.ps1` in the `$roboCommon` array.
