//<script>
(async () => {
    // ============================================================
    //  设备流量监控插件 v21.1.27 (差额归因版)
    //  基于 v21.1.26:
    //    - 总览新增「系统增量/未归属」行: WAN总 − 设备合计 − 路由器自身 = 未归属, 点击看归因明细
    //    - 引擎≥v1.0.8 拆分 ctLocal(路由器自身WAN消耗) / unattr(归属失败) / unattribTop
    //    - acct未生效时界面标记「降级统计」
    // ============================================================
    if (document.querySelector('#IFRAME_KANO_TRAFFIC')) return;

    const PLUGIN_VERSION = '21.1.27';
    const _SIG = '@@KANO_TRAFFIC_PLUGIN_ID:5d1f8b@@';
    const _PS = '<!-- [KANO_PLUGIN_START]';
    const _PE = '<!-- [KANO_PLUGIN_END]';
    const ICON = { dockTraffic: '\u25C8', dockHistory: '\u25A3', dockSettings: '\u25C9', up: '\u2191', down: '\u2193', total: '\u03A3', online: '\u25CF', offline: '\u25CB', wifi: '\u25CE', wired: '\u25C9', refresh: '\u21BB', monitor: '\u25B6', monitorOn: '\u23F8', diag: '\u25D0', log: '\u25CC', rank: '\u25CA', archive: '\u25A3', engine: '\u25C8', clear: '\u25EA', uninstall: '\u25EB', rename: '\u270E', del: '\u2715', limit: '\u29D7', time: '\u25F7', runtime: '\u25F4', device: '\u25CA', chartBar: '\u25A0', chartHBar: '\u25A1' };

    let _tinyView = false;
    // v21.1.8 修复: 不能写 const _hostFmtBytes = formatBytes (下方 const formatBytes 造成 TDZ, 插件加载即崩)
    // 用间接 eval 在全局作用域取宿主的 formatBytes, 取不到则用内置实现
    const _hostFmtBytes = (0, eval)('typeof formatBytes === "function" ? formatBytes : null') || ((b) => {
        b = Math.max(0, Number(b) || 0);
        const u = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        while (b >= 1024 && i < 4) { b /= 1024; i++; }
        return (i === 0 ? b : b.toFixed(2)) + ' ' + u[i];
    });
    const formatBytes = (b) => {
        if (!_tinyView) return _hostFmtBytes(b);
        let v = Math.max(0, Number(b) || 0) / 1024;
        const u = ['KB', 'MB', 'GB', 'TB'];
        let i = 0;
        while (v >= 1024 && i < 3) { v /= 1024; i++; }
        return v.toFixed(1) + ' ' + u[i];
    };

    const CHAIN_NAME = 'KANO_TRAFFIC';
    const CHAIN_NAME6 = 'KANO_TRAFFIC6';
    const LIMIT_CHAIN = 'KANO_LIMIT';
    const LIMIT_CHAIN6 = 'KANO_LIMIT6';
    const STORAGE_FILE = '/data/data/com.minikano.f50_sms/traffic_device_stats';
    const NAMES_FILE = '/data/data/com.minikano.f50_sms/traffic_device_names';
    const SNAPSHOTS_FILE = '/data/data/com.minikano.f50_sms/traffic_snapshots';
    const LIMITS_FILE = '/data/data/com.minikano.f50_sms/traffic_device_limits';
    const LIMIT_UNITS = { 'KB/s': { label: 'KB/s', factor: 1 }, 'MB/s': { label: 'MB/s', factor: 1024 }, 'Kbps': { label: 'Kbps', factor: 0.125 }, 'Mbps': { label: 'Mbps', factor: 128 } };
    const MONITOR_STATE_KEY = 'kano_traffic_monitor_state';
    const CLIENT_ID = (() => { let id = localStorage.getItem('kano_traffic_client_id'); if (!id) { id = Math.random().toString(16).slice(2, 6); localStorage.setItem('kano_traffic_client_id', id); } return id; })();
    let clientName = localStorage.getItem('kano_traffic_client_name') || ('客户端-' + CLIENT_ID);
    const HB_PREFIX = '/data/data/com.minikano.f50_sms/traffic_hb.';
    const DEFAULT_REFRESH_SEC = 5;
    const FULL_SYNC_MS = 30000;
    const HISTORY_SAVE_INTERVAL = 30000;
    const LEASES_FILES = ['/var/lib/misc/dnsmasq.leases', '/tmp/dnsmasq.leases', '/tmp/dhcp.leases', '/data/dnsmasq.leases'];
    const DEBUG_LOG_FILE = '/data/data/com.minikano.f50_sms/traffic_debug.log';
    const MAX_LOG_LINES = 200;

    const ENGINE_BIN = '/data/data/com.minikano.f50_sms/kano_engine';
    const ENGINE_JSON = '/data/data/com.minikano.f50_sms/kano_engine.json';
    const ENGINE_VER = '/data/data/com.minikano.f50_sms/kano_engine.ver';
    const ENGINE_PID = '/data/data/com.minikano.f50_sms/kano_engine.pid';
    const ENGINE_CMD = '/data/data/com.minikano.f50_sms/kano_engine.cmd';
    const ENGINE_LOG = '/data/data/com.minikano.f50_sms/kano_engine.log';
    const ENGINE_START_TS = '/data/data/com.minikano.f50_sms/kano_engine.start';
    const ENGINE_BOOT_FILE = '/sdcard/ufi_tools_boot.sh';
    const ENGINE_BOOT_LINE = `nohup ${ENGINE_BIN} >>${ENGINE_LOG} 2>&1 &`;
    const ENGINE_MANIFEST_URL = 'https://cdn.jsdelivr.net/gh/468133/kano-engine-assets@main/latest.json';
    const BG_SCRIPT = '/data/data/com.minikano.f50_sms/kano_bg.sh';
    const BG_PID = '/data/data/com.minikano.f50_sms/kano_bg.pid';
    const BG_SCHED = '/data/data/com.minikano.f50_sms/traffic_bg_sched';
    const BG_TRIGGER = '/data/data/com.minikano.f50_sms/traffic_archive_trigger';
    const BG_ARCHIVED = '/data/data/com.minikano.f50_sms/traffic_bg_archived'; // 守护脚本到点时的流量文件快照
    const LIMITS_APPLY_SH = '/data/data/com.minikano.f50_sms/kano_limits_apply.sh';

    let deviceList = [];
    let trafficHistory = {};
    let customNames = {};
    let snapshots = [];
    let monitorTimer = null;
    let monitorTickCount = 0;
    let resetClickCount = 0;
    let resetClickTimer = null;
    let localAddrs = new Set();
    let localAddrs6 = new Set();
    let IPT = '';
    let IP6T = '';
    let hasIptables = false;
    let hasIp6tables = false;
    let enableIPv6 = false;
    let pluginUninstalled = false;
    let ruleOwners = {};
    let rulesAdopted = false;
    let historyDirty = false;
    let lastHistorySave = 0;
    let deviceLimits = {};
    let limitMode = null;
    let limitChainsMounted = false;
    let _warnedAbnormal = {};
    let _engineJsonCache = { t: 0, data: null };
    let _engineUpdateNotified = false;
    let _lastLogKey = '';
    let _userShellBroken = false;
    let _refreshing = false;
    let _tickRunning = false;
    let _lastProbe = 0;
    let lastUpdateTime = Date.now();
    let autoArchiveTimer = null;
    let lastAutoArchiveDay = localStorage.getItem('kano_last_auto_archive_day') || '';
    let lastAutoArchiveMonth = localStorage.getItem('kano_last_auto_archive_month') || '';
    let heartbeatTimer = null;
    let selectedSnaps = new Set();
    let historyByFilter = '';
    let rankMode = 'current';
    let trendChartMode = 'bar'; // 'bar' | 'line'

    const SETTINGS_KEY = 'kano_traffic_settings';
    let archiveSettings = { dailyEnabled: true, dailyHour: 0, dailyMinute: 0, monthlyEnabled: true, monthlyDay: 1, monthlyHour: 0, resetAfterArchive: true, logRetentionDays: 7, refreshSeconds: DEFAULT_REFRESH_SEC };
    let ipv6Settings = { enabled: false };
    const IPV6_SETTINGS_KEY = 'kano_traffic_ipv6_settings';

    const ENGINE_CDN_HOSTS = ['cdn.jsdmirror.com', 'jsd.onmicrosoft.cn', 'cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'testingcf.jsdelivr.net'];
    const ENGINE_GH_PROXIES = ['https://ghfast.top/', 'https://ghproxy.net/'];

    const _verNewer = (a, b) => {
        const pa = String(a || '').replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
        const pb = String(b || '').replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const x = pa[i] || 0, y = pb[i] || 0;
            if (x !== y) return x > y;
        }
        return false;
    };

    const _sh = (r) => {
        if (!r) return '';
        if (typeof r === 'string') return r;
        if (typeof r.content === 'string') return r.content;
        if (r.content && typeof r.content === 'object') {
            if (typeof r.content.content === 'string') return r.content.content;
            if (r.content.content !== undefined) return String(r.content.content);
            for (const key of ['content', 'output', 'result', 'data', 'stdout', 'message']) {
                if (typeof r.content[key] === 'string') return r.content[key];
            }
            return String(r.content);
        }
        for (const key of ['content', 'output', 'result', 'data', 'stdout', 'message']) {
            if (typeof r[key] === 'string') return r[key];
            if (r[key] && typeof r[key][key] === 'string') return r[key][key];
        }
        return String(r.content || r.result || r.output || r.data || '');
    };

    const _escEcho = (s) => s.replace(/'/g, "'\\''");

    const _shUser = async (cmd) => {
        if (!_userShellBroken && typeof runShellWithUser === 'function') {
            try {
                const r = await runShellWithUser(cmd);
                if (r && r.success !== false) return r;
                // success=false 可能只是命令退出码非0(如读不存在的文件)，仅本次回退root，不再永久判死接口
            } catch (e) { _userShellBroken = true; }
        }
        return await runShellWithRoot(cmd);
    };

    const _hasRoot = async () => {
        try { const r = await runShellWithRoot('whoami'); return _sh(r).includes('root'); } catch (e) { return false; }
    };

    const _log = async (tag, msg) => {
        const key = `[${tag}] ${msg}`;
        if (key === _lastLogKey) return;
        _lastLogKey = key;
        const line = `[${new Date().toLocaleString()}] [${tag}] ${msg}`;
        try {
            await _shUser(
                `printf '%s\n' '${_escEcho(line)}' >> ${DEBUG_LOG_FILE}; ` +
                `tail -n ${MAX_LOG_LINES} ${DEBUG_LOG_FILE} > ${DEBUG_LOG_FILE}.tmp 2>/dev/null; ` +
                `mv ${DEBUG_LOG_FILE}.tmp ${DEBUG_LOG_FILE} 2>/dev/null; true`
            );
        } catch(e) {}
    };

    const _logCmd = async (tag, cmd, result) => {
        try {
            let out = _sh(result) || '';
            out = out.replace(/\n/g, ' ⏎ ');
            if (out.length > 200) out = out.slice(0, 200) + '…[截断]';
            let c = String(cmd);
            if (c.length > 600) c = c.slice(0, 600) + ' …[命令过长已截断]';
            await _log('CMD', `[${tag}] $ ${c}${out ? ' ⇒ ' + out : ' ⇒ (无输出/成功)'}`);
        } catch (e) {}
    };

    const escHtml = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const copyTextSafe = async (text, fallbackEl) => {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) {}
        try {
            if (fallbackEl && fallbackEl.select) { fallbackEl.focus(); fallbackEl.select(); return document.execCommand('copy'); }
        } catch (e) {}
        // v21.1.21: 无兜底元素时自建临时 textarea, 兼容剪贴板 API 被禁/页面失焦场景
        try {
            const ta = document.createElement('textarea');
            ta.value = String(text ?? ''); ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
            document.body.appendChild(ta); ta.focus(); ta.select();
            const ok = document.execCommand('copy'); ta.remove(); return ok;
        } catch (e) {}
        return false;
    };

    const detectIptables = async () => {
        IPT = ''; hasIptables = false;
        for (const bin of ['iptables', 'iptables-legacy', 'iptables-nft']) {
            try {
                const r = await runShellWithRoot(`${bin} -t mangle -L -n 2>/dev/null && echo IPT_OK || echo IPT_NO`);
                if (_sh(r).includes('IPT_OK')) { IPT = bin; hasIptables = true; break; }
            } catch (e) {}
        }
        if (!hasIptables) createToast('未检测到可用的 iptables，流量统计功能不可用', 'red', 5000);
    };

    const detectIp6tables = async () => {
        IP6T = ''; hasIp6tables = false;
        for (const bin of ['ip6tables', 'ip6tables-legacy', 'ip6tables-nft']) {
            try {
                const r = await runShellWithRoot(`${bin} -t mangle -L -n 2>/dev/null && echo IP6OK || echo IP6NO`);
                if (_sh(r).includes('IP6OK')) { IP6T = bin; hasIp6tables = true; break; }
            } catch (e) {}
        }
    };

    const detectLimitMode = async () => {
        limitMode = null;
        if (!hasIptables && !hasIp6tables) return;
        const bin = hasIptables ? IPT : IP6T;
        const tmpChain = 'KANO_LTEST';
        try {
            const r = await runShellWithRoot(
                `${bin} -t filter -N ${tmpChain} 2>/dev/null || true; ` +
                `${bin} -t filter -A ${tmpChain} -m hashlimit --hashlimit-above 100kb/s --hashlimit-mode srcip --hashlimit-name kprobe_hash -j DROP 2>/dev/null && echo HASHLIMIT_OK || echo HASHLIMIT_NO; ` +
                `${bin} -t filter -F ${tmpChain} 2>/dev/null; ` +
                `${bin} -t filter -A ${tmpChain} -m limit --limit 10/s --limit-burst 20 -j RETURN 2>/dev/null && echo LIMIT_OK || echo LIMIT_NO; ` +
                `${bin} -t filter -F ${tmpChain} 2>/dev/null; ${bin} -t filter -X ${tmpChain} 2>/dev/null; true`
            );
            const out = _sh(r);
            if (out.includes('HASHLIMIT_OK')) limitMode = 'hashlimit';
            else if (out.includes('LIMIT_OK')) limitMode = 'limit';
        } catch (e) {}
    };

    const isMockMode = () => { try { return localStorage.getItem('kanoMock') === '1'; } catch (e) { return false; } }; // v21.1.20: 假数据自检开关
    const saveToFile = async (file, data) => {
        if (isMockMode()) return true; // v21.1.20: 自检模式禁一切落盘, 假数据绝不污染统计/历史/快照/限速
        try {
            const json = JSON.stringify(data);
            const bak = file + '.bak';
            let r = await _shUser(`printf '%s' '${_escEcho(json)}' > ${file}`);
            if (r && r.success === false) {
                r = await _shUser(`busybox printf '%s' '${_escEcho(json)}' > ${file}`);
                if (r && r.success === false) return false;
            }
            const verify = await loadFromFile(file);
            if (!verify) return false;
            await _shUser(`printf '%s' '${_escEcho(json)}' > ${bak}`);
            return true;
        } catch (e) { return false; }
    };

    const loadFromFile = async (file) => {
        let content = await _readFileRaw(file);
        if (!content) { content = await _readFileRaw(file + '.bak'); if (content) console.log('[设备流量监控] 从备份恢复:', file); }
        if (!content) return null;
        try { return JSON.parse(content); } catch (e) { return null; }
    };

    const _readFileRaw = async (file) => {
        try {
            const r = await _shUser(`timeout 2s awk '{print}' ${file}`);
            const c = _sh(r).trim();
            return c || null;
        } catch (e) { return null; }
    };

    const loadData = async () => {
        const h = await loadFromFile(STORAGE_FILE); if (h) trafficHistory = h;
        const n = await loadFromFile(NAMES_FILE); if (n) customNames = n;
        const s = await loadFromFile(SNAPSHOTS_FILE); if (s) snapshots = s;
        const l = await loadFromFile(LIMITS_FILE); if (l) deviceLimits = l;
    };

    const saveSnapshots = async () => saveToFile(SNAPSHOTS_FILE, snapshots);
    const saveHistory = async () => saveToFile(STORAGE_FILE, trafficHistory);
    const saveNames = async () => saveToFile(NAMES_FILE, customNames);
    const saveLimits = async () => saveToFile(LIMITS_FILE, deviceLimits);

    let _localResetAt = 0; // 本地刚做归档重计/清零的时刻(60s 内合并守卫不采纳磁盘值, 防止旧数据复活)
    const flushHistory = async (force) => {
        if (!force && !historyDirty) return false;
        // 多端/多标签同时打开时各自内存累计、互相覆盖落盘 → 丢数据; 写盘前把磁盘端更大的累计合并回来
        try {
            const disk = await loadFromFile(STORAGE_FILE);
            if (disk && Date.now() - _localResetAt > 60000) {
                for (const [mac, dh] of Object.entries(disk)) {
                    const h = trafficHistory[mac];
                    // 本端刚清零过的设备不被磁盘旧值复活; 磁盘端更旧(对端已重计)以本端为准
                    if (!h) { if ((dh.lastSeen || 0) > _localResetAt) trafficHistory[mac] = dh; continue; }
                    if ((dh.lastSeen || 0) <= (h.lastSeen || 0)) continue;
                    if ((dh.totalUp || 0) > (h.totalUp || 0)) h.totalUp = dh.totalUp;
                    if ((dh.totalDown || 0) > (h.totalDown || 0)) h.totalDown = dh.totalDown;
                    if ((dh.curUp || 0) > (h.curUp || 0)) h.curUp = dh.curUp;
                    if ((dh.curDown || 0) > (h.curDown || 0)) h.curDown = dh.curDown;
                }
            }
        } catch (e) {}
        const ok = await saveHistory();
        if (ok) { historyDirty = false; lastHistorySave = Date.now(); }
        return ok;
    };

    const cleanOldLogs = async () => {
        const days = parseInt(archiveSettings.logRetentionDays);
        if (!(days > 0)) return;
        try {
            const r = await _shUser(`timeout 2s awk '{print}' ${DEBUG_LOG_FILE} 2>/dev/null || echo ''`);
            const raw = _sh(r);
            if (!raw.trim()) return;
            const lines = raw.split('\n');
            const cutoff = Date.now() - days * 86400000;
            const kept = lines.filter(line => {
                const m = line.match(/^\[(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\]/);
                if (!m) return true;
                const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
                return ts >= cutoff;
            });
            if (kept.length === lines.length) return;
            await _shUser(`printf '%s' '${_escEcho(kept.join('\n'))}' > ${DEBUG_LOG_FILE}`);
        } catch (e) {}
    };

    const readLogFile = async () => {
        try {
            const r = await _shUser(`timeout 2s awk '{print}' ${DEBUG_LOG_FILE} 2>/dev/null || echo ''`);
            return _sh(r).trim() || '(暂无日志)';
        } catch(e) { return '(读取日志失败)'; }
    };

    const initChain = async () => {
        if (!hasIptables) return;
        await runShellWithRoot(`${IPT} -t mangle -N ${CHAIN_NAME} 2>/dev/null || true`);
        await _cleanMounts();
        await runShellWithRoot(`${IPT} -t mangle -C FORWARD -j ${CHAIN_NAME} 2>/dev/null || ${IPT} -t mangle -I FORWARD 1 -j ${CHAIN_NAME}`);
    };

    const _cleanMounts = async () => {
        if (!hasIptables) return;
        const legacyIf = 'b' + 'r0';
        const cmds = [
            `${IPT} -t mangle -D FORWARD -j ${CHAIN_NAME} 2>/dev/null`,
            `${IPT} -t mangle -D POSTROUTING -j ${CHAIN_NAME} 2>/dev/null`,
            `${IPT} -t mangle -D INPUT -j ${CHAIN_NAME} 2>/dev/null`,
            `${IPT} -t mangle -D OUTPUT -j ${CHAIN_NAME} 2>/dev/null`,
            `${IPT} -t mangle -D POSTROUTING -o ${legacyIf} -j RETURN 2>/dev/null`,
            `${IPT} -t mangle -D INPUT -i ${legacyIf} -j RETURN 2>/dev/null`
        ];
        await runShellWithRoot(cmds.join('; ') + '; true');
    };

    const addRulesBatch = async (addrs4, addrs6) => {
        if (addrs4.length && hasIptables) {
            try {
                const cmd = addrs4.map(ip =>
                    `${IPT} -t mangle -C ${CHAIN_NAME} -s ${ip} -j RETURN 2>/dev/null || ${IPT} -t mangle -A ${CHAIN_NAME} -s ${ip} -j RETURN; ` +
                    `${IPT} -t mangle -C ${CHAIN_NAME} -d ${ip} -j RETURN 2>/dev/null || ${IPT} -t mangle -A ${CHAIN_NAME} -d ${ip} -j RETURN`
                ).join('; ');
                const r = await runShellWithRoot(cmd + '; true');
                _logCmd('加规则v4', cmd, r);
            } catch (e) { _log('ERR', `addRulesBatch v4 异常: ${e && e.message || e}`); }
        }
        if (addrs6.length && hasIp6tables && enableIPv6) {
            try {
                const cmd = addrs6.map(ip6 =>
                    `${IP6T} -t mangle -C ${CHAIN_NAME6} -s ${ip6} -j RETURN 2>/dev/null || ${IP6T} -t mangle -A ${CHAIN_NAME6} -s ${ip6} -j RETURN; ` +
                    `${IP6T} -t mangle -C ${CHAIN_NAME6} -d ${ip6} -j RETURN 2>/dev/null || ${IP6T} -t mangle -A ${CHAIN_NAME6} -d ${ip6} -j RETURN`
                ).join('; ');
                const r = await runShellWithRoot(cmd + '; true');
                _logCmd('加规则v6', cmd, r);
            } catch (e) { _log('ERR', `addRulesBatch v6 异常: ${e && e.message || e}`); }
        }
    };

    const delRulesBatch = async (addrs4, addrs6) => {
        if (addrs4.length && hasIptables) {
            try {
                const cmd = addrs4.map(ip =>
                    `${IPT} -t mangle -D ${CHAIN_NAME} -s ${ip} -j RETURN 2>/dev/null; ` +
                    `${IPT} -t mangle -D ${CHAIN_NAME} -d ${ip} -j RETURN 2>/dev/null`
                ).join('; ');
                const r = await runShellWithRoot(cmd + '; true');
                _logCmd('删规则v4', cmd, r);
            } catch (e) { _log('ERR', `delRulesBatch v4 异常: ${e && e.message || e}`); }
        }
        if (addrs6.length && hasIp6tables) {
            try {
                const cmd = addrs6.map(ip6 =>
                    `${IP6T} -t mangle -D ${CHAIN_NAME6} -s ${ip6} -j RETURN 2>/dev/null; ` +
                    `${IP6T} -t mangle -D ${CHAIN_NAME6} -d ${ip6} -j RETURN 2>/dev/null`
                ).join('; ');
                const r = await runShellWithRoot(cmd + '; true');
                _logCmd('删规则v6', cmd, r);
            } catch (e) { _log('ERR', `delRulesBatch v6 异常: ${e && e.message || e}`); }
        }
    };

    const delDevRules = async (mac) => {
        const dev = deviceList.find(d => d.mac === mac);
        const addrs4 = [], addrs6 = [];
        if (dev?.ip) addrs4.push(dev.ip);
        for (const a of (dev?.ip6s || [])) addrs6.push(a);
        if (!addrs4.length && !addrs6.length) return;
        for (const addr of [...addrs4, ...addrs6]) delete ruleOwners[addr];
        await delRulesBatch(addrs4, addrs6);
    };

    const listRuleAddrs = async (v6) => {
        const addrs = new Set();
        if (v6 ? !hasIp6tables : !hasIptables) return addrs;
        const bin = v6 ? IP6T : IPT;
        const chain = v6 ? CHAIN_NAME6 : CHAIN_NAME;
        const anyTok = v6 ? '::/0' : '0.0.0.0/0';
        try {
            const r = await runShellWithRoot(`${bin} -t mangle -nvxL ${chain} 2>/dev/null || echo ''`);
            const raw = _sh(r);
            if (!raw) return addrs;
            for (const line of raw.split('\n')) {
                const l = line.trim();
                if (!l || l.startsWith('Chain') || l.startsWith('pkts') || !l.includes('RETURN')) continue;
                const p = l.split(/\s+/);
                if (p.length < 8) continue;
                const src = p[p.length - 2], dst = p[p.length - 1];
                if (src && src !== anyTok) addrs.add(src);
                if (dst && dst !== anyTok) addrs.add(dst);
            }
        } catch (e) {}
        return addrs;
    };

    const syncRules = async () => {
        if (pluginUninstalled) return;
        const v4ok = hasIptables;
        const v6ok = hasIp6tables && enableIPv6;
        if (!v4ok && !v6ok) return;
        const expected = {};
        for (const d of deviceList) {
            if (v4ok && d.ip) expected[d.ip] = d.mac;
            if (v6ok) for (const a of (d.ip6s || [])) expected[a] = d.mac;
        }
        const dels = [], adds = [];
        if (!rulesAdopted) {
            rulesAdopted = true;
            const existing = new Set([...(await listRuleAddrs(false)), ...(await listRuleAddrs(true))]);
            for (const addr of existing) {
                if (expected[addr]) ruleOwners[addr] = expected[addr];
                else dels.push(addr);
            }
            _log('SYNC', `启动adopt 继承规则=${Object.keys(ruleOwners).length} 清理残留=${dels.length}`);
        }
        for (const [addr, mac] of Object.entries(expected)) {
            if (ruleOwners[addr] !== mac) { dels.push(addr); adds.push(addr); }
        }
        for (const addr of Object.keys(ruleOwners)) {
            if (!expected[addr]) dels.push(addr);
        }
        const delSet = [...new Set(dels)];
        const addSet = [...new Set(adds)];
        if (delSet.length === 0 && addSet.length === 0) return;
        if (delSet.length) {
            try {
                const need4 = delSet.some(a => !_isV6Addr(a));
                const need6 = delSet.some(a => _isV6Addr(a));
                const [c4, c6] = await Promise.all([need4 ? getCounters(false) : {}, need6 ? getCounters(true) : {}]);
                const all = { ...c4, ...c6 };
                let topped = 0;
                for (const addr of delSet) {
                    const mac = ruleOwners[addr] || expected[addr];
                    const h = mac && trafficHistory[mac];
                    if (!h || !all[addr]) continue;
                    h.addrUp = h.addrUp || {}; h.addrDown = h.addrDown || {};
                    h.addrUp[addr] = Math.max(h.addrUp[addr] || 0, all[addr].up || 0);
                    h.addrDown[addr] = Math.max(h.addrDown[addr] || 0, all[addr].down || 0);
                    topped++;
                }
                if (topped) { historyDirty = true; _log('SYNC', `删规则前补读计数 addr=${topped}/${delSet.length}`); }
            } catch (e) {}
        }
        await delRulesBatch(delSet.filter(a => !_isV6Addr(a)), delSet.filter(a => _isV6Addr(a)));
        await addRulesBatch(addSet.filter(a => !_isV6Addr(a)), addSet.filter(a => _isV6Addr(a)));
        for (const addr of delSet) delete ruleOwners[addr];
        for (const addr of addSet) ruleOwners[addr] = expected[addr];
        _log('SYNC', `规则同步 del=${delSet.length} add=${addSet.length} owners=${Object.keys(ruleOwners).length}`);
    };

    const flushChain = async () => {
        if (!hasIptables) return;
        const cmd = `${IPT} -t mangle -F ${CHAIN_NAME} 2>/dev/null || true`;
        _logCmd('清空v4链', cmd, await runShellWithRoot(cmd));
    };

    const zeroChainCounters = async () => {
        if (!hasIptables) return;
        const cmd = `${IPT} -t mangle -Z ${CHAIN_NAME} 2>/dev/null || true`;
        _logCmd('清零v4计数', cmd, await runShellWithRoot(cmd));
    };

    const initChain6 = async () => {
        if (!hasIp6tables || !enableIPv6) return;
        await runShellWithRoot(`${IP6T} -t mangle -N ${CHAIN_NAME6} 2>/dev/null || true`);
        await _cleanMounts6();
        await runShellWithRoot(`${IP6T} -t mangle -C FORWARD -j ${CHAIN_NAME6} 2>/dev/null || ${IP6T} -t mangle -I FORWARD 1 -j ${CHAIN_NAME6}`);
    };

    const _cleanMounts6 = async () => {
        if (!hasIp6tables) return;
        const legacyIf = 'b' + 'r0';
        const cmds = [
            `${IP6T} -t mangle -D FORWARD -j ${CHAIN_NAME6} 2>/dev/null`,
            `${IP6T} -t mangle -D POSTROUTING -j ${CHAIN_NAME6} 2>/dev/null`,
            `${IP6T} -t mangle -D INPUT -j ${CHAIN_NAME6} 2>/dev/null`,
            `${IP6T} -t mangle -D OUTPUT -j ${CHAIN_NAME6} 2>/dev/null`,
            `${IP6T} -t mangle -D POSTROUTING -o ${legacyIf} -j RETURN 2>/dev/null`,
            `${IP6T} -t mangle -D INPUT -i ${legacyIf} -j RETURN 2>/dev/null`
        ];
        await runShellWithRoot(cmds.join('; ') + '; true');
    };

    const flushChain6 = async () => {
        if (!hasIp6tables) return;
        const cmd = `${IP6T} -t mangle -F ${CHAIN_NAME6} 2>/dev/null || true`;
        _logCmd('清空v6链', cmd, await runShellWithRoot(cmd));
    };

    const mountLimitChains = async () => {
        const cmds = [];
        if (hasIptables) {
            cmds.push(`${IPT} -t filter -N ${LIMIT_CHAIN} 2>/dev/null || true`);
            cmds.push(`${IPT} -t filter -C FORWARD -j ${LIMIT_CHAIN} 2>/dev/null || ${IPT} -t filter -I FORWARD 1 -j ${LIMIT_CHAIN}`);
        }
        if (hasIp6tables) {
            if (enableIPv6) {
                cmds.push(`${IP6T} -t filter -N ${LIMIT_CHAIN6} 2>/dev/null || true`);
                cmds.push(`${IP6T} -t filter -C FORWARD -j ${LIMIT_CHAIN6} 2>/dev/null || ${IP6T} -t filter -I FORWARD 1 -j ${LIMIT_CHAIN6}`);
            } else {
                cmds.push(`${IP6T} -t filter -D FORWARD -j ${LIMIT_CHAIN6} 2>/dev/null`);
                cmds.push(`${IP6T} -t filter -F ${LIMIT_CHAIN6} 2>/dev/null`);
                cmds.push(`${IP6T} -t filter -X ${LIMIT_CHAIN6} 2>/dev/null`);
            }
        }
        if (cmds.length) await runShellWithRoot(cmds.join('; ') + '; true');
    };

    const unmountLimitChains = async () => {
        const cmds = [];
        if (hasIptables) {
            cmds.push(`${IPT} -t filter -D FORWARD -j ${LIMIT_CHAIN} 2>/dev/null`);
            cmds.push(`${IPT} -t filter -F ${LIMIT_CHAIN} 2>/dev/null`);
            cmds.push(`${IPT} -t filter -X ${LIMIT_CHAIN} 2>/dev/null`);
        }
        if (hasIp6tables) {
            cmds.push(`${IP6T} -t filter -D FORWARD -j ${LIMIT_CHAIN6} 2>/dev/null`);
            cmds.push(`${IP6T} -t filter -F ${LIMIT_CHAIN6} 2>/dev/null`);
            cmds.push(`${IP6T} -t filter -X ${LIMIT_CHAIN6} 2>/dev/null`);
        }
        if (cmds.length) await runShellWithRoot(cmds.join('; ') + '; true');
    };

    const buildLimitRules = (bin, chain, addr, l, macKey) => {
        const cmds = [];
        const up = Math.max(0, parseInt(l.up) || 0);
        const down = Math.max(0, parseInt(l.down) || 0);
        if (limitMode === 'hashlimit') {
            if (up > 0) cmds.push(`${bin} -t filter -A ${chain} -s ${addr} -m hashlimit --hashlimit-above ${up}kb/s --hashlimit-mode srcip --hashlimit-name ku_${macKey} -j DROP`);
            if (down > 0) cmds.push(`${bin} -t filter -A ${chain} -d ${addr} -m hashlimit --hashlimit-above ${down}kb/s --hashlimit-mode dstip --hashlimit-name kd_${macKey} -j DROP`);
        } else if (limitMode === 'limit') {
            if (up > 0) {
                const pps = Math.max(1, Math.round(up * 1024 / 1500));
                cmds.push(`${bin} -t filter -A ${chain} -s ${addr} -m limit --limit ${pps}/s --limit-burst ${2 * pps} -j RETURN`);
                cmds.push(`${bin} -t filter -A ${chain} -s ${addr} -j DROP`);
            }
            if (down > 0) {
                const pps = Math.max(1, Math.round(down * 1024 / 1500));
                cmds.push(`${bin} -t filter -A ${chain} -d ${addr} -m limit --limit ${pps}/s --limit-burst ${2 * pps} -j RETURN`);
                cmds.push(`${bin} -t filter -A ${chain} -d ${addr} -j DROP`);
            }
        }
        return cmds;
    };

    const hasActiveLimits = () => {
        for (const mac of Object.keys(deviceLimits)) {
            const l = deviceLimits[mac] || {};
            if ((parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0) return true;
        }
        return false;
    };

    const applyLimits = async () => {
        if (pluginUninstalled) return;
        if (limitMode === null) return;
        if (!hasActiveLimits()) {
            if (limitChainsMounted) {
                await unmountLimitChains();
                limitChainsMounted = false;
                _log('LIMIT', '无限速配置，限速链已摘除');
            }
            try { await _shUser(`rm -f ${LIMITS_APPLY_SH} 2>/dev/null || true`); } catch (e) {}
            return;
        }
        await mountLimitChains();
        limitChainsMounted = true;
        const cmds4 = [`${IPT} -t filter -F ${LIMIT_CHAIN} 2>/dev/null`];
        const cmds6 = [`${IP6T} -t filter -F ${LIMIT_CHAIN6} 2>/dev/null`];
        for (const mac of Object.keys(deviceLimits)) {
            const l = deviceLimits[mac];
            if (!l) continue;
            const dev = deviceList.find(d => d.mac === mac);
            if (!dev) continue;
            const macKey = mac.replace(/:/g, '');
            if (dev.ip) cmds4.push(...buildLimitRules(IPT, LIMIT_CHAIN, dev.ip, l, macKey));
            for (const ip6 of (dev.ip6s || [])) {
                cmds6.push(...buildLimitRules(IP6T, LIMIT_CHAIN6, ip6, l, macKey));
            }
        }
        if (hasIptables) {
            const r4 = await runShellWithRoot(cmds4.join('; ') + '; true');
            const err4 = _sh(r4).split('\n').filter(l => /invalid|error|denied|not exist|File exists|xtables/i.test(l)).join(' | ');
            if (err4) _log('LIMIT', `⚠ v4限速规则写入报错: ${err4}`);
        }
        if (hasIp6tables && enableIPv6) {
            const r6 = await runShellWithRoot(cmds6.join('; ') + '; true');
            const err6 = _sh(r6).split('\n').filter(l => /invalid|error|denied|not exist|File exists|xtables/i.test(l)).join(' | ');
            if (err6) _log('LIMIT', `⚠ v6限速规则写入报错: ${err6}`);
        }
        try {
            const rb = await runShellWithRoot(`${IPT} -t filter -nvxL ${LIMIT_CHAIN} 2>/dev/null || echo ''`);
            const got = ((_sh(rb).match(/DROP|RETURN/g)) || []).length;
            const want = cmds4.length - 1;
            if (want > 0) _log('LIMIT', `限速规则已应用 v4=${got}/${want}条 mode=${limitMode}${got < want ? ' ⚠规则缺失!内核可能拒绝hashlimit规则(规则名/模块限制)' : ''}`);
        } catch (e) {}
        try {
            const sh = '#!/bin/sh\n' + (hasIptables ? cmds4 : []).concat(hasIp6tables && enableIPv6 ? cmds6 : []).join('\n') + '\n'; // 按可用性过滤, 防空二进制名坏行
            await _shUser(`echo '${btoa(unescape(encodeURIComponent(sh)))}' | base64 -d > ${LIMITS_APPLY_SH} && chmod 755 ${LIMITS_APPLY_SH}`);
        } catch (e) {}
    };

    const uninstallPlugin = async () => {
        if (pluginUninstalled) return;
        pluginUninstalled = true;
        if (monitorTimer) { monitorTimer(); monitorTimer = null; }
        if (autoArchiveTimer) { clearInterval(autoArchiveTimer); autoArchiveTimer = null; }
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        try { await _shUser(`rm -f ${HB_PREFIX}* 2>/dev/null || true`); } catch (e) {}
        await _cleanMounts();
        await flushChain();
        if (hasIptables) await runShellWithRoot(`${IPT} -t mangle -X ${CHAIN_NAME} 2>/dev/null || true`);
        if (hasIp6tables) {
            await _cleanMounts6();
            await flushChain6();
            await runShellWithRoot(`${IP6T} -t mangle -X ${CHAIN_NAME6} 2>/dev/null || true`);
        }
        await unmountLimitChains();
        try { await stopEngine(true); } catch (e) {}
        await _shUser(`rm -f ${ENGINE_BIN} ${ENGINE_BIN}.new ${ENGINE_JSON} ${ENGINE_JSON}.tmp ${ENGINE_VER} ${ENGINE_PID} ${ENGINE_CMD} ${ENGINE_LOG} ${ENGINE_LOG}.tmp /data/data/com.minikano.f50_sms/.kano_engine.b64 /data/data/com.minikano.f50_sms/.kano_deploy.b64`);
        try { await runShellWithRoot(`p=$(cat ${BG_PID} 2>/dev/null); [ -n "$p" ] && kill $p 2>/dev/null; sed -i '\#kano_bg.sh#d' ${ENGINE_BOOT_FILE} 2>/dev/null; true`); } catch (e) {}
        await _shUser(`rm -f ${BG_SCRIPT} ${BG_PID} ${BG_SCHED} ${BG_TRIGGER} ${BG_ARCHIVED} ${LIMITS_APPLY_SH} 2>/dev/null || true`);
        await _shUser(`rm -f ${STORAGE_FILE} ${NAMES_FILE} ${SNAPSHOTS_FILE} ${LIMITS_FILE} ${STORAGE_FILE}.bak ${NAMES_FILE}.bak ${SNAPSHOTS_FILE}.bak ${LIMITS_FILE}.bak ${DEBUG_LOG_FILE} ${DEBUG_LOG_FILE}.tmp /data/data/com.minikano.f50_sms/.diag_test`);
        localStorage.removeItem(MONITOR_STATE_KEY);
        localStorage.removeItem('kano_traffic_settings');
        localStorage.removeItem('kano_traffic_ipv6_settings');
        localStorage.removeItem('kano_traffic_ui_mode');
        localStorage.removeItem('kano_last_auto_archive_day');
        localStorage.removeItem('kano_last_auto_archive_month');
        localStorage.removeItem('kano_last_log_clean_day');
        const iframe = document.querySelector('#IFRAME_KANO_TRAFFIC');
        if (iframe) iframe.remove();
        deviceList = [];
        trafficHistory = {};
        customNames = {};
        snapshots = [];
        ruleOwners = {};
        deviceLimits = {};
        historyDirty = false;
        resetClickCount = 0;
        if (resetClickTimer) { clearTimeout(resetClickTimer); resetClickTimer = null; }
        createToast('插件已卸载，所有数据和规则已清除', 'green');
    };

    const refreshLocalAddrs = async () => {
        try {
            const r = await runShellWithRoot(`ip -4 addr show 2>/dev/null || echo ''`);
            const raw = _sh(r) || '';
            const s = new Set();
            for (const m of raw.matchAll(/inet\s+(\d+\.\d+\.\d+\.\d+)/g)) {
                if (m[1] !== '127.0.0.1') s.add(m[1]);
            }
            localAddrs = s;
        } catch (e) { localAddrs = new Set(); }
        try {
            const r = await runShellWithRoot(`ip -6 addr show 2>/dev/null || echo ''`);
            const raw = _sh(r) || '';
            const s = new Set();
            for (const m of raw.matchAll(/inet6\s+([0-9a-fA-F:]+)/g)) {
                const addr = m[1].toLowerCase();
                if (!addr.startsWith('fe80:')) s.add(addr);
            }
            localAddrs6 = s;
        } catch (e) { localAddrs6 = new Set(); }
    };

    const getArpDevs = async () => {
        const r = await runShellWithRoot(`timeout 2s awk '{print}' /proc/net/arp`);
        const devs = [];
        const raw = _sh(r);
        if (!raw) return devs;
        const lines = raw.split('\n');
        for (const line of lines) {
            const p = line.trim().split(/\s+/);
            if (p.length < 6) continue;
            if (p[0] === 'IP' || p[0] === 'IP address') continue;
            const ip = p[0], mac = p[3]?.toLowerCase(), flags = p[2];
            if (!ip.match(/^\d+\.\d+\.\d+\.\d+$/)) continue;
            if (!mac || !mac.match(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)) continue;
            if (mac === '00:00:00:00:00:00') continue;
            if (flags === '0x0') continue;
            if (localAddrs.has(ip)) continue;
            devs.push({ ip, mac });
        }
        return devs;
    };

    const getWifiSignal = async () => {
        const st = {};
        try {
            const r = await runShellWithRoot(`timeout 2s hostapd_cli all_sta 2>/dev/null || echo ''`);
            const raw = _sh(r);
            if (raw && raw.includes('=')) {
                const blocks = raw.split(/\n(?=[0-9a-fA-F:]{17})/);
                for (const blk of blocks) {
                    const mac = blk.trim().split('\n')[0]?.trim();
                    if (!mac || !mac.match(/^[0-9a-fA-F:]{17}$/)) continue;
                    const sig = blk.match(/signal=(-?\d+)/);
                    st[mac.toLowerCase()] = sig ? parseInt(sig[1]) : null;
                }
            }
        } catch (e) {}
        if (Object.keys(st).length === 0) {
            try {
                const r = await runShellWithRoot(`timeout 2s iw dev 2>/dev/null || echo ''`);
                const raw = _sh(r);
                const ifs = [];
                for (const m of raw.matchAll(/Interface\s+(\S+)/g)) {
                    if (!ifs.includes(m[1])) ifs.push(m[1]);
                }
                for (const iface of ifs) {
                    try {
                        const r2 = await runShellWithRoot(`timeout 2s iw dev ${iface} station dump 2>/dev/null || echo ''`);
                        const raw2 = _sh(r2);
                        if (!raw2 || !raw2.includes('Station')) continue;
                        const blocks = raw2.split(/\n(?=Station\s+[0-9a-fA-F:]{17})/);
                        for (const blk of blocks) {
                            const mm = blk.match(/Station\s+([0-9a-fA-F:]{17})/);
                            if (!mm) continue;
                            const sig = blk.match(/signal:\s+(-?\d+)\s*dBm/);
                            st[mm[1].toLowerCase()] = sig ? parseInt(sig[1]) : null;
                        }
                    } catch (e2) {}
                }
            } catch (e) {}
        }
        if (Object.keys(st).length === 0) {
            try {
                const r = await runShellWithRoot(`for i in $(ls /sys/class/net/ 2>/dev/null | grep -E '^(wlan|ap|ath|ra|wl)'); do timeout 2s iwinfo $i assoclist 2>/dev/null; done; true`);
                const raw3 = _sh(r);
                for (const m of raw3.matchAll(/^([0-9A-Fa-f:]{17})\s+(-?\d+)\s*dBm/gm)) {
                    st[m[1].toLowerCase()] = parseInt(m[2]);
                }
            } catch (e) {}
        }
        return st;
    };

    const getNdDevs = async () => {
        if (!hasIp6tables || !enableIPv6) return [];
        const devs = [];
        try {
            const r = await runShellWithRoot(`ip -6 neigh show 2>/dev/null || echo ''`);
            const raw = _sh(r);
            if (!raw || raw.includes('失败') || raw.includes('No such')) return devs;
            for (const line of raw.split('\n')) {
                const p = line.trim().split(/\s+/);
                if (p.length < 5) continue;
                const ip6 = p[0];
                let mac = null;
                for (let i = 1; i < p.length; i++) {
                    if (p[i] === 'lladdr' && i + 1 < p.length) mac = p[i + 1].toLowerCase();
                }
                if (!ip6 || !mac) continue;
                if (!mac.match(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)) continue;
                if (mac === '00:00:00:00:00:00') continue;
                if (ip6.toLowerCase().startsWith('fe80:')) continue;
                if (localAddrs6.has(ip6.toLowerCase())) continue;
                devs.push({ ip6: ip6.toLowerCase(), mac });
            }
        } catch (e) {}
        return devs;
    };

    const normalizeMac = (mac) => String(mac || '').trim().toLowerCase();
    const defaultDeviceName = (ip) => '设备_' + ((ip || '').split('.').pop() || '??');
    const isDefaultDeviceName = (name) => /^设备_(\d+|\?\?)$/.test(String(name || '').trim());
    const cleanAccessName = (name) => {
        const v = String(name ?? '').trim();
        if (!v) return '';
        const lower = v.toLowerCase();
        if (['unknown', 'null', 'undefined', '--', '-', '*'].includes(lower)) return '';
        if (v === '未知' || v === '未知设备') return '';
        return v;
    };
    const toArray = (v) => {
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') {
            try {
                const parsed = JSON.parse(v);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) { return []; }
        }
        if (v && typeof v === 'object') return Object.values(v).filter(i => i && typeof i === 'object');
        return [];
    };

    const getAccessDeviceInfo = async () => {
        const info = { byMac: {}, byIp: {}, count: 0 };
        try {
            if (typeof getData !== 'function') return info;
            const res = await getData(new URLSearchParams({ cmd: 'station_list,lan_station_list,hostNameList' }));
            const editedNames = {};
            for (const item of toArray(res?.devices)) {
                const mac = normalizeMac(item?.mac || item?.mac_addr || item?.macAddress);
                const hostname = cleanAccessName(item?.hostname || item?.host_name || item?.name);
                if (mac && hostname) editedNames[mac] = hostname;
            }
            const put = (item, connType) => {
                const mac = normalizeMac(item?.mac_addr || item?.mac || item?.macAddress);
                const ip = String(item?.ip_addr || item?.ip || item?.ipaddr || '').trim();
                const hostname = editedNames[mac] || cleanAccessName(item?.hostname || item?.host_name || item?.name);
                if (!hostname) return;
                const dev = { hostname, ip, mac, connType };
                if (mac) info.byMac[mac] = { ...(info.byMac[mac] || {}), ...dev };
                if (ip) info.byIp[ip] = { ...(info.byIp[ip] || {}), ...dev };
                info.count++;
            };
            for (const item of toArray(res?.station_list)) put(item, '无线');
            for (const item of toArray(res?.lan_station_list)) put(item, '有线');
            for (const [mac, hostname] of Object.entries(editedNames)) {
                if (!info.byMac[mac]) info.byMac[mac] = { hostname, ip: '', mac, connType: '' };
            }
        } catch (e) {}
        return info;
    };

    const getDhcpLeaseNames = async () => {
        const byMac = {};
        for (const f of LEASES_FILES) {
            try {
                const r = await runShellWithRoot(`timeout 2s awk '{print}' ${f} 2>/dev/null || echo ''`);
                const raw = _sh(r).trim();
                if (!raw) continue;
                for (const line of raw.split('\n')) {
                    const p = line.trim().split(/\s+/);
                    if (p.length < 4) continue;
                    const mac = p[1]?.toLowerCase();
                    const hostname = cleanAccessName(p[3]);
                    if (!mac || !mac.match(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)) continue;
                    if (hostname) byMac[mac] = hostname;
                }
                if (Object.keys(byMac).length > 0) break;
            } catch (e) {}
        }
        return byMac;
    };

    const pickDeviceName = (mac, ip, accessInfo, leaseNames) => {
        const access = accessInfo?.byMac?.[mac] || accessInfo?.byIp?.[ip] || null;
        const leaseName = (leaseNames && leaseNames[mac]) || '';
        const histName = trafficHistory[mac]?.hostname;
        const histValid = histName && !isDefaultDeviceName(histName) ? histName : '';
        const autoName = access?.hostname || leaseName || histValid || defaultDeviceName(ip);
        const nameSource = access?.hostname ? '接入设备' : leaseName ? 'DHCP租约' : histValid ? '历史' : '默认';
        return { name: customNames[mac] || autoName, autoName, access, nameSource };
    };

    const fetchDevs = async () => {
        if (pluginUninstalled) return;
        const eng = await readEngineJson();
        if (eng) {
            const [wifiSig, accessInfo] = await Promise.all([getWifiSignal(), getAccessDeviceInfo()]);
            const leaseNames = {};
            const m = new Map();
            for (const [macRaw, ed] of Object.entries(eng.devices || {})) {
                if (!ed || ed.online === false) continue;
                const mac = String(macRaw).toLowerCase(); // 引擎若输出大写MAC不再静默丢弃
                if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) continue;
                const access = accessInfo?.byMac?.[mac] || (ed.ip ? accessInfo?.byIp?.[ed.ip] : null) || null;
                const engHost = cleanAccessName(ed.hostname);
                const leaseName = leaseNames[mac] || '';
                const histName = trafficHistory[mac]?.hostname;
                const histValid = histName && !isDefaultDeviceName(histName) ? histName : '';
                const autoName = access?.hostname || engHost || leaseName || histValid || defaultDeviceName(ed.ip || '');
                m.set(mac, {
                    ip: ed.ip || null,
                    ip6s: Array.isArray(ed.ip6s) ? ed.ip6s : [],
                    mac,
                    hostname: customNames[mac] || autoName,
                    autoName,
                    nameSource: access?.hostname ? '接入设备' : engHost ? '引擎' : leaseName ? 'DHCP租约' : histValid ? '历史' : '默认',
                    signal: wifiSig[mac] ?? null,
                    connType: access?.connType || ed.connType || ''
                });
            }
            const engList = Array.from(m.values());
            if (engList.length === 0 && deviceList.length > 0) {
                _log('SYNC', `fetchDevs(引擎)瞬态空读 沿用上轮${deviceList.length}台`);
                return;
            }
            deviceList = engList;
            return;
        }
        await refreshLocalAddrs();
        const [arpDevs, ndDevs, wifiSig, accessInfo, leaseNames] = await Promise.all([
            getArpDevs(), getNdDevs(), getWifiSignal(), getAccessDeviceInfo(), getDhcpLeaseNames()
        ]);
        const m = new Map();
        for (const d of arpDevs) {
            const picked = pickDeviceName(d.mac, d.ip, accessInfo, leaseNames);
            m.set(d.mac, {
                ip: d.ip, ip6s: [], mac: d.mac,
                hostname: picked.name, autoName: picked.autoName, nameSource: picked.nameSource,
                signal: wifiSig[d.mac] ?? null,
                connType: picked.access?.connType || ''
            });
        }
        for (const d of ndDevs) {
            const existing = m.get(d.mac);
            if (existing) {
                if (!existing.ip6s.includes(d.ip6)) existing.ip6s.push(d.ip6);
            } else {
                const picked = pickDeviceName(d.mac, '', accessInfo, leaseNames);
                m.set(d.mac, {
                    ip: null, ip6s: [d.ip6], mac: d.mac,
                    hostname: picked.name, autoName: picked.autoName, nameSource: picked.nameSource,
                    signal: wifiSig[d.mac] ?? null,
                    connType: picked.access?.connType || ''
                });
            }
        }
        const nextList = Array.from(m.values());
        if (nextList.length === 0 && deviceList.length > 0) {
            _log('SYNC', `fetchDevs瞬态空读 沿用上轮${deviceList.length}台`);
            return;
        }
        deviceList = nextList;
    };

    const getCounters = async (v6) => {
        if (v6 ? (!hasIp6tables || !enableIPv6) : !hasIptables) return {};
        const bin = v6 ? IP6T : IPT;
        const chain = v6 ? CHAIN_NAME6 : CHAIN_NAME;
        const anyTok = v6 ? '::/0' : '0.0.0.0/0';
        const minCols = 9;
        const r = await runShellWithRoot(`${bin} -t mangle -nvxL ${chain} 2>/dev/null`);
        const c = {};
        const raw = _sh(r);
        if (!raw) return null;
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Chain') && !l.startsWith('pkts') && l.includes('RETURN'));
        for (const line of lines) {
            const p = line.split(/\s+/);
            if (p.length < minCols) continue;
            const bytes = parseInt(p[1]) || 0;
            const src = p[p.length - 2], dst = p[p.length - 1];
            if (src && src !== anyTok && dst === anyTok) { if (!c[src]) c[src] = { up: 0, down: 0 }; c[src].up = bytes; }
            else if (dst && dst !== anyTok && src === anyTok) { if (!c[dst]) c[dst] = { up: 0, down: 0 }; c[dst].down = bytes; }
        }
        return c;
    };

    const updateStats = async () => {
        if (pluginUninstalled) return;
        const eng = await readEngineJson();
        if (eng) { await updateStatsFromEngine(eng); return; }
        const [counters, counters6] = await Promise.all([getCounters(false), getCounters(true)]);
        if (counters === null || counters6 === null) return;
        const now = Date.now();
        const elapsedSec = Math.max((now - lastUpdateTime) / 1000, 0.1);
        lastUpdateTime = now;
        for (const d of deviceList) {
            const cur = {};
            if (d.ip && counters[d.ip]) cur[d.ip] = counters[d.ip];
            for (const ip6 of (d.ip6s || [])) {
                if (counters6[ip6]) cur[ip6] = counters6[ip6];
            }
            const h = trafficHistory[d.mac] || { totalUp: 0, totalDown: 0, curUp: 0, curDown: 0, lastUp: 0, lastDown: 0, firstSeen: now, speedUp: 0, speedDown: 0, ip: d.ip, ip6s: [], addrUp: {}, addrDown: {} };
            // 引擎→iptables 回退切换: 引擎时代累计的 cur 先滚入 total, 否则切换瞬间丢量
            if (typeof h.engBaseUp === 'number') {
                h.totalUp += h.curUp || 0; h.totalDown += h.curDown || 0;
                h.curUp = 0; h.curDown = 0;
                h.engBaseUp = undefined; h.engBaseDown = undefined;
            }
            h.addrUp = h.addrUp || {}; h.addrDown = h.addrDown || {};
            let upBytes = 0, downBytes = 0;
            for (const [addr, c] of Object.entries(cur)) {
                const lu = h.addrUp[addr] || 0, ld = h.addrDown[addr] || 0;
                if ((c.up || 0) < lu) { h.totalUp += lu; if (lu > 10 * 1024 * 1024) _log('STATS', `计数重置保留 mac=${d.mac} addr=${addr} up=${(lu/1048576).toFixed(1)}MB→新${((c.up||0)/1048576).toFixed(1)}MB`); }
                if ((c.down || 0) < ld) { h.totalDown += ld; if (ld > 10 * 1024 * 1024) _log('STATS', `计数重置保留 mac=${d.mac} addr=${addr} down=${(ld/1048576).toFixed(1)}MB→新${((c.down||0)/1048576).toFixed(1)}MB`); }
                upBytes += c.up || 0; downBytes += c.down || 0;
                h.addrUp[addr] = c.up || 0; h.addrDown[addr] = c.down || 0;
            }
            for (const addr of Object.keys(h.addrUp)) {
                if (!(addr in cur)) {
                    const lost = h.addrUp[addr];
                    h.totalUp += lost;
                    if (lost > 10 * 1024 * 1024) _log('STATS', `地址出局保留计数 mac=${d.mac} addr=${addr} up=${(lost/1048576).toFixed(1)}MB`);
                    delete h.addrUp[addr];
                }
            }
            for (const addr of Object.keys(h.addrDown)) {
                if (!(addr in cur)) {
                    const lost = h.addrDown[addr];
                    h.totalDown += lost;
                    if (lost > 10 * 1024 * 1024) _log('STATS', `地址出局保留计数 mac=${d.mac} addr=${addr} down=${(lost/1048576).toFixed(1)}MB`);
                    delete h.addrDown[addr];
                }
            }
            const gapOk = h.lastSeen && (now - h.lastSeen) < 120000; // 久未刷新(刚打开/挂起)不算实时速率
            h.speedUp = gapOk ? Math.max(0, Math.round((upBytes - h.curUp) / elapsedSec)) : 0;
            h.speedDown = gapOk ? Math.max(0, Math.round((downBytes - h.curDown) / elapsedSec)) : 0;
            h.curUp = upBytes; h.curDown = downBytes;
            h.lastUp = upBytes; h.lastDown = downBytes;
            h.lastSeen = now; h.hostname = d.hostname; h.ip = d.ip;
            h.ip6s = d.ip6s || [];
            h.ip6 = h.ip6s[0] || null;
            trafficHistory[d.mac] = h;
        }
        historyDirty = true;
        scanAbnormalTraffic();
        if (now - lastHistorySave >= HISTORY_SAVE_INTERVAL) await flushHistory(true);
    };

    const scanAbnormalTraffic = () => {
        for (const d of deviceList) {
            const h = trafficHistory[d.mac];
            if (!h) continue;
            const total = h.totalUp + h.totalDown + h.curUp + h.curDown;
            if (total > 10 * 1024 * 1024 * 1024 && h.totalUp > h.curUp * 2) {
                const warnKey = d.mac + '@' + Math.floor(total / (10 * 1024 * 1024 * 1024));
                if (_warnedAbnormal[warnKey]) continue;
                _warnedAbnormal[warnKey] = true;
                _log("WARN", `异常流量 mac=${d.mac} total=${(total/1e9).toFixed(1)}GB totalUp=${((h.totalUp||0)/1e9).toFixed(1)}GB curUp=${((h.curUp||0)/1e9).toFixed(2)}GB 地址数=${Object.keys(h.addrUp||{}).length} 疑似重复累加`);
            }
        }
    };

    const updateStatsFromEngine = async (eng) => {
        const now = Date.now();
        lastUpdateTime = now;
        for (const d of deviceList) {
            const ed = eng.devices ? eng.devices[d.mac] : null;
            const h = trafficHistory[d.mac] || { totalUp: 0, totalDown: 0, curUp: 0, curDown: 0, lastUp: 0, lastDown: 0, firstSeen: now, speedUp: 0, speedDown: 0, ip: d.ip, ip6s: [], addrUp: {}, addrDown: {} };
            const eup = ed ? (ed.txBytes || 0) : (h.engLastUp || 0);
            const edown = ed ? (ed.rxBytes || 0) : (h.engLastDown || 0);
            if (typeof h.engBaseUp !== 'number') {
                h.totalUp += h.curUp || 0; h.totalDown += h.curDown || 0; // iptables时代的cur先滚入total再建基线
                h.curUp = 0; h.curDown = 0;
                h.engBaseUp = eup; h.engBaseDown = edown;
            }
            if (eup < h.engBaseUp || edown < h.engBaseDown) {
                // 引擎计数器归零/重置了，把当前周期累计值完整归档到 total
                const lostUp = h.curUp || 0;
                const lostDown = h.curDown || 0;
                h.totalUp += lostUp; h.totalDown += lostDown;
                if (lostUp + lostDown > 10 * 1024 * 1024) _log('STATS', `引擎计数归零保留 mac=${d.mac} 保留=${formatBytes(lostUp + lostDown)}`);
                h.engBaseUp = 0; h.engBaseDown = 0;
            }
            h.curUp = Math.max(0, eup - h.engBaseUp);
            h.curDown = Math.max(0, edown - h.engBaseDown);
            h.engLastUp = eup; h.engLastDown = edown;
            h.speedUp = ed ? (ed.txRateBps || 0) : 0;
            h.speedDown = ed ? (ed.rxRateBps || 0) : 0;
            h.lastUp = h.curUp; h.lastDown = h.curDown;
            h.lastSeen = now; h.hostname = d.hostname; h.ip = d.ip;
            h.ip6s = d.ip6s || [];
            h.ip6 = h.ip6s[0] || null;
            trafficHistory[d.mac] = h;
        }
        historyDirty = true;
        scanAbnormalTraffic();
        if (now - lastHistorySave >= HISTORY_SAVE_INTERVAL) await flushHistory(true);
    };

    const getTraffic = (mac) => {
        const h = trafficHistory[mac];
        if (!h) return { up: 0, down: 0, total: 0, speedUp: 0, speedDown: 0 };
        return {
            up: h.totalUp + h.curUp,
            down: h.totalDown + h.curDown,
            total: h.totalUp + h.totalDown + h.curUp + h.curDown,
            speedUp: h.speedUp || 0,
            speedDown: h.speedDown || 0
        };
    };

    const resetHistoryEntries = (now, keepLastSeen) => {
        _warnedAbnormal = {};
        const eng = _engineJsonCache.data;
        for (const mac of Object.keys(trafficHistory)) {
            const prev = trafficHistory[mac];
            const ed = eng && eng.devices ? eng.devices[mac] : null;
            const baseUp = ed ? (ed.txBytes || 0) : (prev.engLastUp || 0);
            const baseDown = ed ? (ed.rxBytes || 0) : (prev.engLastDown || 0);
            trafficHistory[mac] = {
                totalUp: 0, totalDown: 0, curUp: 0, curDown: 0,
                lastUp: 0, lastDown: 0,
                firstSeen: prev.firstSeen || now,
                lastSeen: keepLastSeen ? (prev.lastSeen || now) : now,
                hostname: prev.hostname,
                ip: prev.ip,
                ip6s: prev.ip6s || (prev.ip6 ? [prev.ip6] : []),
                ip6: prev.ip6,
                engBaseUp: baseUp, engBaseDown: baseDown,
                engLastUp: baseUp, engLastDown: baseDown
            };
        }
    };

    const fmtSig = (dbm) => {
        if (dbm === null || dbm === undefined) return '<span style="opacity:.4">--</span>';
        const c = dbm >= -60 ? '#4ade80' : dbm >= -70 ? '#facc15' : dbm >= -80 ? '#fb923c' : '#f87171';
        const lv = dbm >= -50 ? '极强' : dbm >= -60 ? '强' : dbm >= -70 ? '中' : dbm >= -80 ? '弱' : '极弱';
        return `<span style="color:${c}">${lv}</span>`;
    };

    const fmtTime = (ts) => {
        if (!ts) return '--';
        const d = new Date(ts);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    };

    const fmtIp6Badge = (ip6s) => {
        if (!ip6s || ip6s.length === 0) return '';
        const label = ip6s.length > 1 ? `+v6(${ip6s.length})` : '+v6';
        return `<span style="font-size:9px;opacity:.5;margin-left:4px;">${label}</span>`;
    };

    const fmtLimitBtn = (mac, offline) => {
        const l = deviceLimits[mac] || {};
        const limited = (parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0;
        const base = offline
            ? 'font-size:9px;padding:1px 4px;border:1px solid rgba(255,255,255,0.1);border-radius:3px;color:inherit;cursor:pointer;'
            : 'font-size:10px;padding:1px 5px;border:1px solid rgba(255,255,255,0.15);border-radius:3px;color:inherit;cursor:pointer;';
        const bg = limited ? 'background:var(--dark-btn-color-active);' : (offline ? 'background:rgba(255,255,255,0.05);' : 'background:rgba(255,255,255,0.08);');
        const op = limited ? '.95' : (offline ? '.4' : '.5');
        return `<button class="kano-limit-btn" data-mac="${mac}" title="限速" style="${base}${bg}opacity:${op};">${ICON.limit}</button>`;
    };

    const renderList = () => {
        if (pluginUninstalled) return;
        const tbody = document.querySelector('#kano_traffic_tbody');
        if (!tbody) return;
        let grand = 0;
        for (const d of deviceList) grand += getTraffic(d.mac).total;
        for (const [mac, h] of Object.entries(trafficHistory)) {
            if (!deviceList.find(d => d.mac === mac)) grand += getTraffic(mac).total;
        }
        const sortedDevices = [...deviceList].sort((a, b) => getTraffic(b.mac).total - getTraffic(a.mac).total);
        let html = '';
        if (sortedDevices.length > 0) {
            html += `<tr><td colspan="7" style="padding:6px 8px;font-size:10px;opacity:.5;text-align:left;color:#4ade80;">${ICON.online} 在线设备 (${sortedDevices.length})</td></tr>`;
            for (const d of sortedDevices) {
                const t = getTraffic(d.mac);
                const pct = grand > 0 ? ((t.total / grand) * 100).toFixed(1) : 0;
                const ip6s = d.ip6s || [];
                let ipDisplay = d.ip || '--';
                ipDisplay += fmtIp6Badge(ip6s);
                html += `<tr class="kano-tr" style="border-bottom:1px solid rgba(255,255,255,0.04);" data-mac="${d.mac}">
                    <td class="kano-td" style="padding:10px 8px;">
                        <div class="kano-hostname" style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;">
                            ${escHtml(d.hostname)}
                            ${d.connType ? `<span style="font-size:9px;opacity:.5;font-weight:400;" title="连接方式">${d.connType === '有线' ? ICON.wired + '有线' : d.connType === '无线' ? ICON.wifi + '无线' : escHtml(d.connType)}</span>` : ''}
                            <button class="kano-rename-btn" data-mac="${d.mac}" title="改名" style="font-size:10px;padding:1px 5px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:3px;color:inherit;cursor:pointer;opacity:.5;">${ICON.rename}</button>
                        </div>
                        <div style="font-size:11px;opacity:.55;">${ipDisplay}</div>
                        ${ip6s.length ? `<div style="font-size:9px;opacity:.35;word-break:break-all;">${escHtml(ip6s[0])}${ip6s.length > 1 ? ` 等${ip6s.length}个` : ''}</div>` : ''}
                    </td>
                    <td class="kano-td kano-mac" style="padding:10px 8px;font-size:11px;font-family:monospace;opacity:.65;">${d.mac}</td>
                    <td class="kano-td kano-signal" style="padding:10px 8px;text-align:center;font-size:12px;">${fmtSig(d.signal)}${d.signal !== null ? `<div style="font-size:10px;opacity:.5">${d.signal}dBm</div>` : ''}</td>
                    <td class="kano-td" style="padding:10px 8px;text-align:right;font-family:monospace;font-size:12px;color:#4ade80;">${formatBytes(t.up)}${t.speedUp > 0 ? `<div style="font-size:9px;opacity:.6;color:#4ade80;">+${formatBytes(t.speedUp)}/s</div>` : ''}</td>
                    <td class="kano-td" style="padding:10px 8px;text-align:right;font-family:monospace;font-size:12px;color:#60a5fa;">${formatBytes(t.down)}${t.speedDown > 0 ? `<div style="font-size:9px;opacity:.6;color:#60a5fa;">+${formatBytes(t.speedDown)}/s</div>` : ''}</td>
                    <td class="kano-td" style="padding:10px 8px;text-align:right;font-size:12px;min-width:90px;">
                        <div style="font-weight:700;color:var(--dark-btn-color-active);">${formatBytes(t.total)}</div>
                        <div style="width:100%;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:4px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--dark-btn-color-active),#4ade80);border-radius:2px;"></div></div>
                        <div style="font-size:9px;opacity:.4;text-align:right;">${pct}%</div>
                        <div class="kano-td-sub" style="font-size:9px;opacity:.75;text-align:right;margin-top:3px;"><span style="color:#4ade80;">${ICON.up}${formatBytes(t.up)}${t.speedUp > 0 ? ' +'+formatBytes(t.speedUp)+'/s' : ''}</span> \u00B7 <span style="color:#60a5fa;">${ICON.down}${formatBytes(t.down)}${t.speedDown > 0 ? ' +'+formatBytes(t.speedDown)+'/s' : ''}</span></div>
                    </td>
                    <td class="kano-td" style="padding:10px 4px;text-align:center;">
                        ${fmtLimitBtn(d.mac, false)}
                        <button class="kano-del-btn" data-mac="${d.mac}" data-ip="${d.ip || ''}" data-ip6="${ip6s[0] || ''}" title="删除" style="font-size:12px;padding:2px 6px;background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.2);border-radius:4px;color:#ff6b6b;cursor:pointer;opacity:.7;">${ICON.del}</button>
                    </td>
                </tr>`;
            }
        }
        const onlineMacs = new Set(sortedDevices.map(d => d.mac));
        const offlineDevs = [];
        for (const [mac, h] of Object.entries(trafficHistory)) {
            if (onlineMacs.has(mac)) continue;
            const t = getTraffic(mac);
            if (t.total === 0) continue;
            offlineDevs.push({
                mac,
                hostname: customNames[mac] || h.hostname || defaultDeviceName(h.ip),
                ip: h.ip || '--',
                ip6s: h.ip6s || (h.ip6 ? [h.ip6] : []),
                lastSeen: h.lastSeen,
                total: t.total
            });
        }
        offlineDevs.sort((a, b) => b.total - a.total);
        if (offlineDevs.length > 0) {
            html += `<tr><td colspan="7" style="padding:6px 8px;font-size:10px;opacity:.5;text-align:left;color:#888;border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;">${ICON.offline} 离线设备 (${offlineDevs.length}) &mdash; 曾经连接过</td></tr>`;
            for (const d of offlineDevs) {
                const t = getTraffic(d.mac);
                const pct = grand > 0 ? ((t.total / grand) * 100).toFixed(1) : 0;
                let ipDisplay = d.ip || '--';
                ipDisplay += fmtIp6Badge(d.ip6s);
                html += `<tr class="kano-tr" style="border-bottom:1px solid rgba(255,255,255,0.02);opacity:.55;" data-mac="${d.mac}">
                    <td class="kano-td" style="padding:8px;">
                        <div class="kano-hostname" style="font-weight:600;font-size:12px;display:flex;align-items:center;gap:6px;">
                            ${escHtml(d.hostname)}
                            <button class="kano-rename-btn" data-mac="${d.mac}" title="改名" style="font-size:9px;padding:1px 4px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:3px;color:inherit;cursor:pointer;opacity:.4;">${ICON.rename}</button>
                        </div>
                        <div style="font-size:10px;opacity:.4;">${ipDisplay}</div>
                        ${d.ip6s.length ? `<div style="font-size:9px;opacity:.3;word-break:break-all;">${escHtml(d.ip6s[0])}${d.ip6s.length > 1 ? ` 等${d.ip6s.length}个` : ''}</div>` : ''}
                    </td>
                    <td class="kano-td kano-mac" style="padding:8px;font-size:10px;font-family:monospace;opacity:.5;">${d.mac}</td>
                    <td class="kano-td kano-signal" style="padding:8px;text-align:center;font-size:11px;opacity:.4;">--</td>
                    <td class="kano-td" style="padding:8px;text-align:right;font-family:monospace;font-size:11px;color:#4ade80;opacity:.5;">${formatBytes(t.up)}</td>
                    <td class="kano-td" style="padding:8px;text-align:right;font-family:monospace;font-size:11px;color:#60a5fa;opacity:.5;">${formatBytes(t.down)}</td>
                    <td class="kano-td" style="padding:8px;text-align:right;font-size:11px;min-width:90px;">
                        <div style="font-weight:600;">${formatBytes(t.total)}</div>
                        <div style="font-size:9px;opacity:.35;">${fmtTime(d.lastSeen)}</div>
                        <div class="kano-td-sub" style="font-size:9px;opacity:.65;text-align:right;margin-top:2px;"><span style="color:#4ade80;">${ICON.up}${formatBytes(t.up)}</span> \u00B7 <span style="color:#60a5fa;">${ICON.down}${formatBytes(t.down)}</span></div>
                    </td>
                    <td class="kano-td" style="padding:8px 4px;text-align:center;">
                        ${fmtLimitBtn(d.mac, true)}
                        <button class="kano-del-btn" data-mac="${d.mac}" data-ip="${d.ip === '--' ? '' : d.ip}" data-ip6="${d.ip6s[0] || ''}" title="删除" style="font-size:11px;padding:2px 5px;background:rgba(255,107,107,0.08);border:1px solid rgba(255,107,107,0.15);border-radius:4px;color:#ff6b6b;cursor:pointer;opacity:.5;">${ICON.del}</button>
                    </td>
                </tr>`;
            }
        }
        if (deviceList.length === 0 && offlineDevs.length === 0) {
            html = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#888;">暂无设备</td></tr>`;
        }
        tbody.innerHTML = html;
        tbody.querySelectorAll('.kano-rename-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); showRenameModal(btn.dataset.mac); });
        });
        tbody.querySelectorAll('.kano-limit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); showLimitModal(btn.dataset.mac); });
        });
        tbody.querySelectorAll('.kano-del-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); showDeleteConfirm(btn.dataset.mac, btn.dataset.ip, btn.dataset.ip6); });
        });
        try { applyResponsive(); } catch (e) {} // v21.1.10: 数据变化后重测溢出, 需要时切换田字排版
    };

    // v21.1.27: 差额归因 —— 系统增量(WAN口计数, 与UT"今日流量"同源) − 设备合计 − 路由器自身 = 未归属
    const getReconcile = () => {
        const eng = _engineJsonCache.data;
        const sum = eng && eng.summary ? eng.summary : null;
        if (!eng || !sum || sum.sysDeltaBytes == null) return null;
        const sysUp = sum.sysDeltaTxBytes || 0, sysDown = sum.sysDeltaRxBytes || 0;
        let devUp = 0, devDown = 0;
        for (const k of Object.keys(eng.devices || {})) { devUp += eng.devices[k].txBytes || 0; devDown += eng.devices[k].rxBytes || 0; }
        const locUp = sum.ctLocalTxBytes || 0, locDown = sum.ctLocalRxBytes || 0;
        return {
            eng, sum, sysUp, sysDown, devUp, devDown, locUp, locDown,
            hasSplit: sum.ctLocalBytes != null, // 引擎≥v1.0.8 才有本机/未归属拆分
            unUp: Math.max(0, sysUp - devUp - locUp), unDown: Math.max(0, sysDown - devDown - locDown),
            degraded: eng.conntrack === 0 || eng.acct === 0 || sum.degraded === 1
        };
    };

    const renderOverview = () => {
        if (pluginUninstalled) return;
        const el = document.querySelector('#kano_traffic_overview');
        if (!el) return;
        let up = 0, down = 0;
        for (const d of deviceList) { const t = getTraffic(d.mac); up += t.up; down += t.down; }
        let html = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:8px;text-align:center;">
            <div style="padding:12px 4px;background:rgba(255,255,255,0.03);border-radius:10px;"><div style="font-size:10px;opacity:.55">接入设备</div><div style="font-size:22px;font-weight:900;color:var(--dark-btn-color-active);">${deviceList.length}</div></div>
            <div style="padding:12px 4px;background:rgba(255,255,255,0.03);border-radius:10px;"><div style="font-size:10px;opacity:.55">总上行</div><div style="font-size:14px;font-weight:800">${formatBytes(up)}</div></div>
            <div style="padding:12px 4px;background:rgba(255,255,255,0.03);border-radius:10px;"><div style="font-size:10px;opacity:.55">总下行</div><div style="font-size:14px;font-weight:800">${formatBytes(down)}</div></div>
            <div style="padding:12px 4px;background:rgba(255,255,255,0.03);border-radius:10px;"><div style="font-size:10px;opacity:.55">总流量</div><div style="font-size:14px;font-weight:800;color:#a78bfa">${formatBytes(up+down)}</div></div>
        </div>`;
        const rc = getReconcile(); // v21.1.27: 未归属流量显化(不虚构去处, 差额亮出来)
        if (rc) {
            const sysTot = rc.sysUp + rc.sysDown, unTot = rc.unUp + rc.unDown;
            const ratio = sysTot > 0 ? unTot / sysTot : 0;
            const suspicious = ratio > 0.1 && unTot > 100 * 1024 * 1024;
            html += `<div id="kano_unattr_row" title="点击查看差额归因明细" style="margin-top:6px;padding:7px 10px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:10px;display:flex;flex-wrap:wrap;gap:3px 8px;align-items:center;cursor:pointer;line-height:1.5;">
                <span style="opacity:.55;">系统增量</span><span style="font-weight:700;">${formatBytes(sysTot)}</span>
                <span style="opacity:.3;">|</span>
                <span style="opacity:.55;">未归属</span><span style="font-weight:700;${suspicious ? 'color:#fbbf24;' : ''}">${ICON.up}${formatBytes(rc.unUp)} ${ICON.down}${formatBytes(rc.unDown)} Σ${formatBytes(unTot)}${sysTot > 0 ? ' (' + (ratio * 100).toFixed(1) + '%)' : ''}</span>
                ${rc.degraded ? '<span style="padding:0 6px;border-radius:4px;background:rgba(248,113,113,0.15);color:#f87171;font-weight:700;">降级统计</span>' : ''}
                ${!rc.hasSplit ? '<span style="opacity:.4;">升级引擎≥1.0.8可拆分归因</span>' : ''}
                <span style="margin-left:auto;opacity:.4;">归因 ›</span>
            </div>`;
        }
        el.innerHTML = html;
        const urow = el.querySelector('#kano_unattr_row');
        if (urow) urow.addEventListener('click', () => showUnattrDetail());
    };

    // v21.1.27: 差额归因明细弹窗 —— 拆解每一项来源, 不阻断主流程
    const showUnattrDetail = () => {
        const rc = getReconcile();
        if (!rc) { createToast('暂无引擎数据', 'pink'); return; }
        const { sum, eng } = rc;
        const sysTot = rc.sysUp + rc.sysDown, devTot = rc.devUp + rc.devDown, locTot = rc.locUp + rc.locDown;
        const unTot = rc.unUp + rc.unDown;
        const ctUn = sum.unattrBytes || 0; // conntrack 里看到但归属失败的
        const residual = Math.max(0, unTot - ctUn); // conntrack 都没看到的(硬件加速/统计窗口)
        const row = (k, v, hint) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;"><span style="opacity:.75;">${k}${hint ? `<div style="font-size:10px;opacity:.45;margin-top:1px;">${hint}</div>` : ''}</span><span style="font-weight:600;text-align:right;white-space:nowrap;">${v}</span></div>`;
        let top = '';
        const tops = Array.isArray(eng.unattribTop) ? eng.unattribTop : [];
        if (tops.length) {
            top = '<div style="margin-top:10px;font-size:11px;opacity:.7;">未归属 TOP(按LAN侧地址聚合):</div>' +
                tops.map(t => `<div style="display:flex;justify-content:space-between;font-size:11px;font-family:monospace;padding:2px 0;"><span style="opacity:.8;">${escHtml(t.ip)}</span><span>${formatBytes(t.bytes || 0)}</span></div>`).join('');
        }
        createModal({
            name: 'traffic_unattr_modal', title: '◈ 差额归因', maxWidth: 'min(420px, 94vw)',
            showConfirm: false, closeBtnText: '关闭', onClose: () => true,
            content: `<div style="font-size:11px;opacity:.6;margin-bottom:8px;">引擎本轮运行窗口内: 系统增量 = 设备合计 + 路由器自身 + 未归属。系统增量与 UFI 工具箱"今日流量"同源(WAN口计数器), 可互相对照。</div>
                ${row('系统增量 (WAN口)', `${ICON.up}${formatBytes(rc.sysUp)} ${ICON.down}${formatBytes(rc.sysDown)} Σ${formatBytes(sysTot)}`)}
                ${row('设备合计 (已归属)', `${ICON.up}${formatBytes(rc.devUp)} ${ICON.down}${formatBytes(rc.devDown)} Σ${formatBytes(devTot)}`)}
                ${rc.hasSplit ? row('路由器自身消耗', `${ICON.up}${formatBytes(rc.locUp)} ${ICON.down}${formatBytes(rc.locDown)} Σ${formatBytes(locTot)}`, '插件/引擎自更新、DNS、NTP 等路由器自己产生的WAN流量') : ''}
                ${row('未归属合计', `${ICON.up}${formatBytes(rc.unUp)} ${ICON.down}${formatBytes(rc.unDown)} Σ${formatBytes(unTot)}`, '系统增量中找不到设备主人的部分')}
                ${rc.hasSplit ? row('├ conntrack可见但归属失败', formatBytes(ctUn), '引擎已对该类地址主动发起ND/ARP探测, 学到MAC后自动追认') + row('└ conntrack口径外残余', formatBytes(residual), '硬件转发加速绕过记账、引擎重启前后的统计窗口等') : ''}
                ${top}
                <div style="margin-top:10px;font-size:10px;opacity:.5;line-height:1.7;">未归属偏高的常见原因: ① IPv6 临时地址轮换(引擎会自动追溯, 几分钟后回落) ② 内核 acct 未生效(界面会标记"降级统计") ③ 硬件转发加速 ④ 有线口下接路由器的 NAT 设备(并入下接设备, 拓扑决定) ⑤ 设备上的代理/VPN 隧道${rc.degraded ? '<br><span style="color:#f87171;">当前处于降级统计: conntrack记账不可用, 仅能依赖WAN总量。</span>' : ''}</div>`
        });
    };

    const showRenameModal = (mac) => {
        if (pluginUninstalled) return;
        const dev = deviceList.find(d => d.mac === mac);
        const h = trafficHistory[mac];
        if (!dev && !h) return;
        const hIp6s = h ? (h.ip6s || (h.ip6 ? [h.ip6] : [])) : [];
        const ctx = dev || {
            mac, ip: h.ip || '', ip6s: hIp6s,
            hostname: customNames[mac] || h.hostname || defaultDeviceName(h.ip),
            autoName: (h.hostname && !isDefaultDeviceName(h.hostname) ? h.hostname : '') || defaultDeviceName(h.ip)
        };
        const currentName = customNames[mac] || ctx.hostname;
        const ip6s = ctx.ip6s || [];
        const { id, el } = createModal({
            name: 'traffic_rename_modal', title: '修改设备名称', maxWidth: 'min(360px, 94vw)',
            showConfirm: true, confirmBtnText: '保存', closeBtnText: '取消',
            onClose: () => true,
            onConfirm: async () => {
                const input = el.querySelector('#rename_input');
                const val = input?.value?.trim();
                if (val) {
                    customNames[mac] = val;
                    await saveNames();
                    const d = deviceList.find(x => x.mac === mac);
                    if (d) d.hostname = val;
                    if (trafficHistory[mac]) { trafficHistory[mac].hostname = val; await flushHistory(true); }
                    renderList();
                    createToast('已保存到设备: ' + val, 'green');
                } else {
                    delete customNames[mac];
                    await saveNames();
                    const d = deviceList.find(x => x.mac === mac);
                    if (d) d.hostname = d.autoName || defaultDeviceName(d.ip);
                    if (trafficHistory[mac]) {
                        trafficHistory[mac].hostname = d ? d.hostname : (ctx.autoName || defaultDeviceName(ctx.ip));
                        await flushHistory(true);
                    }
                    renderList();
                    createToast('已恢复默认', 'green');
                }
                return true;
            },
            content: `<div style="font-size:13px;margin-bottom:10px;opacity:.7;">MAC: <span style="font-family:monospace;">${mac}</span><br>IP: ${ctx.ip || '--'}${ip6s.length ? '<br>IPv6: ' + escHtml(ip6s[0]) + (ip6s.length > 1 ? ` 等${ip6s.length}个` : '') : ''}</div><input id="rename_input" type="text" value="${escHtml(currentName)}" style="width:100%;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:13px;" placeholder="输入名称，留空恢复默认"><div style="margin-top:8px;font-size:11px;opacity:.5;">留空将恢复为自动识别名称：${escHtml(ctx.autoName || defaultDeviceName(ctx.ip))}</div>`
        });
        showModal(id);
        setTimeout(() => { const input = el.querySelector('#rename_input'); if (input) { input.focus(); input.select(); } }, 100);
    };

    const showLimitModal = (mac) => {
        if (pluginUninstalled) return;
        const dev = deviceList.find(d => d.mac === mac);
        const h = trafficHistory[mac];
        if (!dev && !h) return;
        const name = dev ? dev.hostname : (customNames[mac] || h.hostname || defaultDeviceName(h.ip));
        const ip = dev ? (dev.ip || '') : (h.ip || '');
        const ip6s = dev ? (dev.ip6s || []) : (h.ip6s || (h.ip6 ? [h.ip6] : []));
        const cur = deviceLimits[mac] || {};
        const curUpUnit = LIMIT_UNITS[cur.upUnit] ? cur.upUnit : 'KB/s';
        const curDownUnit = LIMIT_UNITS[cur.downUnit] ? cur.downUnit : 'KB/s';
        const curUpVal = cur.up ? (cur.up / LIMIT_UNITS[curUpUnit].factor).toFixed(curUpUnit === 'KB/s' ? 0 : 2).replace(/\.0+$/, '') : '';
        const curDownVal = cur.down ? (cur.down / LIMIT_UNITS[curDownUnit].factor).toFixed(curDownUnit === 'KB/s' ? 0 : 2).replace(/\.0+$/, '') : '';
        const unitOptions = (selected) => Object.keys(LIMIT_UNITS).map(u => `<option value="${u}" ${u === selected ? 'selected' : ''}>${LIMIT_UNITS[u].label}</option>`).join('');
        const modeText = limitMode === 'hashlimit' ? 'hashlimit 精确限速（按字节）' : limitMode === 'limit' ? 'limit 近似限速（当前内核仅支持按包限速，为近似值）' : '内核不支持限速模块（hashlimit/limit 均不可用）';
        const modeColor = limitMode === 'hashlimit' ? '#4ade80' : limitMode === 'limit' ? '#fbbf24' : '#f87171';
        const { id, el } = createModal({
            name: 'traffic_limit_modal', title: '⧗ 设备限速', maxWidth: 'min(380px, 94vw)',
            showConfirm: true, confirmBtnText: '保存', closeBtnText: '取消',
            onClose: () => true,
            onConfirm: async () => {
                if (limitMode === null) { createToast('内核不支持限速模块', 'red', 4000); return true; }
                const upVal = parseFloat(el.querySelector('#limit_up_input')?.value) || 0;
                const downVal = parseFloat(el.querySelector('#limit_down_input')?.value) || 0;
                const upUnit = el.querySelector('#limit_up_unit')?.value || 'KB/s';
                const downUnit = el.querySelector('#limit_down_unit')?.value || 'KB/s';
                const upKB = Math.max(0, Math.round(upVal * LIMIT_UNITS[upUnit].factor));
                const downKB = Math.max(0, Math.round(downVal * LIMIT_UNITS[downUnit].factor));
                if (upKB === 0 && downKB === 0) {
                    delete deviceLimits[mac];
                    await saveLimits();
                    await applyLimits();
                    renderList();
                    createToast('已取消限速: ' + name, 'green');
                    _log('LIMIT', `取消限速 mac=${mac}`);
                } else {
                    deviceLimits[mac] = { up: upKB, down: downKB, upUnit, downUnit };
                    await saveLimits();
                    await applyLimits();
                    renderList();
                    const upStr = upKB > 0 ? `${upVal}${upUnit}` : '不限';
                    const downStr = downKB > 0 ? `${downVal}${downUnit}` : '不限';
                    createToast(`已限速: 上行${upStr} 下行${downStr}`, 'green');
                    _log('LIMIT', `设置限速 mac=${mac} up=${upKB}KB/s down=${downKB}KB/s mode=${limitMode}`);
                }
                return true;
            },
            content: `<div style="font-size:13px;margin-bottom:10px;opacity:.7;">
                    设备: <strong style="color:var(--dark-btn-color-active);">${escHtml(name)}</strong><br>
                    MAC: <span style="font-family:monospace;">${mac}</span><br>
                    IP: ${escHtml(ip) || '--'}${ip6s.length ? ' <span style="font-size:10px;opacity:.6;">+v6(' + ip6s.length + ')</span>' : ''}
                </div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <div>
                        <label style="font-size:12px;opacity:.8;display:block;margin-bottom:4px;">上行限速</label>
                        <div style="display:flex;gap:6px;">
                            <input id="limit_up_input" type="number" min="0" step="any" value="${curUpVal}" placeholder="0 = 不限" style="flex:1;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:13px;box-sizing:border-box;">
                            <select id="limit_up_unit" style="padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${unitOptions(curUpUnit)}</select>
                        </div>
                    </div>
                    <div>
                        <label style="font-size:12px;opacity:.8;display:block;margin-bottom:4px;">下行限速</label>
                        <div style="display:flex;gap:6px;">
                            <input id="limit_down_input" type="number" min="0" step="any" value="${curDownVal}" placeholder="0 = 不限" style="flex:1;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:13px;box-sizing:border-box;">
                            <select id="limit_down_unit" style="padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${unitOptions(curDownUnit)}</select>
                        </div>
                    </div>
                </div>
                <div style="margin-top:12px;font-size:11px;opacity:.5;line-height:1.6;">
                    0 或留空 = 不限；两项均为 0 = 删除限速<br>
                    多地址设备每个地址独立限速（不拆分额度）<br>
                    被限速丢弃的包仍会计入流量统计<br>
                    当前模式: <span style="color:${modeColor};">${modeText}</span>
                </div>
                <button id="limit_diag_btn" style="width:100%;margin-top:10px;padding:8px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);border-radius:6px;color:#38bdf8;cursor:pointer;font-size:12px;">🔍 限速不生效？点我一键诊断</button>`
        });
        showModal(id);
        setTimeout(() => { el.querySelector('#limit_up_input')?.focus(); }, 100);
        el.querySelector('#limit_diag_btn')?.addEventListener('click', () => showLimitDiagModal());
    };

    const showDeleteConfirm = (mac, ip, ip6) => {
        if (pluginUninstalled) return;
        const dev = deviceList.find(d => d.mac === mac);
        const name = dev ? dev.hostname : (customNames[mac] || trafficHistory[mac]?.hostname || mac);
        const { id, el } = createModal({
            name: 'traffic_delete_modal', title: '删除设备记录', maxWidth: 'min(360px, 94vw)',
            showConfirm: true, confirmBtnText: '确认执行', closeBtnText: '取消',
            onClose: () => true,
            onConfirm: async () => {
                const action = el.querySelector('input[name="del_action"]:checked')?.value || 'clear';
                if (action === 'clear') {
                    await delDevRules(mac);
                    if (!engineActive()) await syncRules();
                    delete trafficHistory[mac];
                    await flushHistory(true);
                    renderList();
                    renderOverview();
                    createToast('已清除流量: ' + name, 'green');
                } else {
                    await delDevRules(mac);
                    delete trafficHistory[mac];
                    await flushHistory(true);
                    delete customNames[mac];
                    await saveNames();
                    deviceList = deviceList.filter(d => d.mac !== mac);
                    if (deviceLimits[mac]) { delete deviceLimits[mac]; await saveLimits(); await applyLimits(); }
                    renderList();
                    renderOverview();
                    createToast('已删除: ' + name, 'green');
                }
                return true;
            },
            content: `
                <div style="font-size:13px;line-height:1.6;opacity:.85;">
                    <strong style="color:var(--dark-btn-color-active);">${escHtml(name)}</strong><br>
                    MAC: <span style="font-family:monospace;opacity:.7;">${mac}</span><br>
                    IP: <span style="opacity:.7;">${escHtml(ip) || '--'}</span>${ip6 ? '<br>IPv6: <span style="opacity:.7;">' + escHtml(ip6) + '</span>' : ''}<br><br>
                    <div style="display:flex;flex-direction:column;gap:8px;margin:10px 0;">
                        <label style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(251,146,60,0.08);border-radius:6px;cursor:pointer;border:1px solid rgba(251,146,60,0.15);">
                            <input type="radio" name="del_action" value="clear" checked style="width:16px;height:16px;">
                            <div>
                                <div style="font-weight:bold;color:#fb923c;font-size:12px;">仅清除流量</div>
                                <div style="opacity:.5;font-size:11px;">保留自定义名称和离线记录，下次上线从零统计</div>
                            </div>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,107,107,0.08);border-radius:6px;cursor:pointer;border:1px solid rgba(255,107,107,0.15);">
                            <input type="radio" name="del_action" value="delete" style="width:16px;height:16px;">
                            <div>
                                <div style="font-weight:bold;color:#ff6b6b;font-size:12px;">删除全部</div>
                                <div style="opacity:.5;font-size:11px;">清除流量+名称+iptables规则，从列表彻底移除</div>
                            </div>
                        </label>
                    </div>
                </div>`
        });
        showModal(id);
    };

    const runLimitDiag = async () => {
        const out = [];
        const sec = (t) => out.push('', '=== ' + t + ' ===');
        if (!hasIptables) return 'iptables 不可用，无法进行限速诊断';
        sec('基本信息');
        out.push(`限速模式: ${limitMode === 'hashlimit' ? 'hashlimit(精确)' : limitMode === 'limit' ? 'limit(近似)' : '不可用'}`);
        out.push(`限速链已挂载: ${limitChainsMounted ? '是' : '否'}`);
        const activeN = Object.values(deviceLimits).filter(l => l && ((parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0)).length;
        out.push(`限速配置: ${activeN}台设备 ${JSON.stringify(deviceLimits)}`);
        sec('① 内核 hashlimit 支持');
        try {
            const m1 = _sh(await runShellWithRoot(`lsmod 2>/dev/null | grep -i hashlimit || echo NOLMOD`));
            out.push('lsmod: ' + (m1.includes('NOLMOD') ? '未见独立模块（可能已内置内核，以②实测为准）' : m1.trim()));
            const m2 = _sh(await runShellWithRoot(`timeout 2s awk '{print}' /proc/net/ip_tables_matches 2>/dev/null || echo ''`));
            out.push('matches 注册表含 hashlimit: ' + (m2.split('\n').some(l => l.trim() === 'hashlimit') ? '是 ✓' : '否 ✗（→ 内核不支持，限速必然无效）'));
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }
        sec('② 实测建规则（真实错误输出，不静默）');
        const TC = 'KANO_LDIAG';
        try {
            const t = _sh(await runShellWithRoot(
                `${IPT} -t filter -N ${TC} 2>/dev/null || true; ` +
                `${IPT} -t filter -A ${TC} -s 192.0.2.1 -m hashlimit --hashlimit-above 100kb/s --hashlimit-mode srcip --hashlimit-name ku_diag1 -j DROP 2>&1; echo "hashlimit规则 exit=$?"; ` +
                `${IPT} -t filter -A ${TC} -s 192.0.2.2 -m limit --limit 10/s -j DROP 2>&1; echo "limit规则 exit=$?"; ` +
                `${IPT} -t filter -F ${TC} 2>/dev/null; ${IPT} -t filter -X ${TC} 2>/dev/null; true`
            ));
            out.push(t.trim() || '(无输出)');
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }
        sec('③ 被限速设备地址清单');
        try {
            const rows = [];
            for (const mac of Object.keys(deviceLimits)) {
                const l = deviceLimits[mac];
                if (!l || !((parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0)) continue;
                const dev = deviceList.find(d => d.mac === mac);
                const v6s = dev?.ip6s || [];
                rows.push(`${mac}  限速${l.up || 0}KB/s↑ ${l.down || 0}KB/s↓\n  IPv4: ${dev?.ip || '(离线)'}\n  IPv6: ${v6s.length ? v6s.join(', ') : '(无)'}`);
            }
            out.push(rows.length ? rows.join('\n') : '(当前无生效的限速配置)');
            if (!enableIPv6) out.push('⚠ 插件IPv6统计未启用 → 不建任何v6限速规则，设备走IPv6的流量完全不受限！(设置里开启IPv6后重设限速)');
        } catch (e) { out.push('采集异常: ' + (e?.message || e)); }
        sec('③a KANO_LIMIT(v4) 10秒双采样（采样期间请让设备跑流量）');
        let v4delta = null;
        try {
            const sumPkts = (txt) => (txt.match(/^\s*(\d+)\s+\d+\s+(DROP|RETURN)/gm) || [])
                .reduce((s, l) => s + (parseInt(l.trim().split(/\s+/)[0]) || 0), 0);
            const sample = `${IPT} -t filter -nvxL ${LIMIT_CHAIN} 2>/dev/null || echo NOCHAIN`;
            const twoPhase = _sh(await runShellWithRoot(
                `echo ===T0===; ${sample}; echo ===SLEEP===; sleep 10; echo ===T1===; ${sample}`, 30000));
            const t0 = (twoPhase.split('===SLEEP===')[0] || '').replace('===T0===', '');
            const t1 = (twoPhase.split('===T1===')[1] || '');
            if (twoPhase.includes('NOCHAIN')) {
                out.push('链不存在 → 限速规则未应用（先给设备设置一个限速再来诊断）');
            } else {
                v4delta = sumPkts(t1) - sumPkts(t0);
                out.push(`10秒内 命中包数增量: ${v4delta} 个${v4delta > 0 ? ' ✓ 有包经过限速链' : ' ⚠ 没有任何包命中限速规则'}`);
                out.push('--- T1 链实况 ---');
                out.push(t1.trim() || '(无输出)');
            }
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }
        sec('③b KANO_LIMIT6(v6) 10秒双采样');
        try {
            if (!hasIp6tables) {
                out.push('ip6tables 不可用，跳过');
            } else if (!enableIPv6) {
                out.push('插件IPv6未启用 → v6不限速（见③警告）');
            } else {
                const sumPkts6 = (txt) => (txt.match(/^\s*(\d+)\s+\d+\s+(DROP|RETURN)/gm) || [])
                    .reduce((s, l) => s + (parseInt(l.trim().split(/\s+/)[0]) || 0), 0);
                const sample6 = `${IP6T} -t filter -nvxL ${LIMIT_CHAIN6} 2>/dev/null || echo NOCHAIN6`;
                const twoPhase6 = _sh(await runShellWithRoot(
                    `echo ===T0===; ${sample6}; echo ===SLEEP===; sleep 10; echo ===T1===; ${sample6}`, 30000));
                const t06 = (twoPhase6.split('===SLEEP===')[0] || '').replace('===T0===', '');
                const t16 = (twoPhase6.split('===T1===')[1] || '');
                if (twoPhase6.includes('NOCHAIN6')) {
                    out.push('v6链不存在 → 被限速设备当前无IPv6地址或规则未重建');
                } else {
                    const d6 = sumPkts6(t16) - sumPkts6(t06);
                    out.push(`10秒内 v6命中包数增量: ${d6} 个${d6 > 0 ? ' ✓ v6流量正在被限速' : ''}`);
                    out.push('--- T1 v6链实况 ---');
                    out.push(t16.trim() || '(无输出)');
                }
            }
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }
        sec('④ hashlimit 运行表（/proc/net/ipt_hashlimit）');
        try {
            const ht = _sh(await runShellWithRoot(`ls /proc/net/ipt_hashlimit/ 2>/dev/null || echo NODIR`));
            out.push(ht.includes('NODIR') ? '目录不存在 → 没有任何 hashlimit 规则在生效' : ht.trim());
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }
        sec('⑤ 硬件转发加速检测（存在 = 流量绕过 netfilter，限速对其无效）');
        try {
            const a = _sh(await runShellWithRoot(`lsmod 2>/dev/null | grep -iE 'shortcut|sfe|ecm_|nss|fast' || echo NOACC`));
            out.push(a.includes('NOACC') ? '未检测到加速模块 ✓' : '⚠ 检测到: ' + a.trim());
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }
        sec('⑥ filter FORWARD 挂载点（看 KANO_LIMIT 跳转是否被命中）');
        try {
            const f = _sh(await runShellWithRoot(`${IPT} -t filter -nvxL FORWARD 2>/dev/null | head -n 6`));
            out.push(f.trim() || '(无输出)');
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }
        sec('判读指南');
        out.push('· ①无hashlimit 或 ②exit非0 → 内核不支持/拒绝，错误文本即原因');
        out.push('· ③设备带IPv6地址 + ③a增量为0 + ③b未启用/无v6规则 → 流量走了IPv6，v4规则管不着：开启IPv6后重设限速');
        out.push('· ③a设备跑流量期间增量仍为0（且③设备无IPv6）→ 包没过此链：⑤有加速模块则是被它绕过；无加速则可能走了 USB 直连等非 FORWARD 路径');
        out.push('· ④无 ku_ 开头的表项 → hashlimit 规则实际未生效');
        out.push('· ③a/③b增量在涨但仍不限速 → 规则生效中，请把本报告发给开发者');
        out.push('· 注意：限速规则每30秒重建一次，链上 pkts 计数只反映最近≤30秒，以双采样增量为准');
        return out.join('\n');
    };

    const showLimitDiagModal = async () => {
        if (pluginUninstalled) return;
        const { id, el } = createModal({
            name: 'traffic_limit_diag_modal', title: '⧗ 限速专项诊断', maxWidth: 'min(520px, 94vw)',
            showConfirm: false, onClose: () => true,
            content: `<div style="font-size:12px;margin-bottom:8px;opacity:.6;">自动采集内核/规则/命中/加速信息，直接定位限速不生效的原因<br><span style="color:#fbbf24;">采集约 25 秒（含两次 10 秒流量采样）——期间请让被限速设备持续跑流量（测速/看视频），否则无法判断包是否经过限速链</span></div>
                <textarea readonly style="width:100%;height:50vh;font-size:11px;line-height:1.5;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;color:inherit;resize:none;font-family:monospace;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;">收集中（约25秒），期间请让被限速设备保持跑流量...</textarea>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
                    <button id="kano_ldiag_copy" style="font-size:11px;padding:4px 12px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:4px;color:#4ade80;cursor:pointer;">复制全部</button>
                </div>`
        });
        showModal(id);
        const report = await runLimitDiag();
        const ta = el.querySelector('textarea');
        if (ta) ta.value = report;
        _log('LIMIT', '已生成限速专项诊断报告');
        el.querySelector('#kano_ldiag_copy')?.addEventListener('click', async () => {
            const ok = await copyTextSafe(report, ta);
            createToast(ok ? '诊断报告已复制' : '复制失败，请长按文本全选后手动复制', ok ? 'green' : 'pink', 4000);
        });
    };

    const collectAuditText = async () => {
        const out = [];
        try {
            const r = await _shUser(`timeout 2s awk '{print}' ${STORAGE_FILE} 2>/dev/null || echo '{}'`); 
            let data = {};
            try { data = JSON.parse(_sh(r).trim() || '{}'); } catch (e) {}
            const _g = (b) => ((b || 0) / 1e9).toFixed(2) + 'GB';
            let found = false;
            for (const [mac, h] of Object.entries(data)) {
                const total = (h.totalUp || 0) + (h.totalDown || 0) + (h.curUp || 0) + (h.curDown || 0);
                if (total <= 1 * 1024 * 1024 * 1024) continue;
                found = true;
                const cur = (h.curUp || 0) + (h.curDown || 0);
                const hist = (h.totalUp || 0) + (h.totalDown || 0);
                const ratio = cur > 0 ? hist / cur : (hist > 0 ? 999 : 0);
                const v6n = (h.ip6s || (h.ip6 ? [h.ip6] : [])).length;
                const ledgerN = Object.keys(h.addrUp || {}).length;
                const devName = customNames[mac] || h.hostname || mac;
                let verdict;
                if (ratio >= 3 && hist > 5 * 1024 * 1024 * 1024 && v6n >= 2) {
                    verdict = '🔴 符合多IPv6轮换重复累加特征（旧版产生的脏数据），历史累计被反复滚入 → 建议「清除全部流量」';
                } else if (ratio >= 3 && hist > 5 * 1024 * 1024 * 1024) {
                    verdict = '🟡 历史累计远大于当前计数：经历过大量计数重置/地址更替，或为长期跨周期正常累计，结合设备实际用量判断';
                } else {
                    verdict = '🟢 未见异常累加特征';
                }
                out.push(`设备: ${devName} (${mac})`);
                out.push(`  上行: 历史${_g(h.totalUp)} + 当前${_g(h.curUp)}`);
                out.push(`  下行: 历史${_g(h.totalDown)} + 当前${_g(h.curDown)}`);
                out.push(`  IPv6地址 ${v6n}个 · 计数台账 ${ledgerN}条 · 历史/当前比 ${ratio === 999 ? '∞' : ratio.toFixed(1) + 'x'}`);
                out.push(`  判定: ${verdict}`);
            }
            if (!found) out.push('未发现 >1GB 的设备，流量分布正常');
        } catch (e) { out.push('审计采集异常: ' + (e?.message || e)); }
        return out.join('\n');
    };

    const exportDiagPack = async () => {
        const L = [];
        L.push('======== 设备流量监控 · 诊断包 ========');
        L.push(`插件版本: v${PLUGIN_VERSION}`);
        L.push(`采集时间: ${new Date().toLocaleString()}`);
        try { L.push(`UFI-TOOLS版本: ${(typeof UFI_DATA !== 'undefined' && UFI_DATA?.app_ver) || '未知'}`); } catch (e) {}
        L.push(`环境: iptables=${hasIptables ? IPT : '无'} ip6tables=${hasIp6tables ? IP6T : '无'} IPv6统计=${enableIPv6 ? '开' : '关'} 限速模块=${limitMode || '不可用'}`);
        try {
            const engSt = await getEngineStatus();
            const engNow = await readEngineJson(true);
            L.push(`统计引擎: ${engNow ? '运行中(引擎统计模式)' : engSt.installed ? '已安装未运行(已回退iptables)' : '未安装(iptables模式)'} · 版本=${engSt.ver || '无'} · WAN=${(engNow && engNow.wan) || '--'} · acct=${engSt.acct} · zeroStreak=${(engNow && engNow.summary && engNow.summary.zeroStreak) || 0}`);
        } catch (e) { L.push('统计引擎: 状态采集异常 ' + (e?.message || e)); }
        L.push(`设备: 在线${deviceList.length}台 · 历史${Object.keys(trafficHistory).length}台 · 限速中${Object.values(deviceLimits).filter(l => l && ((parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0)).length}台`);
        L.push('');
        L.push('======== ① 异常流量审计 ========');
        L.push(await collectAuditText());
        L.push('');
        L.push('======== ② 限速专项诊断 ========');
        L.push(hasActiveLimits() ? await runLimitDiag() : '(当前无限速配置，跳过)');
        L.push('');
        L.push('======== ③ 运行日志 ========');
        L.push(await readLogFile());
        L.push('');
        L.push('======== ④ 连接方式与接口 ========');
        try {
            let wifiN = 0, wiredN = 0, unknownN = 0;
            for (const d of deviceList) {
                if (d.connType === '无线') wifiN++;
                else if (d.connType === '有线') wiredN++;
                else unknownN++;
            }
            L.push(`连接方式分布: 无线 ${wifiN} 台 · 有线 ${wiredN} 台 · 未知 ${unknownN} 台`);
            const rIf = await runShellWithRoot(`ls /sys/class/net/ 2>/dev/null || echo ''`);
            const ifaces = _sh(rIf).split(/\s+/).map(s => s.trim()).filter(s => s && s !== 'lo' && !/^(wwan|rmnet|ccmni|pdp|ccni)/.test(s));
            L.push(`网络接口: ${ifaces.length ? ifaces.join(' ') : '未能枚举'}`);
            L.push('说明: 统计不区分有线/无线，转发流量均计数；有线口下接路由器/电脑时只能看到该设备本身，其 NAT 后设备的流量并入它统计（拓扑决定，非统计遗漏）');
        } catch (e) { L.push('采集异常: ' + (e?.message || e)); }
        L.push('');
        L.push('======== ⑤ 引擎进程与口径核对 ========');
        try {
            const r5 = await runShellWithRoot(`echo "-- 引擎进程(应只有1个) --"; ps -ef 2>/dev/null | grep kano_engine | grep -v grep || ps 2>/dev/null | grep kano_engine | grep -v grep || echo '(ps不可用)'; echo "-- 引擎JSON summary --"; head -c 500 /data/data/com.minikano.f50_sms/kano_engine.json 2>/dev/null || echo '(无JSON)'; echo; echo "-- 引擎日志尾部 --"; tail -c 2000 /data/data/com.minikano.f50_sms/kano_engine.log 2>/dev/null || echo '(无日志)'; echo; echo "-- 路由表 --"; ip route 2>/dev/null || echo '(ip命令不可用)'`);
            L.push(_sh(r5).trim() || '(无输出)');
        } catch (e) { L.push('采集异常: ' + (e?.message || e)); }
        L.push('');
        L.push('======== ⑥ 原始样本(供离线自检回归) ========');
        try {
            // v21.1.20: 采集真实 conntrack/邻居/JSON 样本, 用于引擎 --test 假数据校准格式
            const r6 = await runShellWithRoot(`echo "-- conntrack 样本(前80行) --"; head -n 80 /proc/net/nf_conntrack 2>/dev/null || echo '(无conntrack)'; echo "-- 邻居表 v4 --"; ip neigh show 2>/dev/null || cat /proc/net/arp 2>/dev/null || echo '(不可用)'; echo "-- 邻居表 v6 --"; ip -6 neigh show 2>/dev/null || echo '(不可用)'; echo "-- 引擎JSON全文 --"; cat /data/data/com.minikano.f50_sms/kano_engine.json 2>/dev/null || echo '(无JSON)'; echo "-- 归属缓存 --"; cat /data/data/com.minikano.f50_sms/kano_neigh_cache 2>/dev/null || echo '(无缓存, v1.0.4起生成)'`);
            L.push(_sh(r6).trim() || '(无输出)');
        } catch (e) { L.push('采集异常: ' + (e?.message || e)); }
        L.push('');
        L.push('======== 诊断包结束 ========');
        return L.join('\n');
    };

    const showExportModal = async () => {
        if (pluginUninstalled) return;
        const { id, el } = createModal({
            name: 'traffic_export_modal', title: '▤ 一键导出诊断包', maxWidth: 'min(520px, 94vw)',
            showConfirm: false, onClose: () => true,
            content: `<div style="font-size:12px;margin-bottom:8px;opacity:.6;line-height:1.6;">自动打包：异常流量审计 + 限速诊断 + 全部运行日志<br><span style="color:#fbbf24;">采集约 25 秒（含限速流量采样）——若有限速问题，期间请让被限速设备保持跑流量</span><br>采集完成后点下方「复制全部」，粘贴发送给开发者即可</div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:8px;">
                    <button id="kano_export_copy" disabled style="font-size:11px;padding:4px 12px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:4px;color:#4ade80;cursor:pointer;">复制全部</button>
                </div>
                <textarea readonly style="width:100%;height:50vh;font-size:11px;line-height:1.5;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;color:inherit;resize:none;font-family:monospace;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;">正在采集诊断包（约25秒），请稍候...</textarea>`
        });
        showModal(id);
        const pack = await exportDiagPack();
        const ta = el.querySelector('textarea');
        if (ta) ta.value = pack;
        const copyBtn = el.querySelector('#kano_export_copy');
        if (copyBtn) copyBtn.disabled = false;
        _log('DIAG', '已生成一键诊断包');
        copyBtn?.addEventListener('click', async () => {
            const ok = await copyTextSafe(pack, ta);
            createToast(ok ? '诊断包已复制，粘贴发送给开发者即可' : '复制失败，请长按文本全选后手动复制', ok ? 'green' : 'pink', 5000);
        });
    };

    const getEngineStatus = async () => {
        const st = { installed: false, running: false, ver: '', binSize: 0, jsonAge: -1, acct: 'na', boot: false, md5: '' };
        try {
            const r = await runShellWithRoot(
                `echo installed=$([ -x ${ENGINE_BIN} ] && echo 1 || echo 0); ` +
                `echo size=$(stat -c %s ${ENGINE_BIN} 2>/dev/null || echo 0); ` +
                `echo ver=$(awk '{print}' ${ENGINE_VER} 2>/dev/null); ` +
                `if ${ENGINE_ALIVE_SH}; then echo running=1; else echo running=0; fi; ` +
                `echo age=$(( $(date +%s) - $(stat -c %Y ${ENGINE_JSON} 2>/dev/null || echo 0) )); ` +
                `echo acct=$(awk '{print}' /proc/sys/net/netfilter/nf_conntrack_acct 2>/dev/null || echo na); ` +
                `echo md5=$(md5sum ${ENGINE_BIN} 2>/dev/null | awk '{print $1}'); ` +
                `grep -qxF '${ENGINE_BOOT_LINE}' ${ENGINE_BOOT_FILE} 2>/dev/null && echo boot=1 || echo boot=0`
            );
            const kv = {};
            for (const line of _sh(r).split('\n')) {
                const m = line.match(/^\s*(installed|size|ver|running|age|acct|boot|md5)=(.*)$/);
                if (m) kv[m[1]] = m[2].trim();
            }
            st.installed = kv.installed === '1';
            st.running = kv.running === '1';
            st.boot = kv.boot === '1';
            st.ver = kv.ver || '';
            st.binSize = parseInt(kv.size) || 0;
            st.jsonAge = kv.age !== undefined ? parseInt(kv.age) : -1;
            st.acct = kv.acct || 'na';
            st.md5 = kv.md5 || '';
        } catch (e) {}
        return st;
    };

    const ENGINE_ALIVE_SH = `p=$(cat ${ENGINE_PID} 2>/dev/null); [ -n "$p" ] && kill -0 $p 2>/dev/null && [ "$(awk '{print $3}' /proc/$p/stat 2>/dev/null)" != "Z" ]`;

    const startEngine = async () => {
        const cmd = `[ -x ${ENGINE_BIN} ] || chmod 777 ${ENGINE_BIN} 2>/dev/null; ` +
            `printf '1' > /proc/sys/net/netfilter/nf_conntrack_acct 2>/dev/null || true; ` +
            `if ${ENGINE_ALIVE_SH}; then echo ENGINE_RUNNING; else ` +
            `rm -f ${ENGINE_PID}; ` +
            `[ $(stat -c %s ${ENGINE_LOG} 2>/dev/null || echo 0) -gt 131072 ] && tail -c 65536 ${ENGINE_LOG} > ${ENGINE_LOG}.tmp 2>/dev/null && mv ${ENGINE_LOG}.tmp ${ENGINE_LOG}; ` +
            `nohup ${ENGINE_BIN} >>${ENGINE_LOG} 2>&1 & sleep 2; ` +
            `if ${ENGINE_ALIVE_SH}; then echo ENGINE_STARTED; else echo ENGINE_STARTFAIL; echo '-- 引擎日志尾部 --'; tail -c 1500 ${ENGINE_LOG} 2>/dev/null; fi; fi; ` +
            `sed -i '\\#${ENGINE_BIN}#d' ${ENGINE_BOOT_FILE} 2>/dev/null; touch ${ENGINE_BOOT_FILE} 2>/dev/null; printf '%s\\n' '${ENGINE_BOOT_LINE}' >> ${ENGINE_BOOT_FILE}`;
        const r = await runShellWithRoot(cmd);
        _logCmd('启动引擎', cmd, r);
        const out = _sh(r);
        if (out.includes('ENGINE_STARTFAIL')) _log('ERR', '引擎启动失败: 进程未存活(可能启动即崩溃), 日志尾部见上条 CMD 输出, 或点「🔍 引擎自检」定位');
        if (out.includes('ENGINE_STARTED')) {
            try { await runShellWithRoot(`date +%s > ${ENGINE_START_TS}`); } catch (e) {}
        }
        return out.includes('ENGINE_RUNNING') || out.includes('ENGINE_STARTED');
    };

    const stopEngine = async (removeBoot) => {
        const cmd = `if [ -f ${ENGINE_PID} ]; then kill $(cat ${ENGINE_PID} 2>/dev/null) 2>/dev/null; fi; ` +
            `i=0; while [ $i -lt 6 ]; do ${ENGINE_ALIVE_SH} || break; sleep 1; i=$((i+1)); done; ` +
            `if ${ENGINE_ALIVE_SH}; then kill -9 $(cat ${ENGINE_PID} 2>/dev/null) 2>/dev/null; sleep 1; fi; ` +
            `rm -f ${ENGINE_PID}; ` +
            (removeBoot ? `sed -i '\\#${ENGINE_BIN}#d' ${ENGINE_BOOT_FILE} 2>/dev/null || true; ` : '') +
            `echo ENGINE_STOPPED`;
        const r = await runShellWithRoot(cmd);
        _logCmd('停止引擎', cmd, r);
        _engineJsonCache = { t: 0, data: null };
    };

    const uninstallEngine = async () => {
        await stopEngine(true);
        await _shUser(`rm -f ${ENGINE_BIN} ${ENGINE_BIN}.new ${ENGINE_JSON} ${ENGINE_JSON}.tmp ${ENGINE_VER} ${ENGINE_PID} ${ENGINE_CMD} ${ENGINE_LOG} ${ENGINE_LOG}.tmp /data/data/com.minikano.f50_sms/.kano_engine.b64 /data/data/com.minikano.f50_sms/.kano_deploy.b64`);
        _engineJsonCache = { t: 0, data: null };
        _log('ACTION', '卸载统计引擎(仅引擎, 插件数据保留)');
        createToast('引擎已卸载，统计已回退 iptables 计数链', 'green', 4000);
    };

    const assetCandidates = (url, rawFirst) => {
        const out = [];
        const m = String(url).match(/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^/@]+)@([^/]+)\/(.+)$/);
        const raws = [];
        if (m) {
            const raw = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
            for (const p of ENGINE_GH_PROXIES) raws.push(p + raw);
        }
        if (rawFirst) out.push(...raws);
        for (const h of ENGINE_CDN_HOSTS) out.push(String(url).replace('cdn.jsdelivr.net', h));
        if (!rawFirst) out.push(...raws);
        const last = localStorage.getItem('kano_cdn_last_ok') || ''; // v21.1.6: 上次成功源排最前
        if (last) { const i = out.findIndex(u => u.includes('//' + last)); if (i > 0) out.unshift(out.splice(i, 1)[0]); }
        return out;
    };

    const fetchTextMulti = async (url, rawFirst) => {
        const cands = assetCandidates(url, rawFirst);
        const tryOne = async (u) => {
            const r = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
            if (r && r.ok) { try { localStorage.setItem('kano_cdn_last_ok', new URL(u).host); } catch (e) {} return await r.text(); }
            throw new Error('bad');
        };
        if (typeof Promise.any === 'function') {
            try { return await Promise.any(cands.map(tryOne)); } catch (e) { return null; }
        }
        for (const u of cands) { try { return await tryOne(u); } catch (e) {} }
        return null;
    };

    const deviceFetchText = async (url, rawFirst) => {
        const cands = assetCandidates(url, rawFirst);
        const urls = cands.map(u => `'${u}'`).join(' ');
        const CURL = '/data/data/com.minikano.f50_sms/files/curl';
        const cmd = `C=curl; [ -x ${CURL} ] && C=${CURL}; [ -x "$C" ] || which $C >/dev/null 2>&1 || echo NOCURL; ` +
            `ts=$(date +%s); for u in ${urls}; do out=$($C -fsSL --connect-timeout 4 --max-time 10 "$u?t=$ts" 2>/dev/null) && [ -n "$out" ] && { printf '__SRC_OK__\\n%s\\n%s' "$u" "$out"; break; }; echo "SRCFAIL $u"; done`;
        const r = await runShellWithRoot(cmd, 90000);
        const out = _sh(r);
        const m = out.match(/__SRC_OK__\n(\S+)\n([\s\S]*)$/);
        if (m) { try { localStorage.setItem('kano_cdn_last_ok', new URL(m[1]).host); } catch (e) {} }
        return {
            text: m ? m[2].trim() : '',
            fails: (out.match(/SRCFAIL/g) || []).length,
            total: cands.length,
            nocurl: out.includes('NOCURL'),
            raw: out
        };
    };

    let _manifestCache = { t: 0, j: null, nullT: 0 };
    const fetchManifest = async () => {
        const now = Date.now();
        if (_manifestCache.j && now - _manifestCache.t < 300000) return _manifestCache.j;
        if (!_manifestCache.j && _manifestCache.nullT && now - _manifestCache.nullT < 60000) return null;
        try {
            const d = await deviceFetchText(ENGINE_MANIFEST_URL, true);
            if (d.text) {
                try { const j = JSON.parse(d.text); if (j && j.rev && j.guard) { _manifestCache = { t: Date.now(), j, nullT: 0 }; return j; } } catch (e) {}
                _log('ENGINE', '云端清单: 设备侧下载成功但解析失败，尝试浏览器侧');
            } else {
                _log('ENGINE', `云端清单: 设备侧失败 SRCFAIL=${d.fails}/${d.total}${d.nocurl ? ' 设备无curl命令' : ''}，尝试浏览器侧`);
            }
        } catch (e) { _log('ENGINE', `云端清单: 设备侧异常 ${e && e.message || e}，尝试浏览器侧`); }
        const txt = await fetchTextMulti(ENGINE_MANIFEST_URL, true);
        if (txt) {
            try { const j = JSON.parse(txt); if (j && j.rev && j.guard) { _log('ENGINE', '云端清单: 浏览器侧获取成功'); _manifestCache = { t: Date.now(), j, nullT: 0 }; return j; } } catch (e) {}
            _log('ENGINE', '云端清单: 浏览器下载成功但解析失败');
        } else {
            _log('ENGINE', `云端清单: 浏览器 ${assetCandidates(ENGINE_MANIFEST_URL).length} 源也全部失败`);
        }
        _manifestCache.nullT = Date.now();
        return null;
    };

    const deployEngine = async (manifest) => {
        const text = await fetchTextMulti(manifest.guard);
        if (text === null) throw new Error('浏览器侧全部 CDN 节点下载失败');
        const b64 = text.replace(/\s+/g, '');
        if (b64.length < 500 || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error('下载内容不是有效 base64');
        const tmp = '/data/data/com.minikano.f50_sms/.kano_engine.b64';
        await _shUser(`rm -f ${tmp}`);
        for (let i = 0; i < b64.length; i += 12000) {
            const chunk = b64.slice(i, i + 12000);
            const wr = await _shUser(`printf '%s' '${chunk}' >> ${tmp}`);
            if (wr && wr.success === false) { await _shUser(`rm -f ${tmp}`); throw new Error('写入设备失败'); }
        }
        const md5 = String(manifest.md5 || '').toLowerCase();
        const checkMd5 = /^[0-9a-f]{32}$/.test(md5) && !/^0+$/.test(md5);
        const cmd = `base64 -d ${tmp} > ${ENGINE_BIN}.new 2>/dev/null || busybox base64 -d ${tmp} > ${ENGINE_BIN}.new 2>/dev/null; ` +
            `rm -f ${tmp}; ` +
            `head -c 4 ${ENGINE_BIN}.new 2>/dev/null | grep -q ELF || { echo DEPLOY_FAIL_NOT_ELF; rm -f ${ENGINE_BIN}.new; exit 0; }; ` +
            (checkMd5 ? `m=$(md5sum ${ENGINE_BIN}.new 2>/dev/null | awk '{print $1}'); [ "$m" = '${md5}' ] || { echo DEPLOY_FAIL_MD5; rm -f ${ENGINE_BIN}.new; exit 0; }; ` : '') +
            `chmod 777 ${ENGINE_BIN}.new; mv -f ${ENGINE_BIN}.new ${ENGINE_BIN}; printf '%s' '${manifest.rev}' > ${ENGINE_VER}; echo DEPLOY_OK`;
        const r = await runShellWithRoot(cmd);
        _logCmd('引擎部署', cmd, r);
        const out = _sh(r);
        if (out.includes('DEPLOY_FAIL_MD5')) throw new Error('MD5 校验失败');
        if (out.includes('DEPLOY_FAIL_NOT_ELF')) throw new Error('解码后不是有效可执行文件');
        if (!out.includes('DEPLOY_OK')) throw new Error('设备安装失败');
    };

    const deployEngineOnDevice = async (manifest) => {
        if (!manifest.deploy) throw new Error('云端清单缺少 deploy 地址');
        const CURL = '/data/data/com.minikano.f50_sms/files/curl';
        const tmp = '/data/data/com.minikano.f50_sms/.kano_deploy.b64';
        const urls = assetCandidates(manifest.deploy).map(u => `'${u}'`).join(' ');
        const cmd = `C=curl; [ -x ${CURL} ] && C=${CURL}; ` +
            `for u in ${urls}; do $C -fsSL --connect-timeout 8 --max-time 30 "$u" -o ${tmp} && [ -s ${tmp} ] && break; done; ` +
            `[ -s ${tmp} ] && ` +
            `(base64 -d ${tmp} 2>/dev/null || busybox base64 -d ${tmp} 2>/dev/null) > ${tmp}.sh && sh ${tmp}.sh && echo DEVICE_DEPLOY_OK || echo DEVICE_DEPLOY_FAIL; ` +
            `rm -f ${tmp} ${tmp}.sh`;
        const r = await runShellWithRoot(cmd, 120000);
        _logCmd('引擎部署(设备侧)', cmd, r);
        if (!_sh(r).includes('DEVICE_DEPLOY_OK')) throw new Error('设备侧下载部署失败');
    };

    const installOrUpdateEngine = async () => {
        const manifest = await fetchManifest();
        if (!manifest) { createToast('无法获取云端清单(检查网络/DNS)', 'red', 4000); _log('ENGINE', '获取云端清单失败'); return false; }
        try {
            const lv = _sh(await _shUser(`awk '{print}' ${ENGINE_VER} 2>/dev/null || echo ''`)).trim();
            if (lv && lv === manifest.rev && engineActive()) {
                createToast(`引擎已是最新 v${lv}，无需更新`, 'green', 3000);
                _log('ENGINE', `引擎已是最新 v${lv}，跳过部署`);
                return true;
            }
        } catch (e) {}
        try {
            await deployEngineOnDevice(manifest);
        } catch (e) {
            _log('ENGINE', `设备侧部署失败(${e && e.message || e})，改试浏览器中转`);
            try { await deployEngine(manifest); }
            catch (e2) { createToast('引擎部署失败: ' + (e2 && e2.message || e2), 'red', 5000); _log('ERR', `引擎部署失败: ${e2 && e2.message || e2}`); return false; }
        }
        await stopEngine(false);
        const ok = await startEngine();
        _engineJsonCache = { t: 0, data: null };
        _log('ENGINE', `引擎 v${manifest.rev} 部署完成${ok ? '，已启动' : '，启动结果待确认'}`);
        createToast(`统计引擎 v${manifest.rev} 部署完成`, 'green', 4000);
        return true;
    };

    const checkEngineUpdate = async (interactive) => {
        const manifest = await fetchManifest();
        if (!manifest) { if (interactive) createToast('无法获取云端清单', 'red', 3000); return null; }
        let local = '';
        try { const r = await _shUser(`awk '{print}' ${ENGINE_VER} 2>/dev/null || echo ''`); local = _sh(r).trim(); } catch (e) {}
        const newer = local !== manifest.rev;
        if (newer && local && !interactive && !_engineUpdateNotified) {
            _engineUpdateNotified = true;
            createToast(`统计引擎有新版本 v${manifest.rev}(当前 v${local})，点「🛠️ 引擎」一键更新`, 'pink', 6000);
        }
        _log('ENGINE', `云端版本 v${manifest.rev} 本地 ${local || '未安装'}${newer ? ' → 可更新' : ' → 已是最新'}`);
        return { manifest, local, newer };
    };

    const updatePluginSelf = async (manifest) => {
        try {
            if (!manifest || !manifest.js) throw new Error('云端清单缺少插件(js)地址');
            if (!/^https?:\/\//.test(manifest.js)) manifest = { ...manifest, js: 'https://cdn.jsdelivr.net/gh/468133/kano-engine-assets@main/' + String(manifest.js).replace(/^\/+/, '') }; // v21.1.7: 兼容清单里 js 为相对路径
            if (typeof getCustomHead !== 'function' || typeof setCustomHead !== 'function') throw new Error('当前 UFI-TOOLS 不支持插件自更新，请手动导入新插件文件');
            _log('ENGINE', `插件自更新: 本机 v${PLUGIN_VERSION} → 云端 v${manifest.jsRev || '?'}，开始下载`);
            _refreshing = true;
            let b64 = '';
            const tmpf = '/data/data/com.minikano.f50_sms/.kano_plugin.b64';
            const dlUrls = assetCandidates(manifest.js, true).map(u => `'${u}'`).join(' ');
            const CURLB = '/data/data/com.minikano.f50_sms/files/curl';
            const dlCmd = `C=curl; [ -x ${CURLB} ] && C=${CURLB}; rm -f ${tmpf}; ts=$(date +%s); for u in ${dlUrls}; do $C -fsSL --connect-timeout 8 --max-time 40 "$u?t=$ts" -o ${tmpf} && [ -s ${tmpf} ] && break; done; [ -s ${tmpf} ] && stat -c %s ${tmpf} || echo 0`;
            const dlr = await runShellWithRoot(dlCmd, 120000);
            _logCmd('插件包下载(设备侧落盘)', dlCmd, dlr);
            const dlsz = parseInt(_sh(dlr), 10) || 0;
            if (dlsz > 0) {
                for (let off = 0, i = 0; off < dlsz; off += 8000, i++) { // v21.1.6: dd 分块读回, 兼容 toybox(tail -c +N 部分设备不支持)
                    const cr = await runShellWithRoot(`dd if=${tmpf} bs=8000 skip=${i} count=1 2>/dev/null`);
                    b64 += _sh(cr).replace(/\s+/g, '');
                }
                await _shUser(`rm -f ${tmpf}`);
                if (b64.length < dlsz - 2) { _log('ERR', `插件包读回不完整 ${b64.length}/${dlsz}`); b64 = ''; }
            }
            if (!b64) { const t = await fetchTextMulti(manifest.js, true); if (t) b64 = t; }
            b64 = String(b64).replace(/\s+/g, '');
            if (b64.length < 10000 || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error('下载内容不是有效 base64(长度 ' + b64.length + ', 头部: ' + b64.slice(0, 24) + ', 设备落盘: ' + dlsz + ')');
            let newJs;
            try { newJs = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))); }
            catch (e) { throw new Error('插件文件解码失败: ' + (e && e.message || e)); }
            if (!newJs.includes(_SIG)) throw new Error('下载的插件缺少身份标识，可能被劫持或拿错文件，已中止');
            const head = await getCustomHead();
            if (!head) throw new Error('读取插件列表失败');
            const escRe = s => s.replace(/[\[\]]/g, '\\$&');
            const re = new RegExp(escRe(_PS) + '\\s*(.*?)\\s*-->([\\s\\S]*?)' + escRe(_PE) + '\\s*\\1\\s*-->', 'g');
            let found = false, newText = head, m;
            while ((m = re.exec(head)) !== null) {
                if (m[2].includes(_SIG)) {
                    newText = head.replace(m[0], () => `${_PS} ${m[1].trim()} -->\n${newJs}\n${_PE} ${m[1].trim()} -->`);
                    found = true;
                    break;
                }
            }
            if (!found) throw new Error('插件列表中未找到本插件标识，请先手动导入 v21.0.2 文件一次，之后即可自更新');
            let saved = false, lastErr = null;
            for (let i = 0; i < 3 && !saved; i++) {
                try {
                    const r = await setCustomHead(newText);
                    saved = !!(r && r.result === 'success');
                    if (!saved) lastErr = new Error('保存返回: ' + JSON.stringify(r).slice(0, 120));
                } catch (e) { lastErr = e; }
            }
            if (!saved) throw lastErr || new Error('保存插件列表失败');
            try { await flushHistory(true); } catch (e) {}
            _refreshing = false;
            _log('ACTION', `插件已自更新到 v${manifest.jsRev || '?'}，页面即将刷新`);
            createToast('插件已更新到 v' + (manifest.jsRev || '?') + '，2秒后刷新页面', 'green', 3000);
            setTimeout(() => location.reload(), 2000);
            return true;
        } catch (e) {
            _refreshing = false;
            createToast('插件更新失败: ' + (e && e.message || e), 'red', 6000);
            _log('ERR', `插件自更新失败: ${e && e.message || e}`);
            return false;
        }
    };

    const engineActive = () => !!(_engineJsonCache.data && _engineJsonCache.data.devices);

    // v21.1.20: 假数据自检开关 —— localStorage.kanoMock='1' 时注入 3 台假设备(大/中/小流量),
    // 计数随时间增长以产生速率; 用于验证三档UI/归档/历史回填/清零, 关闭(删该键)即恢复真实数据
    const _mockT0 = Date.now();
    const mockEngineJson = () => {
        const el = (Date.now() - _mockT0) / 1000;
        const wave = (a, b) => Math.max(0, a + b * Math.sin(Date.now() / 4000));
        const mk = (mac, ip, ip6s, hostname, connType, base, upBps, downBps) => ({
            mac, ip, ip6s, hostname, online: true, connType,
            txBytes: Math.floor(base * 0.3 + upBps * el), rxBytes: Math.floor(base * 0.7 + downBps * el),
            txRateBps: Math.floor(wave(upBps, upBps * 0.6)), rxRateBps: Math.floor(wave(downBps, downBps * 0.6))
        });
        const devices = {};
        const big = mk('aa:bb:cc:00:00:01', '192.168.0.100', ['2409:8d3c:310:222::100', '2409:8d3c:310:222::101'], 'Mock-大流量主机', '有线', 8e9, 2e6, 1.5e7);
        const mid = mk('aa:bb:cc:00:00:02', '192.168.0.101', ['2409:8d3c:310:222::102'], 'Mock-中流量手机', '无线', 1.5e9, 2e5, 2e6);
        const sml = mk('aa:bb:cc:00:00:03', '192.168.0.102', [], 'Mock-小流量插座长名字测试截断显示效果', '无线', 5e7, 1e3, 5e3);
        devices[big.mac] = big; devices[mid.mac] = mid; devices[sml.mac] = sml;
        const tot = [big, mid, sml].reduce((s, d) => s + d.txBytes + d.rxBytes, 0);
        const sysT = Math.floor(tot * 1.12); // v21.1.27: mock 带 12% 差额, 覆盖未归属行/归因弹窗显示
        const locT = Math.floor(tot * 0.04), unT = Math.floor(tot * 0.06);
        return { updatedAt: new Date().toLocaleString(), ts: Math.floor(Date.now() / 1000), engineRev: 'mock', wan: 'mock0', conntrack: 1, acct: 1,
            summary: { sysDeltaBytes: sysT, sysDeltaTxBytes: Math.floor(sysT * 0.2), sysDeltaRxBytes: Math.floor(sysT * 0.8), iptTotalBytes: tot, iptTotalV4Bytes: Math.floor(tot * 0.6), iptTotalV6Bytes: Math.floor(tot * 0.4), deviceTotalBytes: tot, deviceCount: 3, zeroStreak: 0,
                ctLocalBytes: locT, ctLocalTxBytes: Math.floor(locT * 0.6), ctLocalRxBytes: Math.floor(locT * 0.4),
                unattrBytes: unT, unattrTxBytes: Math.floor(unT * 0.3), unattrRxBytes: Math.floor(unT * 0.7), degraded: 0 },
            unattribTop: [{ ip: '192.168.0.200', bytes: Math.floor(unT * 0.7) }, { ip: '2409:8d3c:310:222:9999::55', bytes: Math.floor(unT * 0.3) }],
            devices };
    };

    const readEngineJson = async (force) => {
        const nowT = Date.now();
        if (!force && nowT - _engineJsonCache.t < 1200) return _engineJsonCache.data;
        _engineJsonCache.t = nowT;
        try {
            if (localStorage.getItem('kanoMock') === '1') { const j = mockEngineJson(); _engineJsonCache.data = j; return j; } // v21.1.20: 假数据自检
            const r = await _shUser(`now=$(date +%s); mt=$(stat -c %Y ${ENGINE_JSON} 2>/dev/null || echo 0); if [ $((now - mt)) -lt 30 ]; then timeout 2s awk '{print}' ${ENGINE_JSON} 2>/dev/null; fi`);
            const raw = _sh(r).trim();
            if (!raw) { _engineJsonCache.data = null; return null; }
            const j = JSON.parse(raw);
            if (!j || !j.devices) { _engineJsonCache.data = null; return null; }
            _engineJsonCache.data = j;
            return j;
        } catch (e) { _engineJsonCache.data = null; return null; }
    };

    const getRefreshInterval = () => {
        const s = parseFloat(archiveSettings.refreshSeconds);
        const ms = Math.min(5, Math.max(0.5, isNaN(s) ? DEFAULT_REFRESH_SEC : s)) * 1000;
        return ms; // 引擎模式同样按用户间隔刷新显示(引擎持续统计,数据每5s落盘,间隔只影响显示延迟)
    };

    const refresh = async () => {
        if (pluginUninstalled || _refreshing || _tickRunning) return;
        _refreshing = true;
        const btn = document.querySelector('#kano_traffic_refresh_btn');
        if (btn) { btn.disabled = true; btn.textContent = '刷新中...'; }
        try {
            if (isMockMode() && !window._kanoMockToast) { window._kanoMockToast = 1; createToast('🧪 假数据自检模式：仅验证功能，不写入任何统计数据', 'blue', 8000); }
            const engOn = !!(await readEngineJson(true));
            if (!engOn) {
                await initChain();
                if (hasIp6tables && enableIPv6) await initChain6();
            }
            await fetchDevs();
            if (!engOn) await syncRules();
            await applyLimits();
            await updateStats();
            renderList();
            renderOverview();
            await flushHistory(true);
        } catch (e) {
            console.error('[设备流量监控] 刷新失败:', e);
            _log('ERR', `手动刷新失败: ${e && e.message || e}`);
            createToast('刷新失败', 'red', 3000);
        } finally {
            _refreshing = false;
            if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
        }
    };

    const monitorTick = async () => {
        if (pluginUninstalled || _tickRunning || _refreshing) return;
        _tickRunning = true;
        monitorTickCount++;
        try {
            const fullSyncEvery = Math.max(1, Math.round(FULL_SYNC_MS / getRefreshInterval()));
            if (!engineActive() && monitorTickCount < fullSyncEvery && Date.now() - _lastProbe >= 2000) {
                _lastProbe = Date.now();
                try {
                    const arpNow = await getArpDevs();
                    const known = new Set(deviceList.map(d => d.mac));
                    if (arpNow.some(a => !known.has(a.mac))) {
                        _log('SYNC', '探针发现新设备接入，当轮立即完整同步');
                        await initChain();
                        if (hasIp6tables && enableIPv6) await initChain6();
                        await fetchDevs();
                        await syncRules();
                        await applyLimits();
                        monitorTickCount = 0;
                    }
                } catch (e) {}
            }
            if (monitorTickCount >= fullSyncEvery) {
                monitorTickCount = 0;
                const engOn = !!(await readEngineJson(true));
                if (!engOn) {
                    await initChain();
                    if (hasIp6tables && enableIPv6) await initChain6();
                }
                await fetchDevs();
                if (!engOn) await syncRules();
                await applyLimits();
            }
            await updateStats();
            renderList();
            renderOverview();
        } catch (e) {
            console.error('[设备流量监控] 监控tick异常:', e);
            _log('ERR', `监控tick异常: ${e && e.message || e}`);
        } finally {
            _tickRunning = false;
        }
    };

    const toggleMonitor = async (on) => {
        if (pluginUninstalled) return;
        const btn = document.querySelector('#kano_traffic_monitor_btn');
        if (on) {
            monitorTickCount = 0;
            monitorTimer = requestInterval(() => { monitorTick(); }, getRefreshInterval());
            if (btn) { btn.textContent = ICON.monitorOn + ' 停止监控'; btn.style.background = 'var(--dark-btn-color-active)'; }
            localStorage.setItem(MONITOR_STATE_KEY, '1');
            await refresh();
        } else {
            if (monitorTimer) { monitorTimer(); monitorTimer = null; }
            if (btn) { btn.textContent = ICON.monitor + ' 自动监控'; btn.style.background = ''; }
            localStorage.setItem(MONITOR_STATE_KEY, '0');
            await flushHistory(true);
        }
    };

    const clearAllTraffic = async () => {
        if (pluginUninstalled) return;
        if (_refreshing || _tickRunning) { createToast('正在同步数据，请稍后再试', 'pink', 3000); return; }
        _refreshing = true;
        try {
            const engOn = !!(await readEngineJson(true));
            if (!engOn) {
                await flushChain();
                await initChain();
                if (hasIp6tables && enableIPv6) await flushChain6();
                if (hasIp6tables && enableIPv6) await initChain6();
                ruleOwners = {};
                await syncRules();
            }
            const now = Date.now();
            resetHistoryEntries(now, true);
            _localResetAt = Date.now(); // 合并守卫: 防止磁盘旧值复活
            await flushHistory(true);
            renderList();
            renderOverview();
            _log('ACTION', '清除全部流量(保留名称)');
            createToast('已清除全部流量，自定义名称已保留', 'green');
        } finally { _refreshing = false; }
    };

    const archiveAndReset = async (label, resetCounters = true) => {
        if (pluginUninstalled) return;
        if (_refreshing || _tickRunning) { createToast('正在同步数据，请稍后再试', 'pink', 3000); return; }
        _refreshing = true;
        try {
            await updateStats();
            const now = Date.now();
            const snap = { id: now, label: label || '归档 ' + fmtDateTime(now), time: now, reset: !!resetCounters, by: clientName, devices: {} };
            const allMacs = new Set([...deviceList.map(d => d.mac), ...Object.keys(trafficHistory)]);
            for (const mac of allMacs) {
                const t = getTraffic(mac);
                const name = customNames[mac] || (trafficHistory[mac]?.hostname) || defaultDeviceName(trafficHistory[mac]?.ip);
                if (t.total > 0) {
                    snap.devices[mac] = { up: t.up, down: t.down, total: t.total, name, ip: trafficHistory[mac]?.ip || '', ip6: trafficHistory[mac]?.ip6s?.[0] || trafficHistory[mac]?.ip6 || '' };
                }
            }
            snapshots.unshift(snap);
            if (typeof selectedSnaps !== 'undefined') selectedSnaps.clear(); // 下标整体漂移, 清空勾选防误删
            if (snapshots.length > 50) snapshots = snapshots.slice(0, 50);
            await saveSnapshots();
            _log('ACTION', `归档 ${snap.label} reset=${resetCounters} 设备数=${Object.keys(snap.devices).length} 总量=${formatBytes(Object.values(snap.devices).reduce((s, d) => s + d.total, 0))}`);

            if (resetCounters) {
                const engOn = !!(await readEngineJson(true));
                if (!engOn) {
                    await _cleanMounts();
                    await zeroChainCounters();
                    if (hasIp6tables && enableIPv6) {
                        await flushChain6();
                        await initChain6();
                        for (const k of Object.keys(ruleOwners)) if (_isV6Addr(k)) delete ruleOwners[k];
                    }
                    await initChain();
                    await fetchDevs();
                    await syncRules();
                }
                resetHistoryEntries(now, false);
                _localResetAt = Date.now(); // 合并守卫: 60s 内不采纳磁盘旧值
                lastUpdateTime = Date.now();
                await flushHistory(true);
                renderList();
                renderOverview();
                createToast('已归档并重计: ' + snap.label, 'green');
            } else {
                await flushHistory(true);
                renderList();
                renderOverview();
                createToast('已归档: ' + snap.label, 'green');
            }
        } finally { _refreshing = false; }
    };

    const fmtDateTime = (ts) => {
        const d = new Date(ts);
        return d.getFullYear() + '/' + (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    };

    // ============================================================
    //  历史标签页 - 内联渲染 (重构核心)
    // ============================================================

    const switchHistoryTab = (tab) => {
        document.querySelectorAll('.kano-hist-tab-btn').forEach(b => {
            b.classList.toggle('kano-inner-on', b.dataset.tab === tab);
            b.style.opacity = b.dataset.tab === tab ? '1' : '.5';
            b.style.background = b.dataset.tab === tab ? 'rgba(255,255,255,0.08)' : 'transparent';
        });
        document.querySelectorAll('.kano-hist-pane').forEach(p => {
            p.style.display = p.dataset.pane === tab ? 'block' : 'none';
        });
        if (tab === 'records') renderHistoryRecordsInline();
        if (tab === 'rank') renderHistoryRankInline();
        if (tab === 'trend') renderHistoryTrendInline();
    };

    const renderHistoryRecordsInline = () => {
        const container = document.querySelector('#kano_history_records');
        if (!container) return;
        if (snapshots.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:30px;opacity:.5;">暂无归档记录<br><br>点击「归档并重计」创建第一条记录</div>';
            return;
        }
        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
        html += '<div style="opacity:.6;font-size:11px;">共 ' + snapshots.length + ' 条（最多50条）</div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        const bySet = [...new Set(snapshots.map(s => s.by).filter(Boolean))];
        if (historyByFilter && !bySet.includes(historyByFilter)) historyByFilter = '';
        if (bySet.length > 0) {
            html += '<select id="kano_hist_by_inline" style="font-size:10px;padding:3px 6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:inherit;max-width:110px;"><option value="">全部上传者</option>' +
                bySet.map(b => `<option value="${escHtml(b)}" ${historyByFilter === b ? 'selected' : ''}>${escHtml(b)}</option>`).join('') + '</select>';
        }
        html += '<button id="kano_snap_selectall_inline" style="font-size:10px;padding:3px 8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:inherit;cursor:pointer;">全选</button>';
        html += '<button id="kano_snap_readd_inline" style="font-size:10px;padding:3px 8px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:4px;color:#4ade80;cursor:pointer;">&#x21A9;&#xFE0F; 回添选中</button>';
        html += '<button id="kano_snap_batchdel_inline" style="font-size:10px;padding:3px 8px;background:rgba(255,107,107,0.12);border:1px solid rgba(255,107,107,0.2);border-radius:4px;color:#ff6b6b;cursor:pointer;">删除选中</button>';
        html += '</div></div>';
        html += '<div style="display:flex;flex-direction:column;gap:8px;">';
        const idxList = [];
        for (let i = 0; i < snapshots.length; i++) if (!historyByFilter || snapshots[i].by === historyByFilter) idxList.push(i);
        if (idxList.length === 0) html += '<div style="text-align:center;padding:20px;opacity:.5;">该上传者暂无记录</div>';
        for (const idx of idxList) {
            const snap = snapshots[idx];
            const devCount = Object.keys(snap.devices).length;
            let totalAll = 0;
            for (const d of Object.values(snap.devices)) totalAll += d.total;
            const checked = selectedSnaps.has(idx) ? 'checked' : '';
            html += `
                <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="checkbox" class="snap-checkbox-inline" data-idx="${idx}" ${checked} style="width:16px;height:16px;flex-shrink:0;">
                        <div style="flex:1;cursor:pointer;" onclick="this.parentElement.parentElement.querySelector('.snap-detail-inline').style.display=this.parentElement.parentElement.querySelector('.snap-detail-inline').style.display==='none'?'block':'none';">
                            <div style="font-weight:700;color:var(--dark-btn-color-active);font-size:12px;">${escHtml(snap.label)}${snap.reset === false ? '<span style="font-size:9px;font-weight:400;color:#fbbf24;border:1px solid rgba(251,191,36,.3);border-radius:3px;padding:0 4px;margin-left:6px;">仅归档</span>' : ''}</div>
                            <div style="opacity:.5;font-size:10px;margin-top:2px;">${fmtDateTime(snap.time)} &#xB7; ${devCount} 个设备 &#xB7; 总 ${formatBytes(totalAll)}${snap.by ? ' &#xB7; 由 ' + escHtml(snap.by) + ' 上传' : ''}</div>
                        </div>
                        <span style="font-size:10px;opacity:.4;flex-shrink:0;">&#x25BC;</span>
                    </div>
                    <div class="snap-detail-inline" style="display:none;padding-top:8px;padding-left:24px;">
                        <table style="width:100%;font-size:11px;border-collapse:collapse;">
                            <tr style="opacity:.5;font-size:10px;"><td>设备</td><td style="text-align:right;">上行</td><td style="text-align:right;">下行</td><td style="text-align:right;">总流量</td></tr>
                            ${Object.values(snap.devices).sort((a, b) => (b.total || 0) - (a.total || 0)).map(d => `<tr style="border-top:1px solid rgba(255,255,255,0.04);"><td style="padding:4px 0;">${escHtml(d.name)}</td><td style="text-align:right;font-family:monospace;">${formatBytes(d.up)}</td><td style="text-align:right;font-family:monospace;">${formatBytes(d.down)}</td><td style="text-align:right;font-weight:700;">${formatBytes(d.total)}</td></tr>`).join('')}
                        </table>
                    </div>
                </div>`;
        }
        html += '</div>';
        container.innerHTML = html;

        container.querySelector('#kano_hist_by_inline')?.addEventListener('change', (e) => {
            historyByFilter = e.target.value;
            renderHistoryRecordsInline();
        });
        container.querySelectorAll('.snap-checkbox-inline').forEach(cb => {
            cb.addEventListener('change', () => {
                const idx = parseInt(cb.dataset.idx);
                if (cb.checked) selectedSnaps.add(idx); else selectedSnaps.delete(idx);
            });
        });
        container.querySelector('#kano_snap_selectall_inline')?.addEventListener('click', () => {
            const allChecked = selectedSnaps.size === snapshots.length;
            selectedSnaps.clear();
            if (!allChecked) { for (let i = 0; i < snapshots.length; i++) selectedSnaps.add(i); }
            renderHistoryRecordsInline();
        });
        container.querySelector('#kano_snap_readd_inline')?.addEventListener('click', async () => {
            if (selectedSnaps.size === 0) { createToast('请先勾选要回添的记录', 'pink'); return; }
            const { id, el: reEl } = createModal({
                name: 'snap_readd_modal', title: '回添归档到当前统计', maxWidth: 'min(340px, 94vw)',
                showConfirm: true, confirmBtnText: '确认回添', closeBtnText: '取消',
                onClose: () => true,
                onConfirm: async () => {
                    const idxs = Array.from(selectedSnaps).sort((a, b) => b - a);
                    const now = Date.now();
                    let mergedDevs = 0, mergedBytes = 0;
                    for (const idx of idxs) {
                        const snap = snapshots[idx];
                        if (!snap) continue;
                        for (const [mac, sd] of Object.entries(snap.devices || {})) {
                            const h = trafficHistory[mac] || {
                                totalUp: 0, totalDown: 0, curUp: 0, curDown: 0, lastUp: 0, lastDown: 0,
                                firstSeen: snap.time || now, hostname: '', ip: '', ip6s: [], ip6: null,
                                addrUp: {}, addrDown: {}, speedUp: 0, speedDown: 0
                            };
                            h.totalUp = (h.totalUp || 0) + (sd.up || 0);
                            h.totalDown = (h.totalDown || 0) + (sd.down || 0);
                            if (!h.hostname && sd.name) h.hostname = sd.name;
                            if (!h.ip && sd.ip) h.ip = sd.ip;
                            if ((!h.ip6s || !h.ip6s.length) && sd.ip6) { h.ip6s = [sd.ip6]; h.ip6 = h.ip6 || sd.ip6; }
                            h.lastSeen = now;
                            trafficHistory[mac] = h;
                            mergedDevs++;
                            mergedBytes += (sd.up || 0) + (sd.down || 0);
                        }
                        snapshots.splice(idx, 1);
                    }
                    selectedSnaps.clear();
                    historyDirty = true;
                    await flushHistory(true);
                    await saveSnapshots();
                    renderList();
                    renderOverview();
                    renderHistoryRecordsInline();
                    _log('ACTION', `回添归档到当前统计 条数=${idxs.length} 设备=${mergedDevs} 流量=${formatBytes(mergedBytes)}`);
                    createToast(`已回添 ${idxs.length} 条归档(${mergedDevs}台设备 ${formatBytes(mergedBytes)})到当前统计`, 'green', 5000);
                    return true;
                },
                content: `<div style="font-size:13px;opacity:.85;">确定将 <strong>${selectedSnaps.size}</strong> 条归档记录的流量<strong style="color:#4ade80;">加回正在统计的累计中</strong>？<br><br>
                    <span style="font-size:12px;opacity:.7;">归档中的每台设备流量将累加到当前统计；回添后这些归档会被移除（避免累计排行重复计数）。</span><br><br>
                    <span style="color:#fbbf24;font-size:12px;">此操作不可自动撤销，请确认这些流量尚未计入当前统计。</span></div>`
            });
            showModal(id);
        });
        container.querySelector('#kano_snap_batchdel_inline')?.addEventListener('click', async () => {
            if (selectedSnaps.size === 0) { createToast('请先勾选要删除的记录', 'pink'); return; }
            const { id, el: delEl } = createModal({
                name: 'snap_batchdel_modal', title: '批量删除归档', maxWidth: 'min(320px, 94vw)',
                showConfirm: true, confirmBtnText: '确认删除', closeBtnText: '取消',
                onClose: () => true,
                onConfirm: async () => {
                    const toDelete = Array.from(selectedSnaps).sort((a, b) => b - a);
                    for (const idx of toDelete) snapshots.splice(idx, 1);
                    selectedSnaps.clear();
                    await saveSnapshots();
                    renderHistoryRecordsInline();
                    createToast('已删除 ' + toDelete.length + ' 条归档', 'green');
                    return true;
                },
                content: `<div style="font-size:13px;opacity:.85;">确定删除 <strong>${selectedSnaps.size}</strong> 条归档记录？<br><br><span style="color:#ff6b6b;font-size:12px;">此操作不可恢复。</span></div>`
            });
            showModal(id);
        });
    };

    const getCumulativeTraffic = (mac) => {
        const cur = getTraffic(mac);
        let snapUp = 0, snapDown = 0;
        for (const snap of snapshots) {
            if (snap.reset === false) continue;
            const d = snap.devices[mac];
            if (d) { snapUp += d.up || 0; snapDown += d.down || 0; }
        }
        return { up: cur.up + snapUp, down: cur.down + snapDown, total: cur.total + snapUp + snapDown };
    };

    const renderHistoryRankInline = () => {
        const container = document.querySelector('#kano_history_rank');
        if (!container) return;
        const isCumulative = rankMode === 'cumulative';
        const allDevs = [];
        const seenMacs = new Set();
        for (const d of deviceList) {
            const t = isCumulative ? getCumulativeTraffic(d.mac) : getTraffic(d.mac);
            if (t.total > 0) {
                allDevs.push({ name: d.hostname, mac: d.mac, ip: d.ip || '--', online: true, ...t });
                seenMacs.add(d.mac);
            }
        }
        for (const [mac, h] of Object.entries(trafficHistory)) {
            if (seenMacs.has(mac)) continue;
            const t = isCumulative ? getCumulativeTraffic(mac) : getTraffic(mac);
            if (t.total > 0) {
                allDevs.push({
                    name: customNames[mac] || h.hostname || defaultDeviceName(h.ip),
                    mac, ip: h.ip || '--', online: false, ...t
                });
                seenMacs.add(mac); // 修复: 漏加导致快照循环重复计入同一设备
            }
        }
        if (isCumulative) {
            for (const snap of snapshots) {
                for (const [mac, sd] of Object.entries(snap.devices)) {
                    if (seenMacs.has(mac)) continue;
                    const t = getCumulativeTraffic(mac);
                    if (t.total > 0) {
                        allDevs.push({
                            name: sd.name || customNames[mac] || defaultDeviceName(sd.ip),
                            mac, ip: sd.ip || '--', online: false, ...t
                        });
                        seenMacs.add(mac);
                    }
                }
            }
        }
        allDevs.sort((a, b) => b.total - a.total);
        let grand = allDevs.reduce((s, d) => s + d.total, 0);
        const rankColors = ['#fbbf24', '#9ca3af', '#b45309'];
        const rankIcons = ['&#x1F947;', '&#x1F948;', '&#x1F949;'];

        let rows = '';
        for (let i = 0; i < allDevs.length; i++) {
            const d = allDevs[i];
            const pct = grand > 0 ? ((d.total / grand) * 100).toFixed(1) : 0;
            const color = i < 3 ? rankColors[i] : 'inherit';
            const icon = i < 3 ? rankIcons[i] : (i + 1);
            rows += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                <td style="padding:8px 4px;font-weight:900;color:${color};font-size:14px;text-align:center;width:30px;">${icon}</td>
                <td style="padding:8px 4px;">
                    <div style="font-weight:700;font-size:13px;">${escHtml(d.name)}${d.online ? ' <span style="color:#4ade80;font-size:9px;">&#x25CF;</span>' : ' <span style="opacity:.3;font-size:9px;">&#x25CB;</span>'}</div>
                    <div style="font-size:10px;opacity:.5;">${d.ip}</div>
                </td>
                <td style="padding:8px 4px;text-align:right;font-family:monospace;font-size:12px;color:#4ade80;">${formatBytes(d.up)}</td>
                <td style="padding:8px 4px;text-align:right;font-family:monospace;font-size:12px;color:#60a5fa;">${formatBytes(d.down)}</td>
                <td style="padding:8px 4px;text-align:right;font-size:13px;font-weight:800;color:var(--dark-btn-color-active);">${formatBytes(d.total)}</td>
                <td style="padding:8px 4px;text-align:right;width:80px;">
                    <div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;"><div style="width:${Math.min(pct, 100)}%;height:100%;background:linear-gradient(90deg,${i < 3 ? color : 'var(--dark-btn-color-active)'},#4ade80);border-radius:2px;"></div></div>
                    <div style="font-size:9px;opacity:.4;text-align:right;margin-top:2px;">${pct}%</div>
                </td>
            </tr>`;
        }

        container.innerHTML = `
            <div style="display:flex;gap:8px;margin-bottom:12px;">
                <button id="rank_btn_current_inline" style="flex:1;padding:6px;border-radius:6px;border:1px solid ${!isCumulative ? 'var(--dark-btn-color-active)' : 'rgba(255,255,255,0.1)'};background:${!isCumulative ? 'rgba(255,255,255,0.08)' : 'transparent'};color:inherit;font-size:12px;cursor:pointer;font-weight:${!isCumulative ? '700' : '400'};">&#x1F4CA; 当前流量</button>
                <button id="rank_btn_cumulative_inline" style="flex:1;padding:6px;border-radius:6px;border:1px solid ${isCumulative ? 'var(--dark-btn-color-active)' : 'rgba(255,255,255,0.1)'};background:${isCumulative ? 'rgba(255,255,255,0.08)' : 'transparent'};color:inherit;font-size:12px;cursor:pointer;font-weight:${isCumulative ? '700' : '400'};">&#x1F4C8; 累计流量</button>
            </div>
            <div style="font-size:12px;margin-bottom:8px;opacity:.6;">${isCumulative ? '当前 + 历次「归档并重计」(不含「仅归档」，避免重复计数)' : '本次归档/重置以来'} &#xB7; 共 ${allDevs.length} 个设备 &#xB7; 总 ${formatBytes(grand)}</div>
            <table style="width:100%;font-size:12px;border-collapse:collapse;">
                <tr style="font-size:10px;opacity:.5;border-bottom:2px solid rgba(255,255,255,0.08);"><td></td><td>设备</td><td style="text-align:right;">&#x2B06;&#xFE0F;</td><td style="text-align:right;">&#x2B07;&#xFE0F;</td><td style="text-align:right;">总流量</td><td style="text-align:right;">占比</td></tr>
                ${rows || '<tr><td colspan="6" style="text-align:center;padding:20px;opacity:.5;">暂无流量数据</td></tr>'}
            </table>`;

        container.querySelector('#rank_btn_current_inline')?.addEventListener('click', () => { rankMode = 'current'; renderHistoryRankInline(); });
        container.querySelector('#rank_btn_cumulative_inline')?.addEventListener('click', () => { rankMode = 'cumulative'; renderHistoryRankInline(); });
    };

    const renderHistoryTrendInline = () => {
        const container = document.querySelector('#kano_history_trend');
        if (!container) return;
        const macSet = new Map();
        for (const sn of snapshots) for (const [mac, d] of Object.entries(sn.devices || {})) {
            if (!macSet.has(mac)) macSet.set(mac, d.name || mac);
        }
        if (macSet.size === 0) {
            container.innerHTML = '<div style="text-align:center;padding:30px;opacity:.5;">暂无归档记录</div>';
            return;
        }
        const cur = (container.dataset.mac && macSet.has(container.dataset.mac)) ? container.dataset.mac : [...macSet.keys()][0];
        container.dataset.mac = cur;
        const rows = [];
        let maxV = 1;
        for (const sn of snapshots) {
            const d = (sn.devices || {})[cur];
            if (!d) continue;
            const v = d.total || 0;
            if (v > maxV) maxV = v;
            rows.push({ label: sn.label, v, up: d.up || 0, down: d.down || 0, time: sn.time || 0 });
        }

        rows.sort((a, b) => (a.time || 0) - (b.time || 0)); // 横轴按归档时间先后排列
        let html = '<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;">';
        html += '<select id="kano_trend_mac_inline" style="flex:1;box-sizing:border-box;font-size:11px;padding:4px 6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:inherit;">' +
            [...macSet.entries()].map(([m, n]) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${escHtml(n)} (${m})</option>`).join('') + '</select>';
        html += `<button id="kano_trend_bar" style="font-size:11px;padding:4px 8px;border-radius:4px;border:1px solid ${trendChartMode === 'bar' ? 'var(--dark-btn-color-active)' : 'rgba(255,255,255,0.1)'};background:${trendChartMode === 'bar' ? 'rgba(255,255,255,0.08)' : 'transparent'};color:inherit;cursor:pointer;">${ICON.chartBar} 柱形图</button>`;
        html += `<button id="kano_trend_line" style="font-size:11px;padding:4px 8px;border-radius:4px;border:1px solid ${trendChartMode === 'line' ? 'var(--dark-btn-color-active)' : 'rgba(255,255,255,0.1)'};background:${trendChartMode === 'line' ? 'rgba(255,255,255,0.08)' : 'transparent'};color:inherit;cursor:pointer;">${ICON.chartHBar} 折线图</button>`;
        html += '</div>';

        if (rows.length === 0) {
            html += '<div style="text-align:center;padding:20px;opacity:.5;">该设备暂无归档记录</div>';
        } else {
            const show = rows.slice(-20);
            if (trendChartMode === 'bar') {
                html += '<div style="display:flex;align-items:flex-end;gap:4px;height:140px;padding:6px 2px;border-bottom:1px solid rgba(255,255,255,0.1);">';
                for (const r of show) {
                    const h = Math.max(2, Math.round(r.v / maxV * 120));
                    html += `<div title="${escHtml(r.label)} \u00B7 ${formatBytes(r.v)} \u00B7 ↑${formatBytes(r.up)} ↓${formatBytes(r.down)}" style="flex:1;min-width:8px;height:${h}px;background:linear-gradient(180deg,var(--dark-btn-color-active),#4ade80);border-radius:3px 3px 0 0;"></div>`;
                }
                html += `</div><div style="font-size:10px;opacity:.45;margin-top:6px;">最近 ${show.length} 次归档 \u00B7 悬停柱子查看数值 \u00B7 峰值 ${formatBytes(maxV)}</div>`;
            } else {
                // 折线图模式 (SVG)
                const W = 300, H = 120, pad = 20;
                const pts = show.map((r, i) => {
                    const x = pad + (show.length > 1 ? i / (show.length - 1) : 0.5) * (W - pad * 2);
                    const y = H - pad - (maxV > 0 ? (r.v / maxV) : 0) * (H - pad * 2);
                    return { x, y, v: r.v, up: r.up, down: r.down, label: r.label };
                });
                const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
                const area = `${pad},${H-pad} ` + polyline + ` ${W-pad},${H-pad}`;
                html += `<div style="position:relative;width:100%;height:${H}px;">
                    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:100%;overflow:visible;">
                        <defs><linearGradient id="kanoLineGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--dark-btn-color-active)" stop-opacity="0.35"/><stop offset="100%" stop-color="var(--dark-btn-color-active)" stop-opacity="0.02"/></linearGradient></defs>
                        <polygon points="${area}" fill="url(#kanoLineGrad)" />
                        <polyline points="${polyline}" fill="none" stroke="var(--dark-btn-color-active)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                        ${pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#4ade80" stroke="var(--dark-btn-color-active)" stroke-width="1.5"><title>${escHtml(p.label)}\n总: ${formatBytes(p.v)}\n↑${formatBytes(p.up)} ↓${formatBytes(p.down)}</title></circle>`).join('')}
                    </svg>
                    <div style="position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:space-between;font-size:9px;opacity:.45;padding:0 ${pad}px;">
                        <span>${escHtml(show[0]?.label?.slice(0,10) || '')}</span>
                        <span>${escHtml(show[show.length-1]?.label?.slice(0,10) || '')}</span>
                    </div>
                </div>
                <div style="font-size:10px;opacity:.45;margin-top:6px;">最近 ${show.length} 次归档 \u00B7 峰值 ${formatBytes(maxV)} \u00B7 悬停节点查看详情</div>`;
            }
        }
        container.innerHTML = html;
        container.querySelector('#kano_trend_mac_inline')?.addEventListener('change', (e) => { container.dataset.mac = e.target.value; renderHistoryTrendInline(); });
        container.querySelector('#kano_trend_bar')?.addEventListener('click', () => { trendChartMode = 'bar'; renderHistoryTrendInline(); });
        container.querySelector('#kano_trend_line')?.addEventListener('click', () => { trendChartMode = 'line'; renderHistoryTrendInline(); });
    };

    // ============================================================
    //  设置标签页 - 内联渲染 (重构核心)
    // ============================================================

    const switchSettingsTab = (tab) => {
        document.querySelectorAll('.kano-set-tab-btn').forEach(b => {
            b.classList.toggle('kano-inner-on', b.dataset.tab === tab);
            b.style.opacity = b.dataset.tab === tab ? '1' : '.5';
            b.style.background = b.dataset.tab === tab ? 'rgba(255,255,255,0.08)' : 'transparent';
        });
        document.querySelectorAll('.kano-set-pane').forEach(p => {
            p.style.display = p.dataset.pane === tab ? 'block' : 'none';
        });
        if (tab === 'settings') renderSettingsInline();
        if (tab === 'engine') renderEngineInline();
        if (tab === 'log') renderLogInline();
        if (tab === 'diag') renderDiagInline();
    };

    const renderSettingsInline = () => {
        const container = document.querySelector('#kano_settings_pane');
        if (!container) return;
        loadSettings();
        const pad = (n) => String(n).padStart(2, '0');
        const hours = Array.from({length:24}, (_,i) => `<option value="${i}" ${archiveSettings.dailyHour===i?'selected':''}>${pad(i)}:00</option>`).join('');
        const hours2 = Array.from({length:24}, (_,i) => `<option value="${i}" ${archiveSettings.monthlyHour===i?'selected':''}>${pad(i)}:00</option>`).join('');
        const days = Array.from({length:28}, (_,i) => `<option value="${i+1}" ${archiveSettings.monthlyDay===i+1?'selected':''}>${i+1}日</option>`).join('');
        const minutes = Array.from({length:60}, (_,i) => `<option value="${i}" ${archiveSettings.dailyMinute===i?'selected':''}>${pad(i)}分</option>`).join('');

        container.innerHTML = `
            <div style="font-size:13px;line-height:1.6;">
                <div style="margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <input type="checkbox" id="set_daily_en_inline" ${archiveSettings.dailyEnabled ? 'checked' : ''} style="width:16px;height:16px;">
                        <label for="set_daily_en_inline" style="font-weight:bold;color:var(--dark-btn-color-active);">每日自动归档</label>
                    </div>
                    <div style="display:flex;gap:8px;padding-left:24px;opacity:.85;">
                        <select id="set_daily_h_inline" style="padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${hours}</select>
                        <select id="set_daily_m_inline" style="padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${minutes}</select>
                    </div>
                </div>
                <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <input type="checkbox" id="set_monthly_en_inline" ${archiveSettings.monthlyEnabled ? 'checked' : ''} style="width:16px;height:16px;">
                        <label for="set_monthly_en_inline" style="font-weight:bold;color:#a78bfa;">每月自动归档</label>
                    </div>
                    <div style="display:flex;gap:8px;padding-left:24px;opacity:.85;">
                        <select id="set_monthly_d_inline" style="padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${days}</select>
                        <select id="set_monthly_h_inline" style="padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${hours2}</select>
                    </div>
                </div>
                <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <input type="checkbox" id="set_reset_after_inline" ${archiveSettings.resetAfterArchive!==false?'checked':''} style="width:16px;height:16px;">
                        <label for="set_reset_after_inline" style="font-weight:bold;color:#fb923c;">归档后重计流量</label>
                    </div>
                    <div style="padding-left:24px;opacity:.5;font-size:11px;margin-top:3px;">自动归档后清零计数器重新开始统计</div>
                </div>
                <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                    <div style="font-weight:bold;color:#38bdf8;margin-bottom:6px;">本机标识</div>
                    <input type="text" id="set_client_name_inline" value="${escHtml(clientName)}" maxlength="16" style="width:100%;box-sizing:border-box;padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">
                    <div style="opacity:.5;font-size:11px;margin-top:3px;">多端同时打开插件时仅心跳主端执行自动归档(不再重复日报)；归档记录会带上该标识，历史里可按上传者筛选</div>
                </div>
                <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <input type="checkbox" id="set_ipv6_inline" ${enableIPv6 ? 'checked' : ''} ${!hasIp6tables ? 'disabled' : ''} style="width:16px;height:16px;${!hasIp6tables ? 'opacity:.3' : ''}">
                        <label for="set_ipv6_inline" style="font-weight:bold;color:#a78bfa;${!hasIp6tables ? 'opacity:.5' : ''}">监测 IPv6 流量</label>
                    </div>
                    <div style="padding-left:24px;opacity:.5;font-size:11px;margin-top:3px;">
                        ${hasIp6tables ? '启用后统计 IPv4 + IPv6 双栈流量（每台设备跟踪全部 IPv6 地址）' : '系统无 ip6tables，无法监测 IPv6'}
                    </div>
                </div>
                <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <label for="set_refresh_sec_inline" style="font-weight:bold;color:#4ade80;">监控刷新间隔(秒)</label>
                        <input id="set_refresh_sec_inline" type="number" min="0.5" max="5" step="0.5" value="${archiveSettings.refreshSeconds ?? DEFAULT_REFRESH_SEC}" style="width:70px;padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">
                    </div>
                    <div style="opacity:.5;font-size:11px;margin-top:3px;">自动监控的刷新频率(0.5~5秒,默认5秒,0.5步进)；间隔越小实时性越好但设备负载越高；引擎每时每刻都在统计,此设置控制页面显示的刷新速度；引擎模式下数据本身每5秒更新一次,间隔设小可让显示更跟手；保存后立即生效</div>
                </div>
                <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <label for="set_log_days_inline" style="font-weight:bold;color:#38bdf8;">日志保留天数</label>
                        <input id="set_log_days_inline" type="number" min="0" max="90" step="1" value="${archiveSettings.logRetentionDays ?? 7}" style="width:70px;padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">
                    </div>
                    <div style="opacity:.5;font-size:11px;margin-top:3px;">超过天数的日志自动删除；0 = 不按时长清理（始终另保留最近200条）</div>
                </div>
                <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="checkbox" id="set_deldata_inline" style="width:16px;height:16px;">
                        <label for="set_deldata_inline" style="font-weight:bold;color:#ff6b6b;">删除数据文件</label>
                    </div>
                    <div style="padding-left:24px;opacity:.5;font-size:11px;margin-top:3px;">勾选后点击保存将删除所有流量数据和自定义名称</div>
                </div>
                <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;font-size:11px;opacity:.5;">
                    每日归档: ${archiveSettings.dailyEnabled ? '&#x2713;' : '&#x2717;'} ${pad(archiveSettings.dailyHour)}:${pad(archiveSettings.dailyMinute)}<br>
                    每月归档: ${archiveSettings.monthlyEnabled ? '&#x2713;' : '&#x2717;'} ${archiveSettings.monthlyDay}日 ${pad(archiveSettings.monthlyHour)}:00<br>
                    归档后重计: ${archiveSettings.resetAfterArchive!==false ? '&#x2713;' : '&#x2717;'}<br>
                    刷新间隔: ${archiveSettings.refreshSeconds ?? DEFAULT_REFRESH_SEC}秒<br>
                    IPv6监测: ${hasIp6tables ? (enableIPv6 ? '&#x2713; 已启用' : '&#x2717; 已关闭') : '&#x2717; 系统不支持'}
                </div>
                <button id="kano_settings_save_inline" style="width:100%;margin-top:14px;padding:8px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:6px;color:#4ade80;cursor:pointer;font-size:13px;font-weight:700;">保存设置</button>
            </div>`;

        container.querySelector('#kano_settings_save_inline')?.addEventListener('click', async () => {
            const dailyEn = container.querySelector('#set_daily_en_inline')?.checked ?? true;
            const dailyH = parseInt(container.querySelector('#set_daily_h_inline')?.value || '0');
            const dailyM = parseInt(container.querySelector('#set_daily_m_inline')?.value || '0');
            const monthlyEn = container.querySelector('#set_monthly_en_inline')?.checked ?? true;
            const monthlyD = parseInt(container.querySelector('#set_monthly_d_inline')?.value || '1');
            const monthlyH = parseInt(container.querySelector('#set_monthly_h_inline')?.value || '0');
            const resetAfter = container.querySelector('#set_reset_after_inline')?.checked ?? true;
            const logDaysRaw = parseInt(container.querySelector('#set_log_days_inline')?.value);
            const logRetentionDays = isNaN(logDaysRaw) ? 7 : Math.min(90, Math.max(0, logDaysRaw));
            const refreshSecRaw = parseFloat(container.querySelector('#set_refresh_sec_inline')?.value);
            const refreshSeconds = isNaN(refreshSecRaw) ? DEFAULT_REFRESH_SEC : Math.min(5, Math.max(0.5, refreshSecRaw));
            const cnRaw = (container.querySelector('#set_client_name_inline')?.value || '').trim();
            if (cnRaw && cnRaw !== clientName) {
                clientName = cnRaw.slice(0, 16);
                localStorage.setItem('kano_traffic_client_name', clientName);
                _log('ACTION', `本机标识已修改为 ${clientName}`);
            }
            archiveSettings = { dailyEnabled: dailyEn, dailyHour: dailyH, dailyMinute: dailyM, monthlyEnabled: monthlyEn, monthlyDay: monthlyD, monthlyHour: monthlyH, resetAfterArchive: resetAfter, logRetentionDays, refreshSeconds };
            saveSettings();
            writeBgSched();
            if (monitorTimer) {
                monitorTimer();
                monitorTimer = requestInterval(() => { monitorTick(); }, getRefreshInterval());
                _log('ACTION', `刷新间隔已调整为 ${refreshSeconds}s(监控运行中,已即时生效)`);
            }
            const prevEnableIPv6 = enableIPv6;
            enableIPv6 = hasIp6tables ? (container.querySelector('#set_ipv6_inline')?.checked ?? false) : false;
            saveIPv6Settings();
            _refreshing = true;
            try {
                if (enableIPv6 && !prevEnableIPv6) {
                    const engOn6 = engineActive();
                    if (!engOn6) await initChain6();
                    await fetchDevs();
                    if (!engOn6) await syncRules();
                    await applyLimits();
                    await updateStats();
                    renderList();
                    createToast('IPv6监测已开启，已重新初始化规则', 'green');
                } else if (!enableIPv6 && prevEnableIPv6 && hasIp6tables) {
                    await updateStats();
                    await _cleanMounts6();
                    await flushChain6();
                    for (const k of Object.keys(ruleOwners)) if (_isV6Addr(k)) delete ruleOwners[k];
                    for (const d of deviceList) d.ip6s = [];
                    await applyLimits();
                    const c4 = await getCounters(false);
                    for (const d of deviceList) {
                        const h = trafficHistory[d.mac];
                        if (!h) continue;
                        const up = (c4 && d.ip && c4[d.ip]) ? c4[d.ip].up : 0;
                        const down = (c4 && d.ip && c4[d.ip]) ? c4[d.ip].down : 0;
                        h.lastUp = up; h.lastDown = down; h.curUp = up; h.curDown = down;
                    }
                    renderList();
                    createToast('IPv6监测已关闭，v6链与规则已清理', 'green');
                }
                if (container.querySelector('#set_deldata_inline')?.checked) await deleteDataFiles();
            } finally { _refreshing = false; }
            createToast('设置已保存', 'green');
            renderSettingsInline(); // 刷新显示
        });
    };

    const renderEngineInline = async () => {
        const container = document.querySelector('#kano_engine_pane');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:20px;opacity:.5;">检测中...</div>';
        const st = await getEngineStatus();
        const eng = await readEngineJson(true);
        const cloud = await fetchManifest();
        const sum = eng && eng.summary ? eng.summary : {};
        const item = (k, v, color) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="opacity:.75;">${k}</span><span style="font-weight:600;text-align:right;${color ? 'color:' + color + ';' : ''}">${v}</span></div>`;
        let html = '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;margin-bottom:10px;">';
        const degraded = !!(eng && (eng.conntrack === 0 || eng.acct === 0 || sum.degraded === 1)); // v21.1.27: acct未生效/conntrack不可用 → 降级统计
        html += item('统计模式', eng ? '引擎 (conntrack+sysfs)' + (degraded ? ' · <span style="color:#f87171">降级统计</span>' : '') : 'iptables 计数链' + (st.installed ? '（引擎未运行，已回退）' : '（引擎未安装）'), eng ? (degraded ? '#fbbf24' : '#4ade80') : '#fbbf24');
        html += item('引擎安装', st.installed ? `已安装 v${st.ver || '?'} · ${(st.binSize / 1024).toFixed(1)}KB` : '未安装', st.installed ? '#4ade80' : '#f87171');
        html += item('运行状态', st.running ? '运行中' : '已停止', st.running ? '#4ade80' : '#f87171');
        html += item('数据新鲜度', st.jsonAge >= 0 && st.jsonAge < 30 ? st.jsonAge + 's 前 ✓' : (st.jsonAge >= 30 ? st.jsonAge + 's 前（过期）' : '无数据'), st.jsonAge >= 0 && st.jsonAge < 30 ? '#4ade80' : '#f87171');
        html += item('conntrack 记账', st.acct === '1' ? '已开启' : '未开启(' + st.acct + ')', st.acct === '1' ? '#4ade80' : '#f87171');
        html += item('开机自启', st.boot ? '已启用' : '未启用', st.boot ? '#4ade80' : '#fbbf24');
        if (eng) {
            const zs = sum.zeroStreak || 0;
            html += item('WAN 口', eng.wan || '--');
            html += item('在线设备', (sum.deviceCount != null ? sum.deviceCount : Object.keys(eng.devices || {}).length) + ' 台');
            html += item('引擎累计', 'WAN总 ' + formatBytes(sum.sysDeltaBytes || 0) + ' · 设备合计 ' + formatBytes(sum.deviceTotalBytes || 0));
            if (sum.ctLocalBytes != null) { // v21.1.27: 引擎≥v1.0.8 差额归因 —— WAN总 = 设备合计 + 本机 + 未归属(conntrack可见) + 口径外残余
                const unB = sum.unattrBytes || 0;
                const resid = Math.max(0, (sum.sysDeltaBytes || 0) - (sum.deviceTotalBytes || 0) - (sum.ctLocalBytes || 0) - unB);
                html += item('路由器自身消耗', formatBytes(sum.ctLocalBytes || 0));
                html += item('未归属(归属失败)', formatBytes(unB) + (unB > 0 ? ' · 总览"未归属"行可查TOP' : ''), unB > 0 ? '#fbbf24' : '');
                html += item('口径外残余(硬件加速等)', formatBytes(resid), resid > 50 * 1024 * 1024 ? '#fbbf24' : '');
            }
            html += item('零增量周期', zs > 12 ? zs + ' ⚠ 疑似硬件转发绕过 conntrack' : String(zs), zs > 12 ? '#f87171' : '');
        }
        html += item('云端最新版', cloud ? 'v' + cloud.rev + (cloud.rev === st.ver ? '（已是最新）' : '（可更新）') : '获取失败', cloud ? (cloud.rev === st.ver ? '#4ade80' : '#fbbf24') : '#f87171');
        if (st.installed) {
            const md5ok = cloud && cloud.md5 ? (st.md5 === String(cloud.md5).trim()) : null;
            html += item('二进制校验', md5ok === null ? (st.md5 ? st.md5.slice(0, 12) + '…（云端清单未知）' : '读取失败') : (md5ok ? '✓ 与云端一致' : '✗ 与云端不一致，请云端重装'), md5ok === false ? '#f87171' : (md5ok ? '#4ade80' : ''));
        }
        const jsNewer = !!(cloud && cloud.jsRev && _verNewer(cloud.jsRev, PLUGIN_VERSION));
        html += item('插件云端版', cloud ? (cloud.jsRev ? 'v' + cloud.jsRev + (jsNewer ? '（可更新）' : '（已是最新）') : '清单无插件版本号') : '获取失败', jsNewer ? '#fbbf24' : (cloud && cloud.jsRev ? '#4ade80' : '#f87171'));
        html += '</div>';
        const btnStyle = 'font-size:11px;padding:4px 12px;border-radius:4px;cursor:pointer;border:1px solid ';
        const btnSm = 'font-size:10px;padding:3px 9px;border-radius:4px;cursor:pointer;border:1px solid ';
        html += `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
            <button id="kano_eng_deploy_inline" style="${btnStyle}rgba(74,222,128,0.3);background:rgba(74,222,128,0.12);color:#4ade80;">${st.installed ? '⬇️ 云端更新/重装' : '⬇️ 云端安装'}</button>
            <button id="kano_eng_restart_inline" style="${btnStyle}rgba(251,191,36,0.25);background:rgba(251,191,36,0.1);color:#fbbf24;" ${st.installed ? '' : 'disabled'}>重启</button>
            ${st.running
                ? `<button id="kano_eng_stop_inline" style="${btnStyle}rgba(248,113,113,0.25);background:rgba(248,113,113,0.1);color:#f87171;">停止</button>`
                : `<button id="kano_eng_start_inline" style="${btnStyle}rgba(56,189,248,0.25);background:rgba(56,189,248,0.1);color:#38bdf8;" ${st.installed ? '' : 'disabled'}>启动</button>`}
            <button id="kano_js_update_inline" style="${btnStyle}rgba(251,146,60,0.25);background:rgba(251,146,60,0.1);color:#fb923c;" ${cloud && cloud.js ? '' : 'disabled'}>🔄 更新插件${jsNewer ? ' v' + cloud.jsRev : ''}</button>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;margin-top:6px;opacity:.8;">
            <button id="kano_eng_refresh_inline" style="${btnSm}rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:inherit;">刷新</button>
            <button id="kano_eng_selftest_inline" style="${btnSm}rgba(52,211,153,0.25);background:rgba(52,211,153,0.1);color:#34d399;" ${st.installed ? '' : 'disabled'}>🔍 自检</button>
            <button id="kano_eng_fixture_inline" style="${btnSm}rgba(56,189,248,0.25);background:rgba(56,189,248,0.1);color:#38bdf8;" ${st.installed ? '' : 'disabled'}>🧪 假数据自检</button>
            <button id="kano_eng_nettest_inline" style="${btnSm}rgba(167,139,250,0.25);background:rgba(167,139,250,0.1);color:#a78bfa;">☁️ 连通性</button>
            <button id="kano_eng_uninstall_inline" style="${btnSm}rgba(248,113,113,0.25);background:rgba(248,113,113,0.08);color:#f87171;" ${st.installed ? '' : 'disabled'}>🗑 卸载引擎</button>
        </div>`;
        html += `<div style="font-size:10px;opacity:.45;margin-top:8px;line-height:1.6;">引擎直读内核 conntrack 记账(bytes=)+WAN口 sysfs，页面关闭期间持续统计；引擎不可用时自动回退 iptables 计数链，数据不间断。<br>部署来源: jsDelivr CDN · 468133/kano-engine-assets${cloud && cloud.notes ? '<br>更新说明: ' + escHtml(cloud.notes) : ''}</div>`;
        container.innerHTML = html;

        container.querySelector('#kano_eng_deploy_inline')?.addEventListener('click', async (ev) => {
            ev.target.disabled = true; ev.target.textContent = '部署中...';
            await installOrUpdateEngine();
            await renderEngineInline();
        });
        container.querySelector('#kano_eng_restart_inline')?.addEventListener('click', async (ev) => {
            ev.target.disabled = true;
            await stopEngine(false);
            await startEngine();
            _engineJsonCache = { t: 0, data: null };
            createToast('引擎已重启', 'green');
            await renderEngineInline();
        });
        container.querySelector('#kano_eng_stop_inline')?.addEventListener('click', async (ev) => {
            ev.target.disabled = true;
            await stopEngine(true);
            createToast('引擎已停止，统计已回退 iptables 计数链', 'pink', 4000);
            await renderEngineInline();
        });
        container.querySelector('#kano_eng_start_inline')?.addEventListener('click', async (ev) => {
            ev.target.disabled = true;
            const ok = await startEngine();
            createToast(ok ? '引擎已启动' : '引擎启动失败，详见日志', ok ? 'green' : 'red', 4000);
            await renderEngineInline();
        });
        container.querySelector('#kano_eng_refresh_inline')?.addEventListener('click', renderEngineInline);
        container.querySelector('#kano_eng_nettest_inline')?.addEventListener('click', async (ev) => {
            ev.target.disabled = true; ev.target.textContent = '测试中...';
            const cands = assetCandidates(ENGINE_MANIFEST_URL);
            const lines = [];
            for (const u of cands) {
                let res;
                try {
                    const r = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
                    res = r.ok ? `HTTP ${r.status} ✓` : `HTTP ${r.status}`;
                } catch (e) { res = '失败: ' + (e && e.message || e); }
                lines.push({ u, side: '浏览器', res });
            }
            try {
                const CURL = '/data/data/com.minikano.f50_sms/files/curl';
                const urls = cands.map(u => `'${u}'`).join(' ');
                const cmd = `C=curl; [ -x ${CURL} ] && C=${CURL}; [ -x "$C" ] || which $C >/dev/null 2>&1 || echo NOCURL; ` +
                    `for u in ${urls}; do code=$($C -fsSL -o /dev/null -w '%{http_code}' --connect-timeout 6 --max-time 15 "$u" 2>/dev/null); echo "T $u \${code:-000}"; done`;
                const r = await runShellWithRoot(cmd, 120000);
                const out = _sh(r);
                const outLines = out.split('\n');
                let hitCount = 0;
                for (const u of cands) {
                    const hit = outLines.find(l => l.startsWith('T ' + u + ' '));
                    const code = hit ? hit.trim().split(/\s+/).pop() : null;
                    if (hit) hitCount++;
                    lines.push({ u, side: '设备', res: code ? (code === '200' ? 'HTTP 200 ✓' : 'HTTP ' + code) : '无结果' });
                }
                if (out.includes('NOCURL')) lines.push({ u: '', side: '设备', res: '⚠ 设备无 curl 命令' });
                if (hitCount === 0) lines.push({ u: '', side: '设备', res: '原始输出: ' + (out.trim().slice(0, 200) || '(空)') });
            } catch (e) { lines.push({ u: '', side: '设备', res: '测试异常: ' + (e && e.message || e) }); }
            const okLines = lines.filter(l => l.res.includes('✓'));
            _log('ENGINE', `云端连通性: 通=${okLines.length}/${lines.length}${okLines.length ? ' [' + okLines.map(l => l.side + '@' + (l.u.split('/')[2] || '')).join(',') + ']' : ' 全部不通'}`);
            const netHtml = '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;margin-top:10px;font-size:11px;line-height:1.7;">' +
                '<div style="font-weight:600;margin-bottom:4px;">☁️ 云端连通性测试结果</div>' +
                lines.map(l => `<div style="display:flex;justify-content:space-between;gap:8px;"><span style="opacity:.7;">${l.side}${l.u ? ' · ' + escHtml(l.u.split('/')[2] || l.u) : ''}</span><span style="${l.res.includes('✓') ? 'color:#4ade80;' : 'color:#f87171;'}">${escHtml(l.res)}</span></div>`).join('') +
                '</div>';
            container.insertAdjacentHTML('beforeend', netHtml);
            ev.target.disabled = false; ev.target.textContent = '☁️ 连通性';
        });
        container.querySelector('#kano_eng_selftest_inline')?.addEventListener('click', async (ev) => {
            ev.target.disabled = true; ev.target.textContent = '自检中...';
            const SELFTEST_OUT = '/data/data/com.minikano.f50_sms/kano_selftest.out';
            let out = '';
            _refreshing = true;
            try {
                const cmdA = `echo "== 引擎自检 $(date '+%Y/%m/%d %H:%M:%S') =="; ` +
                    `if [ -x ${ENGINE_BIN} ]; then echo "二进制: $(stat -c %s ${ENGINE_BIN} 2>/dev/null)字节 md5=$(md5sum ${ENGINE_BIN} 2>/dev/null | awk '{print $1}')"; else echo "二进制: 缺失"; fi; ` +
                    `echo "acct=$(awk '{print}' /proc/sys/net/netfilter/nf_conntrack_acct 2>/dev/null) conntrack行数=$(wc -l < /proc/net/nf_conntrack 2>/dev/null)"; ` +
                    `if [ -f ${ENGINE_PID} ]; then kill $(cat ${ENGINE_PID} 2>/dev/null) 2>/dev/null; sleep 1; fi; rm -f ${ENGINE_PID}; ` +
                    `rm -f ${SELFTEST_OUT}; nohup sh -c 'timeout 12s ${ENGINE_BIN} --once >${SELFTEST_OUT} 2>&1; echo "退出码=$?" >>${SELFTEST_OUT}' >/dev/null 2>&1 & echo SELFTEST_LAUNCHED`;
                const r1 = await runShellWithRoot(cmdA);
                _logCmd('引擎自检(1/2 环境+启动试跑)', cmdA, r1);
                await new Promise(res => setTimeout(res, 14000));
                const cmdB = `echo "-- 前台试跑 kano_engine --once (12s超时) --"; cat ${SELFTEST_OUT} 2>/dev/null || echo '(无输出)'; rm -f ${SELFTEST_OUT}; ` +
                    `echo "-- 引擎阶段日志尾部 --"; tail -n 25 ${ENGINE_LOG} 2>/dev/null || echo '(无日志)'; ` +
                    `echo "-- JSON 落盘检查 --"; if [ -f ${ENGINE_JSON} ]; then ls -la ${ENGINE_JSON}; head -c 400 ${ENGINE_JSON} 2>/dev/null; echo; else echo "JSON: 未生成"; fi`;
                const r2 = await runShellWithRoot(cmdB);
                _logCmd('引擎自检(2/2 结果)', cmdB, r2);
                out = (_sh(r1).trim() + '\n' + _sh(r2).trim()).trim() || '(无输出)';
            } catch (e) {
                out = '自检异常: ' + (e && e.message || e);
                _log('ERR', `引擎自检异常: ${e && e.message || e}`);
            }
            _refreshing = false;
            await startEngine();
            const selfHtml = '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;margin-top:10px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                '<div style="font-weight:600;font-size:11px;">🔍 引擎自检结果(已写入运行日志)</div>' +
                '<button class="kano-selftest-copy" style="font-size:10px;padding:2px 8px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:4px;color:#4ade80;cursor:pointer;">📋 复制</button></div>' +
                `<pre style="font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:40vh;overflow:auto;margin:0;opacity:.9;">${escHtml(out)}</pre></div>`;
            container.insertAdjacentHTML('beforeend', selfHtml);
            const cpBtns = container.querySelectorAll('.kano-selftest-copy'); // v21.1.20: 自检结果复制
            const cpBtn = cpBtns[cpBtns.length - 1];
            cpBtn?.addEventListener('click', async () => {
                const ok = await copyTextSafe(out, null);
                cpBtn.textContent = ok ? '✅ 已复制' : '❌ 复制失败';
                setTimeout(() => { cpBtn.textContent = '📋 复制'; }, 1500);
            });
            ev.target.disabled = false; ev.target.textContent = '🔍 引擎自检';
        });
        // v21.1.20: 假数据自检 —— 下载自包含脚本到设备执行, 验证归属/v6前导零/组播与本机代理排除, 全程不碰真实统计
        // v21.1.21: 拆两段执行(下载+后台启动立即返回, 15s后读结果文件), 避开宿主 shell 超时(signal aborted)
        const FIXTURE_DIR = '/data/local/tmp/kano_fixtures', FIXTURE_OUT = FIXTURE_DIR + '/result.txt';
        container.querySelector('#kano_eng_fixture_inline')?.addEventListener('click', async (ev) => {
            ev.target.disabled = true; ev.target.textContent = '自检中(约30s)...';
            let out = '';
            try {
                // v21.1.22: 已在跑则直接等结果(防重复点击整轮重跑); 下载到 .new 成功后覆盖, 失败可复用缓存脚本
                // v21.1.24: 脚本文件名按云端清单版本化(如 run_fixtures_v1.0.7.sh), 避开CDN@main缓存旧脚本
                const fxFile = ((cloud && cloud.fixtures) || '').split('/').pop() || 'run_fixtures.sh';
                const fxUrls = [
                    'https://ghproxy.net/https://raw.githubusercontent.com/468133/kano-engine-assets/main/fixtures/',
                    'https://ghfast.top/https://raw.githubusercontent.com/468133/kano-engine-assets/main/fixtures/',
                    'https://cdn.jsdmirror.com/gh/468133/kano-engine-assets@main/fixtures/',
                    'https://jsd.onmicrosoft.cn/gh/468133/kano-engine-assets@main/fixtures/',
                    'https://cdn.jsdelivr.net/gh/468133/kano-engine-assets@main/fixtures/'
                ].map(b => `'${b}${fxFile}'`).join(' ');
                const cmdA = `D=${FIXTURE_DIR}; mkdir -p $D; if ps 2>/dev/null | grep '[k]ano_fixtures/run' >/dev/null 2>&1; then echo FIXTURE_RUNNING; else C=curl; [ -x /data/data/com.minikano.f50_sms/files/curl ] && C=/data/data/com.minikano.f50_sms/files/curl; for u in ${fxUrls}; do $C -fsSL --connect-timeout 8 --max-time 25 "$u" -o $D/run.sh.new && [ -s $D/run.sh.new ] && { mv -f $D/run.sh.new $D/run.sh; break; }; done; rm -f $D/run.sh.new; if [ -s $D/run.sh ]; then rm -f ${FIXTURE_OUT}; nohup sh -c 'sh ${FIXTURE_DIR}/run.sh >${FIXTURE_OUT} 2>&1; echo "退出码=$?" >>${FIXTURE_OUT}' >/dev/null 2>&1 & echo FIXTURE_LAUNCHED; else echo 'FIXTURE_DL_FAIL 假数据脚本下载失败(所有源均不可达)'; fi; fi`;
                const r1 = await _shUser(cmdA);
                _logCmd('假数据自检(1/2 下载+启动)', cmdA, r1);
                const busy = _sh(r1).includes('FIXTURE_LAUNCHED') || _sh(r1).includes('FIXTURE_RUNNING');
                if (busy) {
                    ev.target.textContent = '执行中(25s后读结果)...';
                    await new Promise(rs => setTimeout(rs, 25000)); // v21.1.23: 4组用例全程约18s, 15s读不到尾部
                }
                const cmdB = `cat ${FIXTURE_OUT} 2>/dev/null || echo '(结果文件未生成, 脚本可能仍在执行, 请15s后再点一次本按钮)'`;
                const r2 = await _shUser(cmdB);
                _logCmd('假数据自检(2/2 结果)', cmdB, r2);
                out = (_sh(r1).trim() + '\n' + _sh(r2).trim()).trim() || '(无输出)';
                if (busy && !/结果: PASS=/.test(out)) out += '\n\n(结果尚未完整, 脚本可能仍在执行, 请15s后再点一次本按钮续读)'; // v21.1.22
                _log('ENGINE', '假数据自检完成');
            } catch (e) { out = '假数据自检异常: ' + (e && e.message || e); }
            const fixHtml = '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;margin-top:10px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                '<div style="font-weight:600;font-size:11px;">🧪 假数据自检结果(不写入任何统计)</div>' +
                '<button class="kano-fixture-copy" style="font-size:10px;padding:2px 8px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:4px;color:#4ade80;cursor:pointer;">📋 复制</button></div>' +
                `<pre style="font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:40vh;overflow:auto;margin:0;opacity:.9;">${escHtml(out)}</pre></div>`;
            container.insertAdjacentHTML('beforeend', fixHtml);
            const fcps = container.querySelectorAll('.kano-fixture-copy');
            const fcp = fcps[fcps.length - 1];
            fcp?.addEventListener('click', async () => {
                const ok = await copyTextSafe(out, null);
                fcp.textContent = ok ? '✅ 已复制' : '❌ 失败';
                setTimeout(() => { fcp.textContent = '📋 复制'; }, 1500);
            });
            ev.target.disabled = false; ev.target.textContent = '🧪 假数据自检';
        });
        container.querySelector('#kano_js_update_inline')?.addEventListener('click', async (ev) => {
            ev.target.disabled = true; ev.target.textContent = '更新中...';
            const ok = await updatePluginSelf(cloud);
            if (!ok) { ev.target.disabled = false; ev.target.textContent = '🔄 更新插件'; }
        });
        const unBtn = container.querySelector('#kano_eng_uninstall_inline');
        let engUnArm = false, engUnTimer = null;
        unBtn?.addEventListener('click', async () => {
            if (!engUnArm) {
                engUnArm = true;
                unBtn.textContent = '再点一次确认卸载';
                engUnTimer = setTimeout(() => { engUnArm = false; unBtn.textContent = '🗑 卸载引擎'; }, 3000);
                return;
            }
            clearTimeout(engUnTimer);
            unBtn.disabled = true; unBtn.textContent = '卸载中...';
            await uninstallEngine();
            await renderEngineInline();
        });
    };

    const renderLogInline = async () => {
        const container = document.querySelector('#kano_log_pane');
        if (!container) return;
        const logText = await readLogFile();
        container.innerHTML = `
            <div style="font-size:12px;margin-bottom:8px;opacity:.6;">最近 ${MAX_LOG_LINES} 条日志记录</div>
            <textarea id="kano_log_ta_inline" readonly style="width:100%;height:45vh;font-size:11px;line-height:1.5;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;color:inherit;resize:none;font-family:monospace;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;">${escHtml(logText)}</textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;">
                <button id="kano_log_clear_inline" style="font-size:11px;padding:4px 12px;background:rgba(255,107,107,0.12);border:1px solid rgba(255,107,107,0.25);border-radius:4px;color:#ff6b6b;cursor:pointer;">清除日志</button>
                <button id="kano_log_refresh_inline" style="font-size:11px;padding:4px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:inherit;cursor:pointer;">刷新</button>
                <button id="kano_log_copy_inline" style="font-size:11px;padding:4px 12px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:4px;color:#4ade80;cursor:pointer;">复制全部</button>
            </div>`;
        const ta = container.querySelector('#kano_log_ta_inline');
        if (ta) ta.scrollTop = ta.scrollHeight;
        container.querySelector('#kano_log_refresh_inline')?.addEventListener('click', async () => {
            const refreshed = await readLogFile();
            if (ta) { ta.value = refreshed; ta.scrollTop = ta.scrollHeight; }
        });
        let logClearArmed = false, logClearTimer = null;
        const clearBtn = container.querySelector('#kano_log_clear_inline');
        clearBtn?.addEventListener('click', async () => {
            if (!logClearArmed) {
                logClearArmed = true;
                clearBtn.textContent = '确认清除？';
                if (logClearTimer) clearTimeout(logClearTimer);
                logClearTimer = setTimeout(() => { logClearArmed = false; clearBtn.textContent = '清除日志'; }, 3000);
                return;
            }
            logClearArmed = false;
            if (logClearTimer) clearTimeout(logClearTimer);
            clearBtn.textContent = '清除日志';
            try { await _shUser(`: > ${DEBUG_LOG_FILE}`); } catch(e) {}
            _lastLogKey = '';
            await _log('ACTION', '日志已手动清除');
            if (ta) ta.value = await readLogFile();
            createToast('日志已清除', 'green');
        });
        container.querySelector('#kano_log_copy_inline')?.addEventListener('click', async () => {
            if (!ta) return;
            const ok = await copyTextSafe(ta.value, ta);
            createToast(ok ? '日志已复制' : '复制失败，请长按文本全选后手动复制', ok ? 'green' : 'pink', 4000);
        });
    };

    const _diagItem = (name, status, detail) => {
        const color = String(status).includes('✓') ? '#4ade80' : String(status).includes('⚠') ? '#fbbf24' : '#f87171';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.03);">
            <span style="opacity:.8;">${name}</span>
            <span style="color:${color};font-weight:bold;">${status}</span>
        </div>${detail ? `<div style="font-size:10px;opacity:.5;padding-left:12px;margin-bottom:4px;">${detail}</div>` : ''}`;
    };

    const _diagSection = (title, items) => {
        return `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;margin-bottom:10px;">
            <div style="font-weight:bold;font-size:12px;margin-bottom:6px;color:var(--dark-btn-color-active);">${title}</div>
            ${items.join('')}
        </div>`;
    };

    const renderDiagInline = async () => {
        const container = document.querySelector('#kano_diag_pane');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:20px;opacity:.5;">收集中，请稍候...</div>';
        
        let chainExists = false, chainRefs = 0, ruleCount = 0;
        let iptStatus = '❌', iptDetail = 'iptables 链未创建';
        let iptRaw = '';
        if (!hasIptables) {
            iptStatus = '❌';
            iptDetail = '未检测到可用的 iptables 二进制（已尝试 iptables/iptables-legacy/iptables-nft）';
        } else {
            try {
                const r = await runShellWithRoot(`${IPT} -t mangle -nvxL ${CHAIN_NAME} 2>/dev/null; echo "---EXIT---$?"`);
                iptRaw = _sh(r);
                if (iptRaw && iptRaw.includes(CHAIN_NAME)) {
                    chainExists = true;
                    const m = iptRaw.match(/\((\d+)\s*references?\)/);
                    chainRefs = m ? parseInt(m[1]) : 0;
                    ruleCount = (iptRaw.match(/RETURN/g) || []).length;
                    iptStatus = chainRefs >= 1 ? '✓' : '⚠';
                    iptDetail = `${IPT} · ${CHAIN_NAME}链 · ${chainRefs}条引用 · ${ruleCount}条RETURN规则`;
                } else if (iptRaw && iptRaw.includes('Chain')) {
                    chainExists = true;
                    iptStatus = '⚠';
                    iptDetail = `${IPT} · ${CHAIN_NAME}链存在但无规则`;
                }
            } catch(e) { iptDetail = '检测异常: ' + (e?.message || e); }
        }

        let auditHtml = '';
        try {
            const r = await _shUser(`timeout 2s awk '{print}' ${STORAGE_FILE} 2>/dev/null || echo '{}'`); 
            const raw = _sh(r).trim() || '{}';
            let data = {};
            try { data = JSON.parse(raw); } catch(e) {}
            let found = false;
            let auditItems = '';
            const _g = (b) => ((b || 0) / 1e9).toFixed(2) + 'GB';
            for (const [mac, h] of Object.entries(data)) {
                const total = (h.totalUp || 0) + (h.totalDown || 0) + (h.curUp || 0) + (h.curDown || 0);
                if (total <= 1 * 1024 * 1024 * 1024) continue;
                found = true;
                const cur = (h.curUp || 0) + (h.curDown || 0);
                const hist = (h.totalUp || 0) + (h.totalDown || 0);
                const ratio = cur > 0 ? hist / cur : (hist > 0 ? 999 : 0);
                const v6n = (h.ip6s || (h.ip6 ? [h.ip6] : [])).length;
                const ledgerN = Object.keys(h.addrUp || {}).length;
                const devName = customNames[mac] || h.hostname || mac;
                let verdict;
                if (ratio >= 3 && hist > 5 * 1024 * 1024 * 1024 && v6n >= 2) {
                    verdict = `⚠️ 符合多IPv6轮换重复累加特征（v20.0.2之前旧版产生的脏数据），历史累计被反复滚入 → 建议「清除全部流量」`;
                } else if (ratio >= 3 && hist > 5 * 1024 * 1024 * 1024) {
                    verdict = '⚠️ 历史累计远大于当前计数：经历过大量计数重置/地址更替，或为长期跨周期正常累计，结合设备实际用量判断';
                } else {
                    verdict = '✅ 未见异常累加特征';
                }
                auditItems += `<div style="background:rgba(255,255,255,0.03);border-radius:6px;padding:8px;margin-bottom:6px;">
                    <div style="font-weight:600;font-size:12px;">${escHtml(devName)}</div>
                    <div style="font-family:monospace;font-size:10px;opacity:.6;">${mac}</div>
                    <div style="font-size:11px;margin-top:3px;">上行: 历史${_g(h.totalUp)} + 当前${_g(h.curUp)}<br>下行: 历史${_g(h.totalDown)} + 当前${_g(h.curDown)}</div>
                    <div style="font-size:10px;opacity:.6;margin-top:2px;">IPv6地址 ${v6n}个 · 计数台账 ${ledgerN}条 · 历史/当前比 ${ratio === 999 ? '∞' : ratio.toFixed(1) + 'x'}</div>
                    <div style="color:${verdict.includes('🔴') ? '#ff6b6b' : verdict.includes('🟡') ? '#fbbf24' : '#4ade80'};font-size:11px;margin-top:4px;line-height:1.5;">${verdict}</div>
                </div>`;
            }
            if (found) {
                auditHtml = `<div style="background:rgba(251,146,60,0.06);border:1px solid rgba(251,146,60,0.15);border-radius:8px;padding:10px;margin-bottom:10px;">
                    <div style="font-weight:bold;font-size:12px;margin-bottom:6px;color:#fb923c;">📊 异常流量审计 (>1GB设备)</div>
                    ${auditItems}
                </div>`;
            } else {
                auditHtml = `<div style="background:rgba(74,222,128,0.06);border:1px solid rgba(74,222,128,0.15);border-radius:8px;padding:10px;margin-bottom:10px;">
                    <div style="font-weight:bold;font-size:12px;color:#4ade80;">📊 异常流量审计</div>
                    <div style="font-size:11px;opacity:.6;margin-top:4px;">未发现 >1GB 的设备，流量分布正常</div>
                </div>`;
            }
        } catch(e) { auditHtml = ''; }

        try {
            const rT = await runShellWithRoot(`ip -4 route show 0.0.0.0/1 2>/dev/null; ls /sys/class/net/ 2>/dev/null | grep -i tun; true`);
            const tunOn = /0\.0\.0\.0\/1|tun/i.test(_sh(rT));
            if (tunOn) {
                const engOk = engineActive();
                auditHtml += `<div style="background:rgba(96,165,250,0.06);border:1px solid rgba(96,165,250,0.15);border-radius:8px;padding:10px;margin-bottom:10px;">
                    <div style="font-weight:bold;font-size:12px;color:#60a5fa;">◐ TUN 代理检测</div>
                    <div style="font-size:11px;opacity:.75;margin-top:4px;line-height:1.5;">检测到 TUN 代理(0.0.0.0/1 分流或 tun 网卡)${engOk ? '；引擎直读 conntrack，统计不受影响 ✓' : '；<span style="color:#fbbf24;">当前 iptables 计数链可能统计不到代理流量，建议在「设置」标签页安装统计引擎</span>'}</div>
                </div>`;
            }
        } catch (e) {}

        let arpCount = 0, arpStatus = '❌', arpDetail = '无法读取ARP表';
        try {
            await refreshLocalAddrs();
            const arpDevs = await getArpDevs();
            arpCount = arpDevs.length;
            arpStatus = arpCount > 0 ? '✓' : '⚠';
            arpDetail = `发现 ${arpCount} 个有效设备`;
        } catch(e) { arpDetail = '检测异常: ' + (e?.message || e); }

        let wifiN = 0, wiredN = 0, unknownN = 0;
        for (const d of deviceList) {
            if (d.connType === '无线') wifiN++;
            else if (d.connType === '有线') wiredN++;
            else unknownN++;
        }
        let ifaces = [];
        try {
            const rIf = await runShellWithRoot(`ls /sys/class/net/ 2>/dev/null || echo ''`);
            ifaces = _sh(rIf).split(/\s+/).map(s => s.trim()).filter(s => s && s !== 'lo' && !/^(wwan|rmnet|ccmni|pdp|ccni)/.test(s));
        } catch (e) {}

        let namesExist = false, historyExist = false, snapsExist = false, limitsExist = false;
        let namesSize = 0, historySize = 0, snapsSize = 0, limitsSize = 0;
        let persistStatus = '❌', persistDetail = '文件系统不可写';
        try { const r = await _shUser(`ls ${NAMES_FILE} >/dev/null 2>&1 && echo yes || echo no`); namesExist = _sh(r).includes('yes'); } catch(e) {}
        try { const r = await _shUser(`ls ${STORAGE_FILE} >/dev/null 2>&1 && echo yes || echo no`); historyExist = _sh(r).includes('yes'); } catch(e) {}
        try { const r = await _shUser(`ls ${SNAPSHOTS_FILE} >/dev/null 2>&1 && echo yes || echo no`); snapsExist = _sh(r).includes('yes'); } catch(e) {}
        try { const r = await _shUser(`ls ${LIMITS_FILE} >/dev/null 2>&1 && echo yes || echo no`); limitsExist = _sh(r).includes('yes'); } catch(e) {}
        try { const r = await _shUser(`timeout 2s awk '{print}' ${NAMES_FILE} 2>/dev/null | wc -c || echo 0`); namesSize = parseInt(_sh(r).trim()) || 0; } catch(e) {}
        try { const r = await _shUser(`timeout 2s awk '{print}' ${STORAGE_FILE} 2>/dev/null | wc -c || echo 0`); historySize = parseInt(_sh(r).trim()) || 0; } catch(e) {}
        try { const r = await _shUser(`timeout 2s awk '{print}' ${SNAPSHOTS_FILE} 2>/dev/null | wc -c || echo 0`); snapsSize = parseInt(_sh(r).trim()) || 0; } catch(e) {}
        try { const r = await _shUser(`timeout 2s awk '{print}' ${LIMITS_FILE} 2>/dev/null | wc -c || echo 0`); limitsSize = parseInt(_sh(r).trim()) || 0; } catch(e) {}

        let writeTest = false;
        try {
            const testFile = '/data/data/com.minikano.f50_sms/.diag_test';
            await _shUser(`echo '{"test":1}' > ${testFile}`);
            const r2 = await _shUser(`timeout 2s awk '{print}' ${testFile}`);
            writeTest = r2.success && _sh(r2).includes('test');
            await _shUser(`rm -f ${testFile}`);
        } catch(e) {}

        if (writeTest) {
            persistStatus = '✓';
            persistDetail = `名称${namesExist?'✓':'✗'} 流量${historyExist?'✓':'✗'} 归档${snapsExist?'✓':'✗'} 限速${limitsExist?'✓':'✗'} · 可读写`;
        } else if (namesExist || historyExist || snapsExist) {
            persistStatus = '⚠';
            persistDetail = `名称${namesExist?'✓':'✗'} 流量${historyExist?'✓':'✗'} 归档${snapsExist?'✓':'✗'} 限速${limitsExist?'✓':'✗'} · 文件可读`;
        }

        const archiveStatus = autoArchiveTimer ? '✓' : '⚠';
        const archiveDetail = autoArchiveTimer
            ? `每日${archiveSettings.dailyEnabled?'✓':'✗'}${String(archiveSettings.dailyHour).padStart(2,'0')}:${String(archiveSettings.dailyMinute).padStart(2,'0')} · 每月${archiveSettings.monthlyEnabled?'✓':'✗'}${archiveSettings.monthlyDay}日`
            : '自动归档未启动';

        const fmtBytes = (b) => b > 1024*1024 ? (b/1024/1024).toFixed(1)+'MB' : b > 1024 ? (b/1024).toFixed(1)+'KB' : b+'B';
        let totalTraffic = 0;
        for (const d of deviceList) totalTraffic += getTraffic(d.mac).total;

        let engDiagStatus = '⚠ 未安装', engDiagDetail = '使用 iptables 计数链统计；在「设置」标签页可云端安装 conntrack 引擎';
        try {
            const engSt = await getEngineStatus();
            const engNow = await readEngineJson(true);
            if (engNow) {
                engDiagStatus = '✓ 引擎统计中';
                engDiagDetail = `v${engSt.ver || '?'} · WAN ${engNow.wan || '--'} · 设备 ${(engNow.summary && engNow.summary.deviceCount != null) ? engNow.summary.deviceCount : Object.keys(engNow.devices || {}).length} 台 · zeroStreak ${(engNow.summary && engNow.summary.zeroStreak) || 0}`;
            } else if (engSt.installed) {
                engDiagStatus = '⚠ 已安装未运行';
                engDiagDetail = `v${engSt.ver || '?'} · 已回退 iptables 计数链(数据不间断) · 在「设置」标签页启动`;
            }
        } catch (e) {}

        const btnItems = [
            _diagItem('刷新', '✓', '正常 · 完整流程(建链+发现+规则同步+强制落盘)'),
            _diagItem('自动监控', monitorTimer ? '✓ 运行中' : '⚠ 停止', monitorTimer ? `每${getRefreshInterval()/1000}秒刷新流量，约每30秒同步设备与规则` : '点击启动'),
            _diagItem('诊断', '✓', '当前正在使用'),
            _diagItem('日志', '✓', '运行日志记录与导出'),
            _diagItem('设置', '✓', '归档时间+删除数据'),
            _diagItem('归档并重计', '✓', `${snapshots.length}条历史归档`),
            _diagItem('查看历史', snapshots.length > 0 ? '✓' : '⚠', snapshots.length > 0 ? `${snapshots.length}条可查看` : '暂无归档记录'),
            _diagItem('流量排行', deviceList.length > 0 ? '✓' : '⚠', deviceList.length > 0 ? `${deviceList.length}个设备可排行` : '暂无设备'),
            _diagItem('清除全部流量', '✓', '保留名称 · 清空计数'),
            _diagItem('卸载插件', '✓', '彻底清理所有数据和规则'),
        ];

        const engRunning = String(engDiagStatus || '').startsWith('✓'); // 修复: 先用后定义(TDZ)导致诊断崩溃
        const sections = [
            _diagSection('📊 流量统计核心', [
                _diagItem('统计引擎', engDiagStatus, engDiagDetail),
                _diagItem('iptables 链', engRunning ? '⚠ 引擎模式（链可选）' : iptStatus, engRunning ? '引擎运行中，不依赖 iptables 计数链' : iptDetail),
                _diagItem('设备发现', arpStatus, arpDetail),
                _diagItem('当前总流量', '✓', `${fmtBytes(totalTraffic)} · ${deviceList.length}在线 · ${Object.keys(trafficHistory).length}历史`),
                _diagItem('IPv6 支持', hasIp6tables ? (enableIPv6 ? '✓ 已启用' : '⚠ 可用但未启用') : '❌ 不可用',
                    hasIp6tables ? `${IP6T} 可用${enableIPv6 ? '，正在统计(多地址跟踪)' : '，设置中可开启'}` : '系统未安装 ip6tables'),
                _diagItem('限速模块', limitMode === 'hashlimit' ? '✓ hashlimit' : limitMode === 'limit' ? '⚠ limit' : '❌ 不可用',
                    (limitMode === 'hashlimit' ? '精确限速(按字节)' : limitMode === 'limit' ? '近似限速(按包pps)' : 'hashlimit/limit 均不可用，限速功能已禁用') + ` · ${Object.values(deviceLimits).filter(l => l && ((parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0)).length}台设备限速中`),
            ]),
            _diagSection('🔌 连接方式与拓扑', [
                _diagItem('连接方式分布', deviceList.length > 0 ? '✓' : '⚠',
                    deviceList.length > 0 ? `无线 ${wifiN} 台 · 有线 ${wiredN} 台 · 未知 ${unknownN} 台（未知=接入设备列表未上报）` : '暂无在线设备'),
                _diagItem('网络接口', ifaces.length > 0 ? '✓' : '⚠', ifaces.length > 0 ? ifaces.join(' ') : '未能枚举 /sys/class/net'),
                _diagItem('有线统计说明', '✓', '统计不区分有线/无线，转发流量均计数；有线口下接路由器/电脑时只能看到该设备本身，其 NAT 后设备的流量并入它统计（拓扑决定，非统计遗漏）'),
            ]),
            _diagSection('💾 数据持久化', [
                _diagItem('文件读写', persistStatus, persistDetail),
                _diagItem('名称文件', namesExist ? '✓' : '⚠', `${fmtBytes(namesSize)}${namesExist ? '' : ' · 未创建'}`),
                _diagItem('流量文件', historyExist ? '✓' : '⚠', `${fmtBytes(historySize)}${historyExist ? '' : ' · 未创建'}`),
                _diagItem('归档文件', snapsExist ? '✓' : '⚠', `${fmtBytes(snapsSize)} · ${snapshots.length}条快照${snapsExist ? '' : ' · 未创建'}`),
                _diagItem('限速配置', limitsExist ? '✓' : '⚠', `${fmtBytes(limitsSize)}${limitsExist ? '' : ' · 未创建'}`),
            ]),
            _diagSection('📋 自动归档', [
                _diagItem('定时器', archiveStatus, archiveDetail),
            ]),
            _diagSection('🔘 功能按钮状态', btnItems),
        ];

        const persistOk = writeTest || namesExist || historyExist;
        const summary = (engRunning || chainExists) && persistOk
            ? '<span style="color:#4ade80;font-weight:bold;">✓ 系统正常运行' + (engRunning ? '（引擎统计模式）</span>' : '</span>')
            : (engRunning || chainExists)
                ? '<span style="color:#fbbf24;font-weight:bold;">⚠ 流量统计正常 · 文件存储待确认</span>'
                : '<span style="color:#f87171;font-weight:bold;">❌ 流量统计异常 · 请检查权限</span>';

        container.innerHTML = `
            <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:10px;margin-bottom:12px;text-align:center;font-size:13px;">
                ${summary}<br>
                <span style="font-size:10px;opacity:.5;">v${PLUGIN_VERSION} · ${new Date().toLocaleString()}</span>
            </div>
            ${auditHtml}
            ${sections.join('')}
            <div style="margin-top:12px;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:10px;text-align:center;">
                <span style="opacity:.5;">截图保存或发送给开发者 · 数据目录: ${NAMES_FILE.replace(/\/[^\/]+$/, '/')}</span><br>
                <div style="display:flex;gap:8px;justify-content:center;margin-top:6px;">
                    <button id="kano_diag_export_log_inline" style="font-size:11px;padding:4px 12px;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.25);border-radius:4px;color:#38bdf8;cursor:pointer;">📋 导出运行日志</button>
                    <button id="kano_diag_export_pack_inline" style="font-size:11px;padding:4px 12px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.3);border-radius:4px;color:#4ade80;cursor:pointer;">📦 一键导出诊断包</button>
                </div>
                <div style="margin-top:8px;">
                    <a href="https://t.me/GUMU51" target="_blank" style="color:#38bdf8;text-decoration:none;font-size:11px;font-weight:600;">✈️ TG问题反馈群: @GUMU51</a>
                </div>
            </div>`;
        
        container.querySelector('#kano_diag_export_log_inline')?.addEventListener('click', () => {
            switchSettingsTab('log');
        });
        container.querySelector('#kano_diag_export_pack_inline')?.addEventListener('click', () => {
            showExportModal();
        });
    };

    const deleteDataFiles = async () => {
        await _shUser(`rm -f ${STORAGE_FILE} ${NAMES_FILE} ${SNAPSHOTS_FILE} ${LIMITS_FILE} ${STORAGE_FILE}.bak ${NAMES_FILE}.bak ${SNAPSHOTS_FILE}.bak ${LIMITS_FILE}.bak`);
        trafficHistory = {};
        customNames = {};
        deviceLimits = {};
        snapshots = []; // 修复: 内存归档不清空, 下次saveSnapshots会复活
        historyDirty = false;
        await applyLimits();
        renderList();
        renderOverview();
        createToast('数据文件已删除', 'green');
    };

    const loadIPv6Settings = () => {
        try {
            const s = JSON.parse(localStorage.getItem(IPV6_SETTINGS_KEY) || '{}');
            if (s.enabled !== undefined) ipv6Settings = { ...ipv6Settings, ...s };
        } catch (e) {}
        enableIPv6 = ipv6Settings.enabled;
    };

    const saveIPv6Settings = () => {
        ipv6Settings.enabled = enableIPv6;
        localStorage.setItem(IPV6_SETTINGS_KEY, JSON.stringify(ipv6Settings));
    };

    const loadSettings = () => {
        loadIPv6Settings();
        try {
            const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
            if (s.dailyHour !== undefined) archiveSettings = { ...archiveSettings, ...s };
        } catch (e) {}
    };

    const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(archiveSettings));

    const beatHeartbeat = async () => {
        if (pluginUninstalled) return;
        try { await _shUser(`date +%s > ${HB_PREFIX}${CLIENT_ID} 2>/dev/null || true`); } catch (e) {}
    };

    const startHeartbeat = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        beatHeartbeat();
        heartbeatTimer = setInterval(beatHeartbeat, 20000);
    };

    const installBgDaemon = async () => {
        if (pluginUninstalled) return;
        try {
            if (!(await _hasRoot())) return;
            const script = '#!/bin/sh\n' +
                '# kano_bg v' + PLUGIN_VERSION + ': 设备流量监控后台守护(插件写入, 卸载时删除)\n' +
                'echo $$ > ' + BG_PID + '\n' +
                'while true; do\n' +
                '  sleep 60\n' +
                '  now=$(date +%s)\n' +
                '  sched=$(cat ' + BG_SCHED + ' 2>/dev/null || echo 0)\n' +
                '  case "$sched" in *[!0-9]*) sched=0;; esac\n' +
                '  if [ "$sched" -gt 0 ] && [ "$now" -ge "$sched" ]; then cp ' + STORAGE_FILE + ' ' + BG_ARCHIVED + ' 2>/dev/null; echo "$now" > ' + BG_TRIGGER + '; echo 0 > ' + BG_SCHED + '; fi\n' +
                '  if [ -f ' + LIMITS_APPLY_SH + ' ]; then\n' +
                '    iptables -t filter -L ' + LIMIT_CHAIN + ' -n >/dev/null 2>&1 || iptables-legacy -t filter -L ' + LIMIT_CHAIN + ' -n >/dev/null 2>&1 || sh ' + LIMITS_APPLY_SH + ' >/dev/null 2>&1\n' +
                '  fi\n' +
                'done\n';
            await runShellWithRoot(`echo '${btoa(unescape(encodeURIComponent(script)))}' | base64 -d > ${BG_SCRIPT} && chmod 755 ${BG_SCRIPT}; grep -q 'kano_bg.sh' ${ENGINE_BOOT_FILE} 2>/dev/null || echo 'nohup sh ${BG_SCRIPT} >/dev/null 2>&1 &' >> ${ENGINE_BOOT_FILE}; p=$(cat ${BG_PID} 2>/dev/null); if [ -n "$p" ] && kill -0 $p 2>/dev/null; then echo BG_RUNNING; else rm -f ${BG_PID}; nohup sh ${BG_SCRIPT} >/dev/null 2>&1 & echo BG_STARTED; fi`);
        } catch (e) {}
    };

    const writeBgSched = async () => {
        try {
            const now = new Date();
            let next = 0;
            if (archiveSettings.dailyEnabled) {
                const d = new Date(now); d.setHours(archiveSettings.dailyHour, archiveSettings.dailyMinute, 0, 0);
                if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
                next = d.getTime();
            }
            if (archiveSettings.monthlyEnabled) {
                const m2 = new Date(now.getFullYear(), now.getMonth(), archiveSettings.monthlyDay, archiveSettings.monthlyHour, 0, 0);
                if (m2.getTime() <= now.getTime()) m2.setMonth(m2.getMonth() + 1);
                if (next === 0 || m2.getTime() < next) next = m2.getTime();
            }
            await _shUser(`echo ${next > 0 ? Math.floor(next / 1000) : 0} > ${BG_SCHED} 2>/dev/null || true`);
        } catch (e) {}
    };

    const checkBgTrigger = async () => {
        if (pluginUninstalled) return;
        try {
            const r = await _shUser(`cat ${BG_TRIGGER} 2>/dev/null || echo NONE`);
            const ts = parseInt(_sh(r).trim()) || 0;
            if (!ts) return;
            if (!(await isHeartbeatLeader())) return;
            await _shUser(`rm -f ${BG_TRIGGER} 2>/dev/null || true`);
            writeBgSched(); // 修复: 守护触发时已把计划清0, 必须重排下一次, 否则后台归档只生效一次
            // 触发文件内容=到点时刻epoch → 不管现在几点都按触发时刻补归档(旧版仅同时段才补, 错过即丢一整天数据)
            const d = new Date(ts * 1000);
            let label;
            if (archiveSettings.monthlyEnabled && d.getDate() === archiveSettings.monthlyDay && d.getHours() === archiveSettings.monthlyHour) {
                label = (d.getMonth() === 0 ? 12 : d.getMonth()) + '月月报';
            } else {
                const y = new Date(ts * 1000 - 86400000);
                label = (y.getMonth() + 1) + '/' + y.getDate() + ' 日报';
            }
            if (hasRecentSnapshot(label)) { _log('SYNC', `补归档: ${label} 已存在, 跳过`); await _shUser(`rm -f ${BG_ARCHIVED} 2>/dev/null || true`); return; }
            // 守护脚本到点时已把流量文件复制为 BG_ARCHIVED → 用它做快照(含前端关闭期间的流量),
            // 再从当前统计按设备扣减 → 精确重计; 无快照(旧守护/复制失败)退化为即时归档
            const archRaw = await loadFromFile(BG_ARCHIVED);
            if (archRaw && typeof archRaw === 'object' && Object.keys(archRaw).length > 0) {
                await updateStats(); // 先并入最新计数, 扣减基数才准确
                const now2 = Date.now();
                const snap = { id: now2, label, time: ts * 1000, reset: true, by: clientName + '(后台)', devices: {} };
                let touched = 0;
                for (const [mac, a] of Object.entries(archRaw)) {
                    const aUp = (a.totalUp || 0) + (a.curUp || 0), aDown = (a.totalDown || 0) + (a.curDown || 0);
                    if (aUp + aDown <= 0) continue;
                    snap.devices[mac] = { up: aUp, down: aDown, total: aUp + aDown, name: customNames[mac] || a.hostname || mac, ip: a.ip || '', ip6: (a.ip6s || [])[0] || a.ip6 || '' };
                    const h = trafficHistory[mac];
                    if (h) {
                        h.totalUp = Math.max(0, (h.totalUp || 0) + (h.curUp || 0) - aUp);
                        h.totalDown = Math.max(0, (h.totalDown || 0) + (h.curDown || 0) - aDown);
                        h.curUp = 0; h.curDown = 0;
                        h.engBaseUp = h.engLastUp || 0; h.engBaseDown = h.engLastDown || 0; // 引擎基线对齐当前值, cur 从 0 重新累计
                        h.addrUp = {}; h.addrDown = {}; h.lastUp = 0; h.lastDown = 0;
                        touched++;
                    }
                }
                if (Object.keys(snap.devices).length > 0) {
                    snapshots.unshift(snap);
            if (typeof selectedSnaps !== 'undefined') selectedSnaps.clear(); // 下标整体漂移, 清空勾选防误删
                    if (snapshots.length > 50) snapshots = snapshots.slice(0, 50);
                    await saveSnapshots();
                }
                historyDirty = true;
                _localResetAt = Date.now();
                await flushHistory(true);
                await _shUser(`rm -f ${BG_ARCHIVED} 2>/dev/null || true`);
                // 引擎模式基线已对齐无需动链; iptables 回退模式清零计数链防重复累计
                if (!engineActive()) { try { await runShellWithRoot(`${IPT} -t mangle -Z ${CHAIN_NAME} 2>/dev/null || true`); } catch (e) {} }
                renderList(); renderOverview();
                _log('ACTION', `后台补归档 ${label} 设备=${touched} 总量=${formatBytes(Object.values(snap.devices).reduce((x, y) => x + y.total, 0))}`);
                createToast('◷ 已补归档 ' + label + '(含前端关闭期间流量)', 'green');
                return;
            }
            _log('ACTION', `后台守护到点 → 补归档 ${label}(无到点快照, 用当前数据)`);
            await archiveAndReset(label, archiveSettings.resetAfterArchive !== false);
            createToast('◷ 已补归档 ' + label, 'green');
        } catch (e) {}
    };

    const isHeartbeatLeader = async () => {
        try {
            const r = await _shUser(`now=$(date +%s); for f in ${HB_PREFIX}*; do [ -f "$f" ] || continue; mt=$(stat -c %Y "$f" 2>/dev/null || echo 0); if [ $((now - mt)) -gt 90 ]; then rm -f "$f"; else echo "\${f##*/}"; fi; done | sort | head -1`);
            return _sh(r).trim() === `traffic_hb.${CLIENT_ID}`;
        } catch (e) { return true; }
    };

    const hasRecentSnapshot = (label) => snapshots.some(sn => sn && sn.label === label && Math.abs(Date.now() - (sn.time || 0)) < 6 * 3600 * 1000);

    const checkAutoArchive = async () => {
        if (pluginUninstalled) return;
        const now = new Date();
        const dayKey = now.getFullYear() + '-' + (now.getMonth()+1) + '-' + now.getDate();
        const monthKey = now.getFullYear() + '-' + (now.getMonth()+1);

        if (localStorage.getItem('kano_last_log_clean_day') !== dayKey) {
            localStorage.setItem('kano_last_log_clean_day', dayKey);
            cleanOldLogs();
        }

        const monthlyDue = archiveSettings.monthlyEnabled && now.getDate() === archiveSettings.monthlyDay && lastAutoArchiveMonth !== monthKey && now.getHours() === archiveSettings.monthlyHour;
        const dailyDue = archiveSettings.dailyEnabled && lastAutoArchiveDay !== dayKey && now.getHours() === archiveSettings.dailyHour && now.getMinutes() >= archiveSettings.dailyMinute;
        if (!monthlyDue && !dailyDue) return;
        if (!(await isHeartbeatLeader())) { _log('SYNC', '自动归档: 本端非心跳主端, 由主端执行'); return; }
        const freshSnaps = await loadFromFile(SNAPSHOTS_FILE);
        if (freshSnaps) snapshots = freshSnaps;

        if (monthlyDue) {
            const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
            const prevMonthName = prevMonth + '月';
            const label = prevMonthName + '月报';
            if (hasRecentSnapshot(label)) {
                _log('SYNC', `自动归档: ${label} 他端已归档, 跳过`);
                lastAutoArchiveMonth = monthKey;
                localStorage.setItem('kano_last_auto_archive_month', monthKey);
                lastAutoArchiveDay = dayKey;
                localStorage.setItem('kano_last_auto_archive_day', dayKey);
                return;
            }
            await archiveAndReset(label, archiveSettings.resetAfterArchive !== false);
            lastAutoArchiveMonth = monthKey;
            localStorage.setItem('kano_last_auto_archive_month', monthKey);
            lastAutoArchiveDay = dayKey;
            localStorage.setItem('kano_last_auto_archive_day', dayKey);
            createToast('&#x1F4C5; 已自动归档' + prevMonthName + '月报' + (archiveSettings.resetAfterArchive !== false ? '并重计' : ''), 'green');
            return;
        }

        if (dailyDue) {
            const yesterday = new Date(now - 86400000);
            const label = (yesterday.getMonth()+1) + '/' + yesterday.getDate() + ' 日报';
            if (hasRecentSnapshot(label)) {
                _log('SYNC', `自动归档: ${label} 他端已归档, 跳过`);
                lastAutoArchiveDay = dayKey;
                localStorage.setItem('kano_last_auto_archive_day', dayKey);
                return;
            }
            await archiveAndReset(label, archiveSettings.resetAfterArchive !== false);
            lastAutoArchiveDay = dayKey;
            localStorage.setItem('kano_last_auto_archive_day', dayKey);
            createToast('&#x1F4C5; 已自动归档 ' + label + (archiveSettings.resetAfterArchive !== false ? '并重计' : ''), 'green');
        }
    };

    const startAutoArchive = () => {
        if (autoArchiveTimer) clearInterval(autoArchiveTimer);
        writeBgSched();
        checkBgTrigger();
        autoArchiveTimer = setInterval(() => { checkBgTrigger(); checkAutoArchive(); }, 60000);
    };

    const stopAutoArchive = () => {
        if (autoArchiveTimer) { clearInterval(autoArchiveTimer); autoArchiveTimer = null; }
    };

    const _isV6Addr = (addr) => String(addr || '').includes(':');

    // ============================================================
    //  UI 构建 (重构后 HTML)
    // ============================================================

    const mmContainer = document.querySelector('.functions-container');
    if (!mmContainer) return;

    mmContainer.insertAdjacentHTML("afterend", `
        <style>
            #IFRAME_KANO_TRAFFIC .kano-tbl { width:100%; border-collapse:collapse; font-size:12px; }
            #IFRAME_KANO_TRAFFIC .kano-tbl th, #IFRAME_KANO_TRAFFIC .kano-tbl td { white-space:nowrap; }
            #IFRAME_KANO_TRAFFIC #kano_traffic_table_wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; max-width:100%; }
            #IFRAME_KANO_TRAFFIC .kano-statusbar { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:10px; opacity:.55; padding:2px 4px 8px; flex-wrap:wrap; }
            #IFRAME_KANO_TRAFFIC .kano-dock { position:sticky; top:6px; z-index:0; display:flex; gap:4px; background:rgba(255,255,255,0.05); backdrop-filter:blur(24px) saturate(180%); -webkit-backdrop-filter:blur(24px) saturate(180%); border:1px solid rgba(255,255,255,0.08); border-radius:20px; box-shadow:0 8px 32px rgba(0,0,0,0.3); padding:5px; margin-bottom:12px; }
            #IFRAME_KANO_TRAFFIC .kano-dock button { flex:1; border:none; background:transparent; color:inherit; font-size:11px; padding:7px 4px; border-radius:14px; cursor:pointer; opacity:.45; transition:opacity .15s, background .15s; white-space:nowrap; }
            #IFRAME_KANO_TRAFFIC .kano-dock button.kano-dock-on { opacity:1; background:rgba(255,255,255,0.1); }
            #IFRAME_KANO_TRAFFIC .kano-tabpane { display:none; }
            #IFRAME_KANO_TRAFFIC .kano-tabpane.kano-tab-on { display:block; }
            
            /* 内联标签页按钮样式 */
            #IFRAME_KANO_TRAFFIC .kano-inner-tab-btn { flex:1; border:none; background:transparent; color:inherit; font-size:11px; padding:6px 4px; border-radius:10px; cursor:pointer; opacity:.5; transition:opacity .15s, background .15s; white-space:nowrap; }
            #IFRAME_KANO_TRAFFIC .kano-inner-tab-btn.kano-inner-on { opacity:1; background:rgba(255,255,255,0.08); }
            #IFRAME_KANO_TRAFFIC .kano-inner-row { display:flex; gap:4px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:12px; padding:4px; margin-bottom:10px; }
            
            #IFRAME_KANO_TRAFFIC .kano-td-sub { display:none; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-td-sub { display:block; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl { font-size:10px; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl th { padding:6px 4px !important; font-size:9px !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl td { padding:6px 4px !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl th:nth-child(2),
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl th:nth-child(3),
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl .kano-mac,
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl .kano-signal { display:none !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl th:nth-child(4),
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl th:nth-child(5),
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl td:nth-child(4),
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl td:nth-child(5) { display:none !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-hostname { font-size:12px !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-btn-row { gap:5px !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-btn-row button { font-size:10px !important; padding:3px 7px !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .title strong { font-size:14px; }
            #IFRAME_KANO_TRAFFIC.kano-narrow .kano-btn-row button { font-size:9px !important; padding:2px 5px !important; }
            #IFRAME_KANO_TRAFFIC.kano-narrow .kano-tbl { font-size:9px; }
            #IFRAME_KANO_TRAFFIC.kano-narrow .kano-tbl th { padding:5px 3px !important; }
            #IFRAME_KANO_TRAFFIC.kano-narrow .kano-tbl td { padding:5px 3px !important; }
            #IFRAME_KANO_TRAFFIC .kano-btn-row { display:flex; gap:8px; flex-wrap:wrap; }
            #IFRAME_KANO_TRAFFIC .kano-btn-row button { font-size:12px; padding:4px 10px; }
            @media(max-width:480px){
                #IFRAME_KANO_TRAFFIC .kano-btn-row { gap:5px; }
                #IFRAME_KANO_TRAFFIC .kano-btn-row button { font-size:10px !important; padding:3px 7px !important; }
                #IFRAME_KANO_TRAFFIC .kano-tbl { font-size:10px; }
                #IFRAME_KANO_TRAFFIC .kano-tbl th { padding:6px 4px !important; }
                #IFRAME_KANO_TRAFFIC .kano-tbl td { padding:6px 4px !important; }
                #IFRAME_KANO_TRAFFIC .title strong { font-size:14px; }
            }
            @media(max-width:380px){
                #IFRAME_KANO_TRAFFIC .kano-btn-row button { font-size:9px !important; padding:2px 5px !important; }
                #IFRAME_KANO_TRAFFIC .kano-tbl { font-size:9px; }
                #IFRAME_KANO_TRAFFIC .kano-tbl th { padding:5px 3px !important; }
                #IFRAME_KANO_TRAFFIC .kano-tbl td { padding:5px 3px !important; }
            }
            /* 超窄屏(小窗)视图: 田字2x2, 上传/下行各占一行 */
            #IFRAME_KANO_TRAFFIC.kano-tiny #kano_traffic_overview > div { grid-template-columns:1fr 1fr !important; gap:4px !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny #kano_traffic_overview > div > div { padding:6px 2px !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl thead { display:none; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl,
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tbody,
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr { display:block; }
            /* 小UI(田字): 左设备信息(加宽1.7fr) | 上传统计/速度 下载统计/速度(上下两行) | 总量+进度条+百分比 | 最右操作竖排; v21.1.26 */
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr { display:grid; grid-template-columns:minmax(0,1.7fr) minmax(0,1fr) minmax(0,1fr) auto; grid-template-rows:auto auto auto; gap:2px 8px; padding:8px 6px; align-items:start; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td { display:block !important; padding:2px 2px !important; text-align:left !important; white-space:normal; min-width:0 !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(1) { grid-column:1; grid-row:1 / 4; padding-right:6px !important; min-width:0; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(4) { grid-column:2; grid-row:1 / 3; display:flex !important; flex-direction:column; align-items:flex-end; justify-content:center; gap:2px; white-space:nowrap !important; border-left:1px solid rgba(255,255,255,0.08); padding-left:8px !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(5) { grid-column:3; grid-row:1 / 3; display:flex !important; flex-direction:column; align-items:flex-end; justify-content:center; gap:2px; white-space:nowrap !important; border-left:1px solid rgba(255,255,255,0.08); padding-left:8px !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(4) .speed-val { color:#4ade80 !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(5) .speed-val { color:#60a5fa !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(6) { grid-column:2 / 4; grid-row:3; display:flex !important; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:4px; border-left:1px solid rgba(255,255,255,0.08); padding-left:8px !important; padding-top:4px !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(6) > div:first-child { width:100%; text-align:right; font-weight:700; color:var(--dark-btn-color-active); }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(6) > div:nth-child(2) { flex:1; order:1; height:3px; margin-top:0 !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(6) > div:nth-child(3) { order:2; width:auto !important; margin-top:0 !important; font-size:9px; opacity:.4; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(6) > div:nth-child(4) { display:none !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td:nth-child(7) { grid-column:4; grid-row:1 / 4; text-align:center !important; display:flex !important; flex-direction:column; align-items:center; justify-content:center; gap:5px; padding:2px 0 2px 6px !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl .kano-mac,
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl .kano-signal { display:none !important; visibility:hidden !important; height:0 !important; min-height:0 !important; padding:0 !important; overflow:hidden !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-tbl tr.kano-tr td div[style*="height:3px"] { width:100% !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-td-sub { display:none !important; }
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-hostname { font-size:11px !important; }
            /* 限速/删除按钮三档等大等高: 固定高度+弹性居中, 抹平字形/圆角/行高差异 */
            #IFRAME_KANO_TRAFFIC .kano-limit-btn, #IFRAME_KANO_TRAFFIC .kano-del-btn { display:inline-flex !important; align-items:center; justify-content:center; font-size:12px !important; line-height:1 !important; height:22px; min-width:24px; padding:0 5px !important; border-radius:4px !important; vertical-align:middle; margin:1px; box-sizing:border-box; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-limit-btn, #IFRAME_KANO_TRAFFIC.kano-compact .kano-del-btn,
            #IFRAME_KANO_TRAFFIC.kano-tiny .kano-limit-btn, #IFRAME_KANO_TRAFFIC.kano-tiny .kano-del-btn { font-size:11px !important; height:20px; min-width:22px; padding:0 4px !important; }
            /* 页脚彩蛋由 JS 按档位随机抽取(v21.1.13) */
        </style>
        <div id="IFRAME_KANO_TRAFFIC" style="width:100%;margin-top:10px;">
            <div class="title" style="margin:6px 0;"><strong>设备流量监控</strong><div style="display:inline-block;" id="collapse_traffic_btn"></div></div>
            <div class="collapse" id="collapse_traffic" data-name="close" style="height:0px;overflow:hidden;">
                <div class="collapse_box">
                    <div class="kano-statusbar">
                        <span id="kano_sb_time">◷ --:--:--</span>
                        <span>设备流量监控</span>
                        <span id="kano_sb_runtime">◴ 0m</span>
                    </div>
                    <div class="kano-dock" id="kano_dock">
                        <button data-tab="traffic" class="kano-dock-on">◈ 流量</button>
                        <button data-tab="history">▣ 历史</button>
                        <button data-tab="settings">◉ 设置</button>
                    </div>
                    
                    <!-- 流量标签页 -->
                    <div class="kano-tabpane kano-tab-on" data-pane="traffic">
                        <div id="kano_traffic_overview" style="margin-bottom:10px;"></div>
                        <div class="kano-btn-row" style="margin-bottom:10px;">
                            <button id="kano_traffic_refresh_btn">${ICON.refresh} 刷新</button>
                            <button id="kano_traffic_monitor_btn">${ICON.monitor} 自动监控</button>
                            <button id="kano_traffic_archive_btn" style="background:rgba(167,139,250,0.1);color:#a78bfa;border-color:rgba(167,139,250,0.2);">${ICON.archive} 归档并重计</button>
                            <button id="kano_traffic_cleartraffic_btn" style="background:rgba(251,146,60,0.1);color:#fb923c;border-color:rgba(251,146,60,0.2);">${ICON.clear} 清除流量</button>
                        </div>
                        <div id="kano_traffic_table_wrap" style="border-radius:10px;background:rgba(255,255,255,0.015);">
                            <table id="kano_traffic_table" class="kano-tbl">
                                <thead><tr style="border-bottom:2px solid rgba(255,255,255,0.08);font-size:10px;opacity:.65;">
                                    <th style="padding:10px 8px;text-align:left;">设备</th>
                                    <th style="padding:10px 8px;text-align:left;">MAC</th>
                                    <th style="padding:10px 8px;text-align:center;">信号</th>
                                    <th style="padding:10px 8px;text-align:right;">${ICON.up} 上传</th>
                                    <th style="padding:10px 8px;text-align:right;">${ICON.down} 下载</th>
                                    <th style="padding:10px 8px;text-align:right;min-width:90px;">${ICON.total} 总流量</th>
                                    <th style="padding:10px 4px;text-align:center;width:30px;"></th>
                                </tr></thead>
                                <tbody id="kano_traffic_tbody"><tr><td colspan="7" style="text-align:center;padding:24px;color:#888;">点击「刷新」</td></tr></tbody>
                            </table>
                        </div>
                    </div>
                    
                    <!-- 历史标签页 (内联化) -->
                    <div class="kano-tabpane" data-pane="history">
                        <div class="kano-inner-row">
                            <button class="kano-inner-tab-btn kano-inner-on kano-hist-tab-btn" data-tab="records">▣ 历史记录</button>
                            <button class="kano-inner-tab-btn kano-hist-tab-btn" data-tab="rank">◊ 流量排行</button>
                            <button class="kano-inner-tab-btn kano-hist-tab-btn" data-tab="trend">◈ 设备趋势</button>
                        </div>
                        <div class="kano-hist-pane kano-inner-on" data-pane="records" id="kano_history_records" style="font-size:12px;line-height:1.5;max-height:420px;overflow:auto;">
                            <div style="text-align:center;padding:30px;opacity:.5;">加载中...</div>
                        </div>
                        <div class="kano-hist-pane" data-pane="rank" id="kano_history_rank" style="font-size:12px;line-height:1.5;max-height:420px;overflow:auto;display:none;">
                            <div style="text-align:center;padding:30px;opacity:.5;">加载中...</div>
                        </div>
                        <div class="kano-hist-pane" data-pane="trend" id="kano_history_trend" style="font-size:12px;line-height:1.5;max-height:420px;overflow:auto;display:none;">
                            <div style="text-align:center;padding:30px;opacity:.5;">加载中...</div>
                        </div>
                    </div>
                    
                    <!-- 设置标签页 (内联化) -->
                    <div class="kano-tabpane" data-pane="settings">
                        <div class="kano-inner-row">
                            <button class="kano-inner-tab-btn kano-inner-on kano-set-tab-btn" data-tab="settings">◉ 设置</button>
                            <button class="kano-inner-tab-btn kano-set-tab-btn" data-tab="engine">◈ 引擎</button>
                            <button class="kano-inner-tab-btn kano-set-tab-btn" data-tab="log">◌ 日志</button>
                            <button class="kano-inner-tab-btn kano-set-tab-btn" data-tab="diag">◐ 诊断</button>
                        </div>
                        <div class="kano-set-pane kano-inner-on" data-pane="settings" id="kano_settings_pane" style="font-size:12px;line-height:1.5;max-height:420px;overflow:auto;">
                            <div style="text-align:center;padding:30px;opacity:.5;">加载中...</div>
                        </div>
                        <div class="kano-set-pane" data-pane="engine" id="kano_engine_pane" style="font-size:12px;line-height:1.5;max-height:420px;overflow:auto;display:none;">
                            <div style="text-align:center;padding:30px;opacity:.5;">加载中...</div>
                        </div>
                        <div class="kano-set-pane" data-pane="log" id="kano_log_pane" style="font-size:12px;line-height:1.5;max-height:420px;overflow:auto;display:none;">
                            <div style="text-align:center;padding:30px;opacity:.5;">加载中...</div>
                        </div>
                        <div class="kano-set-pane" data-pane="diag" id="kano_diag_pane" style="font-size:12px;line-height:1.5;max-height:420px;overflow:auto;display:none;">
                            <div style="text-align:center;padding:30px;opacity:.5;">加载中...</div>
                        </div>
                        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
                            <button id="kano_traffic_uninstall_btn" style="font-size:12px;padding:6px 14px;background:rgba(248,113,113,0.15);color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:6px;cursor:pointer;font-weight:700;">${ICON.uninstall} 卸载插件</button>
                        </div>
                    </div>
                    
                    <div style="margin-top:10px;font-size:11px;opacity:.78;text-align:center;">
                        <span class="kano-kao" id="kano_kao"></span>v${PLUGIN_VERSION}
                    </div>
                </div>
            </div>
        </div>
    `);

    collapseGen("#collapse_traffic_btn", "#collapse_traffic", "#collapse_traffic", (newVal) => { 
        if (newVal == 'open') {
            refresh();
            // 历史/设置标签页首次展开时渲染默认内容
            setTimeout(() => {
                if (document.querySelector('.kano-hist-pane.kano-inner-on[data-pane="records"]')) renderHistoryRecordsInline();
                if (document.querySelector('.kano-set-pane.kano-inner-on[data-pane="settings"]')) renderSettingsInline();
            }, 100);
        }
    });

    // v21.1.20: 页脚版本号区域 2秒内连点5次 切换假数据自检模式(免控制台)
    let _verTaps = [];
    document.querySelector('#kano_kao')?.parentElement?.addEventListener('click', () => {
        const now = Date.now();
        _verTaps = _verTaps.filter(t => now - t < 2000); _verTaps.push(now);
        if (_verTaps.length < 5) return;
        _verTaps = [];
        const on = isMockMode();
        if (on) localStorage.removeItem('kanoMock'); else localStorage.setItem('kanoMock', '1');
        createToast(on ? '✅ 假数据自检已关闭，恢复真实统计' : '🧪 假数据自检已开启(不写入统计)，再连点5次关闭', on ? 'blue' : 'pink', 5000);
        try { refresh(); } catch (e) {}
    });

    // Dock 页签切换
    document.querySelectorAll('#kano_dock button').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('#kano_dock button').forEach(x => x.classList.toggle('kano-dock-on', x === b));
            document.querySelectorAll('#IFRAME_KANO_TRAFFIC .kano-tabpane').forEach(p => p.classList.toggle('kano-tab-on', p.dataset.pane === b.dataset.tab));
            // 切换标签页时渲染对应内容
            try { pickKao(); } catch (e) {} // v21.1.15: 切换标签页刷新页脚彩蛋
            if (b.dataset.tab === 'history') {
                const activeHist = document.querySelector('.kano-hist-tab-btn.kano-inner-on');
                if (activeHist) switchHistoryTab(activeHist.dataset.tab);
            }
            if (b.dataset.tab === 'settings') {
                const activeSet = document.querySelector('.kano-set-tab-btn.kano-inner-on');
                if (activeSet) switchSettingsTab(activeSet.dataset.tab);
            }
        });
    });

    // 历史标签页内联切换
    document.querySelectorAll('.kano-hist-tab-btn').forEach(b => {
        b.addEventListener('click', () => switchHistoryTab(b.dataset.tab));
    });

    // 设置标签页内联切换
    document.querySelectorAll('.kano-set-tab-btn').forEach(b => {
        b.addEventListener('click', () => switchSettingsTab(b.dataset.tab));
    });

    // v21.1.14: 页脚彩蛋 —— 三档UI各24条随机文案(文字+颜文字), 换档或每次加载重抽
    let _kaoGroup = '';
    const KAO_LINES = {
        big: [
            '( ﾟ▽ﾟ)/ 大屏就是爽，流量随便看', '¯\\_(ツ)_/¯ 流量都去哪了？往下看', '(⌐■_■) 正在用显微镜盯着每一字节', '( ♪ ) 没有在假装播放音乐，只是顺便统计流量',
            '(☕‿☕) 咖啡续杯，流量续命', 'Σ(っ°Д°;)っ 谁又把流量跑满了', '( ˘▽˘)っ📶 信号满格，心情满格', 'd(￣◇￣)b 统计这种事，交给二进制就好',
            '(¬‿¬) 我看到你在看4K了', '( ˙꒳˙ ) 认真记账，童叟无欺', '₍ᐢ•ᴗ•ᐢ₎ 每台设备都有小本本', '(╯°□°)╯︵ ┻━┻ 流量超了就想掀桌',
            '(´・ω・`) 上行很寂寞，多上传点吧', '(ﾟДﾟ≡ﾟДﾟ) 下载速度不对劲，快看排行', '( ͡° ͜ʖ ͡°) 别紧张，数据只存在设备里', 'ᕕ( ᐛ )ᕗ 跑得快不如跑得稳',
            '(｡•̀ᴗ-)✧ 今天的流量也很乖', '(；ﾟДﾟ) 又有人在半夜更新系统', '⊂(´･◡･⊂ )∘˚˳° 无线有线，一视同仁', '( ・ω・)つ📦 历史已归档，请放心食用',
            '(＾◡＾)っ 清零不丢人，重头再来', '(￣ω￣;) 引擎在后台搬砖中', '✧*｡٩(ˊᗜˋ*)و✧*｡ 大屏全览，一览无遗', '( ˘ ³˘)♥ 爱流量，更爱知道流量去哪'
        ],
        mid: [
            '(・ω・) 平板视野良好', '(¬‿¬) 中杯也很能装', '(ᵔᴥᵔ) 不多不少，刚刚好', '( ♪ ) 没有在假装播放音乐，只是顺便统计流量',
            '( ˊᵕˋ ) 中屏看流量，不累眼', '(•̀ᴗ•́)و 不大不小，正好干活', '( ͡• ͜ʖ ͡• ) 黄金尺寸，黄金视野', '(´｡• ᵕ •｡`) 横着看也行，竖着看也行',
            '(⊙_⊙) 别看屏幕中等，统计是全量的', '(つ✧ω✧)つ 抱着平板数流量', '(๑•̀ㅂ•́)و✧ 中杯的价格，大杯的体验', '(｀・ω・´)ゞ 收到！中屏模式运行中',
            '( ˘͈ ᵕ ˘͈ ) 不挤不空，正合适', '( •_•)>⌐■-■ 商务中屏，在线审计', '(∩˃o˂∩)♡ 不大不小也是爱', '(　´∀｀) 中屏用户的从容',
            '(´▽`ʃ♡ƪ) 流量明明白白', '( ˙灬˙ ) 中等屏幕，高级享受', '(¬_¬)ﾉ 谁家的平板在吃流量', '(✧∀✧) 这个尺寸刚刚好',
            '( ･ิω･ิ) 中屏亦有乾坤', 'ヽ(・∀・)ﾉ 视野刚好，统计刚好', '(⌒ω⌒) 中屏不慌不忙', '(๑˘︶˘๑) 躺着看流量最舒服'
        ],
        tiny: [
            '◕‿◕ 小窗也有春天', '(ﾉ◕ヮ◕)ﾉ 麻雀虽小，流量不少', 'ಠ_ಠ 屏幕小了，统计没少', '(._.) 挤一挤，总能放下',
            '( •́ ᴥ •̀ ) 小归小，一个数都不少', '(ᗒᗣᗕ)՞ 好挤，但还能看', '( ˊo̴̶̷̤ ̫ o̴̶̷̤ˋ ) 迷你窗口，满配统计', '(⊙︿⊙✿) 字小了点，将就看',
            '(っ- ‸ – ς) 小窗也要认真干活', '(˘･_･˘) 别滑了，都在这一屏', 'ʕ•ᴥ•ʔ 小熊抱紧小屏幕', '(๑´•.̫ • `๑) 田字格里排排坐',
            '(•‸•) 小屏也要看流量，讲究', '(ノへ￣、) 屏幕小不是我的错', '( ˘³˘) 小窗贴贴', '(˵ •̀ ᴗ - ˵ ) ✧ 浓缩的都是精华',
            '(¬﹏¬) 再小也要把数字塞下', '(´,,•ω•,,)♡ 小小的也很可爱', '(・_・;) 宽度告急，排版已切换', '(⊙ˍ⊙) 别看窗小，账记得全',
            '( ；´Д｀) 终于不用再左右滑了', '(๑•́₃•̀๑) 小窗模式，启动！', '(´-﹏-`；) 极限空间利用大师', '( ˙˘˙ ) 小窗静静记账中'
        ]
    };
    const pickKao = () => {
        const el = document.querySelector('#kano_kao');
        const root = document.querySelector('#IFRAME_KANO_TRAFFIC');
        if (!el || !root) return;
        // v21.1.26: 直接读取当前实际类名, 去掉缓存依赖彻底防串档
        const g = root.classList.contains('kano-tiny') ? 'tiny' : (root.classList.contains('kano-compact') ? 'mid' : 'big');
        const arr = KAO_LINES[g];
        el.textContent = arr[Math.floor(Math.random() * arr.length)] + '  ';
    };

    // 响应式
    const _kanoRootEl = document.querySelector('#IFRAME_KANO_TRAFFIC');
    const applyResponsive = () => {
        const root = document.querySelector('#IFRAME_KANO_TRAFFIC');
        if (!root) return;
        const w = root.clientWidth;
        root.classList.toggle('kano-compact', w > 0 && w < 960); // v21.1.12: 中UI覆盖平板
        root.classList.toggle('kano-narrow', w > 0 && w < 480);
        // 小UI(田字): 极窄固定触发 + 窄屏实测溢出触发; >=560(平板) 保持中UI, 不因溢出降档
        let tiny = w > 0 && w < 340;
        if (!tiny && w > 0 && w < 560) {
            const wrap = root.querySelector('#kano_traffic_table_wrap');
            if (wrap) {
                const was = root.classList.contains('kano-tiny');
                if (was) root.classList.remove('kano-tiny'); // 先还原成表格再实测(田字态下表格不再溢出, 直接测会误判)
                if (wrap.scrollWidth > wrap.clientWidth + 4) tiny = true;
            }
        }
        root.classList.toggle('kano-tiny', tiny);
        if (tiny !== _tinyView) { _tinyView = tiny; try { renderOverview(); renderList(); } catch (e) {} }
        const kg = tiny ? 'tiny' : (root.classList.contains('kano-compact') ? 'mid' : 'big'); // v21.1.13: 换档才重抽页脚彩蛋
        if (kg !== _kaoGroup) { _kaoGroup = kg; try { pickKao(); } catch (e) {} }
    };
    if (typeof ResizeObserver === 'function' && _kanoRootEl) {
        new ResizeObserver(applyResponsive).observe(_kanoRootEl);
    }
    window.addEventListener('resize', applyResponsive);
    applyResponsive();
    setTimeout(applyResponsive, 500);

    // 状态栏时钟
    const pluginStartTime = Date.now();
    let _engTsCache = 0, _engTsAt = 0; // 引擎启动时间缓存(60s读一次, 原每1s一次shell太费)
    const _sbTick = async () => {
        if (pluginUninstalled) return;
        const tEl = document.querySelector('#kano_sb_time');
        if (tEl) { const n = new Date(); const p2 = (x) => String(x).padStart(2, '0'); tEl.textContent = ICON.time + ' ' + p2(n.getHours()) + ':' + p2(n.getMinutes()) + ':' + p2(n.getSeconds()); }
        const rEl = document.querySelector('#kano_sb_runtime');
        if (rEl) {
            if (Date.now() - _engTsAt > 60000) {
                _engTsAt = Date.now();
                try {
                    const r = await _shUser(`cat ${ENGINE_START_TS} 2>/dev/null || echo 0`);
                    _engTsCache = parseInt(_sh(r).trim()) || 0;
                } catch (e) {}
            }
            let startTs = _engTsCache > 0 ? _engTsCache * 1000 : pluginStartTime;
            const sec = Math.floor((Date.now() - startTs) / 1000);
            const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
            const p2 = (x) => String(x).padStart(2, '0');
            rEl.textContent = ICON.runtime + ' ' + p2(h) + ':' + p2(m) + ':' + p2(s);
        }
    };
    _sbTick();
    setInterval(_sbTick, 1000);

    document.addEventListener('visibilitychange', () => {
        if (pluginUninstalled) return;
        if (document.hidden) { flushHistory(true); }
        else if (monitorTimer) { monitorTick(); }
    });
    window.addEventListener('pagehide', () => { if (!pluginUninstalled) flushHistory(true); });

    // 事件绑定
    document.querySelector('#kano_traffic_refresh_btn').addEventListener('click', refresh);
    document.querySelector('#kano_traffic_monitor_btn').addEventListener('click', () => toggleMonitor(monitorTimer === null));
    
    // 归档并重计 (从history移到traffic)
    document.querySelector('#kano_traffic_archive_btn').addEventListener('click', () => {
        if (pluginUninstalled) return;
        const { id, el } = createModal({
            name: 'traffic_archive_modal', title: '▣ 选择归档方式', maxWidth: 'min(360px, 94vw)',
            showConfirm: true, confirmBtnText: '归档并重计', closeBtnText: '取消',
            onClose: () => true,
            onConfirm: async () => { await archiveAndReset(null, true); return true; },
            content: `<div style="font-size:13px;line-height:1.6;opacity:.85;">
                <div style="background:rgba(167,139,250,0.08);padding:10px;border-radius:6px;margin-bottom:8px;">
                    <div style="font-weight:bold;color:#a78bfa;">&#x1F4CB; 归档并重计</div>
                    <div style="opacity:.6;font-size:11px;">保存当前流量快照，然后清零所有计数器重新开始统计</div>
                </div>
                <div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;margin-bottom:8px;">
                    <div style="font-weight:bold;opacity:.8;">&#x1F4CB; 仅归档</div>
                    <div style="opacity:.6;font-size:11px;">保存当前流量快照，不清零，继续累计统计</div>
                </div>
                <button id="kano_archive_only_btn" style="width:100%;padding:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:inherit;cursor:pointer;font-size:13px;margin-top:4px;">仅归档</button>
            </div>`
        });
        showModal(id);
        setTimeout(() => {
            const onlyBtn = el.querySelector('#kano_archive_only_btn');
            if (onlyBtn) {
                onlyBtn.addEventListener('click', async () => {
                    closeModal(id);
                    await archiveAndReset(null, false);
                });
            }
        }, 50);
    });

    // 清除流量 (从settings移到traffic)
    document.querySelector('#kano_traffic_cleartraffic_btn').addEventListener('click', async () => {
        if (pluginUninstalled) return;
        resetClickCount++;
        if (resetClickTimer) clearTimeout(resetClickTimer);
        resetClickTimer = setTimeout(() => { resetClickCount = 0; }, 4000);
        if (resetClickCount < 2) { createToast('再次确认清除全部流量 (' + resetClickCount + '/2)', 'pink', 3000); return; }
        resetClickCount = 0;
        await clearAllTraffic();
    });

    // 卸载插件 (保留在settings底部)
    document.querySelector('#kano_traffic_uninstall_btn').addEventListener('click', async () => {
        if (pluginUninstalled) return;
        resetClickCount++;
        if (resetClickTimer) clearTimeout(resetClickTimer);
        resetClickTimer = setTimeout(() => { resetClickCount = 0; }, 4000);
        if (resetClickCount < 5) { createToast('再次确认卸载插件 (' + resetClickCount + '/5)', 'pink', 3000); return; }
        resetClickCount = 0;
        await uninstallPlugin();
    });

    // 初始化
    if (!(await _hasRoot())) {
        createToast('高级功能未开启或 root 不可用：流量统计与限速将无法工作，请先启用高级功能', 'pink', 8000);
    }
    await detectIptables();
    await detectIp6tables();
    await loadData();
    loadSettings();
    await detectLimitMode();
    cleanOldLogs();
    if (limitMode !== null && hasActiveLimits()) {
        await mountLimitChains();
        limitChainsMounted = true;
    } else {
        await unmountLimitChains();
    }
    startAutoArchive();
    installBgDaemon();
    startHeartbeat();

    if (await _hasRoot()) {
        try {
            const r = await runShellWithRoot(`[ -x ${ENGINE_BIN} ] && echo ENG_Y || echo ENG_N`);
            if (_sh(r).includes('ENG_Y')) await startEngine();
        } catch (e) {}
        checkEngineUpdate(false).then((res) => {
            if (res && res.manifest && res.manifest.jsRev && _verNewer(res.manifest.jsRev, PLUGIN_VERSION)) {
                createToast(`插件有新版本 v${res.manifest.jsRev}(当前 v${PLUGIN_VERSION})，点「◉ 设置」→「◈ 引擎」→「🔄 更新插件」一键更新`, 'pink', 8000);
                _log('ENGINE', `插件云端版本 v${res.manifest.jsRev} 本机 v${PLUGIN_VERSION} → 可更新`);
            }
        }).catch(() => {});
    }

    if (localStorage.getItem(MONITOR_STATE_KEY) === '1') setTimeout(() => toggleMonitor(true), 1000);
    else if (localStorage.getItem("#collapse_traffic") === 'open') setTimeout(() => refresh(), 800);

    console.log('[设备流量监控] v' + PLUGIN_VERSION + ' 已加载');
    _log('INIT', 'v' + PLUGIN_VERSION + ' 插件启动');
})();
//</script>