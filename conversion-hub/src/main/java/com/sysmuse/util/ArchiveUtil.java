package com.sysmuse.util;

import java.io.*;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.ZipParameters;
import net.lingala.zip4j.model.enums.EncryptionMethod;
import net.lingala.zip4j.model.enums.AesKeyStrength;

/**
 * Utility class for creating ZIP archives with optional password protection
 * Updated to use Zip4j for standard password-protected ZIP files
 */
public class ArchiveUtil {

    /**
     * Archive a single file into a ZIP archive
     *
     * @param sourceFile The file to archive
     * @param zipPath The path for the output ZIP file
     * @param password Optional password for encryption (null for no encryption)
     * @throws IOException If archiving fails
     */
    public static void archiveFile(Path sourceFile, Path zipPath, String password) throws IOException {
        List<Path> files = Arrays.asList(sourceFile);
        archiveFiles(files, zipPath, password, "");
    }

    /**
     * Archive multiple files into a ZIP archive
     *
     * @param sourceFiles List of files to archive
     * @param zipPath The path for the output ZIP file
     * @param password Optional password for encryption (null for no encryption)
     * @throws IOException If archiving fails
     */
    public static void archiveFiles(List<Path> sourceFiles, Path zipPath, String password) throws IOException {
        archiveFiles(sourceFiles, zipPath, password, "");
    }

    /**
     * Archive multiple files into a ZIP archive with a base directory structure
     *
     * @param sourceFiles List of files to archive
     * @param zipPath The path for the output ZIP file
     * @param password Optional password for encryption (null for no encryption)
     * @param baseDir Base directory name for files in the archive
     * @throws IOException If archiving fails
     */
    public static void archiveFiles(List<Path> sourceFiles, Path zipPath, String password, String baseDir) throws IOException {
        LoggingUtil.info("Creating ZIP archive: " + zipPath);
        LoggingUtil.info("Archiving " + sourceFiles.size() + " files");

        // Create parent directories if they don't exist
        Files.createDirectories(zipPath.getParent());

        try {
            // Create ZipFile object
            ZipFile zipFile = new ZipFile(zipPath.toFile());

            // Set password if provided
            if (password != null && !password.trim().isEmpty()) {
                LoggingUtil.info("Creating password-protected archive");

                // Set password on the ZipFile object
                zipFile.setPassword(password.toCharArray());

                // Set encryption parameters
                ZipParameters zipParameters = new ZipParameters();
                zipParameters.setEncryptFiles(true);
                zipParameters.setEncryptionMethod(EncryptionMethod.AES);
                zipParameters.setAesKeyStrength(AesKeyStrength.KEY_STRENGTH_256);

                // Add each file to the archive
                for (Path sourceFile : sourceFiles) {
                    if (!Files.exists(sourceFile)) {
                        LoggingUtil.warn("Source file does not exist, skipping: " + sourceFile);
                        continue;
                    }

                    // Set the file name in archive (with optional base directory)
                    String fileNameInZip = baseDir.isEmpty() ? sourceFile.getFileName().toString() :
                            baseDir + "/" + sourceFile.getFileName().toString();
                    zipParameters.setFileNameInZip(fileNameInZip);

                    // Add file to archive with password
                    zipFile.addFile(sourceFile.toFile(), zipParameters);

                    LoggingUtil.debug("Added to archive: " + fileNameInZip);
                }
            } else {
                LoggingUtil.info("Creating unencrypted archive");

                // No password - create unencrypted archive
                for (Path sourceFile : sourceFiles) {
                    if (!Files.exists(sourceFile)) {
                        LoggingUtil.warn("Source file does not exist, skipping: " + sourceFile);
                        continue;
                    }

                    // Add file to archive without encryption
                    zipFile.addFile(sourceFile.toFile());
                    LoggingUtil.debug("Added to archive: " + sourceFile.getFileName().toString());
                }
            }

            LoggingUtil.info("ZIP archive created successfully: " + zipPath);

        } catch (Exception e) {
            LoggingUtil.error("Failed to create archive: " + e.getMessage(), e);
            throw new IOException("Failed to create archive", e);
        }
    }

