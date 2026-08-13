import { readFileSync, writeFileSync } from "fs";

// The version is provided by `npm version` via the npm_package_version env var.
const targetVersion = process.env.npm_package_version;

// Read minAppVersion from manifest.json and bump version to the target version.
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

// Update versions.json with the target version and the current minAppVersion.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
