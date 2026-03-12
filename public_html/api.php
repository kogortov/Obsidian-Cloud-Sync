<?php
declare(strict_types=1);

/**
 * Cloud Sync API
 * Single entry point for all sync operations.
 */

// Prevent search engine indexing
header('X-Robots-Tag: noindex, nofollow', true);

// CORS and security headers
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');

// Only allow POST
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Max-Age: 86400');
    http_response_code(204);
    exit;
}

header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Method not allowed', 405);
}

// Load config
$configPath = __DIR__ . '/config.php';
if (!file_exists($configPath)) {
    jsonError('Server not configured. Copy config.example.php to config.php.', 500);
}
$config = require $configPath;

// Connect to database via PDO
try {
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        $config['db']['host'],
        $config['db']['port'],
        $config['db']['dbname'],
        $config['db']['charset']
    );
    $pdo = new PDO($dsn, $config['db']['username'], $config['db']['password'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    jsonError('Database connection failed', 500);
}

// Parse JSON body
$rawBody = file_get_contents('php://input');
$body = json_decode($rawBody ?: '{}', true);
if (!is_array($body)) {
    $body = [];
}

// Route
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':
        handleLogin($pdo, $body, $config);
        break;
    case 'register':
        handleRegister($pdo, $body, $config);
        break;
    case 'vaults':
        handleVaults($pdo, $body);
        break;
    case 'create_vault':
        handleCreateVault($pdo, $body);
        break;
    case 'sync_status':
        handleSyncStatus($pdo, $body);
        break;
    case 'upload':
        handleUpload($pdo, $body, $config);
        break;
    case 'download':
        handleDownload($pdo, $body);
        break;
    case 'delete_file':
        handleDeleteFile($pdo, $body);
        break;
    default:
        jsonError('Unknown action', 400);
}

// ─── Helpers ───────────────────────────────────────────────

