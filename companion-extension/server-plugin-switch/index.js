import { getContext, renderExtensionTemplateAsync } from '../../../extensions.js';

const MODULE_NAME = 'third-party/server-plugin-switch';
const API_BASE = '/api/plugins/server-plugin-switch';

const state = {
    busy: '',
    config: null,
    status: null,
    plugins: [],
    searchQuery: '',
    activeTab: 'plugins',
};

const elements = {};

function getAppTitle() {
    return 'Server Plugin Switch';
}

function getPingHeaders() {
    return {
        ...getHeaders(true),
    };
}

function getHeaders(includeJson = false) {
    const headers = {
        ...(getContext()?.getRequestHeaders?.() || {}),
    };

    if (includeJson) {
        headers['Content-Type'] = 'application/json';
    }

    return headers;
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function isBusy() {
    return Boolean(state.busy);
}

function setBusy(label) {
    state.busy = label;
    renderStatus();
    syncInteractivity();
}

function clearBusy() {
    state.busy = '';
    renderStatus();
    syncInteractivity();
}

async function apiRequest(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const response = await fetch(`${API_BASE}${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
            ...getHeaders(Boolean(options.body)),
            ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        cache: 'no-store',
    });

    const text = await response.text();
    let payload = {};

    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = { ok: false, message: text };
        }
    }

    if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || `${response.status} ${response.statusText}`);
    }

    return payload;
}

function readMode() {
    return elements.restartModeCustom.checked ? 'custom' : 'auto';
}

function collectFormPayload() {
    return {
        restartMode: readMode(),
        customCommand: String(elements.customCommandInput.value || '').trim(),
        restartDelayMs: Number(elements.restartDelayInput.value || 800),
    };
}

function applyOverview(payload) {
    state.config = payload.config || {
        restartMode: 'auto',
        customCommand: '',
        restartDelayMs: 800,
    };
    state.status = payload.status || null;
    state.plugins = Array.isArray(payload.plugins) ? payload.plugins : [];

    elements.restartModeAuto.checked = state.config.restartMode !== 'custom';
    elements.restartModeCustom.checked = state.config.restartMode === 'custom';
    elements.customCommandInput.value = state.config.customCommand || '';
    elements.restartDelayInput.value = String(state.config.restartDelayMs || 800);

    renderStatus();
    renderTabs();
    renderModeHint();
    renderResultCard();
    renderPluginList();
    syncInteractivity();
}

function renderTabs() {
    elements.tabButtons.forEach((button) => {
        button.classList.toggle('is-active', button.dataset.spmextTab === state.activeTab);
    });

    elements.tabPages.forEach((page) => {
        page.classList.toggle('is-active', page.dataset.spmextPage === state.activeTab);
    });
}

function renderStatus(fallbackMessage = '') {
    const status = state.status || {};
    const busy = isBusy();
    let pillText = '在线';
    let pillKind = 'ok';
    let text = fallbackMessage || status.lastRestartResult?.message || '已加载后端插件切换台。';

    if (busy) {
        pillText = '处理中';
        pillKind = 'busy';
        text = state.busy;
    } else if (!state.config) {
        pillText = '离线';
        pillKind = 'error';
    }

    elements.statusPill.textContent = pillText;
    elements.statusPill.dataset.kind = pillKind;
    elements.statusText.textContent = text;
    elements.summaryPlugins.textContent = String(status.pluginCount ?? state.plugins.length ?? 0);
    elements.summaryDisabled.textContent = String(status.disabledCount ?? state.plugins.filter((plugin) => !plugin.enabled)
         .length);
}

function renderModeHint() {
    const mode = readMode();
    if (mode === 'custom') {
        elements.modeHint.textContent = '自定义模式会直接在当前酒馆里安排一条后台启动命令。命令写错就起不来，写成重复启动就会开多个实例。';
    } else {
        elements.modeHint.textContent = '自动模式只负责退出当前进程。是否自动回来，取决于 Docker、pm2、systemd 或外部保活。';
    }
    syncInteractivity();
}

function renderResultCard() {
    const result = state.status?.lastRestartResult;
    if (!result) {
        elements.resultCard.className = 'spmext-result-card is-empty';
        elements.resultCard.innerHTML = '还没有记录。';
        return;
    }

    const detailsHtml = result.details
        ? `<pre class="spmext-result-pre">${escapeHtml(result.details)}</pre>`
        : '';

    elements.resultCard.className = `spmext-result-card ${result.ok ? 'is-ok' : 'is-error'}`;
    elements.resultCard.innerHTML = `
        <div class="spmext-result-top">
            <span class="spmext-result-pill ${result.ok ? 'is-ok' : 'is-error'}">${result.ok ? '成功' : '失败'}</span>
            <span class="spmext-result-meta">${escapeHtml(result.kind || 'restart')} / ${escapeHtml(result.mode || '-')}</s
         pan>
        </div>
        <strong>${escapeHtml(result.message || '-')}</strong>
        ${detailsHtml}
    `;
}

function renderPluginList() {
    if (!state.plugins.length) {
        elements.pluginList.innerHTML = '<div class="spmext-empty">当前没有识别到可管理的后端插件。</div>';
        return;
    }

    const query = state.searchQuery;
    const filtered = state.plugins.filter((plugin) => {
        if (!query) {
            return true;
        }

        const haystack = [
            plugin.name,
            plugin.info?.name,
            plugin.info?.id,
            plugin.info?.description,
            plugin.relativePath,
        ]
            .filter(Boolean)
            .join('\n')
            .toLowerCase();

        return haystack.includes(query);
    });

    if (!filtered.length) {
        elements.pluginList.innerHTML = '<div class="spmext-empty">没有匹配到插件。</div>';
        return;
    }

    elements.pluginList.innerHTML = filtered.map((plugin) => {
        const actionLabel = plugin.enabled ? '停用' : '启用';
        const buttonDisabled = isBusy() || !plugin.toggleAllowed;
        const badgeClass = plugin.enabled ? 'is-enabled' : (plugin.status === 'broken' ? 'is-broken' : 'is-disabled');
        const packageLabel = plugin.packageJson?.version
            ? `${escapeHtml(plugin.packageJson.name || plugin.name)}@${escapeHtml(plugin.packageJson.version)}`
            : escapeHtml(plugin.packageJson?.name || '—');
        const entryLabel = escapeHtml(plugin.entryRelativePath || '—');
        const infoName = escapeHtml(plugin.info?.name || plugin.name);
        const note = escapeHtml(plugin.info?.description || plugin.message || '没有额外描述。');

        return `
            <article class="spmext-plugin-card ${badgeClass}">
                <div class="spmext-plugin-head">
                    <div>
                        <h4>${infoName}</h4>
                        <p class="spmext-plugin-sub">${escapeHtml(plugin.name)}${plugin.info?.id ? ` · ${escapeHtml(plugin.
         info.id)}` : ''}</p>
                    </div>
                    <div class="spmext-plugin-badges">
                        <span class="spmext-badge ${badgeClass}">${plugin.enabled ? '已启用' : (plugin.status === 'broken'
         ? '异常' : '已停用')}</span>
                        ${plugin.isSelf ? '<span class="spmext-badge is-self">本体</span>' : ''}
                    </div>
                </div>
                <p class="spmext-plugin-note">${note}</p>
                <div class="spmext-plugin-meta">
                    <span><strong>入口</strong> <code>${entryLabel}</code></span>
                    <span><strong>包</strong> ${packageLabel}</span>
                    <span><strong>exit()</strong> ${plugin.hasExit ? '有' : '无'}</span>
                </div>
                <div class="spmext-plugin-actions">
                    <button
                        class="menu_button"
                        type="button"
                        data-action="toggle"
                        data-name="${escapeHtml(plugin.name)}"
                        data-next-enabled="${plugin.enabled ? 'false' : 'true'}"
                        ${buttonDisabled ? 'disabled' : ''}
                    >${actionLabel}</button>
                </div>
            </article>
        `;
    }).join('');
}

function syncInteractivity() {
    const busy = isBusy();
    const customMode = readMode() === 'custom';
    elements.refreshButton.disabled = busy;
    elements.saveConfigButton.disabled = busy;
    elements.testCommandButton.disabled = busy || !customMode;
    elements.restartNowButton.disabled = busy;
    elements.restartModeAuto.disabled = busy;
    elements.restartModeCustom.disabled = busy;
    elements.customCommandInput.disabled = busy || !customMode;
    elements.restartDelayInput.disabled = busy;
    elements.searchInput.disabled = busy;

    elements.pluginList.querySelectorAll('button[data-action="toggle"]').forEach((button) => {
        const plugin = state.plugins.find((item) => item.name === button.dataset.name);
        button.disabled = busy || !plugin?.toggleAllowed;
    });
}

function beginRestartRecoveryFlow(message) {
    const timeoutMs = 60_000;
    const initialDelayMs = 1800;
    const startedAt = Date.now();

    setBusy(message || '正在等待酒馆重启。');

    const tick = async () => {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= timeoutMs) {
            clearBusy();
            renderStatus('重启超时。请手动刷新页面。');
            toastr.error('重启超时。请手动刷新页面。', getAppTitle());
            return;
        }

        try {
            const response = await fetch('/api/ping', {
                method: 'POST',
                credentials: 'same-origin',
                headers: getPingHeaders(),
                body: '{}',
                cache: 'no-store',
            });

            if (response.ok || response.status === 204) {
                setBusy('服务已恢复，正在刷新页面。');
                window.setTimeout(() => window.location.reload(), 500);
                return;
            }
        } catch {
            // ignore and keep polling
        }

        const secondsLeft = Math.max(1, Math.ceil((timeoutMs - elapsed) / 1000));
        setBusy(`等待服务恢复...（${secondsLeft}s）`);
        window.setTimeout(tick, 1000);
    };

    window.setTimeout(tick, initialDelayMs);
}

async function refreshOverview({ quiet = false } = {}) {
    setBusy('正在读取后端插件状态。');
    try {
        const payload = await apiRequest('/overview');
        applyOverview(payload);
        if (!quiet) {
            toastr.success('插件列表已刷新。', getAppTitle());
        }
    } catch (error) {
        renderStatus(error.message || '读取失败。');
        if (!quiet) {
            toastr.error(error.message || '读取失败。', getAppTitle());
        }
    } finally {
        clearBusy();
    }
}

async function saveConfig() {
    setBusy('正在保存重启设置。');
    try {
        const payload = await apiRequest('/config', {
            method: 'POST',
            body: collectFormPayload(),
        });
        applyOverview(payload);
        toastr.success(payload.message || '重启设置已保存。', getAppTitle());
    } catch (error) {
        renderStatus(error.message || '保存失败。');
        toastr.error(error.message || '保存失败。', getAppTitle());
    } finally {
        clearBusy();
    }
}

async function testCommand() {
    const form = collectFormPayload();
    if (!form.customCommand) {
        toastr.error('先填自定义启动命令。', getAppTitle());
        return;
    }

    setBusy('正在预检启动命令。');
    try {
        const payload = await apiRequest('/restart/test', {
            method: 'POST',
            body: {
                command: form.customCommand,
            },
        });
        applyOverview(payload);
        toastr.success(payload.message || '预检通过。', getAppTitle());
    } catch (error) {
        renderStatus(error.message || '预检失败。');
        toastr.error(error.message || '预检失败。', getAppTitle());
    } finally {
        clearBusy();
    }
}

async function restartNow() {
    const form = collectFormPayload();
    if (form.restartMode === 'custom' && !form.customCommand) {
        toastr.error('自定义模式下必须先填启动命令。', getAppTitle());
        return;
    }

    if (!window.confirm(form.restartMode === 'custom'
        ? '现在会安排启动命令，然后退出当前酒馆进程。继续吗？'
        : '现在会退出当前酒馆进程。是否自动回来取决于外部守护。继续吗？')) {
        return;
    }

    setBusy('正在安排重启流程。');
    let restartScheduled = false;
    try {
        const payload = await apiRequest('/restart', {
            method: 'POST',
            body: {
                mode: form.restartMode,
                delayMs: form.restartDelayMs,
                command: form.customCommand,
            },
        });
        applyOverview(payload);
        toastr.warning(payload.message || '重启流程已触发。', getAppTitle());
        restartScheduled = true;
        beginRestartRecoveryFlow(payload.message || '重启流程已触发。');
    } catch (error) {
        renderStatus(error.message || '重启失败。');
        toastr.error(error.message || '重启失败。', getAppTitle());
    } finally {
        if (!restartScheduled) {
            clearBusy();
        }
    }
}

async function togglePlugin(name, nextEnabled) {
    const plugin = state.plugins.find((item) => item.name === name);
    if (!plugin) {
        toastr.error('找不到目标插件。', getAppTitle());
        return;
    }

    if (!window.confirm(`${nextEnabled ? '启用' : '停用'} ${plugin.info?.name || plugin.name} 后，要重启才生效。继续吗？`))
          {
        return;
    }

    setBusy(`${nextEnabled ? '启用' : '停用'} ${plugin.name}`);
    try {
        const payload = await apiRequest('/plugins/toggle', {
            method: 'POST',
            body: {
                name,
                enabled: nextEnabled,
            },
        });
        applyOverview(payload);
        toastr.success(payload.message || '插件状态已更新。', getAppTitle());
    } catch (error) {
        renderStatus(error.message || '切换失败。');
        toastr.error(error.message || '切换失败。', getAppTitle());
    } finally {
        clearBusy();
    }
}

function attachListeners() {
    elements.tabButtons.forEach((button) => {
        button.addEventListener('click', () => {
            state.activeTab = button.dataset.spmextTab || 'plugins';
            renderTabs();
        });
    });

    elements.refreshButton.addEventListener('click', () => {
        void refreshOverview();
    });

    elements.searchInput.addEventListener('input', (event) => {
        state.searchQuery = String(event.target.value || '').trim().toLowerCase();
        renderPluginList();
    });

    elements.restartModeAuto.addEventListener('change', renderModeHint);
    elements.restartModeCustom.addEventListener('change', renderModeHint);

    elements.configForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void saveConfig();
    });

    elements.testCommandButton.addEventListener('click', () => {
        void testCommand();
    });

    elements.restartNowButton.addEventListener('click', () => {
        void restartNow();
    });

    elements.pluginList.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action="toggle"]');
        if (!button) {
            return;
        }

        void togglePlugin(button.dataset.name || '', button.dataset.nextEnabled === 'true');
    });
}

function cacheElements() {
    elements.root = document.getElementById('server_plugin_switch_settings');
    elements.tabButtons = Array.from(document.querySelectorAll('[data-spmext-tab]'));
    elements.tabPages = Array.from(document.querySelectorAll('[data-spmext-page]'));
    elements.statusPill = document.getElementById('spmext_status_pill');
    elements.statusText = document.getElementById('spmext_status_text');
    elements.summaryPlugins = document.getElementById('spmext_summary_plugins');
    elements.summaryDisabled = document.getElementById('spmext_summary_disabled');
    elements.refreshButton = document.getElementById('spmext_refresh');
    elements.searchInput = document.getElementById('spmext_search');
    elements.pluginList = document.getElementById('spmext_plugin_list');
    elements.configForm = document.getElementById('spmext_config_form');
    elements.restartModeAuto = document.getElementById('spmext_restart_mode_auto');
    elements.restartModeCustom = document.getElementById('spmext_restart_mode_custom');
    elements.customCommandInput = document.getElementById('spmext_custom_command');
    elements.restartDelayInput = document.getElementById('spmext_restart_delay');
    elements.modeHint = document.getElementById('spmext_mode_hint');
    elements.saveConfigButton = document.getElementById('spmext_save_config');
    elements.testCommandButton = document.getElementById('spmext_test_command');
    elements.restartNowButton = document.getElementById('spmext_restart_now');
    elements.resultCard = document.getElementById('spmext_result_card');
}

async function mountUi() {
    if (!document.getElementById('server_plugin_switch_settings')) {
        const settingsHtml = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
        $('#extensions_settings').append(settingsHtml);
    }

    cacheElements();
    attachListeners();
    renderTabs();
}

jQuery(async () => {
    await mountUi();
    await refreshOverview({ quiet: true });
});
