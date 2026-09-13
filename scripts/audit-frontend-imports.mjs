#!/usr/bin/env node
/**
 * scripts/audit-frontend-imports.mjs
 * 静态审计前端模块的具名导入（Named Imports），确保所有导入符号在目标文件中均有合法导出。
 * 遵循 R35-2 规范：防范模块拆分、重构导致的悬空或失效导入。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendSrc = path.join(rootDir, 'desktop', 'gui', 'frontend', 'src');

function getAllJsFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const dirent of list) {
        const fullPath = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
            results = results.concat(getAllJsFiles(fullPath));
        } else if (dirent.isFile() && dirent.name.endsWith('.js')) {
            results.push(fullPath);
        }
    }
    return results;
}

function parseExports(filePath) {
    const code = fs.readFileSync(filePath, 'utf-8');
    const exports = new Set();
    let hasDefaultExport = false;

    // export [async] function name
    const funcMatches = code.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g);
    for (const m of funcMatches) {
        exports.add(m[1]);
    }

    // export const/let/var name
    const varMatches = code.matchAll(/export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)/g);
    for (const m of varMatches) {
        exports.add(m[1]);
    }

    // export class name
    const classMatches = code.matchAll(/export\s+class\s+([a-zA-Z0-9_$]+)/g);
    for (const m of classMatches) {
        exports.add(m[1]);
    }

    // export default
    if (/export\s+default\b/.test(code)) {
        hasDefaultExport = true;
        exports.add('default');
    }

    // export { a, b as c }
    const blockMatches = code.matchAll(/export\s*\{([^}]+)\}/g);
    for (const m of blockMatches) {
        const items = m[1].split(',');
        for (let item of items) {
            item = item.trim();
            if (!item) continue;
            const parts = item.split(/\s+as\s+/);
            const exportName = parts.length > 1 ? parts[1].trim() : parts[0].trim();
            if (exportName) {
                exports.add(exportName);
            }
        }
    }

    return { exports, hasDefaultExport };
}

function auditImports() {
    const jsFiles = getAllJsFiles(frontendSrc);
    const fileExportsCache = new Map();
    let totalImportsChecked = 0;
    const errors = [];

    // Pre-cache all exports
    for (const file of jsFiles) {
        fileExportsCache.set(file, parseExports(file));
    }

    // Check imports in each file
    for (const file of jsFiles) {
        const relativeFile = path.relative(rootDir, file);
        const code = fs.readFileSync(file, 'utf-8');

        // Match named imports: import { a, b as c } from './module.js'
        const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(code)) !== null) {
            const rawItems = match[1];
            const importPath = match[2];

            // Only audit relative local imports
            if (!importPath.startsWith('.')) {
                continue;
            }

            const targetPath = path.resolve(path.dirname(file), importPath);
            let resolvedTarget = targetPath;
            if (!fs.existsSync(resolvedTarget) && fs.existsSync(resolvedTarget + '.js')) {
                resolvedTarget = resolvedTarget + '.js';
            }

            if (!fs.existsSync(resolvedTarget)) {
                errors.push(`[FILE NOT FOUND] ${relativeFile}: imported file "${importPath}" does not exist (resolved: ${path.relative(rootDir, resolvedTarget)})`);
                continue;
            }

            let targetExports = fileExportsCache.get(resolvedTarget);
            if (!targetExports) {
                targetExports = parseExports(resolvedTarget);
                fileExportsCache.set(resolvedTarget, targetExports);
            }

            const items = rawItems.split(',');
            for (let item of items) {
                item = item.trim();
                if (!item) continue;
                // e.g. "a as b" -> we need "a" to exist in target exports
                const parts = item.split(/\s+as\s+/);
                const originalSymbol = parts[0].trim();
                totalImportsChecked++;

                if (!targetExports.exports.has(originalSymbol)) {
                    errors.push(`[UNDEFINED IMPORT] ${relativeFile}: imports "${originalSymbol}" from "${importPath}", but "${originalSymbol}" is NOT exported by ${path.relative(rootDir, resolvedTarget)}`);
                }
            }
        }
    }

    if (errors.length > 0) {
        console.error(`\x1b[31m[FAIL] Frontend import audit found ${errors.length} error(s):\x1b[0m`);
        for (const err of errors) {
            console.error(`  ❌ ${err}`);
        }
        process.exit(1);
    } else {
        console.log(`\x1b[32m[PASS] Frontend import audit passed: checked ${totalImportsChecked} named import symbols across ${jsFiles.length} files. Zero dead imports.\x1b[0m`);
    }
}

auditImports();