function jsonResponse(array $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function jsonError(string $message, int $code = 400): never {
    jsonResponse(['success' => false, 'error' => $message], $code);
}

function getClientIp(): string {
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function checkRateLimit(PDO $pdo, array $config): void {
    $ip = getClientIp();
    $window = $config['rate_limit']['window_seconds'];
    $max = $config['rate_limit']['max_attempts'];

    $stmt = $pdo->prepare(
        'SELECT COUNT(*) as cnt FROM login_attempts WHERE ip_address = ? AND attempted_at > DATE_SUB(NOW(), INTERVAL ? SECOND)'
    );
    $stmt->execute([$ip, $window]);
    $row = $stmt->fetch();

    if ($row && (int)$row['cnt'] >= $max) {
        jsonError('Too many login attempts. Try again later.', 429);
    }
}

function recordLoginAttempt(PDO $pdo): void {
    $stmt = $pdo->prepare('INSERT INTO login_attempts (ip_address) VALUES (?)');
    $stmt->execute([getClientIp()]);
}

function generateToken(): string {
    return bin2hex(random_bytes(48));
}

function authenticateRequest(PDO $pdo): int {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
        jsonError('Authentication required', 401);
    }
    $token = $m[1];

    $stmt = $pdo->prepare(
        'SELECT user_id FROM auth_tokens WHERE token = ? AND expires_at > NOW()'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();

    if (!$row) {
        jsonError('Invalid or expired token', 401);
    }

    return (int)$row['user_id'];
}

function validateVaultAccess(PDO $pdo, string $vaultId, int $userId): void {
    $stmt = $pdo->prepare('SELECT id FROM vaults WHERE id = ? AND user_id = ?');
    $stmt->execute([$vaultId, $userId]);
    if (!$stmt->fetch()) {
        jsonError('Vault not found or access denied', 403);
    }
}

function validatePath(string $path): void {
    // Prevent directory traversal
    if (
        str_contains($path, '..') ||
        str_starts_with($path, '/') ||
        str_contains($path, "\0") ||
        preg_match('/[<>:"|?*]/', $path)
    ) {
        jsonError('Invalid file path', 400);
    }
}

function currentTimestampMs(): int {
    return (int)(microtime(true) * 1000);
}

// ─── Handlers ──────────────────────────────────────────────

function handleLogin(PDO $pdo, array $body, array $config): void {
    $username = trim((string)($body['username'] ?? ''));
    $password = (string)($body['password'] ?? '');

    if ($username === '' || $password === '') {
        jsonError('Username and password are required');
    }

    checkRateLimit($pdo, $config);
    recordLoginAttempt($pdo);

    $stmt = $pdo->prepare('SELECT id, password_hash FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        jsonError('Invalid username or password', 401);
    }

    $token = generateToken();
    $lifetime = $config['token_lifetime'] ?? 2592000;

    $stmt = $pdo->prepare(
        'INSERT INTO auth_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))'
    );
    $stmt->execute([(int)$user['id'], $token, $lifetime]);

    jsonResponse(['success' => true, 'token' => $token]);
}

function handleRegister(PDO $pdo, array $body, array $config): void {
    $username = trim((string)($body['username'] ?? ''));
    $password = (string)($body['password'] ?? '');

    if ($username === '' || strlen($username) < 3 || strlen($username) > 64) {
        jsonError('Username must be 3-64 characters');
    }
    if (strlen($password) < 6) {
        jsonError('Password must be at least 6 characters');
    }
    if (!preg_match('/^[a-zA-Z0-9_\-]+$/', $username)) {
        jsonError('Username may only contain letters, digits, hyphens and underscores');
    }

    checkRateLimit($pdo, $config);

    // Check if username already taken
    $stmt = $pdo->prepare('SELECT id FROM users WHERE username = ?');
    $stmt->execute([$username]);
    if ($stmt->fetch()) {
        jsonError('Username already taken');
    }

    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);

    $stmt = $pdo->prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    $stmt->execute([$username, $hash]);
    $userId = (int)$pdo->lastInsertId();

    $token = generateToken();
    $lifetime = $config['token_lifetime'] ?? 2592000;

    $stmt = $pdo->prepare(
        'INSERT INTO auth_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))'
    );
    $stmt->execute([$userId, $token, $lifetime]);

    jsonResponse(['success' => true, 'token' => $token]);
}

function handleVaults(PDO $pdo, array $body): void {
    $userId = authenticateRequest($pdo);

    $stmt = $pdo->prepare('SELECT id, name FROM vaults WHERE user_id = ?');
    $stmt->execute([$userId]);
    $vaults = $stmt->fetchAll();

    jsonResponse(['success' => true, 'vaults' => $vaults]);
}

function handleCreateVault(PDO $pdo, array $body): void {
    $userId = authenticateRequest($pdo);
    $name = trim((string)($body['name'] ?? ''));

    if ($name === '' || strlen($name) > 128) {
        jsonError('Vault name must be 1-128 characters');
    }

    // Check for duplicate name
    $stmt = $pdo->prepare('SELECT id FROM vaults WHERE user_id = ? AND name = ?');
    $stmt->execute([$userId, $name]);
    if ($stmt->fetch()) {
        jsonError('Vault with this name already exists');
    }

    // Generate UUID v4
    $uuid = sprintf(
        '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        random_int(0, 0xffff), random_int(0, 0xffff),
        random_int(0, 0xffff),
        random_int(0, 0x0fff) | 0x4000,
        random_int(0, 0x3fff) | 0x8000,
        random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0xffff)
    );

    $stmt = $pdo->prepare('INSERT INTO vaults (id, user_id, name) VALUES (?, ?, ?)');
    $stmt->execute([$uuid, $userId, $name]);

    jsonResponse(['success' => true, 'vault_id' => $uuid]);
}