    /**
     * Create archives for all output files based on the pattern
     *
     * @param baseFilePath The base file path (without extension)
     * @param outputDirectory The directory containing output files
     * @param archiveSuffix The suffix for the archive file
     * @param password Optional password for encryption
     * @throws IOException If archiving fails
     */
    public static void archiveOutputFiles(String baseFilePath, String outputDirectory,
                                          String archiveSuffix, String password) throws IOException {
        Path outputDir = Paths.get(outputDirectory);
        Path basePath = Paths.get(baseFilePath);
        String baseFileName = basePath.getFileName().toString();

        // Find all output files that match the pattern
        List<Path> outputFiles = new ArrayList<>();

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(outputDir)) {
            for (Path file : stream) {
                String fileName = file.getFileName().toString();
                if (fileName.startsWith(baseFileName) && isOutputFile(fileName)) {
                    outputFiles.add(file);
                }
            }
        }

        if (outputFiles.isEmpty()) {
            LoggingUtil.warn("No output files found to archive in directory: " + outputDirectory);
            return;
        }

        // Create archive path
        Path archivePath = outputDir.resolve(baseFileName + archiveSuffix + ".zip");

        // Archive all found files
        archiveFiles(outputFiles, archivePath, password, "");

        LoggingUtil.info("Archived " + outputFiles.size() + " files into: " + archivePath);
    }

    /**
     * Check if a file is an output file based on extension
     */
    private static boolean isOutputFile(String fileName) {
        String lowerCase = fileName.toLowerCase();
        return lowerCase.endsWith(".csv") || lowerCase.endsWith(".json");
    }

    /**
     * Delete all files that were archived
     *
     * @param archivedFiles List of files that were archived
     * @param keepOriginals If true, keep the original files
     */
    public static void cleanupArchivedFiles(List<Path> archivedFiles, boolean keepOriginals) {
        if (keepOriginals) {
            LoggingUtil.info("Keeping original files as configured");
            return;
        }

        LoggingUtil.info("Cleaning up " + archivedFiles.size() + " archived files");

        for (Path file : archivedFiles) {
            try {
                Files.deleteIfExists(file);
                LoggingUtil.debug("Deleted: " + file);
            } catch (IOException e) {
                LoggingUtil.warn("Failed to delete file: " + file + " - " + e.getMessage());
            }
        }
    }

    /**
     * Test if a ZIP file is password protected
     *
     * @param zipPath Path to the ZIP file
     * @return true if the file is password protected
     */
    public static boolean isPasswordProtected(Path zipPath) {
        try {
            ZipFile zipFile = new ZipFile(zipPath.toFile());
            return zipFile.isEncrypted();
        } catch (Exception e) {
            LoggingUtil.error("Error checking if ZIP is password protected: " + e.getMessage());
            return false;
        }
    }

    /**
     * Extract files from a password-protected ZIP archive
     *
     * @param zipPath Path to the ZIP file
     * @param extractPath Directory to extract files to
     * @param password Password for decryption
     * @throws IOException If extraction fails
     */
    public static void extractPasswordProtectedZip(Path zipPath, Path extractPath, String password) throws IOException {
        try {
            ZipFile zipFile = new ZipFile(zipPath.toFile());

            if (zipFile.isEncrypted()) {
                if (password == null || password.trim().isEmpty()) {
                    throw new IOException("ZIP file is password protected but no password provided");
                }
                zipFile.setPassword(password.toCharArray());
            }

            zipFile.extractAll(extractPath.toString());
            LoggingUtil.info("Extracted ZIP archive to: " + extractPath);

        } catch (Exception e) {
            LoggingUtil.error("Failed to extract archive: " + e.getMessage(), e);
            throw new IOException("Failed to extract archive", e);
        }
    }
}

