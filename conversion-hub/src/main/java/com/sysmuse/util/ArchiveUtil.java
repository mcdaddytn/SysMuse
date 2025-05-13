package com.sysmuse.util;

import java.io.*;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import java.util.zip.*;
import javax.crypto.Cipher;
import javax.crypto.CipherOutputStream;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import javax.crypto.spec.IvParameterSpec;
import java.security.SecureRandom;

/**
 * Utility class for creating ZIP archives with optional password protection
 */
public class ArchiveUtil {

    private static final String ENCRYPTION_ALGORITHM = "AES";
    private static final String TRANSFORMATION = "AES/CBC/PKCS5Padding";
    private static final int KEY_LENGTH = 256;
    private static final int IV_LENGTH = 16;

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
        LoggingUtil.info("Creating ZIP archive: %s", zipPath);
        LoggingUtil.info("Archiving %d files", sourceFiles.size());

        // Create parent directories if they don't exist
        Files.createDirectories(zipPath.getParent());
        /*
        try (FileOutputStream fos = new FileOutputStream(zipPath.toFile());
             ZipOutputStream zos = new ZipOutputStream(fos)) {

         */

        try {
            FileOutputStream fos = new FileOutputStream(zipPath.toFile());
            ZipOutputStream zos = new ZipOutputStream(fos);

            // If password is provided, we'll use a simple ZIP-based encryption approach
            // Note: For production use, consider using zip4j library for better security

            for (Path sourceFile : sourceFiles) {
                if (!Files.exists(sourceFile)) {
                    LoggingUtil.warn("Source file does not exist, skipping: %s", sourceFile);
                    continue;
                }

                String entryName = baseDir.isEmpty() ? sourceFile.getFileName().toString() :
                        baseDir + "/" + sourceFile.getFileName().toString();

                ZipEntry zipEntry = new ZipEntry(entryName);
                zos.putNextEntry(zipEntry);

                if (password != null && !password.trim().isEmpty()) {
                    // Write encrypted content
                    writeEncryptedFile(sourceFile, zos, password);
                } else {
                    // Write plain content
                    Files.copy(sourceFile, zos);
                }

                // exception here, stream is closed
                zos.closeEntry();
                LoggingUtil.debug("Added to archive: %s", entryName);
            }
            // gm: adding this
            zos.close();

            LoggingUtil.info("ZIP archive created successfully: %s", zipPath);
        }
        catch (Exception e) {
            LoggingUtil.debug("archiveFiles exception: %s", e.getMessage());
        }
    }

    /**
     * Write an encrypted file to the ZIP output stream
     */
    private static void writeEncryptedFile(Path sourceFile, ZipOutputStream zos, String password) throws IOException {
        LoggingUtil.info("writeEncryptedFile: " + sourceFile);
        try {
            // Generate key from password
            SecretKey secretKey = generateKeyFromPassword(password);

            // Generate IV
            byte[] iv = new byte[IV_LENGTH];
            new SecureRandom().nextBytes(iv);
            IvParameterSpec ivSpec = new IvParameterSpec(iv);

            // Write IV first (needed for decryption)
            zos.write(iv);

            // Create cipher
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivSpec);

            // Write encrypted content
            try (FileInputStream fis = new FileInputStream(sourceFile.toFile())) {
                // Create cipher output stream that wraps the zip stream but doesn't close it
                CipherOutputStream cos = new CipherOutputStream(zos, cipher) {
                    @Override
                    public void close() throws IOException {
                        // Override close to just flush instead of closing the underlying stream
                        flush();
                    }
                };

                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = fis.read(buffer)) != -1) {
                    cos.write(buffer, 0, bytesRead);
                }
                cos.close(); // This will now just flush, not close the ZipOutputStream
            }
        } catch (Exception e) {
            throw new IOException("Failed to encrypt file: " + sourceFile, e);
        }
        LoggingUtil.info("writeEncryptedFile completed: " + sourceFile);
    }

    /**
     * Write an encrypted file to the ZIP output stream
     */
    private static void writeEncryptedFile_Old(Path sourceFile, ZipOutputStream zos, String password) throws IOException {
        LoggingUtil.info("writeEncryptedFile: %s", sourceFile);
        try {
            // Generate key from password
            SecretKey secretKey = generateKeyFromPassword(password);

            // Generate IV
            byte[] iv = new byte[IV_LENGTH];
            new SecureRandom().nextBytes(iv);
            IvParameterSpec ivSpec = new IvParameterSpec(iv);

            // Write IV first (needed for decryption)
            zos.write(iv);

            // Create cipher
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivSpec);

            // Write encrypted content
            try (FileInputStream fis = new FileInputStream(sourceFile.toFile());
                 CipherOutputStream cos = new CipherOutputStream(zos, cipher)) {

                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = fis.read(buffer)) != -1) {
                    cos.write(buffer, 0, bytesRead);
                }
            }
        } catch (Exception e) {
            throw new IOException("Failed to encrypt file: " + sourceFile, e);
        }
        LoggingUtil.info("writeEncryptedFile completed: %s", sourceFile);
    }

    /**
     * Generate a secret key from password using PBKDF2
     */
    private static SecretKey generateKeyFromPassword(String password) throws Exception {
        // For simplicity, using a basic approach
        // In production, use PBKDF2 with proper salt
        byte[] passwordBytes = password.getBytes("UTF-8");
        byte[] keyBytes = new byte[32]; // 256 bits

        // Simple key derivation (not secure for production)
        System.arraycopy(passwordBytes, 0, keyBytes, 0,
                Math.min(passwordBytes.length, keyBytes.length));

        return new SecretKeySpec(keyBytes, ENCRYPTION_ALGORITHM);
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
            LoggingUtil.warn("No output files found to archive in directory: %s", outputDirectory);
            return;
        }

        // Create archive path
        Path archivePath = outputDir.resolve(baseFileName + archiveSuffix + ".zip");

        // Archive all found files
        archiveFiles(outputFiles, archivePath, password, "");

        LoggingUtil.info("Archived %d files into: %s", outputFiles.size(), archivePath);
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

        LoggingUtil.info("Cleaning up %d archived files", archivedFiles.size());

        for (Path file : archivedFiles) {
            try {
                Files.deleteIfExists(file);
                LoggingUtil.debug("Deleted: %s", file);
            } catch (IOException e) {
                LoggingUtil.warn("Failed to delete file: %s - %s", file, e.getMessage());
            }
        }
    }
}

