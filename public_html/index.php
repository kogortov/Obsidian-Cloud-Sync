<?php
// Prevent direct access — return nothing useful
header('X-Robots-Tag: noindex, nofollow');
header('Content-Type: text/plain');
http_response_code(403);
echo 'Access denied.';
