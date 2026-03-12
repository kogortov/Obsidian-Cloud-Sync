<?php
/**
 * Cloud Sync Server Configuration
 * Copy this file to config.php and update the values.
 */

return [
    'db' => [
        'host'     => 'localhost',
        'port'     => 3306,
        'dbname'   => 'cloud_sync',
        'username' => 'your_db_user',
        'password' => 'your_db_password',
        'charset'  => 'utf8mb4',
    ],

    // Token lifetime in seconds (30 days)
    'token_lifetime' => 30 * 24 * 3600,

    // Max login attempts per IP within the window
    'rate_limit' => [
        'max_attempts' => 10,
        'window_seconds' => 900, // 15 minutes
    ],

    // Max file size for upload (bytes) — 50 MB
    'max_file_size' => 50 * 1024 * 1024,
];