function handleSyncStatus(PDO $pdo, array $body): void {
    $userId = authenticateRequest($pdo);
    $vaultId = (string)($body['vault_id'] ?? '');
    $since = (int)($body['since'] ?? 0);

    if ($vaultId === '') {
        jsonError('vault_id is required');
    }

    validateVaultAccess($pdo, $vaultId, $userId);

    $stmt = $pdo->prepare(
        'SELECT path, hash, updated_at, deleted FROM files WHERE vault_id = ? AND updated_at > ?'
    );
    $stmt->execute([$vaultId, $since]);
    $files = $stmt->fetchAll();

    // Cast types
    foreach ($files as &$f) {
        $f['updated_at'] = (int)$f['updated_at'];
        $f['deleted'] = (bool)$f['deleted'];
    }

    jsonResponse([
        'success'     => true,
        'files'       => $files,
        'server_time' => currentTimestampMs(),
    ]);
}

function handleUpload(PDO $pdo, array $body, array $config): void {
    $userId = authenticateRequest($pdo);
    $vaultId = (string)($body['vault_id'] ?? '');
    $path = (string)($body['path'] ?? '');
    $content = (string)($body['content'] ?? '');
    $hash = (string)($body['hash'] ?? '');

    if ($vaultId === '' || $path === '' || $hash === '') {
        jsonError('vault_id, path, content and hash are required');
    }

    validateVaultAccess($pdo, $vaultId, $userId);
    validatePath($path);

    // Decode and check size
    $decoded = base64_decode($content, true);
    if ($decoded === false) {
        jsonError('Invalid base64 content');
    }

    $maxSize = $config['max_file_size'] ?? 52428800;
    if (strlen($decoded) > $maxSize) {
        jsonError('File too large');
    }

    // Upsert: check if file exists
    $stmt = $pdo->prepare('SELECT id FROM files WHERE vault_id = ? AND path = ?');
    $stmt->execute([$vaultId, $path]);
    $existing = $stmt->fetch();

    $now = currentTimestampMs();

    if ($existing) {
        $stmt = $pdo->prepare(
            'UPDATE files SET content = ?, hash = ?, deleted = 0, updated_at = ? WHERE id = ?'
        );
        $stmt->execute([$decoded, $hash, $now, (int)$existing['id']]);
    } else {
        $stmt = $pdo->prepare(
            'INSERT INTO files (vault_id, path, content, hash, deleted, updated_at) VALUES (?, ?, ?, ?, 0, ?)'
        );
        $stmt->execute([$vaultId, $path, $decoded, $hash, $now]);
    }

    jsonResponse(['success' => true, 'hash' => $hash]);
}

function handleDownload(PDO $pdo, array $body): void {
    $userId = authenticateRequest($pdo);
    $vaultId = (string)($body['vault_id'] ?? '');
    $path = (string)($body['path'] ?? '');

    if ($vaultId === '' || $path === '') {
        jsonError('vault_id and path are required');
    }

    validateVaultAccess($pdo, $vaultId, $userId);
    validatePath($path);

    $stmt = $pdo->prepare(
        'SELECT content, hash FROM files WHERE vault_id = ? AND path = ? AND deleted = 0'
    );
    $stmt->execute([$vaultId, $path]);
    $row = $stmt->fetch();

    if (!$row) {
        jsonError('File not found', 404);
    }

    jsonResponse([
        'success' => true,
        'content' => base64_encode($row['content']),
        'hash'    => $row['hash'],
    ]);
}

function handleDeleteFile(PDO $pdo, array $body): void {
    $userId = authenticateRequest($pdo);
    $vaultId = (string)($body['vault_id'] ?? '');
    $path = (string)($body['path'] ?? '');

    if ($vaultId === '' || $path === '') {
        jsonError('vault_id and path are required');
    }

    validateVaultAccess($pdo, $vaultId, $userId);
    validatePath($path);

    $now = currentTimestampMs();

    $stmt = $pdo->prepare(
        'UPDATE files SET deleted = 1, updated_at = ? WHERE vault_id = ? AND path = ?'
    );
    $stmt->execute([$now, $vaultId, $path]);

    jsonResponse(['success' => true]);
}
