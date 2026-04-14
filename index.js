const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const express = require('express');

const info = {
    id: 'server-plugin-switch',
    name: 'Server Plugin Switch / 后端插件切换台',
    description: '查看后端插件、切换下次启动启用状态，并统一安排重启流程。',
};

const STORAGE_DIR = path.resolve(process.cwd(), 'data', '.server-plugin-switch');
const CONFIG_PATH = path.join(STORAGE_DIR, 'config.json');
const DISABLED_SUFFIX = '.spm-disabled';
const MAX_RESULT_DETAILS = 6000;

function buildError(message, statusCode = 400, details = '') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.details = details;
    return error;
}

function trimToEmpty(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeRestartMode(value) {
    return trimToEmpty(value) === 'custom' ? 'custom' : 'auto';
}

function normalizeRestartDelay(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 800;
    }
    return Math.max(100, Math.min(60_000, Math.trunc(parsed)));
}

function normalizeRelativePath(value) {
    const cleaned = String(value || '').replace(/\\/g, '/').replace(/^\.?\//, '');
    return cleaned
        .split('/')
        .filter(Boolean)
        .join('/');
}

function normalizeTimestamp(value) {
    const text = trimToEmpty(value);
    if (!text) {
        return '';
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function truncateText(value, maxLength = MAX_RESULT_DETAILS) {
    const text = String(value || '');
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength - 1)}…`;
}

function isSafePluginName(name) {
    const text = trimToEmpty(name);
    if (!text) {
        return false;
    }
    if (text.includes('/') || text.includes('\\') || text.includes('..')) {
        return false;
    }
    return true;
}

function isPluginScriptName(name) {
    return /\.(js|cjs|mjs)$/i.test(String(name || ''));
}

function getPluginsRootDir() {
    return path.resolve(__dirname, '..');
}

function getServerRootDir() {
    const argv1 = String(process.argv?.[1] || '').trim();
    const absoluteEntry = argv1
        ? (path.isAbsolute(argv1) ? argv1 : path.resolve(process.cwd(), argv1))
        : process.cwd();
    return path.dirname(absoluteEntry);
}

function buildShellSpec(command) {
    if (process.platform === 'win32') {
        return {
            command: 'cmd.exe',
            args: ['/d', '/s', '/c', command],
            label: 'cmd.exe /d /s /c',
        };
    }

    return {
        command: 'sh',
        args: ['-lc', command],
        label: 'sh -lc',
    };
}

function normalizeInfo(rawInfo) {
    if (!rawInfo || typeof rawInfo !== 'object') {
        return null;
    }

    return {
        id: trimToEmpty(rawInfo.id),
        name: trimToEmpty(rawInfo.name),
        description: trimToEmpty(rawInfo.description),
    };
}

function normalizePackageJson(rawPackage) {
    if (!rawPackage || typeof rawPackage !== 'object') {
        return null;
    }

    const name = trimToEmpty(rawPackage.name);
    const version = trimToEmpty(rawPackage.version);
    const main = trimToEmpty(rawPackage.main);

    if (!name && !version && !main) {
        return null;
    }

    return {
        ...(name ? { name } : {}),
        ...(version ? { version } : {}),
        ...(main ? { main } : {}),
    };
}

function normalizeSnapshot(rawSnapshot) {
    if (!rawSnapshot || typeof rawSnapshot !== 'object') {
        return null;
    }

    const snapshot = {
        info: normalizeInfo(rawSnapshot.info),
        packageJson: normalizePackageJson(rawSnapshot.packageJson),
        entryRelativePath: normalizeRelativePath(rawSnapshot.entryRelativePath),
        hasExit: Boolean(rawSnapshot.hasExit),
    };

    if (!snapshot.info && !snapshot.packageJson && !snapshot.entryRelativePath && !snapshot.hasExit) {
        return null;
    }

    return snapshot;
}

function normalizePluginState(rawState) {
    if (!rawState || typeof rawState !== 'object') {
        return null;
    }

    const kind = rawState.kind === 'file' ? 'file' : 'directory';
    const state = {
        kind,
        originalEntryRelativePath: '',
        disabledEntryRelativePath: '',
        originalFileName: '',
        disabledFileName: '',
        disabledEntries: [],
        updatedAt: normalizeTimestamp(rawState.updatedAt),
        snapshot: normalizeSnapshot(rawState.snapshot),
    };

    if (kind === 'directory') {
        state.originalEntryRelativePath = normalizeRelativePath(rawState.originalEntryRelativePath);
        state.disabledEntryRelativePath = normalizeRelativePath(rawState.disabledEntryRelativePath);
        if (Array.isArray(rawState.disabledEntries)) {
            state.disabledEntries = rawState.disabledEntries
                .map((entry) => ({
                    originalRelativePath: normalizeRelativePath(entry?.originalRelativePath),
                    disabledRelativePath: normalizeRelativePath(entry?.disabledRelativePath),
                }))
                .filter((entry) => entry.originalRelativePath && entry.disabledRelativePath);
        }
        if (state.disabledEntries.length === 0 && state.originalEntryRelativePath && state.disabledEntryRelativePath) {
            state.disabledEntries = [
                {
                    originalRelativePath: state.originalEntryRelativePath,
                    disabledRelativePath: state.disabledEntryRelativePath,
                },
            ];
        }
        if (!state.originalEntryRelativePath || !state.disabledEntryRelativePath) {
            return null;
        }
    } else {
        state.originalFileName = trimToEmpty(rawState.originalFileName);
        state.disabledFileName = trimToEmpty(rawState.disabledFileName);
        if (!state.originalFileName || !state.disabledFileName) {
            return null;
        }
    }

    return state;
}

function normalizeLastRestartResult(rawResult) {
    if (!rawResult || typeof rawResult !== 'object') {
        return null;
    }

    const at = normalizeTimestamp(rawResult.at);
    const message = trimToEmpty(rawResult.message);
    const kind = trimToEmpty(rawResult.kind) || 'restart';
    const mode = trimToEmpty(rawResult.mode) || kind;
    const details = truncateText(rawResult.details || '');

    if (!at || !message) {
        return null;
    }

    return {
        ok: rawResult.ok !== false,
        at,
        kind,
        mode,
        message,
        ...(details ? { details } : {}),
    };
}

function buildDefaultConfig() {
    return {
        restartMode: 'auto',
        customCommand: '',
        restartDelayMs: 800,
        pluginStates: {},
        lastRestartResult: null,
    };
}

function normalizeConfig(rawConfig) {
    const config = buildDefaultConfig();
    config.restartMode = normalizeRestartMode(rawConfig?.restartMode);
    config.customCommand = trimToEmpty(rawConfig?.customCommand);
    config.restartDelayMs = normalizeRestartDelay(rawConfig?.restartDelayMs);
    config.lastRestartResult = normalizeLastRestartResult(rawConfig?.lastRestartResult);

    if (rawConfig?.pluginStates && typeof rawConfig.pluginStates === 'object') {
        for (const [key, value] of Object.entries(rawConfig.pluginStates)) {
            if (!isSafePluginName(key)) {
                continue;
            }
            const normalizedState = normalizePluginState(value);
            if (normalizedState) {
                config.pluginStates[key] = normalizedState;
            }
        }
    }

    return config;
}

async function ensureDirectoryExists(targetPath) {
    await fsp.mkdir(targetPath, { recursive: true });
}

async function saveConfig(config) {
    const normalized = normalizeConfig(config);
    await ensureDirectoryExists(STORAGE_DIR);
    await fsp.writeFile(CONFIG_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}

async function readConfig() {
    await ensureDirectoryExists(STORAGE_DIR);

    try {
        const text = await fsp.readFile(CONFIG_PATH, 'utf8');
        return normalizeConfig(JSON.parse(text));
    } catch (error) {
        if (error && error.code !== 'ENOENT') {
            console.warn('[server-plugin-switch] 读取配置失败，将回退到默认配置：', error.message);
        }
        const defaults = buildDefaultConfig();
        return await saveConfig(defaults);
    }
}

function toDisplayPath(basePath, targetPath) {
    const relative = normalizeRelativePath(path.relative(basePath, targetPath));
    return relative || '.';
}

function makeSnapshot(record) {
    return {
        info: record.info || null,
        packageJson: record.packageJson || null,
        entryRelativePath: record.entryRelativePath || '',
        hasExit: Boolean(record.hasExit),
    };
}

function resolveDirectoryEntryFile(directoryPath) {
    const packageJsonPath = path.join(directoryPath, 'package.json');
    let packageJson = null;
    let packageMainPath = '';
    const rootIndexFiles = [];

    for (const candidate of ['index.js', 'index.cjs', 'index.mjs']) {
        const fullPath = path.join(directoryPath, candidate);
        if (fs.existsSync(fullPath)) {
            rootIndexFiles.push(fullPath);
        }
    }

    if (fs.existsSync(packageJsonPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            packageJson = normalizePackageJson(parsed);
            if (packageJson?.main) {
                packageMainPath = path.join(directoryPath, packageJson.main);
                if (fs.existsSync(packageMainPath)) {
                    return {
                        packageJson,
                        entryFile: packageMainPath,
                        packageMainPath,
                        packageMainMissing: false,
                        hasLoaderCandidate: true,
                        rootIndexFiles,
                    };
                }
            }
        } catch (error) {
            packageJson = null;
        }
    }

    if (rootIndexFiles.length > 0) {
        return {
            packageJson,
            entryFile: rootIndexFiles[0],
            packageMainPath,
            packageMainMissing: Boolean(packageMainPath),
            hasLoaderCandidate: true,
            rootIndexFiles,
        };
    }

    return {
        packageJson,
        entryFile: '',
        packageMainPath,
        packageMainMissing: Boolean(packageMainPath),
        hasLoaderCandidate: Boolean(packageJson || packageMainPath),
        rootIndexFiles,
    };
}

function listDirectoryDisableTargets(directoryPath, resolved) {
    const targets = new Map();

    if (resolved.entryFile) {
        const relativePath = toDisplayPath(directoryPath, resolved.entryFile);
        targets.set(relativePath, {
            originalRelativePath: relativePath,
            disabledRelativePath: `${relativePath}${DISABLED_SUFFIX}`,
        });
    }

    for (const rootIndexFile of resolved.rootIndexFiles || []) {
        const relativePath = toDisplayPath(directoryPath, rootIndexFile);
        targets.set(relativePath, {
            originalRelativePath: relativePath,
            disabledRelativePath: `${relativePath}${DISABLED_SUFFIX}`,
        });
    }

    return Array.from(targets.values());
}

async function inspectPluginEntry(entryFile) {
    try {
        const moduleNamespace = await import(pathToFileURL(entryFile).toString());
        const pluginModule = moduleNamespace?.default && typeof moduleNamespace.default === 'object'
            ? moduleNamespace.default
            : moduleNamespace;
        const rawInfo = pluginModule?.info || moduleNamespace?.info || moduleNamespace?.default?.info;
        const rawExit = pluginModule?.exit || moduleNamespace?.exit || moduleNamespace?.default?.exit;

        return {
            info: normalizeInfo(rawInfo),
            infoError: '',
            hasExit: typeof rawExit === 'function',
        };
    } catch (error) {
        return {
            info: null,
            infoError: error instanceof Error ? error.message : String(error),
            hasExit: false,
        };
    }
}

async function buildDirectoryRecord(name, directoryPath, disabledState) {
    if (name.startsWith('.') && !disabledState && path.resolve(directoryPath) !== path.resolve(__dirname)) {
        return null;
    }

    const resolved = resolveDirectoryEntryFile(directoryPath);
    const isSelf = path.resolve(directoryPath) === path.resolve(__dirname);
    if (!isSelf && !disabledState && !resolved.hasLoaderCandidate) {
        return null;
    }

    const disabledEntries = disabledState?.kind === 'directory'
        ? disabledState.disabledEntries
        : [];
    const disabledExistingCount = disabledEntries.filter((entry) => fs.existsSync(path.join(directoryPath, entry.disabledRelativePath))).length;
    const originalExistingCount = disabledEntries.filter((entry) => fs.existsSync(path.join(directoryPath, entry.originalRelativePath))).length;
    const disabledExists = disabledExistingCount > 0 && originalExistingCount === 0;
    const partialDisabled = disabledExistingCount > 0 && originalExistingCount > 0;

    let enabled = false;
    let status = 'broken';
    let message = '';
    let entryRelativePath = disabledState?.originalEntryRelativePath
        || disabledState?.snapshot?.entryRelativePath
        || '';

    if (isSelf) {
        enabled = true;
        status = 'enabled';
        entryRelativePath = resolved.entryFile ? toDisplayPath(directoryPath, resolved.entryFile) : 'index.js';
        message = '管理器本体不能停用自己。';
    } else if (partialDisabled) {
        enabled = false;
        status = 'broken';
        message = '目录插件只被部分改名。先恢复完整状态，再继续切换。';
    } else if (disabledExists) {
        enabled = false;
        status = 'disabled';
        message = '入口文件已经改名。重启后不会再加载它。';
    } else if (resolved.entryFile) {
        enabled = true;
        status = 'enabled';
        entryRelativePath = toDisplayPath(directoryPath, resolved.entryFile);
        message = '当前会在下次启动时被加载。';
    } else if (disabledState) {
        enabled = false;
        status = 'broken';
        message = '记录显示它已停用，但找不到被改名的入口文件。';
    } else if (resolved.packageMainMissing) {
        enabled = false;
        status = 'broken';
        message = 'package.json 指向的 main 不存在，且没有可回退的 index.* 入口。';
    } else {
        enabled = false;
        status = 'broken';
        message = '找不到可加载的入口文件。';
    }

    let metadata;
    if (isSelf) {
        metadata = {
            info,
            infoError: '',
            hasExit: true,
        };
    } else if (enabled && resolved.entryFile) {
        metadata = await inspectPluginEntry(resolved.entryFile);
    } else {
        metadata = {
            info: disabledState?.snapshot?.info || null,
            infoError: '',
            hasExit: Boolean(disabledState?.snapshot?.hasExit),
        };
    }

    return {
        name,
        kind: 'directory',
        path: directoryPath,
        relativePath: toDisplayPath(getPluginsRootDir(), directoryPath),
        entryRelativePath,
        packageJson: resolved.packageJson || disabledState?.snapshot?.packageJson || null,
        info: metadata.info,
        infoError: metadata.infoError || '',
        hasExit: Boolean(metadata.hasExit),
        enabled,
        status,
        message,
        isSelf,
        toggleAllowed: !isSelf && status !== 'broken',
    };
}

async function buildFileRecord(name, filePath, disabledState, allowDisabledOnly = false) {
    const pluginsRoot = getPluginsRootDir();
    const currentExists = fs.existsSync(filePath) && isPluginScriptName(name);
    const disabledFileName = disabledState?.kind === 'file' && disabledState.disabledFileName
        ? disabledState.disabledFileName
        : `${name}${DISABLED_SUFFIX}`;
    const disabledPath = path.join(pluginsRoot, disabledFileName);
    const disabledExists = fs.existsSync(disabledPath);

    if (!currentExists && !disabledExists && allowDisabledOnly) {
        return null;
    }

    let enabled = false;
    let status = 'broken';
    let message = '';

    if (currentExists) {
        enabled = true;
        status = 'enabled';
        message = '当前会在下次启动时被加载。';
    } else if (disabledExists) {
        enabled = false;
        status = 'disabled';
        message = '插件文件已经改名。重启后不会再加载它。';
    } else {
        enabled = false;
        status = 'broken';
        message = '记录里有这个文件插件，但现在找不到原文件或停用文件。';
    }

    const metadata = currentExists
        ? await inspectPluginEntry(filePath)
        : {
            info: disabledState?.snapshot?.info || null,
            infoError: '',
            hasExit: Boolean(disabledState?.snapshot?.hasExit),
        };

    return {
        name,
        kind: 'file',
        path: currentExists ? filePath : disabledPath,
        relativePath: currentExists ? toDisplayPath(pluginsRoot, filePath) : disabledFileName,
        entryRelativePath: disabledState?.originalFileName || name,
        packageJson: null,
        info: metadata.info,
        infoError: metadata.infoError || '',
        hasExit: Boolean(metadata.hasExit),
        enabled,
        status,
        message,
        isSelf: false,
        toggleAllowed: status !== 'broken',
    };
}

async function collectPlugins(config) {
    const pluginsRoot = getPluginsRootDir();
    const pluginRecords = [];
    const seenNames = new Set();
    const entries = fs.existsSync(pluginsRoot)
        ? fs.readdirSync(pluginsRoot, { withFileTypes: true })
        : [];

    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
            continue;
        }

        const fullPath = path.join(pluginsRoot, entry.name);
        const disabledState = config.pluginStates[entry.name] || null;

        if (entry.isDirectory()) {
            const record = await buildDirectoryRecord(entry.name, fullPath, disabledState);
            if (record) {
                pluginRecords.push(record);
                seenNames.add(record.name);
            }
            continue;
        }

        if (entry.isFile() && isPluginScriptName(entry.name)) {
            const record = await buildFileRecord(entry.name, fullPath, disabledState, false);
            if (record) {
                pluginRecords.push(record);
                seenNames.add(record.name);
            }
        }
    }

    for (const [name, disabledState] of Object.entries(config.pluginStates)) {
        if (seenNames.has(name) || disabledState.kind !== 'file') {
            continue;
        }
        const record = await buildFileRecord(name, path.join(pluginsRoot, name), disabledState, true);
        if (record) {
            pluginRecords.push(record);
        }
    }

    pluginRecords.sort((left, right) => left.name.localeCompare(right.name, 'en'));

    return {
        pluginsRoot,
        plugins: pluginRecords,
    };
}

function toClientConfig(config) {
    return {
        restartMode: config.restartMode,
        customCommand: config.customCommand,
        restartDelayMs: config.restartDelayMs,
    };
}

function buildStatusPayload(config, pluginsRoot, plugins) {
    return {
        platform: process.platform,
        pluginsRoot,
        serverRoot: getServerRootDir(),
        storageDir: STORAGE_DIR,
        pluginCount: plugins.length,
        disabledCount: plugins.filter((plugin) => !plugin.enabled).length,
        lastRestartResult: config.lastRestartResult,
    };
}

async function buildOverviewPayload(config) {
    const listing = await collectPlugins(config);
    return {
        config: toClientConfig(config),
        status: buildStatusPayload(config, listing.pluginsRoot, listing.plugins),
        plugins: listing.plugins,
    };
}

async function saveConfigWithRollback(config, forwardPath, rollbackPath) {
    try {
        return await saveConfig(config);
    } catch (error) {
        if (forwardPath && rollbackPath && fs.existsSync(forwardPath)) {
            try {
                await ensureDirectoryExists(path.dirname(rollbackPath));
                await fsp.rename(forwardPath, rollbackPath);
            } catch {
                // ignore rollback failure
            }
        }
        throw error;
    }
}

async function disableDirectoryPlugin(config, record) {
    const resolved = resolveDirectoryEntryFile(record.path);
    const disableTargets = listDirectoryDisableTargets(record.path, resolved);
    const entryRelativePath = normalizeRelativePath(record.entryRelativePath || disableTargets[0]?.originalRelativePath);
    if (!entryRelativePath || disableTargets.length === 0) {
        throw buildError('当前无法判断目录插件的入口文件。');
    }

    const renamedPairs = [];
    for (const target of disableTargets) {
        const originalPath = path.join(record.path, target.originalRelativePath);
        const disabledPath = path.join(record.path, target.disabledRelativePath);
        if (!fs.existsSync(originalPath)) {
            throw buildError('当前插件入口文件不存在，无法停用。');
        }
        if (fs.existsSync(disabledPath)) {
            throw buildError('目标停用入口已存在，请先检查目录状态。');
        }
    }

    try {
        for (const target of disableTargets) {
            const originalPath = path.join(record.path, target.originalRelativePath);
            const disabledPath = path.join(record.path, target.disabledRelativePath);
            await ensureDirectoryExists(path.dirname(disabledPath));
            await fsp.rename(originalPath, disabledPath);
            renamedPairs.push({ originalPath, disabledPath });
        }
    } catch (error) {
        for (const pair of renamedPairs.reverse()) {
            try {
                if (fs.existsSync(pair.disabledPath)) {
                    await fsp.rename(pair.disabledPath, pair.originalPath);
                }
            } catch {
                // ignore rollback failure
            }
        }
        throw error;
    }

    config.pluginStates[record.name] = {
        kind: 'directory',
        originalEntryRelativePath: entryRelativePath,
        disabledEntryRelativePath: `${entryRelativePath}${DISABLED_SUFFIX}`,
        disabledEntries: disableTargets,
        updatedAt: new Date().toISOString(),
        snapshot: makeSnapshot(record),
    };

    try {
        return await saveConfig(config);
    } catch (error) {
        for (const pair of renamedPairs.reverse()) {
            try {
                if (fs.existsSync(pair.disabledPath)) {
                    await fsp.rename(pair.disabledPath, pair.originalPath);
                }
            } catch {
                // ignore rollback failure
            }
        }
        throw error;
    }
}

async function enableDirectoryPlugin(config, record) {
    const disabledState = config.pluginStates[record.name];
    if (!disabledState || disabledState.kind !== 'directory') {
        throw buildError('缺少目录插件的停用记录，无法恢复。');
    }

    const enableTargets = disabledState.disabledEntries.length > 0
        ? disabledState.disabledEntries
        : [
            {
                originalRelativePath: disabledState.originalEntryRelativePath,
                disabledRelativePath: disabledState.disabledEntryRelativePath,
            },
        ];

    const originalMissing = enableTargets.filter((entry) => !fs.existsSync(path.join(record.path, entry.originalRelativePath)));
    const disabledMissing = enableTargets.filter((entry) => !fs.existsSync(path.join(record.path, entry.disabledRelativePath)));

    if (originalMissing.length === 0) {
        delete config.pluginStates[record.name];
        return await saveConfig(config);
    }
    if (disabledMissing.length > 0) {
        throw buildError('找不到被改名的入口文件，无法恢复。');
    }

    const renamedPairs = [];
    try {
        for (const entry of enableTargets) {
            const originalPath = path.join(record.path, entry.originalRelativePath);
            const disabledPath = path.join(record.path, entry.disabledRelativePath);
            await ensureDirectoryExists(path.dirname(originalPath));
            await fsp.rename(disabledPath, originalPath);
            renamedPairs.push({ originalPath, disabledPath });
        }
    } catch (error) {
        for (const pair of renamedPairs.reverse()) {
            try {
                if (fs.existsSync(pair.originalPath)) {
                    await fsp.rename(pair.originalPath, pair.disabledPath);
                }
            } catch {
                // ignore rollback failure
            }
        }
        throw error;
    }

    delete config.pluginStates[record.name];

    try {
        return await saveConfig(config);
    } catch (error) {
        for (const pair of renamedPairs.reverse()) {
            try {
                if (fs.existsSync(pair.originalPath)) {
                    await fsp.rename(pair.originalPath, pair.disabledPath);
                }
            } catch {
                // ignore rollback failure
            }
        }
        throw error;
    }
}

async function disableFilePlugin(config, record) {
    const pluginsRoot = getPluginsRootDir();
    const originalPath = path.join(pluginsRoot, record.name);
    const disabledFileName = `${record.name}${DISABLED_SUFFIX}`;
    const disabledPath = path.join(pluginsRoot, disabledFileName);

    if (!fs.existsSync(originalPath)) {
        throw buildError('当前插件文件不存在，无法停用。');
    }
    if (fs.existsSync(disabledPath)) {
        throw buildError('目标停用文件已存在，请先检查目录状态。');
    }

    await fsp.rename(originalPath, disabledPath);

    config.pluginStates[record.name] = {
        kind: 'file',
        originalFileName: record.name,
        disabledFileName,
        updatedAt: new Date().toISOString(),
        snapshot: makeSnapshot(record),
    };

    return await saveConfigWithRollback(config, disabledPath, originalPath);
}

async function enableFilePlugin(config, record) {
    const pluginsRoot = getPluginsRootDir();
    const disabledState = config.pluginStates[record.name];
    if (!disabledState || disabledState.kind !== 'file') {
        throw buildError('缺少文件插件的停用记录，无法恢复。');
    }

    const originalPath = path.join(pluginsRoot, disabledState.originalFileName);
    const disabledPath = path.join(pluginsRoot, disabledState.disabledFileName);

    if (fs.existsSync(originalPath)) {
        delete config.pluginStates[record.name];
        return await saveConfig(config);
    }
    if (!fs.existsSync(disabledPath)) {
        throw buildError('找不到被改名的插件文件，无法恢复。');
    }

    await fsp.rename(disabledPath, originalPath);
    delete config.pluginStates[record.name];

    return await saveConfigWithRollback(config, originalPath, disabledPath);
}

async function setPluginEnabled(name, enabled) {
    const config = await readConfig();
    const listing = await collectPlugins(config);
    const record = listing.plugins.find((plugin) => plugin.name === name);

    if (!record) {
        throw buildError(`找不到插件：${name}`, 404);
    }
    if (!record.toggleAllowed) {
        throw buildError(record.isSelf ? '管理器本体不能停用自己。' : '当前插件状态异常，不能切换。');
    }
    if (record.enabled === enabled) {
        return await buildOverviewPayload(config);
    }

    const nextConfig = record.kind === 'directory'
        ? (enabled ? await enableDirectoryPlugin(config, record) : await disableDirectoryPlugin(config, record))
        : (enabled ? await enableFilePlugin(config, record) : await disableFilePlugin(config, record));

    return await buildOverviewPayload(nextConfig);
}

function previewCommand(command) {
    const clean = trimToEmpty(command);
    return truncateText(clean, 160);
}

function scheduleGracefulExit(delayMs) {
    const exitDelay = normalizeRestartDelay(delayMs);
    setTimeout(() => {
        try {
            process.kill(process.pid, 'SIGTERM');
        } catch {
            try {
                process.exit(0);
            } catch {
                // ignore
            }
        }
    }, exitDelay);

    return exitDelay;
}

function scheduleCustomCommandRestart(command, delayMs) {
    const delay = normalizeRestartDelay(delayMs);
    const shellSpec = buildShellSpec(command);
    const helperCode = [
        "const { spawn } = require('child_process');",
        `const spec = ${JSON.stringify(shellSpec)};`,
        `const cwd = ${JSON.stringify(getServerRootDir())};`,
        `const delay = ${JSON.stringify(delay)};`,
        'setTimeout(() => {',
        '  try {',
        "    const child = spawn(spec.command, spec.args, { cwd, env: process.env, detached: true, stdio: 'ignore', windowsHide: process.platform !== 'win32' });",
        '    child.unref();',
        '  } catch (error) {',
        '    // ignore',
        '  }',
        '}, delay);',
    ].join('\n');

    const helper = spawn(process.execPath, ['-e', helperCode], {
        cwd: getServerRootDir(),
        env: process.env,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });
    helper.unref();

    scheduleGracefulExit(Math.min(400, delay));

    return {
        delayMs: delay,
        wrapper: shellSpec.label,
        preview: previewCommand(command),
    };
}

function scheduleAutoModeRestart(delayMs) {
    const delay = scheduleGracefulExit(delayMs);
    return {
        delayMs: delay,
        wrapper: 'process exit',
    };
}

function buildLastRestartResult(fields) {
    return normalizeLastRestartResult({
        ok: fields.ok !== false,
        at: new Date().toISOString(),
        kind: fields.kind || 'restart',
        mode: fields.mode || fields.kind || 'restart',
        message: fields.message,
        details: fields.details || '',
    });
}

async function runCommandPreflight(command) {
    const trimmed = trimToEmpty(command);
    if (!trimmed) {
        throw buildError('请先填写自定义启动命令。');
    }

    if (process.platform === 'win32') {
        const probe = await spawnAndCapture('cmd.exe', ['/d', '/c', 'echo shell-ok'], {
            cwd: getServerRootDir(),
            timeoutMs: 5000,
        });

        if (!probe.ok) {
            throw buildError('预检失败：当前环境无法启动 cmd.exe。', 500, truncateText(`${probe.stdout}\n${probe.stderr}`.trim()));
        }

        return {
            ok: true,
            details: truncateText('Windows 下不会执行真正的启动命令。这里只确认了 cmd.exe 可以被拉起。'),
        };
    }

    const probe = await spawnAndCapture('sh', ['-n', '-c', trimmed], {
        cwd: getServerRootDir(),
        timeoutMs: 5000,
    });

    if (!probe.ok) {
        throw buildError(
            '预检失败：shell 语法没有通过。',
            400,
            truncateText(`${probe.stdout}\n${probe.stderr}`.trim()),
        );
    }

    return {
        ok: true,
        details: truncateText('POSIX shell 语法检查已通过。它不会真的启动新的酒馆进程。'),
    };
}

function spawnAndCapture(command, args, options = {}) {
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;
        const startTime = Date.now();

        const settle = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };

        let child;
        try {
            child = spawn(command, args, {
                cwd: options.cwd || undefined,
                env: options.env || process.env,
                shell: false,
                windowsHide: true,
            });
        } catch (error) {
            settle({
                ok: false,
                stdout: '',
                stderr: '',
                timedOut: false,
                exitCode: null,
                signal: null,
                durationMs: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
            });
            return;
        }

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });

        let timeoutId;
        if (Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
            timeoutId = setTimeout(() => {
                timedOut = true;
                try {
                    child.kill('SIGTERM');
                } catch {
                    // ignore
                }
            }, options.timeoutMs);
        }

        child.on('error', (error) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            settle({
                ok: false,
                stdout,
                stderr,
                timedOut,
                exitCode: null,
                signal: null,
                durationMs: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
            });
        });

        child.on('close', (exitCode, signal) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            settle({
                ok: exitCode === 0 && !timedOut,
                stdout,
                stderr,
                timedOut,
                exitCode,
                signal,
                durationMs: Date.now() - startTime,
            });
        });
    });
}

function asyncRoute(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (error) {
            console.error('[server-plugin-switch] 请求失败：', error);
            res.status(error.statusCode || 500).json({
                ok: false,
                message: error.message || '未知错误',
                details: error.details || '',
            });
        }
    };
}

async function persistLastRestartResult(config, result) {
    return await saveConfig({
        ...config,
        lastRestartResult: result,
    });
}

const plugin = {
    info,
    init: async (router) => {
        console.log('[server-plugin-switch] API 路径: /api/plugins/server-plugin-switch/*');

        await ensureDirectoryExists(STORAGE_DIR);

        router.use(express.json({ limit: '256kb' }));

        router.post('/probe', asyncRoute(async (req, res) => {
            res.json({
                ok: true,
                plugin: info,
                platform: process.platform,
                pluginsRoot: getPluginsRootDir(),
                serverRoot: getServerRootDir(),
            });
        }));

        router.get('/overview', asyncRoute(async (req, res) => {
            const config = await readConfig();
            res.json({
                ok: true,
                ...(await buildOverviewPayload(config)),
            });
        }));

        router.post('/config', asyncRoute(async (req, res) => {
            const current = await readConfig();
            const nextConfig = await saveConfig({
                ...current,
                restartMode: normalizeRestartMode(req.body?.restartMode),
                customCommand: trimToEmpty(req.body?.customCommand),
                restartDelayMs: normalizeRestartDelay(req.body?.restartDelayMs),
            });

            res.json({
                ok: true,
                message: '重启设置已保存。',
                ...(await buildOverviewPayload(nextConfig)),
            });
        }));

        router.post('/plugins/toggle', asyncRoute(async (req, res) => {
            const name = trimToEmpty(req.body?.name);
            if (!isSafePluginName(name)) {
                throw buildError('插件名无效。');
            }
            if (typeof req.body?.enabled !== 'boolean') {
                throw buildError('enabled 必须是布尔值。');
            }

            const payload = await setPluginEnabled(name, req.body.enabled);
            res.json({
                ok: true,
                message: req.body.enabled ? '已改回启用状态。重启后生效。' : '已改成停用状态。重启后生效。',
                ...payload,
            });
        }));

        router.post('/restart/test', asyncRoute(async (req, res) => {
            const current = await readConfig();
            const command = trimToEmpty(req.body?.command) || current.customCommand;
            const testResult = await runCommandPreflight(command);
            const nextConfig = await persistLastRestartResult(current, buildLastRestartResult({
                ok: true,
                kind: 'test',
                mode: 'custom',
                message: '自定义命令预检通过。',
                details: testResult.details,
            }));

            res.json({
                ok: true,
                message: '预检通过。',
                ...(await buildOverviewPayload(nextConfig)),
            });
        }));

        router.post('/restart', asyncRoute(async (req, res) => {
            const current = await readConfig();
            const mode = normalizeRestartMode(req.body?.mode || current.restartMode);
            const delayMs = normalizeRestartDelay(req.body?.delayMs || current.restartDelayMs);

            let nextConfig;
            if (mode === 'custom') {
                const command = trimToEmpty(req.body?.command) || current.customCommand;
                if (!command) {
                    throw buildError('自定义模式下必须先填写启动命令。');
                }

                const scheduled = scheduleCustomCommandRestart(command, delayMs);
                nextConfig = await persistLastRestartResult(current, buildLastRestartResult({
                    ok: true,
                    kind: 'restart',
                    mode: 'custom',
                    message: '已安排自定义命令重启。旧进程退出后会尝试拉起新进程。',
                    details: `wrapper: ${scheduled.wrapper}\npreview: ${scheduled.preview}\ndelayMs: ${scheduled.delayMs}`,
                }));
            } else {
                const scheduled = scheduleAutoModeRestart(delayMs);
                nextConfig = await persistLastRestartResult(current, buildLastRestartResult({
                    ok: true,
                    kind: 'restart',
                    mode: 'auto',
                    message: '已安排自动模式重启。是否自动回来取决于外部守护。',
                    details: `wrapper: ${scheduled.wrapper}\ndelayMs: ${scheduled.delayMs}`,
                }));
            }

            res.json({
                ok: true,
                message: '重启流程已触发。',
                ...(await buildOverviewPayload(nextConfig)),
            });
        }));
    },
    exit: async () => {
        // no-op
    },
};

module.exports = plugin;
