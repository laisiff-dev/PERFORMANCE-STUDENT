// 輔英科技大學 學生國內外獲獎紀錄管理與領獎通知系統 前端主邏輯 (含個資去識別化與 AES-256-GCM 解密保護)

function initFooyinAwardsApp() {
    // 僅於 HTTP / HTTPS 網頁環境動態掛載嚴格 CSP，避免瀏覽器於本機 file:// 模式阻擋靜態腳本
    if (window.location.protocol === 'https:' || window.location.protocol === 'http:') {
        const cspMeta = document.createElement('meta');
        cspMeta.httpEquiv = 'Content-Security-Policy';
        cspMeta.content = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';";
        document.head.appendChild(cspMeta);
    }

    const PLACEHOLDER_SET = new Set(['', '無', '未填', '未填寫', '學生未填', '未公開', '未提供', 'None', 'none', 'nan', 'NaN', 'N/A', 'NA', '-', '—']);
    const INTERNAL_SOURCE_KWS = ['行政會議', '校務會議', '官方網站', '官網', '公開網站', '公開新聞', '公開網頁', '輔英新聞', '填報資料模版', '填報資料'];
    const SUPPORTED_ACAD_YEARS = ['112', '113', '114', '115', '116', '117', '118', '119', '120'];
    const SUPPORTED_ACAD_YEAR_LABELS = SUPPORTED_ACAD_YEARS.map(y => `${y}學年度`);
    const SUPPORTED_ACAD_YEAR_DESC = [...SUPPORTED_ACAD_YEAR_LABELS].reverse();

    // 輕量級 IndexedDB 儲存引擎（支援儲存 FileSystemFileHandle 電腦/雲端硬碟檔案控制代碼與無容量限制加密快照）
    const IDB_NAME = 'FooyinAwardsPersistentDB_v2';
    const IDB_STORE = 'kv_store';
    const LS_FALLBACK_PREFIX = 'fooyin_idb_fb_';

    function openAppIdb() {
        return new Promise((resolve) => {
            if (!window.indexedDB) { resolve(null); return; }
            try {
                const req = window.indexedDB.open(IDB_NAME, 1);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(IDB_STORE)) {
                        db.createObjectStore(IDB_STORE);
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch (_) {
                resolve(null);
            }
        });
    }

    async function idbGet(key) {
        const db = await openAppIdb();
        if (db) {
            return new Promise((resolve) => {
                try {
                    const tx = db.transaction(IDB_STORE, 'readonly');
                    const req = tx.objectStore(IDB_STORE).get(key);
                    req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
                    req.onerror = () => resolve(null);
                } catch (_) { resolve(null); }
            });
        }
        try {
            const raw = window.localStorage ? window.localStorage.getItem(LS_FALLBACK_PREFIX + key) : null;
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }

    async function idbSet(key, val) {
        const db = await openAppIdb();
        if (db) {
            const ok = await new Promise((resolve) => {
                try {
                    const tx = db.transaction(IDB_STORE, 'readwrite');
                    tx.objectStore(IDB_STORE).put(val, key);
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                } catch (_) { resolve(false); }
            });
            if (ok) return true;
        }
        try {
            if (window.localStorage && key !== 'bound_fs_handle') {
                window.localStorage.setItem(LS_FALLBACK_PREFIX + key, JSON.stringify(val));
                return true;
            }
        } catch (_) {}
        return false;
    }

    async function idbDel(key) {
        const db = await openAppIdb();
        if (db) {
            await new Promise((resolve) => {
                try {
                    const tx = db.transaction(IDB_STORE, 'readwrite');
                    tx.objectStore(IDB_STORE).delete(key);
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                } catch (_) { resolve(false); }
            });
        }
        try {
            if (window.localStorage) window.localStorage.removeItem(LS_FALLBACK_PREFIX + key);
        } catch (_) {}
    }

    // 靜態離線模式已刪除識別鍵紀錄（僅儲存不含任何學生個資之公開識別碼，確保重新整理後不復現已刪錯誤資料）
    const STATIC_DELETED_KEYS_STORAGE = 'fooyin_deleted_static_keys_v1';
    function loadStaticDeletedSet() {
        try {
            const raw = window.localStorage ? window.localStorage.getItem(STATIC_DELETED_KEYS_STORAGE) : null;
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return new Set(parsed.map(String));
            }
        } catch (_) {}
        return new Set();
    }
    const staticDeletedKeysSet = loadStaticDeletedSet();

    function saveStaticDeletedSet() {
        try {
            if (window.localStorage) {
                window.localStorage.setItem(STATIC_DELETED_KEYS_STORAGE, JSON.stringify([...staticDeletedKeysSet]));
            }
        } catch (_) {}
    }

    function makeStaticDeleteKey(r) {
        const num = String(r["編號"] !== undefined && r["編號"] !== null ? r["編號"] : '').trim();
        const cid = String(r["識別號"] || '').replace(/^#+/, '').trim();
        const ev = String(r["活動名稱"] || r["競賽或活動名稱"] || '').trim();
        return `${num}::${cid}::${ev}`;
    }

    function isStaticRecordDeleted(r) {
        return staticDeletedKeysSet.has(makeStaticDeleteKey(r));
    }

    function markStaticRecordDeleted(r) {
        staticDeletedKeysSet.add(makeStaticDeleteKey(r));
        saveStaticDeletedSet();
    }

    function clearStaticRecordDeleted(r) {
        const key = makeStaticDeleteKey(r);
        const cid = String(r["識別號"] || '').replace(/^#+/, '').trim();
        const ev = String(r["活動名稱"] || r["競賽或活動名稱"] || '').trim();
        let changed = staticDeletedKeysSet.delete(key);
        if (cid && ev) {
            const suffix = `::${cid}::${ev}`;
            [...staticDeletedKeysSet].forEach(k => {
                if (k.endsWith(suffix)) {
                    staticDeletedKeysSet.delete(k);
                    changed = true;
                }
            });
        }
        if (changed) saveStaticDeletedSet();
    }

    // 靜態離線模式已修訂欄位快取（嚴格僅儲存去識別化後之公開欄位與核定金額/領獎狀態，絕不寫入任何明文個資）
    const STATIC_EDITED_PATCHES_STORAGE = 'fooyin_edited_public_patches_v1';
    function loadStaticEditedPatches() {
        try {
            const raw = window.localStorage ? window.localStorage.getItem(STATIC_EDITED_PATCHES_STORAGE) : null;
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            }
        } catch (_) {}
        return {};
    }
    const staticEditedPatchesMap = loadStaticEditedPatches();

    function saveStaticEditedPatches() {
        try {
            if (window.localStorage) {
                window.localStorage.setItem(STATIC_EDITED_PATCHES_STORAGE, JSON.stringify(staticEditedPatchesMap));
            }
        } catch (_) {}
    }

    function applyStaticEditedPatch(rec) {
        const uid = getRecordUid(rec);
        if (uid && staticEditedPatchesMap[uid]) {
            return { ...rec, ...deidentifyRecord(staticEditedPatchesMap[uid]), "編號": rec["編號"] };
        }
        return rec;
    }

    function persistStaticEditedPatch(rec) {
        const uid = getRecordUid(rec);
        if (!uid) return;
        staticEditedPatchesMap[uid] = deidentifyRecord(rec);
        saveStaticEditedPatches();
    }

    function removeStaticEditedPatch(uid) {
        const key = String(uid || '').trim();
        if (key && staticEditedPatchesMap[key]) {
            delete staticEditedPatchesMap[key];
            saveStaticEditedPatches();
        }
    }

    function getRecordUid(r) {
        if (r["編號"] !== undefined && r["編號"] !== null && String(r["編號"]).trim() !== '') {
            return String(r["編號"]).trim();
        }
        return String(r["識別號"] || '').replace(/^#+/, '').trim();
    }

    function showToast(message, isDanger = false) {
        const container = document.getElementById('app-toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `app-toast${isDanger ? ' toast-danger' : ''}`;
        toast.innerHTML = `<i class="fa-solid ${isDanger ? 'fa-trash-can' : 'fa-circle-check'}"></i><span>${escapeHtml(message)}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.25s ease';
            setTimeout(() => toast.remove(), 260);
        }, 2800);
    }

    // 基礎公開去識別化資料集
    let basePublicRecords = (window.INITIAL_AWARDS_DATA && window.INITIAL_AWARDS_DATA.length > 0)
        ? window.INITIAL_AWARDS_DATA.map(r => applyStaticEditedPatch(normalizeAwardRecord(r))).filter(r => !isStaticRecordDeleted(r))
        : [];

    // 刪除、批次勾選、列內快速核定與暫存區/儲存狀態
    let isBatchDeleteMode = false;
    let selectedDeleteIds = new Set();
    let pendingDeleteUids = [];
    let activeDetailRecordId = null;
    let activeEditingStagingUid = null;
    let detailModalRenderedUnlocked = false;
    let editingQuickRowUid = null;
    let editingQuickFocusField = 'amt';

    // 待審核資料暫存區 (Staging Area) 狀態
    let stagingRecords = [];            // 去識別化後之待審核暫存清單
    let stagingFullPiiMap = {};         // 當次連線暫存項目之完整個資 (僅存揮發性記憶體)
    let selectedStagingUids = new Set();

    // 電腦硬碟 / 雲端硬碟雙向儲存與自動載入設定
    let boundFileHandle = null;
    let storagePrefs = {
        auto_cloud_url: '',
        server_storage_dir: '',
        auto_load_startup: true,
        bound_file_name: '',
        last_sync_at: ''
    };

    // 揮發性記憶體管理員狀態（絕不寫入 localStorage / sessionStorage / Cookie）
    let isAdminUnlocked = false;
    let activeSessionPassphrase = null;
    let activeEncryptedVault = window.ENCRYPTED_PII_VAULT || null;
    let decryptedPiiMap = null;      // { [編號]: { 獲獎學生, 學生學號, 學制班級, 原畢業學校, 佐證連結 } }
    let sessionFullRecordsMap = {};  // 當次連線新增紀錄之完整個資（上鎖後僅顯示遮罩版）
    let adminApiToken = null;
    let failedUnlockCount = 0;
    let lockUntilTimestamp = 0;

    const AUTO_LOCK_SECONDS = 600; // 10 分鐘閒置自動上鎖
    let remainingSeconds = 0;
    let countdownTimerId = null;

    let allRecords = [...basePublicRecords];
    let filteredRecords = [...allRecords];
    let currentPage = 1;
    const itemsPerPage = 12;

    let collegeChart = null;
    let levelChart = null;
    let statusChart = null;
    let pendingUnlockCallback = null;

    // DOM 元素引用
    const searchInput = document.getElementById('search-input');
    const filterYear = document.getElementById('filter-year');
    const filterSemester = document.getElementById('filter-semester');
    const filterCollege = document.getElementById('filter-college');
    const filterDept = document.getElementById('filter-dept');
    const filterLevel = document.getElementById('filter-level');
    const filterStatus = document.getElementById('filter-status');
    const btnResetFilter = document.getElementById('btn-reset-filter');
    const tableBody = document.getElementById('table-body');
    const recordCountBadge = document.getElementById('record-count-badge');
    const paginationInfo = document.getElementById('pagination-info');
    const paginationControls = document.getElementById('pagination-controls');

    // =========================================================
    // 資安基礎工具：XSS 跳脫、URL 白名單驗證與前端去識別化函式
    // =========================================================
    function escapeHtml(val) {
        if (val === null || val === undefined) return '';
        return String(val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function safeHref(url) {
        const u = String(url || '').trim();
        if (u === '#protected-evidence') return '#protected-evidence';
        if (/^https?:\/\//i.test(u)) return u;
        return '#';
    }

    function maskSingleName(name) {
        const n = String(name || '').trim();
        if (!n || PLACEHOLDER_SET.has(n)) return '無';
        if (n.includes('○') || n.includes('*')) return n;
        const chars = Array.from(n);
        if (chars.length === 1) return '○';
        if (chars.length === 2) return chars[0] + '○';
        if (chars.length === 3) return chars[0] + '○' + chars[2];
        return chars.slice(0, 2).join('') + '○'.repeat(chars.length - 3) + chars[chars.length - 1];
    }

    function maskStudentNames(namesStr) {
        const raw = String(namesStr || '').trim();
        if (!raw || PLACEHOLDER_SET.has(raw)) return '無';
        const parts = raw.split(/[、,，/／;；]+/).map(s => s.trim()).filter(Boolean);
        return parts.length ? parts.map(maskSingleName).join('、') : '無';
    }

    function maskStudentId(stuId) {
        const s = String(stuId || '').trim();
        if (!s || PLACEHOLDER_SET.has(s)) return '無';
        if (s.includes('*')) return s;
        if (s.length <= 4) return s[0] + '***';
        return s.slice(0, 3) + '*'.repeat(s.length - 4) + s.slice(-1);
    }

    function maskGradeClass(grade) {
        const g = String(grade || '').trim();
        if (!g || PLACEHOLDER_SET.has(g)) return '無';
        return g.replace(/(\d+年)\s*[0-9一二三四五六七八九十甲乙丙丁]+\s*班/, '$1○班');
    }

    function maskHighSchool(school) {
        const s = String(school || '').trim();
        if (!s || PLACEHOLDER_SET.has(s)) return '無';
        if (s.includes('已去識別化')) return s;
        return '🔒 已去識別化保護';
    }

    function maskEvidenceUrl(url) {
        const u = String(url || '').trim();
        if (!u || PLACEHOLDER_SET.has(u)) return '無';
        const lower = u.toLowerCase();
        if (['drive.google.com', 'docs.google.com', 'onedrive.live.com', 'sharepoint.com', 'dropbox.com'].some(d => lower.includes(d))) {
            return '#protected-evidence';
        }
        return u;
    }

    function deidentifyRecord(rec) {
        let safeRemarks = String(rec["備註"] || '');
        const rawNames = String(rec["獲獎學生"] || '').trim();
        if (rawNames && !PLACEHOLDER_SET.has(rawNames) && !rawNames.includes('○')) {
            rawNames.split(/[、,，/／;；]+/).map(s => s.trim()).filter(s => s.length >= 2).forEach(nm => {
                safeRemarks = safeRemarks.split(nm).join(maskSingleName(nm));
            });
        }
        return {
            ...rec,
            "獲獎學生": maskStudentNames(rec["獲獎學生"]),
            "學生學號": maskStudentId(rec["學生學號"]),
            "學制班級": maskGradeClass(rec["學制班級"]),
            "原畢業學校": maskHighSchool(rec["原畢業學校"]),
            "佐證連結": maskEvidenceUrl(rec["佐證連結"]),
            "備註": safeRemarks
        };
    }

    // =========================================================
    // 學年度、學期、活動主辦單位與資料來源 自動推導與標準化引擎
    // =========================================================
    function isInternalMeetingOrWebSource(val) {
        const s = String(val || '').trim();
        if (!s) return false;
        if (/\d{3}\s*[-—~第]\s*\d+\s*次?\s*(行政|校務)/.test(s)) return true;
        return INTERNAL_SOURCE_KWS.some(kw => s.includes(kw));
    }

    function parseSourceToYearSemester(sourceStr) {
        const src = String(sourceStr || '').trim();
        if (!src) return { year: null, term: null };

        const m = src.match(/(\d{3})\s*[-—~第]\s*(\d+)\s*次?\s*(行政會議|校務會議)/);
        if (m) {
            const rocYear = m[1];
            const session = parseInt(m[2], 10);
            const mType = m[3];
            const term = (mType === '校務會議') ? (session <= 2 ? '上' : '下') : (session <= 5 ? '上' : '下');
            return { year: `${rocYear}學年度`, term };
        }

        let yearOnly = null;
        const mYr = src.match(/(\d{3})\s*學年度/);
        if (mYr) yearOnly = `${mYr[1]}學年度`;

        if (['上學期', '第一學期', '第1學期'].some(k => src.includes(k))) return { year: yearOnly, term: '上' };
        if (['下學期', '第二學期', '第2學期'].some(k => src.includes(k))) return { year: yearOnly, term: '下' };

        return { year: yearOnly, term: null };
    }

    function parseDateToYearSemester(dateStr) {
        const s = String(dateStr || '').trim();
        if (!s) return { year: null, term: null };
        const m = s.match(/(\d{3,4})\s*[-/年.]\s*(\d{1,2})/);
        if (!m) return { year: null, term: null };

        const yr = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        if (month < 1 || month > 12) return { year: null, term: null };

        const adYear = yr < 1911 ? yr + 1911 : yr;
        let rocAcadYear;
        let term;
        if (month >= 8) {
            rocAcadYear = adYear - 1911;
            term = '上';
        } else if (month === 1) {
            rocAcadYear = adYear - 1912;
            term = '上';
        } else {
            rocAcadYear = adYear - 1912;
            term = '下';
        }
        return { year: `${rocAcadYear}學年度`, term };
    }

    function inferYearAndSemester(record) {
        const srcParsed = parseSourceToYearSemester(record["資料來源"]);
        const rawYear = String(record["學年度"] || '').replace(/學年度/g, '').trim();
        const curYear = rawYear ? `${rawYear}學年度` : '';
        let curTerm = String(record["學期"] || '').trim();
        if (curTerm !== '上' && curTerm !== '下') curTerm = '';

        // 1. 優先由資料來源會議期別判定 (如 113-3行政會議 -> 113學年度 上)
        if (srcParsed.year && srcParsed.term) {
            return { year: srcParsed.year, term: srcParsed.term };
        }

        // 2. 從會議記錄時間讀取
        const meetParsed = parseDateToYearSemester(record["會議記錄時間"]);
        if (meetParsed.term) {
            return { year: curYear || srcParsed.year || meetParsed.year || '114學年度', term: meetParsed.term };
        }

        // 3. 既有明確有效學期 (支援 112~120 學年度上、下學期)
        if (curTerm === '上' || curTerm === '下') {
            const finalYr = curYear || srcParsed.year || '114學年度';
            return { year: finalYr, term: curTerm };
        }

        // 4. 從活動結束日期 / 活動起始日期 / 通知時間推算 (跨學期賽事以結束結算日期為準)
        const dateFields = ['活動結束日期', '活動起始日期', '通知時間'];
        for (const df of dateFields) {
            const dtParsed = parseDateToYearSemester(record[df]);
            if (dtParsed.term) {
                const finalYr = curYear || srcParsed.year || dtParsed.year || '114學年度';
                return { year: finalYr, term: dtParsed.term };
            }
        }

        const fallbackYear = curYear || srcParsed.year || '114學年度';
        return { year: fallbackYear, term: srcParsed.term || '上' };
    }

    function resolveDeptCode(deptName, rawDeptCode) {
        const raw = String(rawDeptCode || '').trim();
        const dn = String(deptName || (raw.includes(' - ') ? raw.split(' - ')[0] : raw) || '').trim();
        if (window.FOOYIN_DEPT_CODE_MAP && dn && window.FOOYIN_DEPT_CODE_MAP[dn]) {
            return window.FOOYIN_DEPT_CODE_MAP[dn];
        }
        if (raw && raw.includes(' - ')) return raw;
        return dn ? `${dn} - 1445` : '護理系 - 1445';
    }

    function classifyCompetitionLevel(cat, ev, wk, org) {
        const c = String(cat || '').trim();
        const e = String(ev || '').trim();
        const w = String(wk || '').trim();
        const combined = `${c} ${e} ${w} ${String(org || '')}`;

        if (['國際', '國外', '大陸', '港', '澳'].some(k => c.includes(k))) return '國際競賽';
        if (['國際', '世界', '亞洲', 'Global', 'World', 'International'].some(k => e.includes(k)) && !e.includes('全國')) return '國際競賽';
        if (['證照', '國考', '檢定', '高考', '專技'].some(k => combined.includes(k))) return '專業證照';

        const academicKws = ['發明', '創新', '創意', '專題', '論文', '研討會', '簡報', '美容', '美學', '調香', '香氛', '美睫', '彩繪', '設計', '程式', '資訊', '護理技能', '臨床技能', '大專優秀青年', '書道', '文學', '英語', '外語'];
        const sportsKws = ['運動會', '大運', '聯賽', '錦標賽', '體育', '溜冰', '籃球', '排球', '足球', '羽球', '田徑', '拔河', '游泳', '跆拳', '柔道', '桌球', '網球', '木球', '射箭', '健美錦標'];
        if (sportsKws.some(k => `${e} ${w}`.includes(k)) && !academicKws.some(k => `${e} ${w}`.includes(k))) {
            return '體育競賽';
        }
        if (e.includes('盃') && ['球', '泳', '跑', '田徑', '溜冰', '武術', '跆拳', '體操', '運動'].some(k => `${e} ${w}`.includes(k))) {
            return '體育競賽';
        }
        return '國內競賽';
    }

    function normalizeAwardRecord(rawRecord, preserveExplicitYearTerm = false) {
        const r = { ...rawRecord };
        const rawOrg = String(r["活動主辦單位"] || '').trim();
        let rawSrc = String(r["資料來源"] || '').trim();
        const remarks = String(r["備註"] || '');

        if (remarks.includes('112-114') && rawOrg && rawSrc === rawOrg) {
            rawSrc = '112-114學年度填報資料';
        }

        let normalizedOrg;
        if (!rawOrg || PLACEHOLDER_SET.has(rawOrg) || isInternalMeetingOrWebSource(rawOrg)) {
            if (isInternalMeetingOrWebSource(rawOrg) && !rawSrc) {
                rawSrc = rawOrg;
            }
            normalizedOrg = '無';
        } else {
            normalizedOrg = rawOrg;
        }

        if (!rawSrc) {
            rawSrc = remarks.includes('112-114') ? '112-114學年度填報資料' : '無';
        }

        r["活動主辦單位"] = normalizedOrg;
        r["資料來源"] = rawSrc;

        if (!r["系所名稱"] && r["學生所屬系科 - 系所代碼"]) {
            r["系所名稱"] = String(r["學生所屬系科 - 系所代碼"]).split(' - ')[0].trim();
        }
        r["學生所屬系科 - 系所代碼"] = resolveDeptCode(r["系所名稱"], r["學生所屬系科 - 系所代碼"]);

        if (!r["競賽層級"] || !['國際競賽', '國內競賽', '體育競賽', '專業證照', '特殊優良事蹟'].includes(r["競賽層級"])) {
            r["競賽層級"] = classifyCompetitionLevel(r["活動類別"], r["活動名稱"] || r["競賽或活動名稱"], r["競賽項目"] || r["參賽項目或作品名稱"], normalizedOrg);
        }

        const explicitYr = String(r["學年度"] || '').replace(/學年度/g, '').trim();
        const explicitTm = String(r["學期"] || '').trim();
        if (preserveExplicitYearTerm && explicitYr && (explicitTm === '上' || explicitTm === '下')) {
            r["學年度"] = `${explicitYr}學年度`;
            r["學期"] = explicitTm;
        } else {
            const inferred = inferYearAndSemester(r);
            r["學年度"] = inferred.year;
            r["學期"] = inferred.term;
        }
        return r;
    }

    // =========================================================
    // WebCrypto + 純 JS 雙引擎 AES-256-GCM 記憶體解密與自動上鎖機制
    // (同時支援 HTTPS GitHub Pages、localhost 與本機 file:// 直接點擊開啟)
    // =========================================================
    function base64ToUint8Array(b64) {
        const binary = window.atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    // 純 JS 標準 SHA-256 / PBKDF2-SHA256 / AES-256-GCM 備援引擎 (供 file:// 離線環境使用)
    const SHA256_K = new Uint32Array([
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ]);

    function pureSha256(msgBytes) {
        let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,
            h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
        const len = msgBytes.length;
        const bitLenHi = Math.floor((len * 8) / 0x100000000);
        const bitLenLo = (len * 8) >>> 0;
        const padLen = ((len + 9 + 63) & ~63);
        const buf = new Uint8Array(padLen);
        buf.set(msgBytes);
        buf[len] = 0x80;
        const dv = new DataView(buf.buffer);
        dv.setUint32(padLen - 8, bitLenHi, false);
        dv.setUint32(padLen - 4, bitLenLo, false);

        const w = new Uint32Array(64);
        for (let off = 0; off < padLen; off += 64) {
            for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
            for (let i = 16; i < 64; i++) {
                const x = w[i - 15], y = w[i - 2];
                const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
                const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
            }
            let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
            for (let i = 0; i < 64; i++) {
                const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
                const ch = (e & f) ^ (~e & g);
                const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
                const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const t2 = (S0 + maj) >>> 0;
                h=g; g=f; f=e; e=(d + t1) >>> 0; d=c; c=b; b=a; a=(t1 + t2) >>> 0;
            }
            h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
            h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
        }
        const out = new Uint8Array(32);
        const odv = new DataView(out.buffer);
        odv.setUint32(0,h0); odv.setUint32(4,h1); odv.setUint32(8,h2); odv.setUint32(12,h3);
        odv.setUint32(16,h4); odv.setUint32(20,h5); odv.setUint32(24,h6); odv.setUint32(28,h7);
        return out;
    }

    function purePbkdf2Sha256(passwordBytes, saltBytes, iterations, dkLen) {
        let key = passwordBytes.length > 64 ? pureSha256(passwordBytes) : passwordBytes;
        const ipad = new Uint8Array(64), opad = new Uint8Array(64);
        for (let i = 0; i < 64; i++) {
            const kb = i < key.length ? key[i] : 0;
            ipad[i] = kb ^ 0x36;
            opad[i] = kb ^ 0x5c;
        }
        const hmac = (data) => {
            const inner = new Uint8Array(64 + data.length);
            inner.set(ipad); inner.set(data, 64);
            const ih = pureSha256(inner);
            const outer = new Uint8Array(96);
            outer.set(opad); outer.set(ih, 64);
            return pureSha256(outer);
        };
        const blocks = Math.ceil(dkLen / 32);
        const out = new Uint8Array(blocks * 32);
        for (let b = 1; b <= blocks; b++) {
            const sb = new Uint8Array(saltBytes.length + 4);
            sb.set(saltBytes);
            sb[saltBytes.length] = (b >>> 24) & 0xff;
            sb[saltBytes.length + 1] = (b >>> 16) & 0xff;
            sb[saltBytes.length + 2] = (b >>> 8) & 0xff;
            sb[saltBytes.length + 3] = b & 0xff;
            let u = hmac(sb);
            const t = new Uint8Array(u);
            for (let i = 1; i < iterations; i++) {
                u = hmac(u);
                for (let j = 0; j < 32; j++) t[j] ^= u[j];
            }
            out.set(t, (b - 1) * 32);
        }
        return out.slice(0, dkLen);
    }

    let aesSboxCache = null;
    function getAesSbox() {
        if (aesSboxCache) return aesSboxCache;
        const sbox = new Uint8Array(256);
        let p = 1, q = 1;
        do {
            p = (p ^ (p << 1) ^ (p & 0x80 ? 0x11b : 0)) & 0xff;
            q ^= q << 1; q ^= q << 2; q ^= q << 4; q = (q ^ (q & 0x80 ? 0x09 : 0)) & 0xff;
            const xf = q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^ ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4));
            sbox[p] = (xf ^ 0x63) & 0xff;
        } while (p !== 1);
        sbox[0] = 0x63;
        aesSboxCache = sbox;
        return sbox;
    }

    function aes256GcmPureDecrypt(key32, iv12, ciphertextWithTag) {
        if (ciphertextWithTag.length < 16) throw new Error('Invalid ciphertext');
        const sbox = getAesSbox();
        const rcon = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
        const rk = new Uint8Array(240);
        rk.set(key32);
        let wi = 32, rconIdx = 1;
        const temp = new Uint8Array(4);
        while (wi < 240) {
            temp.set(rk.subarray(wi - 4, wi));
            if (wi % 32 === 0) {
                const t = temp[0];
                temp[0] = sbox[temp[1]] ^ rcon[rconIdx++];
                temp[1] = sbox[temp[2]];
                temp[2] = sbox[temp[3]];
                temp[3] = sbox[t];
            } else if (wi % 32 === 16) {
                for (let k = 0; k < 4; k++) temp[k] = sbox[temp[k]];
            }
            for (let k = 0; k < 4; k++) rk[wi + k] = rk[wi - 32 + k] ^ temp[k];
            wi += 4;
        }

        const xt = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;
        const encBlock = (blk) => {
            const s = new Uint8Array(16), tmp = new Uint8Array(16);
            for (let i = 0; i < 16; i++) s[i] = blk[i] ^ rk[i];
            for (let r = 1; r <= 14; r++) {
                for (let i = 0; i < 16; i++) tmp[i] = sbox[s[i]];
                s[0]=tmp[0]; s[1]=tmp[5]; s[2]=tmp[10]; s[3]=tmp[15];
                s[4]=tmp[4]; s[5]=tmp[9]; s[6]=tmp[14]; s[7]=tmp[3];
                s[8]=tmp[8]; s[9]=tmp[13]; s[10]=tmp[2]; s[11]=tmp[7];
                s[12]=tmp[12]; s[13]=tmp[1]; s[14]=tmp[6]; s[15]=tmp[11];
                if (r < 14) {
                    for (let c = 0; c < 16; c += 4) {
                        const a0=s[c], a1=s[c+1], a2=s[c+2], a3=s[c+3];
                        const t = a0 ^ a1 ^ a2 ^ a3;
                        s[c]^=t^xt(a0^a1); s[c+1]^=t^xt(a1^a2); s[c+2]^=t^xt(a2^a3); s[c+3]^=t^xt(a3^a0);
                    }
                }
                const roff = r * 16;
                for (let i = 0; i < 16; i++) s[i] ^= rk[roff + i];
            }
            return s;
        };

        const gmul = (x, y) => {
            const z = new Uint8Array(16), v = new Uint8Array(y);
            for (let i = 0; i < 16; i++) {
                const xi = x[i];
                for (let bit = 7; bit >= 0; bit--) {
                    if ((xi >>> bit) & 1) for (let k = 0; k < 16; k++) z[k] ^= v[k];
                    const lsb = v[15] & 1;
                    for (let k = 15; k > 0; k--) v[k] = (v[k] >>> 1) | ((v[k - 1] & 1) << 7);
                    v[0] >>>= 1;
                    if (lsb) v[0] ^= 0xe1;
                }
            }
            return z;
        };

        const cLen = ciphertextWithTag.length - 16;
        const ct = ciphertextWithTag.subarray(0, cLen);
        const tag = ciphertextWithTag.subarray(cLen);
        const H = encBlock(new Uint8Array(16));
        const j0 = new Uint8Array(16);
        j0.set(iv12, 0); j0[15] = 1;

        let y = new Uint8Array(16);
        const blk = new Uint8Array(16);
        for (let off = 0; off < cLen; off += 16) {
            blk.fill(0);
            blk.set(ct.subarray(off, Math.min(off + 16, cLen)));
            for (let k = 0; k < 16; k++) y[k] ^= blk[k];
            y = gmul(y, H);
        }
        const lenBlk = new Uint8Array(16);
        const ldv = new DataView(lenBlk.buffer);
        ldv.setUint32(8, Math.floor((cLen * 8) / 0x100000000), false);
        ldv.setUint32(12, (cLen * 8) >>> 0, false);
        for (let k = 0; k < 16; k++) y[k] ^= lenBlk[k];
        y = gmul(y, H);

        const s0 = encBlock(j0);
        let diff = 0;
        for (let k = 0; k < 16; k++) diff |= (y[k] ^ s0[k]) ^ tag[k];
        if (diff !== 0) throw new Error('AES-GCM Auth Failed');

        const pt = new Uint8Array(cLen);
        const ctr = new Uint8Array(j0);
        const cdv = new DataView(ctr.buffer);
        let counterVal = 1;
        for (let off = 0; off < cLen; off += 16) {
            counterVal = (counterVal + 1) >>> 0;
            cdv.setUint32(12, counterVal, false);
            const ks = encBlock(ctr);
            const chunk = Math.min(16, cLen - off);
            for (let k = 0; k < chunk; k++) pt[off + k] = ct[off + k] ^ ks[k];
        }
        return pt;
    }

    function uint8ArrayToBase64(bytes) {
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return window.btoa(binary);
    }

    async function encryptVaultWithWebCrypto(piiMapObj, passphrase) {
        if (!passphrase || !window.crypto || !window.crypto.subtle) return activeEncryptedVault;
        try {
            const enc = new TextEncoder();
            const salt = window.crypto.getRandomValues(new Uint8Array(16));
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const iterations = 150000;
            const keyMaterial = await window.crypto.subtle.importKey(
                'raw',
                enc.encode(passphrase),
                { name: 'PBKDF2' },
                false,
                ['deriveKey']
            );
            const aesKey = await window.crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt']
            );
            const plainBytes = enc.encode(JSON.stringify(piiMapObj));
            const cipherBuf = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                aesKey,
                plainBytes
            );
            return {
                kdf: 'PBKDF2-HMAC-SHA256',
                cipher: 'AES-256-GCM',
                iterations,
                salt: uint8ArrayToBase64(salt),
                iv: uint8ArrayToBase64(iv),
                ciphertext: uint8ArrayToBase64(new Uint8Array(cipherBuf))
            };
        } catch (_) {
            return activeEncryptedVault;
        }
    }

    async function decryptVaultWithWebCrypto(vaultObj, passphrase) {
        const enc = new TextEncoder();
        const salt = base64ToUint8Array(vaultObj.salt);
        const iv = base64ToUint8Array(vaultObj.iv);
        const ciphertext = base64ToUint8Array(vaultObj.ciphertext);
        const iterations = Number(vaultObj.iterations || 150000);

        if (window.crypto && window.crypto.subtle) {
            const keyMaterial = await window.crypto.subtle.importKey(
                'raw',
                enc.encode(passphrase),
                { name: 'PBKDF2' },
                false,
                ['deriveKey']
            );
            const aesKey = await window.crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['decrypt']
            );
            const decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                aesKey,
                ciphertext
            );
            return JSON.parse(new TextDecoder('utf-8').decode(decryptedBuffer));
        }

        // 本機 file:// 離線開啟時自動切換至純 JS AES-256-GCM 引擎
        await new Promise(resolve => setTimeout(resolve, 30));
        const key32 = purePbkdf2Sha256(enc.encode(passphrase), salt, iterations, 32);
        const plainBytes = aes256GcmPureDecrypt(key32, iv, ciphertext);
        return JSON.parse(new TextDecoder('utf-8').decode(plainBytes));
    }

    function syncEffectiveRecords() {
        allRecords = basePublicRecords.map(pubRec => {
            const idKey = String(pubRec["編號"] || pubRec["識別號"] || '');
            if (isAdminUnlocked) {
                if (sessionFullRecordsMap[idKey]) {
                    return { ...pubRec, ...sessionFullRecordsMap[idKey] };
                }
                if (decryptedPiiMap && decryptedPiiMap[idKey]) {
                    return { ...pubRec, ...decryptedPiiMap[idKey] };
                }
            }
            return deidentifyRecord(pubRec);
        });
    }

    function updateSecurityUI() {
        const btnSec = document.getElementById('btn-security-center');
        const btnLabel = document.getElementById('security-btn-label');
        const btnIcon = document.getElementById('security-btn-icon');
        const banner = document.getElementById('privacy-status-banner');
        const bannerMsg = document.getElementById('privacy-banner-msg');
        const bannerBtn = document.getElementById('btn-banner-security-toggle');
        const tableBadge = document.getElementById('table-privacy-badge');
        const unlockPanel = document.getElementById('security-unlock-panel');
        const unlockedPanel = document.getElementById('security-unlocked-panel');

        const mm = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
        const ss = String(remainingSeconds % 60).padStart(2, '0');

        if (isAdminUnlocked) {
            btnSec.classList.add('unlocked');
            btnIcon.className = 'fa-solid fa-unlock-keyhole';
            btnLabel.textContent = `已解鎖 (${mm}:${ss})`;

            banner.classList.remove('locked');
            banner.classList.add('unlocked');
            bannerMsg.innerHTML = `<strong>管理員授權檢視模式已啟用：</strong>完整學生姓名、學號、母校與佐證已於記憶體內解密。系統將於閒置 <strong>${mm}:${ss}</strong> 後自動上鎖並銷毀記憶體金鑰。`;
            bannerBtn.innerHTML = `<i class="fa-solid fa-lock"></i> 立即上鎖`;

            if (tableBadge) {
                tableBadge.className = 'badge badge-warning';
                tableBadge.innerHTML = '<i class="fa-solid fa-unlock"></i> 管理員授權檢視中 (完整個資)';
            }
            if (unlockPanel) unlockPanel.style.display = 'none';
            if (unlockedPanel) unlockedPanel.style.display = 'block';
        } else {
            btnSec.classList.remove('unlocked');
            btnIcon.className = 'fa-solid fa-shield-halved';
            btnLabel.textContent = '個資保護中 (管理員解鎖)';

            banner.classList.remove('unlocked');
            banner.classList.add('locked');
            bannerMsg.innerHTML = `<strong>GitHub 掛網個資保密防護已啟用：</strong>公開瀏覽預設依《個人資料保護法》執行去識別化遮罩（姓名、學號、班級、原畢業學校與雲端私密佐證均經 <strong>AES-256-GCM</strong> 加密保護，前端原始碼零明文個資）。`;
            bannerBtn.innerHTML = `<i class="fa-solid fa-key"></i> 管理員授權解鎖`;

            if (tableBadge) {
                tableBadge.className = 'badge badge-teal';
                tableBadge.innerHTML = '<i class="fa-solid fa-shield-halved"></i> 個資去識別化保護中';
            }
            if (unlockPanel) unlockPanel.style.display = 'block';
            if (unlockedPanel) unlockedPanel.style.display = 'none';
        }
    }

    function resetIdleTimer() {
        if (!isAdminUnlocked) return;
        remainingSeconds = AUTO_LOCK_SECONDS;
    }

    function startAutoLockCountdown() {
        if (countdownTimerId) clearInterval(countdownTimerId);
        remainingSeconds = AUTO_LOCK_SECONDS;
        countdownTimerId = setInterval(() => {
            if (!isAdminUnlocked) {
                clearInterval(countdownTimerId);
                return;
            }
            remainingSeconds--;
            if (remainingSeconds <= 0) {
                lockAdminVault(true);
            } else {
                updateSecurityUI();
            }
        }, 1000);
    }

    async function unlockAdminVault() {
        const msgEl = document.getElementById('security-auth-msg');
        const pwInput = document.getElementById('admin-passphrase-input');
        const now = Date.now();

        if (now < lockUntilTimestamp) {
            const waitSec = Math.ceil((lockUntilTimestamp - now) / 1000);
            msgEl.style.color = '#DC2626';
            msgEl.textContent = `密碼錯誤次數過多，防暴力破解保護啟動中，請於 ${waitSec} 秒後再試。`;
            return;
        }

        const passphrase = pwInput.value;
        if (!passphrase) {
            msgEl.style.color = '#DC2626';
            msgEl.textContent = '請輸入管理員通行密碼！';
            return;
        }

        msgEl.style.color = '#2563EB';
        msgEl.textContent = '正在執行 PBKDF2-SHA256 金鑰衍生與 AES-256-GCM 驗證解密...';

        try {
            const vaultSource = (activeEncryptedVault && activeEncryptedVault.ciphertext)
                ? activeEncryptedVault
                : window.ENCRYPTED_PII_VAULT;
            if (vaultSource && vaultSource.ciphertext) {
                decryptedPiiMap = await decryptVaultWithWebCrypto(vaultSource, passphrase);
            } else {
                // 若為純公開模式 (--public-only) 則嘗試向本機 API 驗證
                const resp = await fetch('/api/admin/unlock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ passphrase })
                });
                if (!resp.ok) throw new Error('驗證失敗或此公開站台未封裝加密個資保險箱');
                const data = await resp.json();
                adminApiToken = data.token;
            }

            // 同步嘗試取得本機伺服器授權 Token (若本機 API 伺服器啟動中)
            try {
                const resp = await fetch('/api/admin/unlock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ passphrase })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    adminApiToken = data.token;
                }
            } catch (_) {
                // 靜態 GitHub Pages 環境無後端 API，忽略即可
            }

            isAdminUnlocked = true;
            activeSessionPassphrase = passphrase;
            failedUnlockCount = 0;
            pwInput.value = '';
            msgEl.style.color = '#059669';
            msgEl.textContent = '解密驗證成功！已載入完整學生資料。';

            syncEffectiveRecords();
            startAutoLockCountdown();
            updateSecurityUI();
            applyFilters(true);

            setTimeout(() => {
                document.getElementById('security-modal').classList.remove('show');
                msgEl.textContent = '';
                if (typeof pendingUnlockCallback === 'function') {
                    const cb = pendingUnlockCallback;
                    pendingUnlockCallback = null;
                    cb();
                }
            }, 450);
        } catch (err) {
            failedUnlockCount++;
            if (failedUnlockCount >= 3) {
                lockUntilTimestamp = Date.now() + Math.min(failedUnlockCount * 10000, 60000);
            }
            msgEl.style.color = '#DC2626';
            msgEl.textContent = (err && err.message && err.message.includes('WebCrypto'))
                ? err.message
                : `通行密碼錯誤，AES-256-GCM 驗證失敗！(連續失敗 ${failedUnlockCount} 次)`;
        }
    }

    async function lockAdminVault(isAuto = false) {
        if (adminApiToken) {
            try {
                await fetch('/api/admin/lock', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${adminApiToken}` }
                });
            } catch (_) {}
        }
        isAdminUnlocked = false;
        activeSessionPassphrase = null;
        decryptedPiiMap = null;
        adminApiToken = null;
        pendingUnlockCallback = null;
        if (countdownTimerId) clearInterval(countdownTimerId);
        remainingSeconds = 0;

        syncEffectiveRecords();
        updateSecurityUI();
        applyFilters(true);

        if (isAuto) {
            alert('因閒置超過 10 分鐘，系統已自動清除記憶體解密金鑰並恢復學生個資遮罩保護。');
        }
    }

    function requireAdminUnlock(actionCallback, reasonText) {
        if (isAdminUnlocked) {
            resetIdleTimer();
            actionCallback();
            return;
        }
        pendingUnlockCallback = actionCallback;
        const msgEl = document.getElementById('security-auth-msg');
        msgEl.style.color = '#D97706';
        msgEl.textContent = reasonText || '此功能涉及完整學生個資或系統資料變更，請先完成管理員解鎖。';
        document.getElementById('security-modal').classList.add('show');
        const pwInput = document.getElementById('admin-passphrase-input');
        if (pwInput) pwInput.focus();
    }

    function authHeaders(extra = {}) {
        const h = { ...extra };
        if (adminApiToken) h['Authorization'] = `Bearer ${adminApiToken}`;
        return h;
    }

    // 學年度正規化比對函式
    function matchYear(recordYear, targetYear) {
        if (!targetYear) return true;
        if (!recordYear) return false;
        const rY = String(recordYear).replace(/學年度/g, '').trim();
        const tY = String(targetYear).replace(/學年度/g, '').trim();
        return rY === tY;
    }

    // =========================================================
    // 電腦硬碟 / 雲端硬碟雙向儲存與開啟自動載入引擎 (IndexedDB + FileSystemAccess API + Cloud URL)
    // =========================================================
    function buildFullPiiMapForEncryption() {
        const mergedMap = { ...(decryptedPiiMap || {}) };
        Object.entries(sessionFullRecordsMap || {}).forEach(([k, v]) => {
            mergedMap[k] = { ...(mergedMap[k] || {}), ...v };
        });
        return mergedMap;
    }

    async function buildPortableMasterSnapshot() {
        if (isAdminUnlocked && activeSessionPassphrase) {
            const fullPii = buildFullPiiMapForEncryption();
            if (Object.keys(fullPii).length > 0) {
                activeEncryptedVault = await encryptVaultWithWebCrypto(fullPii, activeSessionPassphrase);
                decryptedPiiMap = fullPii;
            }
        }
        const nowIso = new Date().toISOString();
        return {
            schema: 'FooyinAwardsMasterSnapshot_v2',
            updated_at: nowIso,
            public_records: basePublicRecords.map(r => deidentifyRecord(normalizeAwardRecord(r, true))),
            encrypted_pii_vault: activeEncryptedVault || window.ENCRYPTED_PII_VAULT || null,
            deleted_static_keys: [...staticDeletedKeysSet],
            staging_public_records: stagingRecords.map(s => deidentifyRecord(s)),
            sources_config: sourcesConfigState,
            storage_prefs: {
                auto_cloud_url: storagePrefs.auto_cloud_url || '',
                server_storage_dir: storagePrefs.server_storage_dir || '',
                auto_load_startup: storagePrefs.auto_load_startup !== false,
                bound_file_name: storagePrefs.bound_file_name || '',
                last_sync_at: nowIso
            }
        };
    }

    async function saveMasterDatabaseSnapshot(writeToBoundFile = true) {
        const snap = await buildPortableMasterSnapshot();
        storagePrefs.last_sync_at = snap.updated_at;
        await idbSet('master_snapshot', snap);
        await idbSet('user_settings', snap.storage_prefs);
        await idbSet('staging_queue', snap.staging_public_records);

        if (writeToBoundFile && boundFileHandle) {
            try {
                const perm = boundFileHandle.queryPermission
                    ? await boundFileHandle.queryPermission({ mode: 'readwrite' })
                    : 'granted';
                if (perm === 'granted') {
                    const writable = await boundFileHandle.createWritable();
                    await writable.write(JSON.stringify(snap, null, 2));
                    await writable.close();
                    storagePrefs.bound_file_name = boundFileHandle.name || storagePrefs.bound_file_name;
                    await idbSet('user_settings', storagePrefs);
                }
            } catch (err) {
                console.warn('寫入電腦/雲端綁定儲存檔略過:', err);
            }
        }
        updateStorageUI();
        return snap;
    }

    async function saveStagingQueueOnly() {
        await idbSet('staging_queue', stagingRecords.map(s => deidentifyRecord(s)));
        updateStagingBadges();
    }

    function applyMasterSnapshotObject(snap, shouldOverwriteStaging = true) {
        if (!snap || typeof snap !== 'object') return false;
        if (Array.isArray(snap.deleted_static_keys)) {
            snap.deleted_static_keys.forEach(k => staticDeletedKeysSet.add(String(k)));
            saveStaticDeletedSet();
        }
        if (snap.encrypted_pii_vault && snap.encrypted_pii_vault.ciphertext) {
            activeEncryptedVault = snap.encrypted_pii_vault;
        }
        if (snap.sources_config && snap.sources_config.school_public_sources) {
            sourcesConfigState = snap.sources_config;
        }
        if (snap.storage_prefs && typeof snap.storage_prefs === 'object') {
            storagePrefs = {
                ...storagePrefs,
                ...snap.storage_prefs,
                bound_file_name: boundFileHandle ? (boundFileHandle.name || snap.storage_prefs.bound_file_name || '') : (snap.storage_prefs.bound_file_name || '')
            };
        }
        if (Array.isArray(snap.public_records) && snap.public_records.length > 0) {
            basePublicRecords = snap.public_records
                .map(r => deidentifyRecord(applyStaticEditedPatch(normalizeAwardRecord(r, true))))
                .filter(r => !isStaticRecordDeleted(r));
        }
        if (shouldOverwriteStaging && Array.isArray(snap.staging_public_records)) {
            stagingRecords = snap.staging_public_records;
            selectedStagingUids = new Set(stagingRecords.map(s => s._stagingUid).filter(Boolean));
        }
        syncEffectiveRecords();
        updateStagingBadges();
        updateStorageUI();
        return true;
    }

    async function readAndApplyFromFileHandle(handle, requestPermIfNeeded = false) {
        if (!handle) return false;
        try {
            let perm = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'granted';
            if (perm !== 'granted' && requestPermIfNeeded && handle.requestPermission) {
                perm = await handle.requestPermission({ mode: 'readwrite' });
            }
            if (perm !== 'granted') {
                const readPerm = handle.queryPermission ? await handle.queryPermission({ mode: 'read' }) : 'prompt';
                if (readPerm !== 'granted') return 'NEEDS_PERMISSION';
            }
            const file = await handle.getFile();
            const text = await file.text();
            if (!text.trim()) {
                // 新建立之空白檔案，立即寫入當前快照初始化
                await saveMasterDatabaseSnapshot(true);
                return true;
            }
            const parsed = JSON.parse(text);
            if (parsed && parsed.schema === 'FooyinAwardsMasterSnapshot_v2') {
                applyMasterSnapshotObject(parsed, true);
                await idbSet('master_snapshot', parsed);
                return true;
            } else if (Array.isArray(parsed)) {
                // 若使用者選取一般匯出之 JSON 陣列，送入暫存區供審核或更新
                enqueueRecordsToStaging(parsed, `電腦/雲端儲存檔 (${file.name})`, false);
                return true;
            }
        } catch (err) {
            console.warn('讀取電腦/雲端儲存檔失敗:', err);
        }
        return false;
    }

    function updateStorageUI() {
        const headerLbl = document.getElementById('storage-status-label');
        const summaryEl = document.getElementById('storage-current-summary');
        const badgeEl = document.getElementById('storage-last-sync-badge');
        const stageHintEl = document.getElementById('staging-storage-target-hint');
        const autoUrlInput = document.getElementById('cfg-auto-cloud-url');
        const srvDirInput = document.getElementById('cfg-server-storage-dir');
        const autoLoadChk = document.getElementById('cfg-auto-load-startup');

        const fName = (boundFileHandle && boundFileHandle.name) || storagePrefs.bound_file_name || '';
        const syncTimeTxt = storagePrefs.last_sync_at
            ? new Date(storagePrefs.last_sync_at).toLocaleString('zh-TW', { hour12: false })
            : '尚未變更';

        if (headerLbl) {
            headerLbl.textContent = fName ? `已連結: ${fName}` : '儲存位置與自動載入';
        }
        if (summaryEl) {
            summaryEl.innerHTML = fName
                ? `已綁定電腦／雲端硬碟同步檔案：<strong>${escapeHtml(fName)}</strong>（與瀏覽器永久庫雙向自動同步，共 <strong>${basePublicRecords.length}</strong> 筆正式紀錄）。`
                : `瀏覽器永久資料庫 (IndexedDB) 自動記憶已啟用（共 <strong>${basePublicRecords.length}</strong> 筆正式紀錄）；您可於下方綁定電腦硬碟或 Google 雲端硬碟資料夾檔案。`;
        }
        if (badgeEl) {
            badgeEl.textContent = fName ? `已綁定檔案｜更新: ${syncTimeTxt}` : `自動記憶中｜${syncTimeTxt}`;
        }
        if (stageHintEl) {
            stageHintEl.innerHTML = `<i class="fa-solid fa-hard-drive"></i> 確認後寫入位置：${fName ? escapeHtml(fName) + ' ＋ 瀏覽器永久庫' : '瀏覽器永久庫（可點上方設定電腦/雲端硬碟檔案）'}`;
        }
        if (autoUrlInput && document.activeElement !== autoUrlInput) autoUrlInput.value = storagePrefs.auto_cloud_url || '';
        if (srvDirInput && document.activeElement !== srvDirInput) srvDirInput.value = storagePrefs.server_storage_dir || '';
        if (autoLoadChk) autoLoadChk.checked = storagePrefs.auto_load_startup !== false;
    }

    async function handleBindNewStorageFile() {
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: '輔英獲獎正式資料庫_自動同步.json',
                    types: [{ description: '輔英獲獎系統加密同步資料庫 (.json)', accept: { 'application/json': ['.json'] } }]
                });
                boundFileHandle = handle;
                storagePrefs.bound_file_name = handle.name || '輔英獲獎正式資料庫_自動同步.json';
                await idbSet('bound_fs_handle', handle);
                await saveMasterDatabaseSnapshot(true);
                const banner = document.getElementById('storage-reconnect-banner');
                if (banner) banner.style.display = 'none';
                showToast(`已設定儲存位置為「${storagePrefs.bound_file_name}」，後續將自動同步寫入與載入！`);
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return;
            }
        }
        handleDownloadSyncBackup();
        showToast('此瀏覽器不支援直接掛載硬碟代碼，已為您下載同步備份檔並啟用瀏覽器 IndexedDB 自動保存！');
    }

    async function handleBindExistingStorageFile() {
        if (window.showOpenFilePicker) {
            try {
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{ description: '輔英獲獎系統同步資料庫 (.json)', accept: { 'application/json': ['.json'] } }]
                });
                if (!handle) return;
                boundFileHandle = handle;
                storagePrefs.bound_file_name = handle.name || '';
                await idbSet('bound_fs_handle', handle);
                const ok = await readAndApplyFromFileHandle(handle, true);
                if (ok === true) {
                    const banner = document.getElementById('storage-reconnect-banner');
                    if (banner) banner.style.display = 'none';
                    applyFilters(true);
                    showToast(`已成功綁定並從「${storagePrefs.bound_file_name}」載入最新正式資料庫！`);
                }
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return;
            }
        }
        const fbInput = document.getElementById('fallback-load-sync-file');
        if (fbInput) fbInput.click();
    }

    async function handleDownloadSyncBackup() {
        const snap = await saveMasterDatabaseSnapshot(false);
        const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = storagePrefs.bound_file_name || '輔英獲獎正式資料庫_自動同步.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    async function handleSaveStorageSettings() {
        const autoUrlEl = document.getElementById('cfg-auto-cloud-url');
        const srvDirEl = document.getElementById('cfg-server-storage-dir');
        const autoLoadEl = document.getElementById('cfg-auto-load-startup');

        storagePrefs.auto_cloud_url = autoUrlEl ? autoUrlEl.value.trim() : '';
        storagePrefs.server_storage_dir = srvDirEl ? srvDirEl.value.trim() : '';
        storagePrefs.auto_load_startup = autoLoadEl ? Boolean(autoLoadEl.checked) : true;

        if (storagePrefs.server_storage_dir) {
            try {
                await fetch('/api/storage-config', {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        custom_storage_dir: storagePrefs.server_storage_dir,
                        auto_load_on_startup: storagePrefs.auto_load_startup
                    })
                });
            } catch (_) {}
        }

        await saveMasterDatabaseSnapshot(true);
        if (storagePrefs.auto_cloud_url && /^https?:\/\//i.test(storagePrefs.auto_cloud_url)) {
            await autoCheckCloudUrlSource(storagePrefs.auto_cloud_url, true);
        }
        document.getElementById('storage-settings-modal').classList.remove('show');
        showToast('已儲存電腦/雲端儲存與自動載入設定！下次開啟將自動套用。');
    }

    async function autoCheckCloudUrlSource(cloudUrl, notifyToast = false) {
        if (!cloudUrl || !/^https?:\/\//i.test(cloudUrl)) return;
        try {
            const resp = await fetch(cloudUrl);
            if (!resp.ok) return;
            const text = await resp.text();
            const trimmed = text.trim();
            if (trimmed.startsWith('{')) {
                const parsed = JSON.parse(trimmed);
                if (parsed && parsed.schema === 'FooyinAwardsMasterSnapshot_v2') {
                    applyMasterSnapshotObject(parsed, false);
                    applyFilters(true);
                    if (notifyToast) showToast('已成功從雲端同步連結載入最新正式資料庫！');
                    return;
                }
            }
            const rows = parseCSVorJSON(text, '雲端硬碟自動載入');
            if (rows.length > 0) {
                const res = enqueueRecordsToStaging(rows, '雲端硬碟連結自動掃描', false);
                if (res.added > 0 && notifyToast) {
                    showToast(`從雲端連結偵測到 ${res.added} 筆新/異動資料，已送入「暫存審核區」！`);
                }
            }
        } catch (_) {}
    }

    // 初始化系統
    initSystem();

    async function initSystem() {
        setupEventListeners();
        await fetchAwardsData();
        updateSecurityUI();
        updateStagingBadges();
        updateStorageUI();
        applyFilters();
    }

    async function fetchAwardsData() {
        // 1. 先還原使用者上次儲存的設定與暫存審核區
        const savedSettings = await idbGet('user_settings');
        if (savedSettings && typeof savedSettings === 'object') {
            storagePrefs = { ...storagePrefs, ...savedSettings };
        }
        const savedStaging = await idbGet('staging_queue');
        if (Array.isArray(savedStaging)) {
            stagingRecords = savedStaging;
            selectedStagingUids = new Set(stagingRecords.map(s => s._stagingUid).filter(Boolean));
        }

        // 2. 若本機 Python API 伺服器啟動中，優先連線取得最新庫
        try {
            const resp = await fetch('/api/awards', { headers: authHeaders() });
            if (resp.ok) {
                const data = await resp.json();
                if (Array.isArray(data) && data.length > 0) {
                    basePublicRecords = data.map(r => deidentifyRecord(normalizeAwardRecord(r, true)));
                    if (isAdminUnlocked) {
                        data.forEach(r => {
                            const idKey = String(r["編號"] || r["識別號"] || '');
                            if (idKey && !String(r["獲獎學生"] || '').includes('○')) {
                                sessionFullRecordsMap[idKey] = {
                                    "獲獎學生": r["獲獎學生"],
                                    "學生學號": r["學生學號"],
                                    "學制班級": r["學制班級"],
                                    "原畢業學校": r["原畢業學校"],
                                    "佐證連結": r["佐證連結"]
                                };
                            }
                        });
                    }
                    syncEffectiveRecords();
                    filteredRecords = [...allRecords];
                    return;
                }
            }
        } catch (_) {
            // GitHub Pages 靜態模式，使用自動持久化引擎載入
        }

        // 3. 預設基準庫
        if (window.INITIAL_AWARDS_DATA && window.INITIAL_AWARDS_DATA.length > 0) {
            basePublicRecords = window.INITIAL_AWARDS_DATA
                .map(r => deidentifyRecord(applyStaticEditedPatch(normalizeAwardRecord(r))))
                .filter(r => !isStaticRecordDeleted(r));
        }

        // 4. 若開啟自動載入，自動從瀏覽器 IndexedDB 永久庫、綁定之電腦/雲端硬碟檔案及雲端連結載入最新資料
        if (storagePrefs.auto_load_startup !== false) {
            const savedSnap = await idbGet('master_snapshot');
            if (savedSnap && savedSnap.schema === 'FooyinAwardsMasterSnapshot_v2') {
                applyMasterSnapshotObject(savedSnap, false);
            }

            const savedHandle = await idbGet('bound_fs_handle');
            if (savedHandle) {
                boundFileHandle = savedHandle;
                storagePrefs.bound_file_name = savedHandle.name || storagePrefs.bound_file_name;
                const handleResult = await readAndApplyFromFileHandle(savedHandle, false);
                if (handleResult === 'NEEDS_PERMISSION') {
                    const banner = document.getElementById('storage-reconnect-banner');
                    const msg = document.getElementById('storage-reconnect-msg');
                    if (msg) {
                        msg.innerHTML = `已偵測到您設定的電腦／雲端硬碟儲存檔「<strong>${escapeHtml(storagePrefs.bound_file_name)}</strong>」（目前已自動載入上次快取資料；點擊右側按鈕即可連通硬碟檔案雙向同步）。`;
                    }
                    if (banner) banner.style.display = 'flex';
                }
            }

            if (storagePrefs.auto_cloud_url) {
                await autoCheckCloudUrlSource(storagePrefs.auto_cloud_url, false);
            }
        }

        syncEffectiveRecords();
        filteredRecords = [...allRecords];
    }

    function setupEventListeners() {
        // 使用者互動重置閒置計時器
        ['click', 'keydown'].forEach(evtName => {
            document.addEventListener(evtName, () => {
                if (isAdminUnlocked) resetIdleTimer();
            }, { passive: true });
        });

        // 資安中心與解鎖/上鎖按鈕
        const btnSecurityCenter = document.getElementById('btn-security-center');
        if (btnSecurityCenter) {
            btnSecurityCenter.addEventListener('click', () => {
                pendingUnlockCallback = null;
                document.getElementById('security-auth-msg').textContent = '';
                document.getElementById('security-modal').classList.add('show');
            });
        }

        const btnBannerToggle = document.getElementById('btn-banner-security-toggle');
        if (btnBannerToggle) {
            btnBannerToggle.addEventListener('click', () => {
                if (isAdminUnlocked) {
                    lockAdminVault(false);
                } else {
                    pendingUnlockCallback = null;
                    document.getElementById('security-auth-msg').textContent = '';
                    document.getElementById('security-modal').classList.add('show');
                    document.getElementById('admin-passphrase-input').focus();
                }
            });
        }

        document.getElementById('btn-confirm-unlock').addEventListener('click', unlockAdminVault);
        const btnToggleEye = document.getElementById('btn-toggle-pw-eye');
        if (btnToggleEye) {
            btnToggleEye.addEventListener('click', () => {
                const pwEl = document.getElementById('admin-passphrase-input');
                const isPw = pwEl.type === 'password';
                pwEl.type = isPw ? 'text' : 'password';
                btnToggleEye.innerHTML = isPw ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
            });
        }
        document.getElementById('admin-passphrase-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                unlockAdminVault();
            }
        });
        document.getElementById('btn-lock-now').addEventListener('click', () => {
            lockAdminVault(false);
            document.getElementById('security-modal').classList.remove('show');
        });
        document.querySelectorAll('.modal').forEach(modalEl => {
            modalEl.addEventListener('click', (e) => {
                if (e.target === modalEl) modalEl.classList.remove('show');
            });
        });

        // 學院-系所連動選單
        filterCollege.addEventListener('change', () => {
            const college = filterCollege.value;
            filterDept.innerHTML = '<option value="">全部系所</option>';
            if (college && window.FOOYIN_COLLEGES_MAP[college]) {
                window.FOOYIN_COLLEGES_MAP[college].forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d;
                    opt.textContent = d;
                    filterDept.appendChild(opt);
                });
            }
            applyFilters();
        });

        // 篩選變更事件
        searchInput.addEventListener('input', applyFilters);
        filterYear.addEventListener('change', applyFilters);
        if (filterSemester) filterSemester.addEventListener('change', applyFilters);
        filterDept.addEventListener('change', applyFilters);
        filterLevel.addEventListener('change', applyFilters);
        filterStatus.addEventListener('change', applyFilters);

        btnResetFilter.addEventListener('click', () => {
            searchInput.value = '';
            filterYear.value = '';
            if (filterSemester) filterSemester.value = '';
            filterCollege.value = '';
            filterDept.innerHTML = '<option value="">全部系所</option>';
            filterLevel.value = '';
            filterStatus.value = '';
            applyFilters();
        });

        // 新增紀錄表單：輸入資料來源或會議記錄時間時自動校正學年度與學期
        const addSourceInput = document.getElementById('add-data-source');
        const addMeetingDateInput = document.getElementById('add-meeting-date');
        const syncAddFormYearTerm = () => {
            const srcVal = addSourceInput ? addSourceInput.value : '';
            const meetVal = addMeetingDateInput ? addMeetingDateInput.value : '';
            const fromSrc = parseSourceToYearSemester(srcVal);
            if (fromSrc.year && fromSrc.term) {
                document.getElementById('add-year').value = fromSrc.year;
                document.getElementById('add-term').value = fromSrc.term;
                return;
            }
            const fromMeet = parseDateToYearSemester(meetVal);
            if (fromMeet.year && fromMeet.term) {
                const yrSelect = document.getElementById('add-year');
                if ([...yrSelect.options].some(o => o.value === fromMeet.year)) {
                    yrSelect.value = fromMeet.year;
                }
                document.getElementById('add-term').value = fromMeet.term;
            }
        };
        if (addSourceInput) addSourceInput.addEventListener('input', syncAddFormYearTerm);
        if (addMeetingDateInput) addMeetingDateInput.addEventListener('change', syncAddFormYearTerm);

        // 匯出選單切換
        const btnExport = document.getElementById('btn-export');
        const exportMenu = document.getElementById('export-menu');
        btnExport.addEventListener('click', (e) => {
            e.stopPropagation();
            exportMenu.classList.toggle('show');
        });
        document.addEventListener('click', () => exportMenu.classList.remove('show'));

        const openYearExpBtn = document.getElementById('open-year-export-modal');
        if (openYearExpBtn) {
            openYearExpBtn.addEventListener('click', (e) => {
                e.preventDefault();
                openExportOptionsModal('template-xlsx');
            });
        }
        document.getElementById('export-112-114-excel').addEventListener('click', (e) => {
            e.preventDefault();
            openExportOptionsModal('template-xlsx');
        });
        document.getElementById('export-112-114-csv').addEventListener('click', (e) => {
            e.preventDefault();
            openExportOptionsModal('template-csv');
        });
        const dlTemplateMenuBtn = document.getElementById('download-template-file');
        if (dlTemplateMenuBtn) {
            dlTemplateMenuBtn.addEventListener('click', (e) => {
                e.preventDefault();
                openExportOptionsModal('blank-template-xlsx');
            });
        }
        const exportPubExcelBtn = document.getElementById('export-public-excel');
        if (exportPubExcelBtn) {
            exportPubExcelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                exportDataToExcel("輔英科技大學_獲獎紀錄公開去識別化清冊.xlsx", true);
            });
        }
        document.getElementById('export-public-csv').addEventListener('click', (e) => {
            e.preventDefault();
            exportDataToCSV("輔英科技大學_獲獎紀錄公開去識別化清冊.csv", true);
        });
        const exportFullExcelBtn = document.getElementById('export-full-excel');
        if (exportFullExcelBtn) {
            exportFullExcelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                requireAdminUnlock(() => {
                    exportDataToExcel("輔英科技大學_獲獎紀錄完整管理清冊.xlsx", false);
                }, '匯出含完整學生姓名與學號之管理清冊需先驗證管理員密碼（若僅需公開資料請選擇「匯出去識別化公開清冊」）。');
            });
        }
        document.getElementById('export-csv').addEventListener('click', (e) => {
            e.preventDefault();
            requireAdminUnlock(() => {
                exportDataToCSV("輔英科技大學_獲獎紀錄完整管理清冊.csv", false);
            }, '匯出含完整學生姓名與學號之管理清冊需先驗證管理員密碼（若僅需公開資料請選擇「匯出去識別化公開清冊」）。');
        });
        document.getElementById('export-json').addEventListener('click', (e) => {
            e.preventDefault();
            if (isAdminUnlocked) {
                exportDataToJSON("fooyin_awards_admin_export.json", false);
            } else {
                exportDataToJSON("fooyin_awards_public_masked.json", true);
            }
        });

        // 匯入視窗內建範例模版下載按鈕（與匯出欄位 100% 相同）
        const btnDlFullTpl = document.getElementById('btn-dl-full-template');
        if (btnDlFullTpl) btnDlFullTpl.addEventListener('click', () => downloadSampleImportTemplate(true));
        const btnDl112Tpl = document.getElementById('btn-dl-112-template');
        if (btnDl112Tpl) btnDl112Tpl.addEventListener('click', () => downloadSampleImportTemplate(false));

        // 彈窗關閉按鈕
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
            });
        });

        // 三大來源 LOOK 檢視與每週自動更新中心按鈕
        document.getElementById('btn-weekly-update').addEventListener('click', openSourcesLookupModal);
        const btnRunScanNow = document.getElementById('btn-run-lookup-scan-now');
        if (btnRunScanNow) btnRunScanNow.addEventListener('click', triggerWeeklyUpdate);
        const lookupFolderInput = document.getElementById('lookup-drive-folder-input');
        if (lookupFolderInput) {
            lookupFolderInput.addEventListener('change', async (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    await importBatchFilesFromFolder(e.target.files, true);
                    e.target.value = '';
                }
            });
        }
        const btnSaveGdriveCfg = document.getElementById('btn-save-gdrive-cfg');
        if (btnSaveGdriveCfg) btnSaveGdriveCfg.addEventListener('click', handleSaveGdriveConfig);
        const btnAddSchoolSrc = document.getElementById('btn-add-school-src');
        if (btnAddSchoolSrc) btnAddSchoolSrc.addEventListener('click', handleAddSchoolSource);
        const btnAddDeptSrc = document.getElementById('btn-add-dept-src');
        if (btnAddDeptSrc) btnAddDeptSrc.addEventListener('click', handleAddDeptSource);

        document.getElementById('btn-batch-notify').addEventListener('click', () => {
            requireAdminUnlock(triggerBatchNotify, '批量派發學生領獎通知信涉及個人聯絡資料，請先完成管理員解鎖。');
        });

        document.getElementById('btn-add-award').addEventListener('click', () => {
            document.getElementById('add-modal').classList.add('show');
        });

        document.getElementById('confirm-add-award').addEventListener('click', handleAddAwardRecord);

        // 暫存審核區與電腦/雲端儲存設定按鈕綁定
        const btnStagingCenter = document.getElementById('btn-staging-center');
        if (btnStagingCenter) btnStagingCenter.addEventListener('click', openStagingModal);
        const btnDiffGotoStaging = document.getElementById('btn-diff-goto-staging');
        if (btnDiffGotoStaging) {
            btnDiffGotoStaging.addEventListener('click', () => {
                document.getElementById('diff-modal').classList.remove('show');
                openStagingModal();
            });
        }
        const btnStagingOpenStorage = document.getElementById('btn-staging-open-storage');
        if (btnStagingOpenStorage) {
            btnStagingOpenStorage.addEventListener('click', () => {
                updateStorageUI();
                document.getElementById('storage-settings-modal').classList.add('show');
            });
        }
        const btnStagingSelectAll = document.getElementById('btn-staging-select-all');
        if (btnStagingSelectAll) {
            btnStagingSelectAll.addEventListener('click', () => {
                const allUids = stagingRecords.map(s => s._stagingUid).filter(Boolean);
                const allChecked = allUids.length > 0 && allUids.every(u => selectedStagingUids.has(u));
                if (allChecked) selectedStagingUids.clear();
                else allUids.forEach(u => selectedStagingUids.add(u));
                renderStagingModalData();
            });
        }
        const btnStagingRemoveSel = document.getElementById('btn-staging-remove-selected');
        if (btnStagingRemoveSel) {
            btnStagingRemoveSel.addEventListener('click', () => {
                if (selectedStagingUids.size === 0) return;
                removeStagingItems([...selectedStagingUids]);
            });
        }
        const btnStagingClearAll = document.getElementById('btn-staging-clear-all');
        if (btnStagingClearAll) {
            btnStagingClearAll.addEventListener('click', () => {
                if (!stagingRecords.length) return;
                if (confirm(`確定要清空暫存區內全部 ${stagingRecords.length} 筆待審核資料嗎？`)) {
                    removeStagingItems(stagingRecords.map(s => s._stagingUid));
                }
            });
        }
        const btnConfirmCommitStaging = document.getElementById('btn-confirm-commit-staging');
        if (btnConfirmCommitStaging) {
            btnConfirmCommitStaging.addEventListener('click', handleConfirmCommitStaging);
        }

        const btnStorageSettings = document.getElementById('btn-storage-settings');
        if (btnStorageSettings) {
            btnStorageSettings.addEventListener('click', () => {
                updateStorageUI();
                document.getElementById('storage-settings-modal').classList.add('show');
            });
        }
        const btnBindNewFile = document.getElementById('btn-bind-new-storage-file');
        if (btnBindNewFile) btnBindNewFile.addEventListener('click', handleBindNewStorageFile);
        const btnBindExistingFile = document.getElementById('btn-bind-existing-storage-file');
        if (btnBindExistingFile) btnBindExistingFile.addEventListener('click', handleBindExistingStorageFile);
        const btnSyncFileNow = document.getElementById('btn-sync-from-file-now');
        if (btnSyncFileNow) {
            btnSyncFileNow.addEventListener('click', async () => {
                if (!boundFileHandle) {
                    await handleBindExistingStorageFile();
                    return;
                }
                const ok = await readAndApplyFromFileHandle(boundFileHandle, true);
                if (ok === true) {
                    applyFilters(true);
                    showToast(`已從「${boundFileHandle.name}」同步最新資料！`);
                }
            });
        }
        const btnDownloadBackup = document.getElementById('btn-download-sync-backup');
        if (btnDownloadBackup) btnDownloadBackup.addEventListener('click', handleDownloadSyncBackup);
        const fbSyncInput = document.getElementById('fallback-load-sync-file');
        if (fbSyncInput) {
            fbSyncInput.addEventListener('change', async (e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                try {
                    const txt = await f.text();
                    const parsed = JSON.parse(txt);
                    if (parsed && parsed.schema === 'FooyinAwardsMasterSnapshot_v2') {
                        storagePrefs.bound_file_name = f.name;
                        applyMasterSnapshotObject(parsed, true);
                        await saveMasterDatabaseSnapshot(false);
                        applyFilters(true);
                        showToast(`已成功載入「${f.name}」正式資料庫快照！`);
                    } else {
                        const rows = parseCSVorJSON(txt, f.name);
                        enqueueRecordsToStaging(rows, `手動載入檔案 (${f.name})`, true);
                    }
                } catch (_) {
                    alert('無法解析所選 JSON 同步檔，請確認檔案格式正確。');
                }
                e.target.value = '';
            });
        }
        const btnSaveStorageCfg = document.getElementById('btn-save-storage-settings');
        if (btnSaveStorageCfg) btnSaveStorageCfg.addEventListener('click', handleSaveStorageSettings);
        const btnReconnectFs = document.getElementById('btn-reconnect-fs-handle');
        if (btnReconnectFs) {
            btnReconnectFs.addEventListener('click', async () => {
                if (!boundFileHandle) return;
                const ok = await readAndApplyFromFileHandle(boundFileHandle, true);
                if (ok === true) {
                    const banner = document.getElementById('storage-reconnect-banner');
                    if (banner) banner.style.display = 'none';
                    applyFilters(true);
                    showToast(`已連通電腦/雲端儲存檔「${boundFileHandle.name}」並載入最新資料！`);
                }
            });
        }
        const btnResetLocalCache = document.getElementById('btn-reset-local-cache');
        if (btnResetLocalCache) {
            btnResetLocalCache.addEventListener('click', () => {
                requireAdminUnlock(async () => {
                    if (!confirm('確定要清除瀏覽器自訂修改快取並回復系統初始 509 筆基準資料嗎？（您電腦/雲端硬碟上的外部備份檔不會被刪除）')) return;
                    await idbDel('master_snapshot');
                    await idbDel('staging_queue');
                    Object.keys(staticEditedPatchesMap).forEach(k => delete staticEditedPatchesMap[k]);
                    saveStaticEditedPatches();
                    staticDeletedKeysSet.clear();
                    saveStaticDeletedSet();
                    stagingRecords = [];
                    selectedStagingUids.clear();
                    activeEncryptedVault = window.ENCRYPTED_PII_VAULT || null;
                    basePublicRecords = (window.INITIAL_AWARDS_DATA || []).map(r => deidentifyRecord(normalizeAwardRecord(r)));
                    syncEffectiveRecords();
                    updateStagingBadges();
                    updateStorageUI();
                    applyFilters();
                    document.getElementById('storage-settings-modal').classList.remove('show');
                    showToast('已回復系統初始基準資料庫！');
                }, '重置本機資料庫快取請先完成管理員解鎖。');
            });
        }

        // 自選學年度 (112~120) 匯出視窗事件綁定
        ['export-year-mode', 'export-single-year', 'export-range-start', 'export-range-end', 'export-semester-filter', 'export-format-type', 'export-opt-use-page-filter'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', updateExportOptionsUI);
        });
        const btnExecCustomExport = document.getElementById('btn-execute-custom-export');
        if (btnExecCustomExport) btnExecCustomExport.addEventListener('click', executeCustomYearExport);

        // 匯入資料視窗（直接開啟，相容公開與管理匯出檔匯入）
        document.getElementById('btn-import-award').addEventListener('click', () => {
            document.getElementById('import-status-msg').textContent = '';
            document.getElementById('import-modal').classList.add('show');
        });

        document.getElementById('confirm-import-data').addEventListener('click', handleImportData);
        document.getElementById('notify-channel-select').addEventListener('change', updateNotifyPreviewText);

        // 會議與官網公告差別比對中心 Modal 按鈕
        const btnDiffCenter = document.getElementById('btn-diff-center');
        const cardDiffKpi = document.getElementById('card-diff-kpi');
        if (btnDiffCenter) btnDiffCenter.addEventListener('click', openDiffModal);
        if (cardDiffKpi) cardDiffKpi.addEventListener('click', openDiffModal);

        // 未申請獎補助同學提醒機制 Modal 按鈕
        const btnUnappliedCenter = document.getElementById('btn-unapplied-center');
        const cardUnappliedKpi = document.getElementById('card-unapplied-kpi');
        if (btnUnappliedCenter) btnUnappliedCenter.addEventListener('click', openUnappliedModal);
        if (cardUnappliedKpi) cardUnappliedKpi.addEventListener('click', openUnappliedModal);

        const btnMergeAllDiff = document.getElementById('btn-merge-all-diff');
        if (btnMergeAllDiff) {
            btnMergeAllDiff.addEventListener('click', handleMergeAllDiff);
        }

        const chartYearFilter = document.getElementById('chart-year-filter');
        if (chartYearFilter) {
            chartYearFilter.addEventListener('change', renderCharts);
        }

        // 7 大頁籤視角切換器
        document.querySelectorAll('.view-tab').forEach(tabBtn => {
            tabBtn.addEventListener('click', (e) => {
                document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
                const btn = e.currentTarget;
                btn.classList.add('active');
                const tabKey = btn.dataset.tab;

                if (tabKey === 'diff-analysis') {
                    openDiffModal();
                } else if (tabKey === 'unapplied-reminders') {
                    openUnappliedModal();
                } else if (tabKey === 'sources-lookup') {
                    openSourcesLookupModal();
                } else if (tabKey === 'staging-area') {
                    openStagingModal();
                } else {
                    applyFilters();
                }
            });
        });

        const btnBatchUnappliedModal = document.getElementById('btn-batch-unapplied-remind-modal');
        if (btnBatchUnappliedModal) {
            btnBatchUnappliedModal.addEventListener('click', () => {
                requireAdminUnlock(triggerBatchUnappliedRemind, '發送全體未申請同學催辦通知請先完成管理員解鎖。');
            });
        }

        // 單筆與批次刪除事件綁定
        const btnToggleBatchDel = document.getElementById('btn-toggle-batch-delete');
        const btnCancelBatchDel = document.getElementById('btn-cancel-batch-delete');
        const btnBatchSelectPage = document.getElementById('btn-batch-select-page');
        const btnConfirmBatchDel = document.getElementById('btn-confirm-batch-delete');
        const btnDetailDel = document.getElementById('btn-detail-delete-record');
        const btnDetailSave = document.getElementById('btn-detail-save-record');
        const btnExecuteDel = document.getElementById('btn-execute-delete');

        if (btnToggleBatchDel) {
            btnToggleBatchDel.addEventListener('click', () => {
                requireAdminUnlock(() => {
                    isBatchDeleteMode = true;
                    selectedDeleteIds.clear();
                    updateBatchDeleteToolbar();
                    renderTable();
                }, '啟用批次刪除錯誤匯入資料模式請先完成管理員解鎖。');
            });
        }

        if (btnCancelBatchDel) {
            btnCancelBatchDel.addEventListener('click', () => {
                isBatchDeleteMode = false;
                selectedDeleteIds.clear();
                updateBatchDeleteToolbar();
                renderTable();
            });
        }

        if (btnBatchSelectPage) {
            btnBatchSelectPage.addEventListener('click', () => {
                const start = (currentPage - 1) * itemsPerPage;
                const end = Math.min(start + itemsPerPage, filteredRecords.length);
                const pageItems = filteredRecords.slice(start, end);
                const pageUids = pageItems.map(r => getRecordUid(r)).filter(Boolean);
                const allSelected = pageUids.length > 0 && pageUids.every(uid => selectedDeleteIds.has(uid));
                if (allSelected) {
                    pageUids.forEach(uid => selectedDeleteIds.delete(uid));
                } else {
                    pageUids.forEach(uid => selectedDeleteIds.add(uid));
                }
                updateBatchDeleteToolbar();
                renderTable();
            });
        }

        if (btnConfirmBatchDel) {
            btnConfirmBatchDel.addEventListener('click', () => {
                if (selectedDeleteIds.size === 0) return;
                requireAdminUnlock(() => {
                    promptDeleteRecords([...selectedDeleteIds]);
                }, '刪除獲獎紀錄涉及系統資料異動，請先完成管理員解鎖。');
            });
        }

        if (btnDetailDel) {
            btnDetailDel.addEventListener('click', () => {
                if (!activeDetailRecordId) return;
                requireAdminUnlock(() => {
                    promptDeleteRecords([activeDetailRecordId]);
                }, '刪除獲獎紀錄涉及系統資料異動，請先完成管理員解鎖。');
            });
        }

        if (btnDetailSave) {
            btnDetailSave.addEventListener('click', handleSaveDetailModal);
        }

        if (btnExecuteDel) {
            btnExecuteDel.addEventListener('click', executeConfirmedDelete);
        }

        document.addEventListener('keydown', (e) => {
            const delModal = document.getElementById('delete-confirm-modal');
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
            } else if (e.key === 'Enter' && delModal && delModal.classList.contains('show')) {
                e.preventDefault();
                executeConfirmedDelete();
            }
        });
    }

    function applyFilters(preservePage = false) {
        const kw = searchInput.value.trim().toLowerCase();
        const yr = filterYear.value;
        const sem = filterSemester ? filterSemester.value : '';
        const col = filterCollege.value;
        const dept = filterDept.value;
        const lvl = filterLevel.value;
        const st = filterStatus.value;

        const activeTabBtn = document.querySelector('.view-tab.active');
        const activeTabKey = activeTabBtn ? activeTabBtn.dataset.tab : 'all-awards';

        filteredRecords = allRecords.filter(r => {
            if (activeTabKey === 'template-112-114') {
                const rY = String(r["學年度"] || '').replace(/學年度/g, '').trim();
                if (!SUPPORTED_ACAD_YEARS.includes(rY)) return false;
            } else if (activeTabKey === 'crawled-meetings') {
                const src = String(r["資料來源"] || '');
                const isMeetingOrWeb = src.includes('會議') || src.includes('官網') || src.includes('網站') || src.includes('行政') || src.includes('校務') || src.includes('抓取');
                if (!isMeetingOrWeb) return false;
            }

            if (!matchYear(r["學年度"], yr)) return false;
            if (sem && String(r["學期"] || '').trim() !== sem) return false;
            if (col && String(r["所屬學院"] || '').trim() !== col.trim()) return false;
            if (dept && String(r["系所名稱"] || '').trim() !== dept.trim()) return false;
            if (lvl && String(r["競賽層級"] || '').trim() !== lvl.trim()) return false;
            if (st && String(r["發放與領獎狀態"] || '').trim() !== st.trim()) return false;

            if (kw) {
                const match = Object.values(r).some(val =>
                    String(val || '').toLowerCase().includes(kw)
                );
                if (!match) return false;
            }
            return true;
        });

        if (preservePage === true) {
            const maxPage = Math.max(1, Math.ceil(filteredRecords.length / itemsPerPage));
            if (currentPage > maxPage) currentPage = maxPage;
        } else {
            currentPage = 1;
        }
        renderDashboard();
    }

    function renderDashboard() {
        renderKPICards();
        renderCharts();
        renderTable();
    }

    function renderKPICards() {
        const total = filteredRecords.length;
        const intlCount = filteredRecords.filter(r => r["競賽層級"] === "國際競賽").length;
        const domesticCount = filteredRecords.filter(r => r["競賽層級"] === "國內競賽" || r["競賽層級"] === "專業證照").length;

        let totalScholarship = 0;
        let pendingNotifyCount = 0;

        filteredRecords.forEach(r => {
            totalScholarship += Number(r["獎助金金額"] || 0);
            if (["待通知", "未申請", "逾期未申請"].includes(r["發放與領獎狀態"])) pendingNotifyCount++;
        });

        const setTxt = (id, txt) => {
            const el = document.getElementById(id);
            if (el) el.textContent = txt;
        };

        setTxt('kpi-total-count', total.toLocaleString());
        setTxt('kpi-intl-count', intlCount.toLocaleString());
        const ratio = total > 0 ? ((intlCount / total) * 100).toFixed(1) : 0;
        setTxt('kpi-intl-ratio', `佔全校 ${ratio}%`);

        setTxt('kpi-domestic-count', domesticCount.toLocaleString());
        setTxt('kpi-scholarship-total', `$${totalScholarship.toLocaleString()}`);
        setTxt('kpi-unapplied-count', pendingNotifyCount.toLocaleString());
        setTxt('kpi-unapplied-sub', `未簽領與催辦筆數: ${pendingNotifyCount}`);
        setTxt('unapplied-badge-count', pendingNotifyCount.toLocaleString());
    }

    function renderCharts() {
        if (typeof Chart === 'undefined') return;
        try {
            const chartYearFilter = document.getElementById('chart-year-filter');
            const selectedYear = chartYearFilter ? chartYearFilter.value : '';

            const recordsToChart = selectedYear
                ? allRecords.filter(r => matchYear(r["學年度"], selectedYear))
                : filteredRecords;

            const colMap = {};
            const lvlMap = {};
            const statusMap = {};

            recordsToChart.forEach(r => {
                const col = r["所屬學院"] || "其他";
                colMap[col] = (colMap[col] || 0) + 1;

                const lvl = r["競賽層級"] || "其他";
                lvlMap[lvl] = (lvlMap[lvl] || 0) + 1;

                const st = r["發放與領獎狀態"] || "尚待核定";
                statusMap[st] = (statusMap[st] || 0) + 1;
            });

            const canvasCol = document.getElementById('collegeChart');
            if (canvasCol && canvasCol.getContext) {
                const ctxCol = canvasCol.getContext('2d');
                if (collegeChart) collegeChart.destroy();
                collegeChart = new Chart(ctxCol, {
                    type: 'bar',
                    data: {
                        labels: Object.keys(colMap),
                        datasets: [{
                            label: '獲獎數',
                            data: Object.values(colMap),
                            backgroundColor: ['#0F2C59', '#00C49F', '#2563EB', '#7C3AED', '#D97706'],
                            borderRadius: 8
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
                });
            }

            const canvasLvl = document.getElementById('levelChart');
            if (canvasLvl && canvasLvl.getContext) {
                const ctxLvl = canvasLvl.getContext('2d');
                if (levelChart) levelChart.destroy();
                levelChart = new Chart(ctxLvl, {
                    type: 'doughnut',
                    data: {
                        labels: Object.keys(lvlMap),
                        datasets: [{
                            data: Object.values(lvlMap),
                            backgroundColor: ['#7C3AED', '#2563EB', '#10B981', '#F59E0B', '#EF4444']
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
                });
            }

            const canvasSt = document.getElementById('statusChart');
            if (canvasSt && canvasSt.getContext) {
                const ctxSt = canvasSt.getContext('2d');
                if (statusChart) statusChart.destroy();
                statusChart = new Chart(ctxSt, {
                    type: 'bar',
                    data: {
                        labels: Object.keys(statusMap),
                        datasets: [{
                            label: '紀錄筆數',
                            data: Object.values(statusMap),
                            backgroundColor: ['#00C49F', '#94A3B8', '#EA580C', '#2563EB', '#7C3AED', '#10B981'],
                            borderRadius: 8
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
                });
            }
        } catch (err) {
            console.warn("圖表渲染異常:", err);
        }
    }

    function renderTable() {
        tableBody.innerHTML = '';
        const total = filteredRecords.length;
        recordCountBadge.textContent = `顯示 ${total} 筆紀錄`;

        if (total === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="24" style="text-align:center; padding: 40px 20px; color: #94A3B8;">
                        <i class="fa-solid fa-folder-open" style="font-size: 36px; color: #CBD5E1; margin-bottom: 10px; display: inline-block;"></i><br>
                        <strong style="font-size: 15px; color: #475569;">無符合條件之學生獲獎與領獎紀錄</strong><br>
                        <span style="font-size: 13px; color: #64748B; margin-top: 4px; display: inline-block;">請嘗試調整或重置搜尋關鍵字/篩選條件，或切換至「全校獲獎紀錄總覽庫」頁籤</span><br><br>
                        <button class="btn btn-primary btn-sm" id="btn-clear-search-fallback" style="padding: 6px 16px;">
                            <i class="fa-solid fa-rotate-left"></i> 一鍵重置所有篩選條件
                        </button>
                    </td>
                </tr>`;
            paginationInfo.textContent = '無資料';
            paginationControls.innerHTML = '';

            const btnClear = document.getElementById('btn-clear-search-fallback');
            if (btnClear) {
                btnClear.addEventListener('click', () => {
                    searchInput.value = '';
                    filterYear.value = '';
                    if (filterSemester) filterSemester.value = '';
                    filterCollege.value = '';
                    filterDept.innerHTML = '<option value="">全部系所</option>';
                    filterLevel.value = '';
                    filterStatus.value = '';
                    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
                    const allTab = document.querySelector('.view-tab[data-tab="all-awards"]');
                    if (allTab) allTab.classList.add('active');
                    applyFilters();
                });
            }
            return;
        }

        const start = (currentPage - 1) * itemsPerPage;
        const end = Math.min(start + itemsPerPage, total);
        const pageItems = filteredRecords.slice(start, end);

        pageItems.forEach(r => {
            const tr = document.createElement('tr');

            let statusBadgeClass = 'badge-warning';
            if (r["發放與領獎狀態"] === '尚待核定') statusBadgeClass = 'badge-teal';
            if (r["發放與領獎狀態"] === '無須發放') statusBadgeClass = 'badge-info';
            if (r["發放與領獎狀態"] === '通知已發送') statusBadgeClass = 'badge-info';
            if (r["發放與領獎狀態"] === '已線上簽領') statusBadgeClass = 'badge-purple';
            if (r["發放與領獎狀態"] === '已完成撥款') statusBadgeClass = 'badge-success';

            let levelBadgeClass = 'badge-info';
            const catLevel = r["活動類別"] || r["競賽層級"] || '全國';
            if (['國際', '國外', '大陸', '港', '澳'].some(k => catLevel.includes(k))) levelBadgeClass = 'badge-purple';
            if (catLevel.includes('證照')) levelBadgeClass = 'badge-success';

            const deptCodeStr = resolveDeptCode(r["系所名稱"], r["學生所屬系科 - 系所代碼"]);
            const recId = r["識別號"] || r["編號"];
            const rawRecordNum = getRecordUid(r);

            const organizerText = r["活動主辦單位"] || '無';
            const dataSourceText = r["資料來源"] || '無';
            const startDateDisplay = r["活動起始日期"] || r["會議記錄時間"] || r["通知時間"] || '';
            const endDateDisplay = r["活動結束日期"] || '';
            const evHref = safeHref(r["佐證連結"]);
            const isProtectedEvidence = evHref === '#protected-evidence';
            const isAwarded = String(r["是否獲獎"] || '是').trim() !== '否';
            const amtNum = Number(r["獎助金金額"]) || 0;

            const isInlineEditing = String(editingQuickRowUid || '') === String(rawRecordNum);
            const curStatus = r["發放與領獎狀態"] || (isAwarded ? '尚待核定' : '無須發放');
            const statusOptions = ['尚待核定', '待通知', '通知已發送', '已線上簽領', '已完成撥款', '無須發放'];

            const amtHtml = isInlineEditing
                ? `<div class="inline-amt-wrap">
                       <span class="inline-ntd-prefix">NT$</span>
                       <input type="number" class="inline-amt-input" id="quick-amt-${escapeHtml(rawRecordNum)}" data-id="${escapeHtml(rawRecordNum)}" value="${amtNum}" min="0" step="500" placeholder="金額">
                   </div>`
                : (amtNum > 0
                    ? `<button type="button" class="quick-cell-btn has-amt btn-quick-edit-amt" data-id="${escapeHtml(rawRecordNum)}" title="點擊核定或修改獎助金額並送出"><span class="text-gold">NT$ ${amtNum.toLocaleString()}</span> <i class="fa-solid fa-pen-to-square"></i></button>`
                    : `<button type="button" class="quick-cell-btn btn-quick-edit-amt" data-id="${escapeHtml(rawRecordNum)}" title="點擊核定獎助金額並送出"><span>${isAwarded ? '尚待核定' : '無'}</span> <i class="fa-solid fa-pen-to-square"></i></button>`);

            const statusHtml = isInlineEditing
                ? `<div class="inline-status-wrap">
                       <select class="inline-status-select" id="quick-status-${escapeHtml(rawRecordNum)}" data-id="${escapeHtml(rawRecordNum)}">
                           ${statusOptions.map(stOpt => `<option value="${escapeHtml(stOpt)}" ${curStatus === stOpt ? 'selected' : ''}>${escapeHtml(stOpt)}</option>`).join('')}
                       </select>
                       <button type="button" class="btn btn-sm btn-quick-save" data-id="${escapeHtml(rawRecordNum)}" title="送出儲存獎助金額與領獎狀態">
                           <i class="fa-solid fa-check"></i> 送出
                       </button>
                       <button type="button" class="btn btn-secondary btn-sm btn-quick-cancel" data-id="${escapeHtml(rawRecordNum)}" title="取消編輯">
                           <i class="fa-solid fa-xmark"></i>
                       </button>
                   </div>`
                : `<button type="button" class="badge ${statusBadgeClass} quick-status-btn btn-quick-edit-status" data-id="${escapeHtml(rawRecordNum)}" title="點擊變更領獎與發放狀態並送出">${escapeHtml(curStatus)} <i class="fa-solid fa-caret-down"></i></button>`;

            const evidenceCellHtml = isProtectedEvidence
                ? `<button class="btn btn-secondary btn-sm btn-unlock-evidence" data-id="${escapeHtml(rawRecordNum)}" style="padding: 2px 6px; font-size: 11px;" title="雲端佐證含個資，需管理員解鎖檢視"><i class="fa-solid fa-lock"></i> 受保護</button>`
                : (evHref !== '#'
                    ? `<a href="${escapeHtml(evHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 11px;"><i class="fa-solid fa-arrow-up-right-from-square"></i> 佐證</a>`
                    : `<small class="text-muted">無</small>`);

            tr.innerHTML = `
                <td><strong>#${escapeHtml(recId)}</strong></td>
                <td>${escapeHtml(r["學年度"] || '')}</td>
                <td><strong>${escapeHtml(r["學期"] || '上')}</strong></td>
                <td><span class="badge ${levelBadgeClass}">${escapeHtml(catLevel)}</span></td>
                <td><small class="text-muted">${escapeHtml(organizerText)}</small></td>
                <td><strong>${escapeHtml(r["活動名稱"] || r["競賽或活動名稱"] || '')}</strong></td>
                <td><small>${escapeHtml(r["競賽項目"] || r["參賽項目或作品名稱"] || '')}</small></td>
                <td><small>${escapeHtml(r["個人/團體競賽"] || '個人競賽')}</small></td>
                <td>${escapeHtml(r["人數(男)"] !== undefined ? r["人數(男)"] : '0')}</td>
                <td>${escapeHtml(r["人數(女)"] !== undefined ? r["人數(女)"] : '0')}</td>
                <td><span class="badge ${isAwarded ? 'badge-success' : 'badge-warning'}">${escapeHtml(isAwarded ? '是' : '否')}</span></td>
                <td><span class="badge ${isAwarded ? levelBadgeClass : 'badge-warning'}">${escapeHtml(r["獲獎名次"] || r["榮譽獎項"] || '')}</span></td>
                <td><small>${escapeHtml(startDateDisplay)}</small></td>
                <td><small>${escapeHtml(endDateDisplay)}</small></td>
                <td><small class="text-muted">${escapeHtml(deptCodeStr)}</small></td>
                <td><small>${escapeHtml(r["競賽項目是否與就讀科系相關"] || '是')}</small></td>

                <td style="background: rgba(124, 58, 237, 0.03);"><strong>${escapeHtml(r["所屬學院"] || '')}</strong><br><small>${escapeHtml(r["系所名稱"] || '')}</small></td>
                <td style="background: rgba(124, 58, 237, 0.03);">
                    <strong>${escapeHtml(r["獲獎學生"] || '無')}</strong><br>
                    <small class="text-muted">學號: ${escapeHtml(r["學生學號"] || '無')}</small>
                </td>
                <td style="background: rgba(124, 58, 237, 0.03);"><small>${escapeHtml(r["指導老師"] || '無')}</small></td>
                <td style="background: rgba(124, 58, 237, 0.03);">${amtHtml}</td>
                <td style="background: rgba(124, 58, 237, 0.03);">${statusHtml}</td>
                <td style="background: rgba(124, 58, 237, 0.03);">${evidenceCellHtml}</td>
                <td style="background: rgba(124, 58, 237, 0.03);">
                    <div class="action-btn-row">
                        ${isBatchDeleteMode ? `
                            <label class="batch-check-label" title="勾選此筆以進行批次刪除">
                                <input type="checkbox" class="batch-del-checkbox" data-id="${escapeHtml(rawRecordNum)}" ${selectedDeleteIds.has(String(rawRecordNum)) ? 'checked' : ''}>
                            </label>
                        ` : ''}
                        <button type="button" class="btn btn-secondary btn-sm btn-view-detail" data-id="${escapeHtml(rawRecordNum)}" title="查看紀錄詳情與編輯修正">
                            <i class="fa-solid fa-pen-to-square"></i> 詳情/修正
                        </button>
                        ${isAwarded && r["發放與領獎狀態"] !== '無須發放' ? `
                            <button type="button" class="btn btn-warning btn-sm btn-send-notify" data-id="${escapeHtml(rawRecordNum)}" title="發送領獎通知 (需管理員解鎖)">
                                <i class="fa-solid fa-paper-plane"></i>
                            </button>
                        ` : ''}
                        ${isAwarded && !['已線上簽領', '已完成撥款', '無須發放'].includes(r["發放與領獎狀態"]) ? `
                            <button type="button" class="btn btn-success btn-sm btn-sign-claim" data-id="${escapeHtml(rawRecordNum)}" title="辦理線上簽領 (需管理員解鎖)">
                                <i class="fa-solid fa-signature"></i>
                            </button>
                        ` : ''}
                        <button type="button" class="btn btn-danger btn-sm btn-delete-record" data-id="${escapeHtml(rawRecordNum)}" title="直接刪除此筆錯誤匯入或重複資料 (需管理員解鎖)">
                            <i class="fa-solid fa-trash-can"></i> 刪除
                        </button>
                    </div>
                </td>
                <td style="background: rgba(16, 185, 129, 0.05);">
                    <span class="badge badge-teal">${escapeHtml(dataSourceText)}</span>
                    ${r["會議記錄時間"] ? `<br><small class="text-muted">${escapeHtml(r["會議記錄時間"])}</small>` : ''}
                </td>
            `;
            tableBody.appendChild(tr);
        });

        // 綁定列內獎助金額與領獎狀態快速編輯按鈕
        document.querySelectorAll('.btn-quick-edit-amt').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = String(btn.dataset.id || '');
                requireAdminUnlock(() => {
                    editingQuickRowUid = targetId;
                    editingQuickFocusField = 'amt';
                    renderTable();
                }, '核定或修改獎助金額涉及系統資料異動，請先完成管理員解鎖。');
            });
        });
        document.querySelectorAll('.btn-quick-edit-status').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = String(btn.dataset.id || '');
                requireAdminUnlock(() => {
                    editingQuickRowUid = targetId;
                    editingQuickFocusField = 'status';
                    renderTable();
                }, '變更領獎與發放狀態涉及系統資料異動，請先完成管理員解鎖。');
            });
        });
        document.querySelectorAll('.btn-quick-cancel').forEach(btn => {
            btn.addEventListener('click', () => {
                editingQuickRowUid = null;
                renderTable();
            });
        });
        document.querySelectorAll('.btn-quick-save').forEach(btn => {
            btn.addEventListener('click', () => {
                saveQuickRowEdit(String(btn.dataset.id || ''));
            });
        });

        if (editingQuickRowUid) {
            const amtEl = document.getElementById(`quick-amt-${editingQuickRowUid}`);
            const stEl = document.getElementById(`quick-status-${editingQuickRowUid}`);
            let statusManuallyChanged = false;
            if (stEl) {
                stEl.addEventListener('change', () => { statusManuallyChanged = true; });
                stEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); saveQuickRowEdit(editingQuickRowUid); }
                });
            }
            if (amtEl) {
                amtEl.addEventListener('input', () => {
                    const v = Number(amtEl.value || 0);
                    if (!statusManuallyChanged && stEl && v > 0 && stEl.value === '尚待核定') {
                        stEl.value = '待通知';
                    }
                });
                amtEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); saveQuickRowEdit(editingQuickRowUid); }
                });
            }
            const focusEl = editingQuickFocusField === 'status' ? stEl : amtEl;
            if (focusEl && typeof focusEl.focus === 'function') {
                focusEl.focus();
                if (focusEl === amtEl && typeof amtEl.select === 'function') amtEl.select();
            }
        }

        // 綁定操作按鈕
        document.querySelectorAll('.btn-unlock-evidence').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.id;
                requireAdminUnlock(() => openDetailModal(targetId), '雲端硬碟佐證檔案含獲獎證書與學生個人資訊，請先完成管理員解鎖。');
            });
        });
        document.querySelectorAll('.btn-view-detail').forEach(btn => {
            btn.addEventListener('click', () => openDetailModal(btn.dataset.id));
        });
        document.querySelectorAll('.btn-send-notify').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.id;
                requireAdminUnlock(() => openNotifyModal(targetId), '發送個人領獎通知信需解密學生姓名與學號，請先完成管理員解鎖。');
            });
        });
        document.querySelectorAll('.btn-sign-claim').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.id;
                requireAdminUnlock(() => handleStudentSign(targetId), '更新學生簽領狀態請先完成管理員解鎖。');
            });
        });
        document.querySelectorAll('.btn-delete-record').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.id;
                requireAdminUnlock(() => promptDeleteRecords([targetId]), '刪除錯誤匯入或重複紀錄涉及系統資料異動，請先完成管理員解鎖。');
            });
        });
        document.querySelectorAll('.batch-del-checkbox').forEach(chk => {
            chk.addEventListener('change', (e) => {
                const id = String(e.currentTarget.dataset.id || '');
                if (!id) return;
                if (e.currentTarget.checked) selectedDeleteIds.add(id);
                else selectedDeleteIds.delete(id);
                updateBatchDeleteToolbar();
            });
        });

        updateBatchDeleteToolbar();

        // 分頁控制
        const totalPages = Math.ceil(total / itemsPerPage);
        paginationInfo.textContent = `顯示 ${start + 1}-${end} 筆，共 ${total} 筆紀錄`;

        paginationControls.innerHTML = '';
        for (let p = 1; p <= totalPages; p++) {
            if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2) {
                const btn = document.createElement('button');
                btn.className = `page-btn ${p === currentPage ? 'active' : ''}`;
                btn.textContent = p;
                btn.addEventListener('click', () => {
                    currentPage = p;
                    renderTable();
                });
                paginationControls.appendChild(btn);
            }
        }
    }

    function isMaskedPiiString(val) {
        const s = String(val || '').trim();
        return s.includes('○') || s.includes('*') || s.includes('已去識別化') || s === '#protected-evidence';
    }

    async function commitRecordUpdates(recordUid, updatesObj, preserveExplicitYearTerm = true) {
        const uidStr = String(recordUid || '').trim();
        const targetPub = basePublicRecords.find(r => getRecordUid(r) === uidStr || String(r["編號"]) === uidStr);
        if (!targetPub) return null;

        const idKey = String(targetPub["編號"] || targetPub["識別號"] || uidStr);
        const existingFullPii = {
            ...(decryptedPiiMap && decryptedPiiMap[idKey] ? decryptedPiiMap[idKey] : {}),
            ...(sessionFullRecordsMap[idKey] ? sessionFullRecordsMap[idKey] : {})
        };

        const merged = { ...targetPub, ...existingFullPii };
        Object.entries(updatesObj || {}).forEach(([k, v]) => {
            if (k === '編號' || v === undefined || v === null) return;
            if (['獲獎學生', '學生學號', '學制班級', '原畢業學校', '佐證連結'].includes(k)) {
                if (isMaskedPiiString(v) && existingFullPii[k] !== undefined) {
                    merged[k] = existingFullPii[k];
                    return;
                }
            }
            merged[k] = v;
        });

        // 雙向同步別名欄位與系所代碼
        const ev = String(updatesObj["活動名稱"] !== undefined ? updatesObj["活動名稱"] : (merged["活動名稱"] || merged["競賽或活動名稱"] || '')).trim();
        merged["活動名稱"] = ev;
        merged["競賽或活動名稱"] = ev;

        const wk = String(updatesObj["競賽項目"] !== undefined ? updatesObj["競賽項目"] : (merged["競賽項目"] || merged["參賽項目或作品名稱"] || '')).trim();
        merged["競賽項目"] = wk;
        merged["參賽項目或作品名稱"] = wk;

        const rk = String(updatesObj["獲獎名次"] !== undefined ? updatesObj["獲獎名次"] : (merged["獲獎名次"] || merged["榮譽獎項"] || '')).trim();
        merged["獲獎名次"] = rk;
        merged["榮譽獎項"] = rk;

        const deptName = String(merged["系所名稱"] || '').trim();
        if (deptName && window.FOOYIN_DEPT_CODE_MAP && window.FOOYIN_DEPT_CODE_MAP[deptName]) {
            merged["學生所屬系科 - 系所代碼"] = window.FOOYIN_DEPT_CODE_MAP[deptName];
        }
        merged["獎助金金額"] = Math.max(0, Number(merged["獎助金金額"] || 0));

        const normalizedFull = normalizeAwardRecord(merged, preserveExplicitYearTerm);
        normalizedFull["編號"] = targetPub["編號"];

        sessionFullRecordsMap[idKey] = {
            "獲獎學生": normalizedFull["獲獎學生"] || '無',
            "學生學號": normalizedFull["學生學號"] || '無',
            "學制班級": normalizedFull["學制班級"] || '無',
            "原畢業學校": normalizedFull["原畢業學校"] || '無',
            "佐證連結": normalizedFull["佐證連結"] || '無'
        };

        try {
            await fetch('/api/update-award', {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    record_id: targetPub["編號"],
                    custom_id: targetPub["識別號"] || '',
                    updates: normalizedFull
                })
            });
        } catch (_) {}

        const deidCopy = deidentifyRecord(normalizedFull);
        Object.assign(targetPub, deidCopy);
        persistStaticEditedPatch(targetPub);

        syncEffectiveRecords();
        await saveMasterDatabaseSnapshot(true);
        applyFilters(true);
        return normalizedFull;
    }

    async function saveQuickRowEdit(recordUid) {
        const uidStr = String(recordUid || '').trim();
        if (!uidStr) return;
        const amtEl = document.getElementById(`quick-amt-${uidStr}`);
        const stEl = document.getElementById(`quick-status-${uidStr}`);
        const newAmt = Math.max(0, Number(amtEl ? amtEl.value : 0) || 0);
        const newStatus = stEl ? stEl.value : '尚待核定';
        const todayStr = new Date().toISOString().split('T')[0];

        const updates = {
            "獎助金金額": newAmt,
            "發放與領獎狀態": newStatus
        };
        if (newStatus === '通知已發送') {
            const curRec = allRecords.find(r => getRecordUid(r) === uidStr);
            if (curRec && !curRec["通知時間"]) updates["通知時間"] = todayStr;
        }

        editingQuickRowUid = null;
        const saved = await commitRecordUpdates(uidStr, updates, true);
        if (saved) {
            const dispId = saved["識別號"] || saved["編號"];
            showToast(`已送出更新 #${dispId}：獎助金 NT$ ${newAmt.toLocaleString()} ／ 狀態「${newStatus}」`);
        }
    }

    function openDetailModal(recordId, isStagingEdit = false) {
        let record = null;
        let canEditPiiNow = isAdminUnlocked;
        if (isStagingEdit) {
            const stBase = stagingRecords.find(s => String(s._stagingUid) === String(recordId));
            if (!stBase) return;
            activeEditingStagingUid = String(stBase._stagingUid);
            activeDetailRecordId = null;
            const fullStPii = stagingFullPiiMap[activeEditingStagingUid] || {};
            canEditPiiNow = isAdminUnlocked || Object.keys(fullStPii).length > 0;
            record = canEditPiiNow ? { ...stBase, ...fullStPii } : stBase;
        } else {
            record = allRecords.find(r => getRecordUid(r) === String(recordId) || String(r["編號"]) === String(recordId));
            if (!record) return;
            activeDetailRecordId = getRecordUid(record);
            activeEditingStagingUid = null;
        }
        detailModalRenderedUnlocked = canEditPiiNow;
        const btnDelInModal = document.getElementById('btn-detail-delete-record');
        if (btnDelInModal) btnDelInModal.style.display = isStagingEdit ? 'none' : 'inline-flex';

        const evHref = safeHref(record["佐證連結"]);
        const amtNum = Number(record["獎助金金額"]) || 0;
        const isAwarded = String(record["是否獲獎"] || '是').trim() !== '否';
        const curYear = String(record["學年度"] || '114學年度').includes('學年度')
            ? String(record["學年度"])
            : `${String(record["學年度"]).trim() || '114'}學年度`;
        const curTerm = String(record["學期"] || '上').trim() === '下' ? '下' : '上';
        const curCat = String(record["活動類別"] || '全國').trim();
        const curLevel = String(record["競賽層級"] || '國內競賽').trim();
        const curStatus = String(record["發放與領獎狀態"] || (isAwarded ? '尚待核定' : '無須發放')).trim();
        const curCollege = String(record["所屬學院"] || '護理學院').trim();
        const curGroup = String(record["個人/團體競賽"] || '個人競賽').trim();
        const curDeptRel = String(record["競賽項目是否與就讀科系相關"] || '是').trim() === '否' ? '否' : '是';

        const catBaseOpts = ['全國', '國際(外)', '大陸、港、澳地區', '教育部'];
        if (curCat && !catBaseOpts.includes(curCat)) catBaseOpts.unshift(curCat);
        const levelOpts = ['國際競賽', '國內競賽', '體育競賽', '專業證照', '特殊優良事蹟'];
        const statusOpts = ['尚待核定', '待通知', '通知已發送', '已線上簽領', '已完成撥款', '無須發放'];
        const collegeOpts = ['護理學院', '醫學與健康學院', '環境與生命學院', '人文與管理學院'];
        const allDepts = Object.keys(window.FOOYIN_DEPT_CODE_MAP || {});

        const piiReadonlyAttr = canEditPiiNow ? '' : 'readonly';
        const piiReadonlyClass = canEditPiiNow ? '' : 'input-locked-readonly';
        const piiLockHint = canEditPiiNow ? '' : ' <small style="color:#D97706;">(解鎖後可修改)</small>';

        const unlockStripHtml = isStagingEdit
            ? `<div class="detail-unlock-strip unlocked">
                   <span><i class="fa-solid fa-clipboard-check"></i> <strong>暫存區紀錄檢視與修正：</strong>您可於此檢查並修正所有欄位與獎助金額，按下方「儲存修正並送出」更新暫存資料，再於暫存區按確認寫入正式資料庫。</span>
                   <span class="badge badge-teal">暫存編號 ${escapeHtml(activeEditingStagingUid)}</span>
               </div>`
            : (canEditPiiNow
                ? `<div class="detail-unlock-strip unlocked">
                       <span><i class="fa-solid fa-unlock-keyhole"></i> <strong>管理員完整編輯模式：</strong>所有欄位（含學生姓名、學號、獎助金額與領獎狀態）皆可直接修正並點選下方「儲存修正並送出」。</span>
                       <span class="badge badge-teal">流水號 #${escapeHtml(record["編號"])}</span>
                   </div>`
                : `<div class="detail-unlock-strip locked">
                       <span><i class="fa-solid fa-shield-halved"></i> <strong>目前為去識別化檢視：</strong>您可直接核定獎助金額、領獎狀態與賽事欄位後按「儲存修正並送出」（系統將驗證管理員密碼）；若需修改學生姓名或學號請先點選右側解鎖。</span>
                       <button type="button" class="btn btn-warning btn-sm" id="btn-detail-unlock-pii">
                           <i class="fa-solid fa-key"></i> 解鎖編輯完整個資
                       </button>
                   </div>`);

        const evLinkActionHtml = (evHref !== '#' && evHref !== '#protected-evidence')
            ? `<a href="${escapeHtml(evHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="margin-top:4px; align-self:flex-start;"><i class="fa-solid fa-arrow-up-right-from-square"></i> 開啟目前佐證網址</a>`
            : (evHref === '#protected-evidence'
                ? `<small style="color:#D97706;"><i class="fa-solid fa-lock"></i> 雲端硬碟佐證已加密保護，解鎖後自動顯示真實網址</small>`
                : '');

        const body = document.getElementById('detail-modal-body');
        body.innerHTML = `
            ${unlockStripHtml}
            <form id="detail-edit-form" class="grid-form">
                <div class="detail-edit-highlight-box">
                    <div class="form-group">
                        <label style="color:#0F766E; font-weight:700;"><i class="fa-solid fa-sack-dollar"></i> 核發獎助學金金額 (NTD) *</label>
                        <input type="number" id="detail-edit-amount" value="${amtNum}" min="0" step="500" placeholder="輸入核定金額，尚未核定填 0">
                    </div>
                    <div class="form-group">
                        <label style="color:#0F766E; font-weight:700;"><i class="fa-solid fa-award"></i> 領獎與發放狀態 *</label>
                        <select id="detail-edit-status">
                            ${statusOpts.map(s => `<option value="${escapeHtml(s)}" ${curStatus === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>通知發送日期</label>
                        <input type="text" id="detail-edit-notify-date" value="${escapeHtml(record["通知時間"] || '')}" placeholder="例如：2026-11-18">
                    </div>
                    <div class="form-group">
                        <label>領獎截止日期</label>
                        <input type="text" id="detail-edit-deadline" value="${escapeHtml(record["領獎截止日期"] || '')}" placeholder="例如：2026-12-15">
                    </div>
                </div>

                <div class="form-group">
                    <label>識別號 (表單編號)</label>
                    <input type="text" id="detail-edit-custom-id" value="${escapeHtml(record["識別號"] || record["編號"] || '')}">
                </div>
                <div class="form-group">
                    <label>資料來源 *</label>
                    <input type="text" id="detail-edit-source" list="source-suggestions" value="${escapeHtml(record["資料來源"] || '無')}">
                </div>

                <div class="form-group">
                    <label>學年度 (112~120) *</label>
                    <select id="detail-edit-year">
                        ${SUPPORTED_ACAD_YEAR_DESC.map(y => `<option value="${y}" ${curYear === y ? 'selected' : ''}>${y}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>學期 *</label>
                    <select id="detail-edit-term">
                        <option value="上" ${curTerm === '上' ? 'selected' : ''}>上學期 (第1學期)</option>
                        <option value="下" ${curTerm === '下' ? 'selected' : ''}>下學期 (第2學期)</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>活動類別 *</label>
                    <select id="detail-edit-cat">
                        ${catBaseOpts.map(c => `<option value="${escapeHtml(c)}" ${curCat === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>競賽層級 *</label>
                    <select id="detail-edit-level">
                        ${levelOpts.map(l => `<option value="${escapeHtml(l)}" ${curLevel === l ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
                    </select>
                </div>

                <div class="form-group full-width">
                    <label>活動名稱 (賽事全稱) *</label>
                    <input type="text" id="detail-edit-event" value="${escapeHtml(record["活動名稱"] || record["競賽或活動名稱"] || '')}">
                </div>
                <div class="form-group full-width">
                    <label>競賽項目 / 作品題目 *</label>
                    <input type="text" id="detail-edit-work" value="${escapeHtml(record["競賽項目"] || record["參賽項目或作品名稱"] || '')}">
                </div>

                <div class="form-group">
                    <label>活動主辦單位 <small style="color:#64748B;">(無記錄填「無」)</small></label>
                    <input type="text" id="detail-edit-organizer" value="${escapeHtml(record["活動主辦單位"] || '無')}">
                </div>
                <div class="form-group">
                    <label>會議 / 公告記錄日期</label>
                    <input type="text" id="detail-edit-meeting-date" value="${escapeHtml(record["會議記錄時間"] || '')}" placeholder="例如：2026-08-06">
                </div>

                <div class="form-group">
                    <label>是否獲獎 *</label>
                    <select id="detail-edit-awarded">
                        <option value="是" ${isAwarded ? 'selected' : ''}>是</option>
                        <option value="否" ${!isAwarded ? 'selected' : ''}>否</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>獲獎名次 / 榮譽獎項 *</label>
                    <input type="text" id="detail-edit-rank" value="${escapeHtml(record["獲獎名次"] || record["榮譽獎項"] || '')}">
                </div>

                <div class="form-group">
                    <label>個人 / 團體競賽</label>
                    <select id="detail-edit-group">
                        <option value="個人競賽" ${curGroup === '個人競賽' ? 'selected' : ''}>個人競賽</option>
                        <option value="團體競賽" ${curGroup === '團體競賽' ? 'selected' : ''}>團體競賽</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>競賽項目是否與就讀科系相關</label>
                    <select id="detail-edit-dept-rel">
                        <option value="是" ${curDeptRel === '是' ? 'selected' : ''}>是</option>
                        <option value="否" ${curDeptRel === '否' ? 'selected' : ''}>否</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>人數(男)</label>
                    <input type="number" id="detail-edit-male" value="${escapeHtml(record["人數(男)"] !== undefined ? record["人數(男)"] : '0')}" min="0">
                </div>
                <div class="form-group">
                    <label>人數(女)</label>
                    <input type="number" id="detail-edit-female" value="${escapeHtml(record["人數(女)"] !== undefined ? record["人數(女)"] : '0')}" min="0">
                </div>

                <div class="form-group">
                    <label>活動起始日期</label>
                    <input type="text" id="detail-edit-start-date" value="${escapeHtml(record["活動起始日期"] || '')}" placeholder="YYYY/MM/DD">
                </div>
                <div class="form-group">
                    <label>活動結束日期</label>
                    <input type="text" id="detail-edit-end-date" value="${escapeHtml(record["活動結束日期"] || '')}" placeholder="YYYY/MM/DD">
                </div>

                <div class="form-group">
                    <label>所屬學院 *</label>
                    <select id="detail-edit-college">
                        ${collegeOpts.map(c => `<option value="${escapeHtml(c)}" ${curCollege === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>系所名稱 * <small id="detail-dept-code-preview" style="color:#64748B;">(${escapeHtml(resolveDeptCode(record["系所名稱"], record["學生所屬系科 - 系所代碼"]))})</small></label>
                    <input type="text" id="detail-edit-dept" list="detail-dept-datalist" value="${escapeHtml(record["系所名稱"] || '')}">
                    <datalist id="detail-dept-datalist">
                        ${allDepts.map(d => `<option value="${escapeHtml(d)}"></option>`).join('')}
                    </datalist>
                </div>

                <div class="form-group">
                    <label>獲獎學生姓名${piiLockHint}</label>
                    <input type="text" id="detail-edit-student" class="${piiReadonlyClass}" value="${escapeHtml(record["獲獎學生"] || '無')}" ${piiReadonlyAttr}>
                </div>
                <div class="form-group">
                    <label>學生學號${piiLockHint}</label>
                    <input type="text" id="detail-edit-stuid" class="${piiReadonlyClass}" value="${escapeHtml(record["學生學號"] || '無')}" ${piiReadonlyAttr}>
                </div>

                <div class="form-group">
                    <label>學制班級${piiLockHint}</label>
                    <input type="text" id="detail-edit-grade" class="${piiReadonlyClass}" value="${escapeHtml(record["學制班級"] || '無')}" ${piiReadonlyAttr}>
                </div>
                <div class="form-group">
                    <label>指導老師</label>
                    <input type="text" id="detail-edit-teacher" value="${escapeHtml(record["指導老師"] || '無')}">
                </div>

                <div class="form-group">
                    <label>原畢業學校${piiLockHint}</label>
                    <input type="text" id="detail-edit-school" class="${piiReadonlyClass}" value="${escapeHtml(record["原畢業學校"] || '無')}" ${piiReadonlyAttr}>
                </div>
                <div class="form-group">
                    <label>原始佐證網址${!isAdminUnlocked && evHref === '#protected-evidence' ? piiLockHint : ''}</label>
                    <input type="text" id="detail-edit-url" class="${!isAdminUnlocked && evHref === '#protected-evidence' ? piiReadonlyClass : ''}" value="${escapeHtml(record["佐證連結"] || '無')}" ${!isAdminUnlocked && evHref === '#protected-evidence' ? 'readonly' : ''}>
                    ${evLinkActionHtml}
                </div>

                <div class="form-group full-width">
                    <label>備註說明</label>
                    <textarea id="detail-edit-remarks" rows="2">${escapeHtml(record["備註"] || '')}</textarea>
                </div>
            </form>
        `;

        const detailFormEl = document.getElementById('detail-edit-form');
        if (detailFormEl) {
            detailFormEl.addEventListener('submit', (e) => {
                e.preventDefault();
                handleSaveDetailModal();
            });
        }

        const btnUnlockInDetail = document.getElementById('btn-detail-unlock-pii');
        if (btnUnlockInDetail) {
            btnUnlockInDetail.addEventListener('click', () => {
                const isStg = Boolean(activeEditingStagingUid);
                const targetUid = isStg ? activeEditingStagingUid : activeDetailRecordId;
                requireAdminUnlock(() => {
                    openDetailModal(targetUid, isStg);
                }, '解鎖後即可檢視與編輯完整學生姓名、學號、班級與母校資料。');
            });
        }

        const detailDeptInput = document.getElementById('detail-edit-dept');
        const detailCollegeSelect = document.getElementById('detail-edit-college');
        const detailDeptCodePreview = document.getElementById('detail-dept-code-preview');
        if (detailDeptInput) {
            detailDeptInput.addEventListener('input', () => {
                const dVal = detailDeptInput.value.trim();
                if (detailDeptCodePreview) {
                    detailDeptCodePreview.textContent = `(${resolveDeptCode(dVal, '')})`;
                }
                if (window.FOOYIN_COLLEGES_MAP && detailCollegeSelect) {
                    Object.entries(window.FOOYIN_COLLEGES_MAP).forEach(([col, depts]) => {
                        if (depts.includes(dVal)) detailCollegeSelect.value = col;
                    });
                }
            });
        }

        const detailAmtInput = document.getElementById('detail-edit-amount');
        const detailStatusSelect = document.getElementById('detail-edit-status');
        let detailStatusTouched = false;
        if (detailStatusSelect) {
            detailStatusSelect.addEventListener('change', () => { detailStatusTouched = true; });
        }
        if (detailAmtInput) {
            detailAmtInput.addEventListener('input', () => {
                const v = Number(detailAmtInput.value || 0);
                if (!detailStatusTouched && detailStatusSelect && v > 0 && detailStatusSelect.value === '尚待核定') {
                    detailStatusSelect.value = '待通知';
                }
            });
        }

        document.getElementById('detail-modal').classList.add('show');
    }

    function handleSaveDetailModal() {
        if (!activeDetailRecordId && !activeEditingStagingUid) return;
        const isStagingMode = Boolean(activeEditingStagingUid);
        const targetUid = isStagingMode ? activeEditingStagingUid : activeDetailRecordId;
        const wasUnlockedWhenRendered = detailModalRenderedUnlocked;

        const getVal = (id, fallback = '') => {
            const el = document.getElementById(id);
            return el ? String(el.value || '').trim() : fallback;
        };

        const collectedUpdates = {
            "識別號": getVal('detail-edit-custom-id'),
            "學年度": getVal('detail-edit-year', '114學年度'),
            "學期": getVal('detail-edit-term', '上'),
            "活動類別": getVal('detail-edit-cat', '全國'),
            "競賽層級": getVal('detail-edit-level', '國內競賽'),
            "活動名稱": getVal('detail-edit-event'),
            "競賽項目": getVal('detail-edit-work'),
            "活動主辦單位": getVal('detail-edit-organizer', '無') || '無',
            "會議記錄時間": getVal('detail-edit-meeting-date'),
            "是否獲獎": getVal('detail-edit-awarded', '是'),
            "獲獎名次": getVal('detail-edit-rank', '獲獎') || '獲獎',
            "個人/團體競賽": getVal('detail-edit-group', '個人競賽'),
            "競賽項目是否與就讀科系相關": getVal('detail-edit-dept-rel', '是'),
            "人數(男)": String(Math.max(0, Number(getVal('detail-edit-male', '0')) || 0)),
            "人數(女)": String(Math.max(0, Number(getVal('detail-edit-female', '0')) || 0)),
            "活動起始日期": getVal('detail-edit-start-date'),
            "活動結束日期": getVal('detail-edit-end-date'),
            "所屬學院": getVal('detail-edit-college', '護理學院'),
            "系所名稱": getVal('detail-edit-dept', '護理系') || '護理系',
            "指導老師": getVal('detail-edit-teacher', '無') || '無',
            "獎助金金額": Math.max(0, Number(getVal('detail-edit-amount', '0')) || 0),
            "發放與領獎狀態": getVal('detail-edit-status', '尚待核定'),
            "通知時間": getVal('detail-edit-notify-date'),
            "領獎截止日期": getVal('detail-edit-deadline'),
            "資料來源": getVal('detail-edit-source', '無') || '無',
            "備註": getVal('detail-edit-remarks')
        };

        if (!collectedUpdates["活動名稱"]) {
            alert('請填寫「活動名稱」！');
            return;
        }

        const urlInputVal = getVal('detail-edit-url', '無') || '無';
        if (wasUnlockedWhenRendered) {
            collectedUpdates["獲獎學生"] = getVal('detail-edit-student', '無') || '無';
            collectedUpdates["學生學號"] = getVal('detail-edit-stuid', '無') || '無';
            collectedUpdates["學制班級"] = getVal('detail-edit-grade', '無') || '無';
            collectedUpdates["原畢業學校"] = getVal('detail-edit-school', '無') || '無';
            collectedUpdates["佐證連結"] = urlInputVal;
        } else if (urlInputVal !== '#protected-evidence') {
            collectedUpdates["佐證連結"] = urlInputVal;
        }

        if (isStagingMode) {
            const stIdx = stagingRecords.findIndex(s => String(s._stagingUid) === String(targetUid));
            if (stIdx !== -1) {
                const prev = stagingRecords[stIdx];
                const prevFullPii = stagingFullPiiMap[targetUid] || {};
                const merged = normalizeAwardRecord({ ...prev, ...prevFullPii, ...collectedUpdates }, true);
                merged["活動名稱"] = collectedUpdates["活動名稱"];
                merged["競賽或活動名稱"] = collectedUpdates["活動名稱"];
                merged["競賽項目"] = collectedUpdates["競賽項目"];
                merged["參賽項目或作品名稱"] = collectedUpdates["競賽項目"];
                merged["獲獎名次"] = collectedUpdates["獲獎名次"];
                merged["榮譽獎項"] = collectedUpdates["獲獎名次"];
                merged["學生所屬系科 - 系所代碼"] = resolveDeptCode(merged["系所名稱"], merged["學生所屬系科 - 系所代碼"]);

                stagingFullPiiMap[targetUid] = {
                    "獲獎學生": merged["獲獎學生"] || '無',
                    "學生學號": merged["學生學號"] || '無',
                    "學制班級": merged["學制班級"] || '無',
                    "原畢業學校": merged["原畢業學校"] || '無',
                    "佐證連結": merged["佐證連結"] || '無'
                };
                const deidStg = deidentifyRecord(merged);
                deidStg._stagingUid = prev._stagingUid;
                deidStg._stagingOrigin = prev._stagingOrigin;
                deidStg._stagingAction = checkStagingActionType(deidStg);
                stagingRecords[stIdx] = deidStg;
                saveStagingQueueOnly();
                renderStagingModalData();
            }
            activeEditingStagingUid = null;
            document.getElementById('detail-modal').classList.remove('show');
            showToast('已更新暫存區紀錄內容！確認無誤後可點選寫入正式資料庫。');
            return;
        }

        requireAdminUnlock(async () => {
            const saved = await commitRecordUpdates(targetUid, collectedUpdates, true);
            document.getElementById('detail-modal').classList.remove('show');
            if (saved) {
                const dispId = saved["識別號"] || saved["編號"];
                showToast(`已成功儲存修正並送出紀錄 #${dispId}！`);
            }
        }, '儲存並送出獲獎紀錄修訂涉及系統資料變更，請先完成管理員解鎖。');
    }

    let activeNotifyRecord = null;
    function openNotifyModal(recordId) {
        activeNotifyRecord = allRecords.find(r => getRecordUid(r) === String(recordId) || String(r["編號"]) === String(recordId));
        if (!activeNotifyRecord) return;

        document.getElementById('notify-target-student').textContent = activeNotifyRecord["獲獎學生"] || '無';
        document.getElementById('notify-target-stuid').textContent = activeNotifyRecord["學生學號"] || '無';
        document.getElementById('notify-target-event').textContent = activeNotifyRecord["競賽或活動名稱"] || activeNotifyRecord["活動名稱"];
        document.getElementById('notify-target-amount').textContent = `NT$ ${(Number(activeNotifyRecord["獎助金金額"]) || 0).toLocaleString()} 元`;

        updateNotifyPreviewText();
        document.getElementById('notify-modal').classList.add('show');
    }

    function updateNotifyPreviewText() {
        if (!activeNotifyRecord) return;
        const channel = document.getElementById('notify-channel-select').value;
        const txtBox = document.getElementById('notify-preview-text');
        const evName = activeNotifyRecord["競賽或活動名稱"] || activeNotifyRecord["活動名稱"];
        const rkName = activeNotifyRecord["榮譽獎項"] || activeNotifyRecord["獲獎名次"];

        if (channel === 'email') {
            txtBox.value = `【輔英科技大學 學術獲獎與獎助學金領獎通知信】\n親愛的 ${activeNotifyRecord["獲獎學生"]} 同學（學號：${activeNotifyRecord["學生學號"]}）您好：\n恭喜您在【${evName}】中榮獲『${rkName}』佳績！\n學校頒發獎助學金新臺幣 NT$ ${(Number(activeNotifyRecord["獎助金金額"]) || 0).toLocaleString()} 元。\n請於【${activeNotifyRecord["領獎截止日期"] || '期限內'}】登入校園 Portal 完成線上簽領：\n連結: https://portal.fy.edu.tw/awards/claim?id=${activeNotifyRecord["編號"]}`;
        } else if (channel === 'line') {
            txtBox.value = `【輔英獲獎與領獎通知】\n恭喜 ${activeNotifyRecord["獲獎學生"]} 同學榮獲「${evName}」【${rkName}】！\n獎助金金額: NT$ ${(Number(activeNotifyRecord["獎助金金額"]) || 0).toLocaleString()} 元\n請登入校園 Portal 完成線上簽領：\n連結: https://portal.fy.edu.tw/awards/claim?id=${activeNotifyRecord["編號"]}`;
        } else {
            txtBox.value = `[輔英Portal校內通知] 您有一筆學術獲獎獎助金 (NT$ ${(Number(activeNotifyRecord["獎助金金額"]) || 0).toLocaleString()}) 待簽領。發送時間: ${new Date().toLocaleDateString()}`;
        }
    }

    document.getElementById('confirm-send-notify').addEventListener('click', async () => {
        if (!activeNotifyRecord) return;
        const todayStr = new Date().toISOString().split('T')[0];
        try {
            await fetch('/api/dispatch-notification', {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ record_id: activeNotifyRecord["編號"] })
            });
        } catch (_) {}

        const targetPub = basePublicRecords.find(r => getRecordUid(r) === getRecordUid(activeNotifyRecord) || String(r["編號"]) === String(activeNotifyRecord["編號"]));
        if (targetPub) {
            targetPub["發放與領獎狀態"] = "通知已發送";
            targetPub["通知時間"] = todayStr;
            persistStaticEditedPatch(targetPub);
        }
        syncEffectiveRecords();
        document.getElementById('notify-modal').classList.remove('show');
        applyFilters(true);
        showToast(`已成功向 ${activeNotifyRecord["獲獎學生"]} 發送領獎通知！`);
    });

    async function handleStudentSign(recordId) {
        const record = allRecords.find(r => getRecordUid(r) === String(recordId) || String(r["編號"]) === String(recordId));
        if (!record) return;
        if (confirm(`確定要幫學生 [${record["獲獎學生"]}] 辦理線上簽領領獎作業？`)) {
            try {
                await fetch('/api/update-status', {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ record_id: recordId, status: "已線上簽領" })
                });
            } catch (_) {}
            const targetPub = basePublicRecords.find(r => getRecordUid(r) === String(recordId) || String(r["編號"]) === String(recordId));
            if (targetPub) {
                targetPub["發放與領獎狀態"] = "已線上簽領";
                persistStaticEditedPatch(targetPub);
            }
            syncEffectiveRecords();
            applyFilters(true);
            showToast(`已完成 #${record["識別號"] || record["編號"]} 線上簽領狀態更新！`);
        }
    }

    // =========================================================
    // 錯誤匯入或重複資料刪除引擎（支援單筆直接刪除與多筆勾選批次刪除）
    // =========================================================
    function updateBatchDeleteToolbar() {
        const btnToggle = document.getElementById('btn-toggle-batch-delete');
        const bar = document.getElementById('batch-delete-bar');
        const countEl = document.getElementById('batch-selected-count');
        const btnConfirm = document.getElementById('btn-confirm-batch-delete');
        const btnSelectPage = document.getElementById('btn-batch-select-page');

        if (!btnToggle || !bar) return;
        if (isBatchDeleteMode) {
            btnToggle.style.display = 'none';
            bar.style.display = 'inline-flex';
            const selCount = selectedDeleteIds.size;
            if (countEl) countEl.textContent = String(selCount);
            if (btnConfirm) btnConfirm.disabled = selCount === 0;

            if (btnSelectPage) {
                const start = (currentPage - 1) * itemsPerPage;
                const end = Math.min(start + itemsPerPage, filteredRecords.length);
                const pageItems = filteredRecords.slice(start, end);
                const pageUids = pageItems.map(r => getRecordUid(r)).filter(Boolean);
                const allSelected = pageUids.length > 0 && pageUids.every(uid => selectedDeleteIds.has(uid));
                btnSelectPage.innerHTML = allSelected
                    ? '<i class="fa-solid fa-square-xmark"></i> 取消本頁'
                    : '<i class="fa-regular fa-square-check"></i> 全選本頁';
            }
        } else {
            btnToggle.style.display = 'inline-flex';
            bar.style.display = 'none';
        }
    }

    function promptDeleteRecords(uids) {
        const targetSet = new Set((uids || []).map(x => String(x || '').trim()).filter(Boolean));
        if (targetSet.size === 0) return;

        const targets = allRecords.filter(r => targetSet.has(getRecordUid(r)));
        if (targets.length === 0) return;

        pendingDeleteUids = targets.map(r => getRecordUid(r));
        const summaryBox = document.getElementById('delete-confirm-summary');
        const btnExec = document.getElementById('btn-execute-delete');

        if (targets.length === 1) {
            const r = targets[0];
            const dispId = r["識別號"] || r["編號"];
            const evName = r["活動名稱"] || r["競賽或活動名稱"] || '無';
            summaryBox.innerHTML = `
                <p style="margin-bottom: 8px; font-weight: 700; color: #991B1B;">
                    <i class="fa-solid fa-triangle-exclamation"></i> 確定要永久刪除此筆錯誤匯入或重複之獲獎紀錄嗎？
                </p>
                <div class="delete-record-preview-list">
                    <div><strong>識別號：</strong>#${escapeHtml(dispId)}</div>
                    <div><strong>學年度 / 學期：</strong>${escapeHtml(r["學年度"] || '')} ${escapeHtml(r["學期"] || '')}學期</div>
                    <div><strong>所屬系所：</strong>${escapeHtml(r["所屬學院"] || '')} - ${escapeHtml(r["系所名稱"] || '')}</div>
                    <div><strong>獲獎學生：</strong>${escapeHtml(r["獲獎學生"] || '無')}（學號：${escapeHtml(r["學生學號"] || '無')}）</div>
                    <div><strong>活動名稱：</strong>${escapeHtml(evName)}</div>
                    <div><strong>資料來源：</strong>${escapeHtml(r["資料來源"] || '無')}</div>
                </div>
                <small style="display: block; margin-top: 8px; color: #64748B;">刪除後將立即同步更新清冊、KPI 指標與統計圖表，且不會納入匯出檔案。</small>
            `;
            if (btnExec) btnExec.innerHTML = '<i class="fa-solid fa-trash-can"></i> 確認刪除此筆紀錄';
        } else {
            const previewItemsHtml = targets.map(r => {
                const dispId = r["識別號"] || r["編號"];
                const evName = r["活動名稱"] || r["競賽或活動名稱"] || '無';
                return `<div><strong>#${escapeHtml(dispId)}</strong>｜${escapeHtml(r["獲獎學生"] || '無')} — ${escapeHtml(evName)} <span style="color:#64748B;">(${escapeHtml(r["資料來源"] || '無')})</span></div>`;
            }).join('');
            summaryBox.innerHTML = `
                <p style="margin-bottom: 8px; font-weight: 700; color: #991B1B;">
                    <i class="fa-solid fa-triangle-exclamation"></i> 確定要一次永久刪除已勾選的 <strong>${targets.length}</strong> 筆獲獎紀錄嗎？
                </p>
                <div class="delete-record-preview-list">${previewItemsHtml}</div>
                <small style="display: block; margin-top: 8px; color: #64748B;">刪除後將立即同步更新清冊、KPI 指標與統計圖表，且不會納入匯出檔案。</small>
            `;
            if (btnExec) btnExec.innerHTML = `<i class="fa-solid fa-trash-can"></i> 確認刪除 (${targets.length} 筆)`;
        }

        document.getElementById('delete-confirm-modal').classList.add('show');
    }

    async function executeConfirmedDelete() {
        if (!pendingDeleteUids || pendingDeleteUids.length === 0) return;
        const uidsToDelete = [...pendingDeleteUids];
        pendingDeleteUids = [];

        const targetSet = new Set(uidsToDelete);
        const targetRecords = basePublicRecords.filter(r => targetSet.has(getRecordUid(r)));

        document.getElementById('delete-confirm-modal').classList.remove('show');
        document.getElementById('detail-modal').classList.remove('show');

        let apiPersisted = false;
        try {
            const payload = uidsToDelete.length === 1
                ? {
                    record_id: uidsToDelete[0],
                    custom_id: targetRecords[0] ? (targetRecords[0]["識別號"] || '') : ''
                }
                : { record_ids: uidsToDelete };

            const resp = await fetch('/api/delete-award', {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(payload)
            });
            if (resp.ok) {
                apiPersisted = true;
            }
        } catch (_) {
            // 靜態離線模式，改以本機靜態刪除清單記憶
        }

        if (!apiPersisted) {
            targetRecords.forEach(r => markStaticRecordDeleted(r));
        }

        basePublicRecords = basePublicRecords.filter(r => !targetSet.has(getRecordUid(r)));
        uidsToDelete.forEach(uid => {
            delete sessionFullRecordsMap[uid];
            removeStaticEditedPatch(uid);
            if (decryptedPiiMap && decryptedPiiMap[uid]) {
                delete decryptedPiiMap[uid];
            }
            selectedDeleteIds.delete(uid);
        });

        if (activeDetailRecordId && targetSet.has(String(activeDetailRecordId))) {
            activeDetailRecordId = null;
        }
        if (isBatchDeleteMode && selectedDeleteIds.size === 0) {
            isBatchDeleteMode = false;
        }

        syncEffectiveRecords();
        await saveMasterDatabaseSnapshot(true);
        applyFilters(true);

        if (uidsToDelete.length === 1 && targetRecords[0]) {
            const dispId = targetRecords[0]["識別號"] || targetRecords[0]["編號"];
            showToast(`已成功刪除紀錄 #${dispId}`, true);
        } else {
            showToast(`已成功批次刪除 ${uidsToDelete.length} 筆紀錄`, true);
        }
    }

    // =========================================================
    // 三大資料來源 LOOK 監看與每週自動更新中心
    // (1. 個人雲端硬碟/行政會議檔案夾  2. 學校公開網頁  3. 系上公開網頁)
    // =========================================================
    let sourcesConfigState = window.DATA_SOURCES_CONFIG || {
        schedule: { frequency: 'weekly', day_of_week: 'Monday', time: '08:00' },
        cloud_drive_sources: [{
            id: 'gdrive-admin-meetings',
            name: '個人雲端硬碟 / 行政會議檔案夾',
            cloud_folder_url: 'https://drive.google.com/drive/my-drive',
            sheet_csv_url: '',
            local_sync_paths: ['./行政會議', 'G:/我的雲端硬碟/行政會議']
        }],
        school_public_sources: [
            { id: 'fy-epo-news', name: '輔英科技大學 校園新聞公開專區 (公共事務室)', url: 'https://epo.fy.edu.tw/p/403-1058-1306-1.php?Lang=zh-tw', enabled: true },
            { id: 'fy-sec-minutes', name: '秘書室 行政會議與校務會議公開專區', url: 'https://ese.fy.edu.tw/?Lang=zh-tw', enabled: true }
        ],
        department_public_sources: [
            { id: 'dept-nursing', name: '護理學院與護理系 公開網頁', department: '護理系', college: '護理學院', url: 'https://efi.fy.edu.tw/?Lang=zh-tw', enabled: true },
            { id: 'dept-medhealth', name: '醫學與健康學院 公開網頁', department: '健康美容系', college: '醫學與健康學院', url: 'https://emed-health.fy.edu.tw/', enabled: true },
            { id: 'dept-pt', name: '物理治療系 系上公開網頁', department: '物理治療系', college: '醫學與健康學院', url: 'https://edpt.fy.edu.tw/', enabled: true },
            { id: 'dept-nutr', name: '保健營養系 系上公開網頁', department: '保健營養系', college: '醫學與健康學院', url: 'https://ednh.fy.edu.tw/', enabled: true },
            { id: 'dept-osh', name: '職業安全衛生系 系上公開網頁', department: '職業安全衛生系', college: '環境與生命學院', url: 'https://eosh.fy.edu.tw/', enabled: true }
        ]
    };

    async function openSourcesLookupModal() {
        const modal = document.getElementById('update-log-modal');
        renderSourcesLookupUI();
        modal.classList.add('show');
        try {
            const resp = await fetch('/api/sources-status', { headers: authHeaders() });
            if (resp.ok) {
                const remoteCfg = await resp.json();
                if (remoteCfg && remoteCfg.school_public_sources) {
                    sourcesConfigState = remoteCfg;
                    renderSourcesLookupUI();
                }
            }
        } catch (_) {}
    }

    function renderSourcesLookupUI() {
        const gdriveList = sourcesConfigState.cloud_drive_sources || [];
        const gdriveObj = gdriveList[0] || { cloud_folder_url: 'https://drive.google.com/drive/my-drive', sheet_csv_url: '' };
        const gdriveUrlInput = document.getElementById('cfg-gdrive-url');
        const gsheetCsvInput = document.getElementById('cfg-gsheet-csv-url');
        const lookGdriveBtn = document.getElementById('btn-look-gdrive');

        if (gdriveUrlInput) gdriveUrlInput.value = gdriveObj.cloud_folder_url || '';
        if (gsheetCsvInput) gsheetCsvInput.value = gdriveObj.sheet_csv_url || '';
        if (lookGdriveBtn) lookGdriveBtn.href = safeHref(gdriveObj.cloud_folder_url || 'https://drive.google.com/drive/my-drive');

        const schoolBox = document.getElementById('school-sources-list');
        if (schoolBox) {
            schoolBox.innerHTML = '';
            (sourcesConfigState.school_public_sources || []).forEach((s, idx) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:6px; background:#FFF; padding:6px 10px; border-radius:8px; border:1px solid #E2E8F0; font-size:12.5px;';
                row.innerHTML = `
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><strong>${escapeHtml(s.name)}</strong></span>
                    <div style="display:flex; gap:4px; flex-shrink:0;">
                        <a href="${escapeHtml(safeHref(s.url))}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="padding:3px 8px; font-size:11px;">
                            <i class="fa-solid fa-magnifying-glass"></i> LOOK
                        </a>
                        <button type="button" class="btn btn-secondary btn-sm btn-del-school-src" data-idx="${idx}" style="padding:3px 7px; font-size:11px; color:#EF4444;" title="移除">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `;
                schoolBox.appendChild(row);
            });
            schoolBox.querySelectorAll('.btn-del-school-src').forEach(b => {
                b.addEventListener('click', (e) => {
                    const i = Number(e.currentTarget.dataset.idx);
                    sourcesConfigState.school_public_sources.splice(i, 1);
                    persistSourcesConfig();
                    renderSourcesLookupUI();
                });
            });
        }

        const deptBox = document.getElementById('dept-sources-list');
        if (deptBox) {
            deptBox.innerHTML = '';
            (sourcesConfigState.department_public_sources || []).forEach((d, idx) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:6px; background:#FFF; padding:6px 10px; border-radius:8px; border:1px solid #E2E8F0; font-size:12.5px;';
                row.innerHTML = `
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><strong>${escapeHtml(d.name || d.department)}</strong></span>
                    <div style="display:flex; gap:4px; flex-shrink:0;">
                        <a href="${escapeHtml(safeHref(d.url))}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="padding:3px 8px; font-size:11px;">
                            <i class="fa-solid fa-magnifying-glass"></i> LOOK
                        </a>
                        <button type="button" class="btn btn-secondary btn-sm btn-del-dept-src" data-idx="${idx}" style="padding:3px 7px; font-size:11px; color:#EF4444;" title="移除">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `;
                deptBox.appendChild(row);
            });
            deptBox.querySelectorAll('.btn-del-dept-src').forEach(b => {
                b.addEventListener('click', (e) => {
                    const i = Number(e.currentTarget.dataset.idx);
                    sourcesConfigState.department_public_sources.splice(i, 1);
                    persistSourcesConfig();
                    renderSourcesLookupUI();
                });
            });
        }
    }

    async function persistSourcesConfig() {
        try {
            await fetch('/api/sources-config', {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(sourcesConfigState)
            });
        } catch (_) {}
    }

    function handleSaveGdriveConfig() {
        const gUrl = document.getElementById('cfg-gdrive-url').value.trim() || 'https://drive.google.com/drive/my-drive';
        const sUrl = document.getElementById('cfg-gsheet-csv-url').value.trim();
        if (!sourcesConfigState.cloud_drive_sources || !sourcesConfigState.cloud_drive_sources.length) {
            sourcesConfigState.cloud_drive_sources = [{ id: 'gdrive-admin-meetings', name: '個人雲端硬碟 / 行政會議檔案夾', local_sync_paths: ['./行政會議', 'G:/我的雲端硬碟/行政會議'], enabled: true }];
        }
        sourcesConfigState.cloud_drive_sources[0].cloud_folder_url = gUrl;
        sourcesConfigState.cloud_drive_sources[0].sheet_csv_url = sUrl;
        persistSourcesConfig();
        renderSourcesLookupUI();
        const term = document.getElementById('update-log-terminal');
        if (term) term.textContent = `[設定已更新] 個人雲端硬碟『行政會議』連結已設為: ${gUrl}\n` + (sUrl ? `[雲端試算表自動同步 CSV]: ${sUrl}\n` : '');
    }

    function handleAddSchoolSource() {
        const nameEl = document.getElementById('new-school-src-name');
        const urlEl = document.getElementById('new-school-src-url');
        const name = nameEl.value.trim();
        const url = urlEl.value.trim();
        if (!name || !/^https?:\/\//i.test(url)) {
            alert('請輸入學校公開網頁名稱與有效的 http(s):// 網址！');
            return;
        }
        sourcesConfigState.school_public_sources.push({ id: 'school-' + Date.now(), name, category: '學校公開網頁', url, enabled: true });
        nameEl.value = '';
        urlEl.value = '';
        persistSourcesConfig();
        renderSourcesLookupUI();
    }

    function handleAddDeptSource() {
        const deptEl = document.getElementById('new-dept-src-name');
        const urlEl = document.getElementById('new-dept-src-url');
        const dept = deptEl.value.trim();
        const url = urlEl.value.trim();
        if (!dept || !/^https?:\/\//i.test(url)) {
            alert('請輸入系所名稱與有效的系上公開網頁 http(s):// 網址！');
            return;
        }
        let foundCol = '護理學院';
        Object.entries(window.FOOYIN_COLLEGES_MAP || {}).forEach(([col, depts]) => {
            if (depts.includes(dept)) foundCol = col;
        });
        sourcesConfigState.department_public_sources.push({
            id: 'dept-' + Date.now(),
            name: `${dept} 系上公開網頁`,
            department: dept,
            college: foundCol,
            category: '系上公開網頁',
            url,
            enabled: true
        });
        deptEl.value = '';
        urlEl.value = '';
        persistSourcesConfig();
        renderSourcesLookupUI();
    }

    // 經輔英科技大學公共事務室校園新聞專區 (https://epo.fy.edu.tw/) 逐篇實證查核並與表 4-8-1 交叉核對之公開獲獎公告
    const VERIFIED_EPO_PUBLIC_RECORDS = [
        {
            "識別號": "FY115-001",
            "學年度": "115學年度",
            "學期": "上",
            "會議記錄時間": "2026-08-06",
            "活動類別": "國際(外)",
            "活動主辦單位": "World Beauty Art Association (WBAA)",
            "資料來源": "學校公開網頁 (輔英新聞)",
            "所屬學院": "醫學與健康學院",
            "系所名稱": "健康美容系",
            "學生所屬系科 - 系所代碼": "健康美容系 - 3839",
            "學制班級": "無",
            "獲獎學生": "李靜美",
            "學生學號": "無",
            "指導老師": "黃曉玲 助理教授",
            "競賽層級": "國際競賽",
            "活動名稱": "WBAA第25屆世界美容藝術與設計國際大賽暨2026 WBA Global Triple Challenge全球美學現場賽",
            "競賽或活動名稱": "WBAA第25屆世界美容藝術與設計國際大賽暨2026 WBA Global Triple Challenge全球美學現場賽",
            "競賽項目": "皮膚臉部護理",
            "參賽項目或作品名稱": "皮膚臉部護理",
            "個人/團體競賽": "個人競賽",
            "人數(男)": "0",
            "人數(女)": "1",
            "是否獲獎": "是",
            "獲獎名次": "金牌",
            "榮譽獎項": "金牌",
            "活動起始日期": "2026/08/01",
            "活動結束日期": "2026/08/06",
            "獎助金金額": 0,
            "發放與領獎狀態": "尚待核定",
            "原畢業學校": "無",
            "佐證連結": "https://epo.fy.edu.tw/p/406-1058-76437,r1306.php?Lang=zh-tw",
            "備註": "輔英校園新聞 2026-08-06 查證（115學年度上學期最新國際賽獲獎，已收錄於系統基準庫）"
        },
        {
            "識別號": "EPO-76254-1",
            "學年度": "114學年度",
            "學期": "下",
            "會議記錄時間": "2026-07-08",
            "活動類別": "國際(外)",
            "活動主辦單位": "馬來西亞國際美容博覽會(IBE)、馬來西亞國際技職協會(MIVA)",
            "資料來源": "學校公開網頁 (輔英新聞)",
            "所屬學院": "醫學與健康學院",
            "系所名稱": "健康美容系",
            "學生所屬系科 - 系所代碼": "健康美容系 - 3839",
            "學制班級": "無",
            "獲獎學生": "吳琇璟",
            "學生學號": "無",
            "指導老師": "柯美華 副主任",
            "競賽層級": "國際競賽",
            "活動名稱": "2026年第四屆MIVA世界卓越盃國際賽",
            "競賽或活動名稱": "2026年第四屆MIVA世界卓越盃國際賽",
            "競賽項目": "創意墨水藝術彩繪",
            "參賽項目或作品名稱": "創意墨水藝術彩繪",
            "個人/團體競賽": "個人競賽",
            "人數(男)": "0",
            "人數(女)": "1",
            "是否獲獎": "是",
            "獲獎名次": "金獎",
            "榮譽獎項": "金獎",
            "活動起始日期": "2026/07/01",
            "活動結束日期": "2026/07/08",
            "獎助金金額": 0,
            "發放與領獎狀態": "尚待核定",
            "原畢業學校": "長庚科技大學五專部",
            "佐證連結": "https://epo.fy.edu.tw/p/406-1058-76254,r1306.php?Lang=zh-tw",
            "備註": "輔英校園新聞 2026-07-08 查證（表 4-8-1 於 5 月結算後新增之暑期國際賽事）"
        },
        {
            "識別號": "EPO-76254-2",
            "學年度": "114學年度",
            "學期": "下",
            "會議記錄時間": "2026-07-08",
            "活動類別": "國際(外)",
            "活動主辦單位": "馬來西亞國際美容博覽會(IBE)、馬來西亞國際技職協會(MIVA)",
            "資料來源": "學校公開網頁 (輔英新聞)",
            "所屬學院": "醫學與健康學院",
            "系所名稱": "健康美容系",
            "學生所屬系科 - 系所代碼": "健康美容系 - 3839",
            "學制班級": "無",
            "獲獎學生": "蔡莉鈞",
            "學生學號": "無",
            "指導老師": "柯美華 副主任",
            "競賽層級": "國際競賽",
            "活動名稱": "2026年第四屆MIVA世界卓越盃國際賽",
            "競賽或活動名稱": "2026年第四屆MIVA世界卓越盃國際賽",
            "競賽項目": "芳療類《七大元素能量覺醒》",
            "參賽項目或作品名稱": "芳療類《七大元素能量覺醒》",
            "個人/團體競賽": "個人競賽",
            "人數(男)": "0",
            "人數(女)": "1",
            "是否獲獎": "是",
            "獲獎名次": "金牌",
            "榮譽獎項": "金牌",
            "活動起始日期": "2026/07/01",
            "活動結束日期": "2026/07/08",
            "獎助金金額": 0,
            "發放與領獎狀態": "尚待核定",
            "原畢業學校": "高雄市私立三信高級家事商業職業學校",
            "佐證連結": "https://epo.fy.edu.tw/p/406-1058-76254,r1306.php?Lang=zh-tw",
            "備註": "輔英校園新聞 2026-07-08 查證（健康美容系獲芳療類金牌）"
        },
        {
            "識別號": "421568",
            "target_update_id": "421568",
            "related_table_ids": "421568, 421569, 421570, 421572, 421573",
            "學年度": "114學年度",
            "學期": "下",
            "會議記錄時間": "2026-06-03",
            "活動類別": "全國",
            "活動主辦單位": "運動部",
            "資料來源": "學校公開網頁 (輔英新聞)",
            "所屬學院": "人文與管理學院",
            "系所名稱": "休閒與遊憩事業管理系",
            "學生所屬系科 - 系所代碼": "休閒與遊憩事業管理系 - 1457",
            "學制班級": "四技2年1班",
            "獲獎學生": "姜曼羚",
            "學生學號": "無",
            "指導老師": "梁國禎、梁豐君 教練",
            "競賽層級": "體育競賽",
            "活動名稱": "115年全國身心障礙國民運動會",
            "競賽或活動名稱": "115年全國身心障礙國民運動會",
            "競賽項目": "肢體障礙S9級女子組50公尺、100公尺、400公尺自由式、100公尺仰式及200公尺混合式",
            "參賽項目或作品名稱": "肢體障礙S9級女子組50公尺、100公尺、400公尺自由式、100公尺仰式及200公尺混合式",
            "個人/團體競賽": "個人競賽",
            "人數(男)": "0",
            "人數(女)": "1",
            "是否獲獎": "是",
            "獲獎名次": "五金（三破全國紀錄）",
            "榮譽獎項": "五金（三破全國紀錄）",
            "活動起始日期": "2026/05/21",
            "活動結束日期": "2026/05/24",
            "獎助金金額": 0,
            "發放與領獎狀態": "尚待核定",
            "原畢業學校": "高雄市立文山高級中學",
            "佐證連結": "https://epo.fy.edu.tw/p/406-1058-75863,r1306.php?Lang=zh-tw",
            "備註": "輔英校園新聞 2026-06-03 查證（對應補充表 4-8-1 識別號 #421568~#421573 未登載之選手、班級與教練資訊）"
        },
        {
            "識別號": "421564",
            "target_update_id": "421564",
            "學年度": "114學年度",
            "學期": "下",
            "會議記錄時間": "2026-05-18",
            "活動類別": "全國",
            "活動主辦單位": "教育部",
            "資料來源": "學校公開網頁 (輔英新聞)",
            "所屬學院": "醫學與健康學院",
            "系所名稱": "醫學檢驗生物技術系",
            "學生所屬系科 - 系所代碼": "醫學檢驗生物技術系 - 1448",
            "學制班級": "無",
            "獲獎學生": "杜佩芸",
            "學生學號": "無",
            "指導老師": "葉耀宗 教授、邱敏熙 助理教授",
            "競賽層級": "國內競賽",
            "活動名稱": "2026年全國技專校院學生實務專題製作競賽暨成果展",
            "競賽或活動名稱": "2026年全國技專校院學生實務專題製作競賽暨成果展",
            "競賽項目": "生技醫農群：以腸道菌相組成之改變開發可預測心血管疾病風險的IVD試劑組",
            "參賽項目或作品名稱": "生技醫農群：以腸道菌相組成之改變開發可預測心血管疾病風險的IVD試劑組",
            "個人/團體競賽": "個人競賽",
            "人數(男)": "0",
            "人數(女)": "1",
            "是否獲獎": "是",
            "獲獎名次": "第一名",
            "榮譽獎項": "第一名",
            "活動起始日期": "2026/05/14",
            "活動結束日期": "2026/05/15",
            "獎助金金額": 0,
            "發放與領獎狀態": "尚待核定",
            "原畢業學校": "輔英科技大學",
            "佐證連結": "https://epo.fy.edu.tw/p/406-1058-75509,r1306.php?Lang=zh-tw",
            "備註": "輔英校園新聞 2026-05-18 查證（對應補充表 4-8-1 識別號 #421564 生技醫農群第一名之獲獎學生與指導教授）"
        },
        {
            "識別號": "421565",
            "target_update_id": "421565",
            "學年度": "114學年度",
            "學期": "下",
            "會議記錄時間": "2026-05-18",
            "活動類別": "全國",
            "活動主辦單位": "教育部",
            "資料來源": "學校公開網頁 (輔英新聞)",
            "所屬學院": "醫學與健康學院",
            "系所名稱": "醫學檢驗生物技術系",
            "學生所屬系科 - 系所代碼": "醫學檢驗生物技術系 - 1448",
            "學制班級": "無",
            "獲獎學生": "陳韻綺、包可欣",
            "學生學號": "無",
            "指導老師": "曾維昌 副教授",
            "競賽層級": "國內競賽",
            "活動名稱": "2026年全國技專校院學生實務專題製作競賽暨成果展",
            "競賽或活動名稱": "2026年全國技專校院學生實務專題製作競賽暨成果展",
            "競賽項目": "生技醫農群：利用深共熔溶劑配合液相—液相微萃取法萃取牛奶中殘留四環黴素並利用HPLC-UV快速偵測",
            "參賽項目或作品名稱": "生技醫農群：利用深共熔溶劑配合液相—液相微萃取法萃取牛奶中殘留四環黴素並利用HPLC-UV快速偵測",
            "個人/團體競賽": "團體競賽",
            "人數(男)": "0",
            "人數(女)": "2",
            "是否獲獎": "是",
            "獲獎名次": "第二名",
            "榮譽獎項": "第二名",
            "活動起始日期": "2026/05/14",
            "活動結束日期": "2026/05/15",
            "獎助金金額": 0,
            "發放與領獎狀態": "尚待核定",
            "原畢業學校": "輔英科技大學五專部",
            "佐證連結": "https://epo.fy.edu.tw/p/406-1058-75509,r1306.php?Lang=zh-tw",
            "備註": "輔英校園新聞 2026-05-18 查證（對應補充表 4-8-1 識別號 #421565 生技醫農群第二名之獲獎學生與指導教授）"
        }
    ];

    // =========================================================
    // 待審核資料暫存區 (Staging Area) 核心引擎
    // 網路新增 / 自行建檔 / 檔案與雲端匯入 -> 先進暫存區 -> 檢視修正 -> 按確認才進正式資料庫
    // =========================================================
    function findMatchingFormalRecord(rec) {
        const candId = String(rec.target_update_id || rec["識別號"] || '').replace(/^#+/, '').trim();
        if (!candId) return null;
        return basePublicRecords.find(r =>
            String(r["識別號"] || '').replace(/^#+/, '').trim() === candId ||
            String(r["編號"] || '').trim() === candId
        ) || null;
    }

    function checkStagingActionType(rec) {
        return findMatchingFormalRecord(rec) ? 'UPDATE' : 'ADD';
    }

    function isRecordIdenticalToFormalDb(normRec) {
        const existing = findMatchingFormalRecord(normRec);
        if (existing) {
            const existingNum = String(existing["編號"]);
            const existingFullStudent = (sessionFullRecordsMap[existingNum] && sessionFullRecordsMap[existingNum]["獲獎學生"]) ||
                (decryptedPiiMap && decryptedPiiMap[existingNum] && decryptedPiiMap[existingNum]["獲獎學生"]) ||
                existing["獲獎學生"] || '無';
            const incomingStudentMasked = maskStudentNames(normRec["獲獎學生"]);
            const existingStudentMasked = maskStudentNames(existingFullStudent);
            const sameTeacher = String(existing["指導老師"] || '無').trim() === String(normRec["指導老師"] || '無').trim();
            const sameEvent = String(existing["活動名稱"] || existing["競賽或活動名稱"] || '').trim() === String(normRec["活動名稱"] || normRec["競賽或活動名稱"] || '').trim();
            const sameWork = String(existing["競賽項目"] || existing["參賽項目或作品名稱"] || '').trim() === String(normRec["競賽項目"] || normRec["參賽項目或作品名稱"] || '').trim();
            const sameAmt = Number(existing["獎助金金額"] || 0) === Number(normRec["獎助金金額"] || 0);
            const sameStatus = String(existing["發放與領獎狀態"] || '').trim() === String(normRec["發放與領獎狀態"] || '').trim();
            if (incomingStudentMasked === existingStudentMasked && sameTeacher && sameEvent && sameWork && sameAmt && sameStatus) {
                return true;
            }
            return false;
        }
        const evName = normRec["競賽或活動名稱"] || normRec["活動名稱"] || '';
        const wkName = normRec["參賽項目或作品名稱"] || normRec["競賽項目"] || '';
        return basePublicRecords.some(r =>
            (r["競賽或活動名稱"] || r["活動名稱"]) === evName &&
            (r["參賽項目或作品名稱"] || r["競賽項目"]) === wkName &&
            String(r["學年度"]) === String(normRec["學年度"]) &&
            String(r["系所名稱"]) === String(normRec["系所名稱"]) &&
            String(r["獲獎名次"] || r["榮譽獎項"]) === String(normRec["獲獎名次"] || normRec["榮譽獎項"]) &&
            String(r["活動起始日期"] || '') === String(normRec["活動起始日期"] || '') &&
            maskStudentNames(r["獲獎學生"]) === maskStudentNames(normRec["獲獎學生"])
        );
    }

    function isRecordAlreadyInStaging(normRec) {
        const candId = String(normRec.target_update_id || normRec["識別號"] || '').replace(/^#+/, '').trim();
        const evName = normRec["競賽或活動名稱"] || normRec["活動名稱"] || '';
        const wkName = normRec["參賽項目或作品名稱"] || normRec["競賽項目"] || '';
        return stagingRecords.some(s => {
            const sId = String(s.target_update_id || s["識別號"] || '').replace(/^#+/, '').trim();
            if (candId && sId && candId === sId) return true;
            return (s["競賽或活動名稱"] || s["活動名稱"]) === evName &&
                (s["參賽項目或作品名稱"] || s["競賽項目"]) === wkName &&
                String(s["學年度"]) === String(normRec["學年度"]) &&
                String(s["系所名稱"]) === String(normRec["系所名稱"]) &&
                maskStudentNames(s["獲獎學生"]) === maskStudentNames(normRec["獲獎學生"]);
        });
    }

    function updateStagingBadges() {
        const count = stagingRecords.length;
        const headerBadge = document.getElementById('staging-badge-count');
        const tabBadge = document.getElementById('tab-staging-count');
        const headerBtn = document.getElementById('btn-staging-center');
        if (headerBadge) headerBadge.textContent = String(count);
        if (tabBadge) tabBadge.textContent = String(count);
        if (headerBtn) headerBtn.classList.toggle('has-items', count > 0);
    }

    function enqueueRecordsToStaging(rawList, originLabel = '手動匯入', autoOpenModal = true) {
        let added = 0, skippedExact = 0, skippedDup = 0;
        (rawList || []).forEach((item, idx) => {
            if (!item || typeof item !== 'object') return;
            const norm = (item["競賽或活動名稱"] !== undefined && item["學期"] !== undefined)
                ? normalizeAwardRecord(item, true)
                : mapImportedRowToRecord(item, originLabel);
            if (item.target_update_id) {
                norm.target_update_id = String(item.target_update_id);
                if (!norm["識別號"]) norm["識別號"] = String(item.target_update_id);
            }
            const evName = norm["競賽或活動名稱"] || norm["活動名稱"] || '';
            if (!evName) return;

            if (isRecordIdenticalToFormalDb(norm)) {
                skippedExact++;
                return;
            }
            if (isRecordAlreadyInStaging(norm)) {
                skippedDup++;
                return;
            }

            const stUid = `STG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${idx}`;
            if (!isMaskedPiiString(norm["獲獎學生"]) || !isMaskedPiiString(norm["學生學號"])) {
                stagingFullPiiMap[stUid] = {
                    "獲獎學生": norm["獲獎學生"] || '無',
                    "學生學號": norm["學生學號"] || '無',
                    "學制班級": norm["學制班級"] || '無',
                    "原畢業學校": norm["原畢業學校"] || '無',
                    "佐證連結": norm["佐證連結"] || '無'
                };
            }
            const deidCopy = deidentifyRecord(norm);
            deidCopy._stagingUid = stUid;
            deidCopy._stagingOrigin = originLabel;
            deidCopy._stagingAction = checkStagingActionType(norm);
            if (norm.target_update_id) deidCopy.target_update_id = norm.target_update_id;

            stagingRecords.unshift(deidCopy);
            selectedStagingUids.add(stUid);
            added++;
        });

        saveStagingQueueOnly();
        updateStorageUI();
        if (document.getElementById('staging-modal') && document.getElementById('staging-modal').classList.contains('show')) {
            renderStagingModalData();
        }
        if (document.getElementById('diff-modal') && document.getElementById('diff-modal').classList.contains('show') && currentDiffData) {
            refreshClientDiffSummary();
            renderDiffModalData();
        }
        if (autoOpenModal && added > 0) {
            openStagingModal();
        }
        return { added, skippedExact, skippedDup };
    }

    function openStagingModal() {
        updateStorageUI();
        renderStagingModalData();
        const modal = document.getElementById('staging-modal');
        if (modal) modal.classList.add('show');
    }

    function renderStagingModalData() {
        updateStagingBadges();
        let newCnt = 0, updCnt = 0;
        stagingRecords.forEach(s => {
            s._stagingAction = checkStagingActionType(s);
            if (s._stagingAction === 'UPDATE') updCnt++;
            else newCnt++;
        });

        // 清理不存在於暫存清單的勾選 ID
        const validSet = new Set(stagingRecords.map(s => s._stagingUid));
        [...selectedStagingUids].forEach(u => {
            if (!validSet.has(u)) selectedStagingUids.delete(u);
        });

        const totalEl = document.getElementById('staging-total-count');
        const newEl = document.getElementById('staging-new-count');
        const updEl = document.getElementById('staging-update-count');
        const selEl = document.getElementById('staging-selected-count');
        const btnCommit = document.getElementById('btn-confirm-commit-staging');

        if (totalEl) totalEl.textContent = String(stagingRecords.length);
        if (newEl) newEl.textContent = String(newCnt);
        if (updEl) updEl.textContent = String(updCnt);
        if (selEl) selEl.textContent = String(selectedStagingUids.size);
        if (btnCommit) {
            btnCommit.disabled = selectedStagingUids.size === 0;
            btnCommit.innerHTML = `<i class="fa-solid fa-database"></i> 確認無誤，將勾選資料寫入正式資料庫 (${selectedStagingUids.size} 筆)`;
        }

        const tbody = document.getElementById('staging-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (stagingRecords.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 34px; color:#64748B;">
                <i class="fa-solid fa-clipboard-check" style="font-size:22px; color:#0D9488; margin-bottom:6px; display:block;"></i>
                目前暫存審核區沒有待確認之資料。<br>
                <small>當您從「網路 LOOK / 比對中心」、「自行建檔（新增獲獎紀錄）」或「匯入資料」新增紀錄時，皆會先送至此處供您檢視確認！</small>
            </td></tr>`;
            return;
        }

        stagingRecords.forEach(s => {
            const uid = s._stagingUid;
            const checked = selectedStagingUids.has(uid);
            const fullPii = stagingFullPiiMap[uid] || {};
            const dispStudent = (isAdminUnlocked && fullPii["獲獎學生"]) ? fullPii["獲獎學生"] : (s["獲獎學生"] || '無');
            const dispStuId = (isAdminUnlocked && fullPii["學生學號"]) ? fullPii["學生學號"] : (s["學生學號"] || '無');
            const targetId = s.target_update_id || s["識別號"] || '';
            const actionBadge = s._stagingAction === 'UPDATE'
                ? `<span class="badge badge-warning">🔄 更新 #${escapeHtml(targetId)}</span>`
                : `<span class="badge badge-teal">🆕 新增入庫</span>`;
            const amt = Number(s["獎助金金額"] || 0);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align:center;">
                    <input type="checkbox" class="staging-row-chk" data-uid="${escapeHtml(uid)}" ${checked ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;">
                </td>
                <td>
                    ${actionBadge}<br>
                    <small style="color:#64748B;">${escapeHtml(s._stagingOrigin || '暫存來源')}</small>
                </td>
                <td><strong>${escapeHtml(s["學年度"] || '')}</strong><br><small>${escapeHtml(s["學期"] || '')}學期</small></td>
                <td><strong>${escapeHtml(s["所屬學院"] || '')}</strong><br><small>${escapeHtml(s["系所名稱"] || '')}</small></td>
                <td>
                    <strong>${escapeHtml(s["活動名稱"] || s["競賽或活動名稱"] || '')}</strong><br>
                    <small class="text-muted">${escapeHtml(s["競賽項目"] || s["參賽項目或作品名稱"] || '')}</small>
                </td>
                <td><strong>${escapeHtml(dispStudent)}</strong><br><small class="text-muted">學號: ${escapeHtml(dispStuId)}</small></td>
                <td><span class="badge badge-gold">${escapeHtml(s["獲獎名次"] || s["榮譽獎項"] || '')}</span></td>
                <td>
                    <strong class="text-gold">${amt > 0 ? 'NT$ ' + amt.toLocaleString() : '尚待核定'}</strong><br>
                    <small>${escapeHtml(s["發放與領獎狀態"] || '尚待核定')}</small>
                </td>
                <td><span class="badge badge-info">${escapeHtml(s["資料來源"] || '無')}</span></td>
                <td>
                    <div style="display:flex; gap:5px; flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary btn-sm btn-stg-edit" data-uid="${escapeHtml(uid)}" title="檢視並修正此筆暫存欄位">
                            <i class="fa-solid fa-pen-to-square"></i> 編修
                        </button>
                        <button type="button" class="btn btn-success btn-sm btn-stg-commit-one" data-uid="${escapeHtml(uid)}" title="確認此筆無誤，直接寫入正式資料庫">
                            <i class="fa-solid fa-check"></i> 確認入庫
                        </button>
                        <button type="button" class="btn btn-outline-danger btn-sm btn-stg-remove-one" data-uid="${escapeHtml(uid)}" title="從暫存區移除">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.staging-row-chk').forEach(chk => {
            chk.addEventListener('change', (e) => {
                const u = e.currentTarget.dataset.uid;
                if (e.currentTarget.checked) selectedStagingUids.add(u);
                else selectedStagingUids.delete(u);
                renderStagingModalData();
            });
        });
        tbody.querySelectorAll('.btn-stg-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                openDetailModal(e.currentTarget.dataset.uid, true);
            });
        });
        tbody.querySelectorAll('.btn-stg-commit-one').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const u = e.currentTarget.dataset.uid;
                commitStagingUidsToFormalDb([u]);
            });
        });
        tbody.querySelectorAll('.btn-stg-remove-one').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const u = e.currentTarget.dataset.uid;
                removeStagingItems([u]);
            });
        });
    }

    function removeStagingItems(uids) {
        const rmSet = new Set((uids || []).map(String));
        stagingRecords = stagingRecords.filter(s => !rmSet.has(String(s._stagingUid)));
        rmSet.forEach(u => {
            selectedStagingUids.delete(u);
            delete stagingFullPiiMap[u];
        });
        saveStagingQueueOnly();
        renderStagingModalData();
        if (document.getElementById('diff-modal') && document.getElementById('diff-modal').classList.contains('show') && currentDiffData) {
            refreshClientDiffSummary();
            renderDiffModalData();
        }
    }

    function commitStagingUidsToFormalDb(uids) {
        const targetSet = new Set((uids || []).map(String).filter(Boolean));
        const toCommit = stagingRecords.filter(s => targetSet.has(String(s._stagingUid)));
        if (!toCommit.length) {
            alert('請先勾選至少一筆確認無誤的暫存資料！');
            return;
        }

        requireAdminUnlock(async () => {
            const fullPayloadRecords = toCommit.map(s => {
                const uid = s._stagingUid;
                const fullPii = stagingFullPiiMap[uid] || {};
                const copy = { ...s, ...fullPii };
                if (copy.target_update_id) {
                    copy["識別號"] = String(copy.target_update_id);
                }
                delete copy._stagingUid;
                delete copy._stagingOrigin;
                delete copy._stagingAction;
                delete copy.target_update_id;
                delete copy.related_table_ids;
                return copy;
            });

            let stats = { added: 0, updated: 0, skipped: 0 };
            try {
                const resp = await fetch('/api/import-awards', {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ records: fullPayloadRecords })
                });
                if (resp.ok) {
                    const res = await resp.json();
                    stats = { added: res.added_count || 0, updated: res.updated_count || 0, skipped: res.skipped_count || 0 };
                    await fetchAwardsData();
                } else {
                    stats = upsertRecordsIntoMemory(fullPayloadRecords);
                }
            } catch (_) {
                stats = upsertRecordsIntoMemory(fullPayloadRecords);
            }

            // 從暫存區移除已正式入庫項目
            stagingRecords = stagingRecords.filter(s => !targetSet.has(String(s._stagingUid)));
            targetSet.forEach(u => {
                selectedStagingUids.delete(u);
                delete stagingFullPiiMap[u];
            });

            syncEffectiveRecords();
            await saveMasterDatabaseSnapshot(true);
            renderStagingModalData();
            if (currentDiffData) {
                refreshClientDiffSummary();
                renderDiffModalData();
            }
            applyFilters(true);

            if (stagingRecords.length === 0) {
                document.getElementById('staging-modal').classList.remove('show');
            }
            showToast(`正式入庫完成！新增 ${stats.added} 筆、更新 ${stats.updated} 筆，已同步儲存至設定位置！`);
        }, '將暫存審核區資料正式寫入資料庫與儲存檔，請先完成管理員解鎖。');
    }

    function handleConfirmCommitStaging() {
        commitStagingUidsToFormalDb([...selectedStagingUids]);
    }

    async function triggerWeeklyUpdate() {
        const modal = document.getElementById('update-log-modal');
        const term = document.getElementById('update-log-terminal');
        modal.classList.add('show');

        const schoolCount = (sourcesConfigState.school_public_sources || []).length;
        const deptCount = (sourcesConfigState.department_public_sources || []).length;
        term.textContent = `[1/3] 正在 LOOK 檢視『個人雲端硬碟 / 行政會議檔案夾』同步狀態...\n` +
            `[2/3] 正在連線掃描『學校公開網頁』(${schoolCount} 個公開站台)...\n` +
            `[3/3] 正在連線掃描『系上公開網頁』(${deptCount} 個學系榮譽榜)...\n`;

        let sheetRows = [];
        const gsheetCsvUrl = (sourcesConfigState.cloud_drive_sources && sourcesConfigState.cloud_drive_sources[0] && sourcesConfigState.cloud_drive_sources[0].sheet_csv_url) || storagePrefs.auto_cloud_url || '';
        if (gsheetCsvUrl && /^https:\/\//i.test(gsheetCsvUrl)) {
            try {
                const sResp = await fetch(gsheetCsvUrl);
                if (sResp.ok) {
                    const csvTxt = await sResp.text();
                    sheetRows = parseCSVorJSON(csvTxt, '個人雲端硬碟/行政會議檔案夾');
                    term.textContent += `[雲端試算表同步] 成功讀取 ${sheetRows.length} 筆雲端紀錄！\n`;
                }
            } catch (_) {
                term.textContent += `[提示] 雲端試算表連線受瀏覽器 CORS 限制，可綁定雲端硬碟桌面資料夾同步。\n`;
            }
        }

        const latestLookupSamples = [
            ...sheetRows,
            ...VERIFIED_EPO_PUBLIC_RECORDS.map(r => ({ ...r }))
        ];

        const stgRes = enqueueRecordsToStaging(latestLookupSamples, '網路LOOK掃描', false);
        term.textContent += `\n[三大來源 LOOK 掃描完成 — 已送入暫存審核區]\n` +
            `- 新發現並送入暫存區待確認: ${stgRes.added} 筆\n` +
            `- 與正式庫完全相符略過: ${stgRes.skippedExact} 筆 | 已在暫存區: ${stgRes.skippedDup} 筆\n` +
            `👉 請點選上方「暫存審核區 (${stagingRecords.length})」檢視確認後寫入正式資料庫！`;
        if (stgRes.added > 0) {
            showToast(`網路 LOOK 掃描發現 ${stgRes.added} 筆新/補充資料，已送入「暫存審核區」待確認！`);
        } else {
            showToast('網路 LOOK 掃描完成，目前無新增差異（或已在暫存審核區中）。');
        }
    }

    async function triggerBatchNotify() {
        const pendingList = allRecords.filter(r => r["發放與領獎狀態"] === "待通知");
        if (pendingList.length === 0) {
            alert("目前沒有『待通知』的學生領獎紀錄！");
            return;
        }

        if (confirm(`確定要一鍵批量發送領獎通知給全校 ${pendingList.length} 位獲獎學生？`)) {
            try {
                await fetch('/api/dispatch-notification', {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({})
                });
            } catch (_) {}

            const todayStr = new Date().toISOString().split('T')[0];
            basePublicRecords.forEach(r => {
                if (r["發放與領獎狀態"] === "待通知") {
                    r["發放與領獎狀態"] = "通知已發送";
                    r["通知時間"] = todayStr;
                    persistStaticEditedPatch(r);
                }
            });
            syncEffectiveRecords();
            await saveMasterDatabaseSnapshot(true);
            applyFilters();
            alert(`已成功批量派發 ${pendingList.length} 封學生領獎與獎助金通知信！`);
        }
    }

    async function handleAddAwardRecord() {
        const yearVal = document.getElementById('add-year').value;
        const deptVal = document.getElementById('add-dept').value.trim() || '護理系';
        const deptCodeVal = resolveDeptCode(deptVal, document.getElementById('add-dept-code').value.trim());
        const catVal = document.getElementById('add-cat').value || '全國';
        const orgInput = document.getElementById('add-organizer').value.trim() || '無';
        const srcInput = document.getElementById('add-data-source').value.trim() || '無';
        const meetDateInput = document.getElementById('add-meeting-date').value || '';
        const evVal = document.getElementById('add-event').value.trim() || '';
        const wkVal = document.getElementById('add-work').value.trim() || '';
        const isAwardedVal = document.getElementById('add-is-awarded').value || '是';
        const amtVal = Number(document.getElementById('add-amount').value || 0);
        const levelVal = classifyCompetitionLevel(catVal, evVal, wkVal, orgInput);

        if (!evVal) {
            alert('請填寫「活動名稱」！');
            return;
        }

        const rawNewRecord = normalizeAwardRecord({
            "識別號": "",
            "學年度": yearVal,
            "學期": document.getElementById('add-term').value || '上',
            "會議記錄時間": meetDateInput,
            "活動類別": catVal,
            "活動主辦單位": orgInput,
            "活動名稱": evVal,
            "競賽項目": wkVal,
            "個人/團體競賽": document.getElementById('add-group-type').value || '個人競賽',
            "人數(男)": String(document.getElementById('add-male-count').value || '0'),
            "人數(女)": String(document.getElementById('add-female-count').value || '1'),
            "是否獲獎": isAwardedVal,
            "獲獎名次": document.getElementById('add-award').value.trim() || (isAwardedVal === '否' ? '未獲獎' : '獲獎'),
            "活動起始日期": document.getElementById('add-start-date').value || '',
            "活動結束日期": document.getElementById('add-end-date').value || '',
            "學生所屬系科 - 系所代碼": deptCodeVal,
            "競賽項目是否與就讀科系相關": document.getElementById('add-dept-rel').value || '是',
            "所屬學院": document.getElementById('add-college').value,
            "系所名稱": deptVal,
            "學制班級": document.getElementById('add-grade').value.trim() || '無',
            "獲獎學生": document.getElementById('add-student').value.trim() || '無',
            "學生學號": document.getElementById('add-stuid').value.trim() || '無',
            "指導老師": document.getElementById('add-teacher').value.trim() || '無',
            "競賽層級": document.getElementById('add-level').value || levelVal,
            "競賽或活動名稱": evVal,
            "參賽項目或作品名稱": wkVal,
            "榮譽獎項": document.getElementById('add-award').value.trim() || (isAwardedVal === '否' ? '未獲獎' : '獲獎'),
            "獎助金金額": amtVal,
            "發放與領獎狀態": isAwardedVal === '否' ? '無須發放' : (amtVal > 0 ? '待通知' : '尚待核定'),
            "通知時間": "",
            "領獎截止日期": "",
            "原畢業學校": document.getElementById('add-school').value.trim() || '無',
            "佐證連結": document.getElementById('add-url').value.trim() || '無',
            "備註": "自行建檔新增之獲獎紀錄",
            "資料來源": srcInput
        }, true);

        document.getElementById('add-modal').classList.remove('show');
        const stgRes = enqueueRecordsToStaging([rawNewRecord], '自行建檔新增', true);
        if (stgRes.added > 0) {
            showToast(`已將新建紀錄「${evVal}」送入暫存審核區，請確認無誤後寫入正式資料庫！`);
        } else {
            showToast('此筆紀錄與現有正式庫或暫存區重複，已略過。', true);
        }
    }

    // =========================================================
    // 100% 對稱雙向匯入與匯出引擎 (匯入格式完全相容所有匯出格式)
    // =========================================================
    function mapImportedRowToRecord(rawRow, fallbackSource = '112-114學年度填報資料') {
        const cleanRow = {};
        Object.entries(rawRow || {}).forEach(([k, v]) => {
            const ck = String(k || '').replace(/^[\uFEFF"\s]+|["\s]+$/g, '');
            if (!ck) return;
            let cv = v;
            if (cv instanceof Date && !isNaN(cv.getTime())) {
                cv = cv.toISOString().split('T')[0];
            } else if (cv === null || cv === undefined) {
                cv = '';
            } else {
                cv = String(cv).trim();
                if (cv.toLowerCase() === 'nan') cv = '';
            }
            cleanRow[ck] = cv;
        });

        const rawDept = cleanRow["系所名稱"] || cleanRow["學生所屬系科 - 系所代碼"] || cleanRow["學生所屬系科代碼"] || '';
        const deptName = rawDept.includes(' - ') ? rawDept.split(' - ')[0].trim() : rawDept.trim();

        let inferredCollege = cleanRow["所屬學院"] || '';
        if (!inferredCollege && window.FOOYIN_COLLEGES_MAP) {
            Object.entries(window.FOOYIN_COLLEGES_MAP).forEach(([col, depts]) => {
                if (depts.includes(deptName)) inferredCollege = col;
            });
        }
        if (!inferredCollege) inferredCollege = '護理學院';

        const yearInput = cleanRow["學年度"] || '114';
        const yearStr = yearInput.includes('學年度') ? yearInput : `${yearInput}學年度`;

        const catVal = cleanRow["活動類別"] || cleanRow["競賽層級"] || '全國';
        const evName = cleanRow["活動名稱"] || cleanRow["競賽或活動名稱"] || '';
        const wkName = cleanRow["競賽項目"] || cleanRow["參賽項目或作品名稱"] || '';
        const orgVal = cleanRow["活動主辦單位"] || '無';
        const levelVal = cleanRow["競賽層級"] || classifyCompetitionLevel(catVal, evName, wkName, orgVal);

        const rawId = String(cleanRow["識別號"] || cleanRow["#識別號"] || cleanRow["編號"] || '').replace(/^#+/, '').trim();
        const rawAmtDigits = String(cleanRow["獎助金金額"] || cleanRow["獎助金額"] || '').replace(/[^\d]/g, '');
        const amountVal = rawAmtDigits ? Number(rawAmtDigits) : 0;

        const isAwardedVal = cleanRow["是否獲獎"] || '是';
        const rkName = cleanRow["獲獎名次"] || cleanRow["榮譽獎項"] || (isAwardedVal === '否' ? '未獲獎' : '獲獎');
        const srcVal = cleanRow["資料來源"] || fallbackSource;
        const defaultStatus = isAwardedVal === '否' ? '無須發放' : (amountVal > 0 ? '待通知' : '尚待核定');

        return normalizeAwardRecord({
            "識別號": rawId,
            "學年度": yearStr,
            "學期": cleanRow["學期"] || '',
            "會議記錄時間": cleanRow["會議記錄時間"] || '',
            "活動類別": catVal,
            "活動主辦單位": orgVal,
            "活動名稱": evName,
            "競賽或活動名稱": evName,
            "競賽項目": wkName,
            "參賽項目或作品名稱": wkName,
            "個人/團體競賽": cleanRow["個人/團體競賽"] || cleanRow["個人/團體"] || '個人競賽',
            "人數(男)": cleanRow["人數(男)"] || cleanRow["男"] || '0',
            "人數(女)": cleanRow["人數(女)"] || cleanRow["女"] || '0',
            "是否獲獎": isAwardedVal,
            "獲獎名次": rkName,
            "榮譽獎項": rkName,
            "活動起始日期": cleanRow["活動起始日期"] || '',
            "活動結束日期": cleanRow["活動結束日期"] || '',
            "學生所屬系科 - 系所代碼": resolveDeptCode(deptName || '護理系', cleanRow["學生所屬系科 - 系所代碼"] || cleanRow["學生所屬系科代碼"]),
            "競賽項目是否與就讀科系相關": cleanRow["競賽項目是否與就讀科系相關"] || cleanRow["科系相關"] || '是',
            "所屬學院": inferredCollege,
            "系所名稱": deptName || '護理系',
            "學制班級": cleanRow["學制班級"] || '無',
            "獲獎學生": cleanRow["獲獎學生"] || '無',
            "學生學號": cleanRow["學生學號"] || '無',
            "指導老師": cleanRow["指導老師"] || '無',
            "競賽層級": levelVal,
            "獎助金金額": amountVal,
            "發放與領獎狀態": cleanRow["發放與領獎狀態"] || cleanRow["領獎與發放狀態"] || defaultStatus,
            "通知時間": cleanRow["通知時間"] || '',
            "領獎截止日期": cleanRow["領獎截止日期"] || '',
            "原畢業學校": cleanRow["原畢業學校"] || '無',
            "佐證連結": cleanRow["佐證連結"] || cleanRow["佐證"] || '無',
            "備註": cleanRow["備註"] || `由 ${srcVal} 匯入`,
            "資料來源": srcVal
        });
    }

    async function parseSingleImportFile(file) {
        const fname = file.name || '';
        const lower = fname.toLowerCase();
        const stem = fname.replace(/\.[^.]+$/, '');
        const inferredSource = isInternalMeetingOrWebSource(stem) ? stem : '112-114學年度填報資料';
        const fileModDate = file.lastModified ? new Date(file.lastModified).toISOString().split('T')[0] : '';

        if ((lower.endsWith('.xls') || lower.endsWith('.xlsx')) && window.XLSX) {
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
            const firstSheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[firstSheetName];
            const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

            let headerIdx = -1;
            for (let r = 0; r < Math.min(rawRows.length, 25); r++) {
                if (rawRows[r] && rawRows[r].some(cell => {
                    const str = String(cell || '').replace(/^\uFEFF/, '').trim();
                    return ['識別號', '#識別號', '編號', '學年度', '活動名稱', '競賽或活動名稱', '獲獎學生'].some(k => str.includes(k));
                })) {
                    headerIdx = r;
                    break;
                }
            }

            const extracted = [];
            if (headerIdx !== -1) {
                const headers = rawRows[headerIdx].map(c => String(c || '').replace(/^\uFEFF/, '').trim());
                let startRow = headerIdx + 1;
                if (startRow < rawRows.length && rawRows[startRow].some(c => String(c || '').trim() === '男' || String(c || '').trim() === '女') && !String(rawRows[startRow][0] || '').trim()) {
                    rawRows[startRow].forEach((subCol, cIdx) => {
                        const sc = String(subCol || '').trim();
                        if (sc === '男') headers[cIdx] = '人數(男)';
                        if (sc === '女') headers[cIdx] = '人數(女)';
                    });
                    startRow++;
                }
                for (let r = startRow; r < rawRows.length; r++) {
                    const rowArr = rawRows[r];
                    if (!rowArr || !rowArr.some(c => String(c || '').trim() !== '')) continue;
                    const obj = {};
                    headers.forEach((h, idx) => {
                        if (h && rowArr[idx] !== undefined) obj[h] = rowArr[idx];
                    });
                    if (!obj["會議記錄時間"] && isInternalMeetingOrWebSource(stem) && fileModDate) {
                        obj["會議記錄時間"] = fileModDate;
                    }
                    extracted.push(mapImportedRowToRecord(obj, inferredSource));
                }
            } else {
                const fallbackObjs = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' });
                fallbackObjs.forEach(o => extracted.push(mapImportedRowToRecord(o, inferredSource)));
            }
            return extracted;
        }

        if (lower.endsWith('.csv') || lower.endsWith('.json')) {
            const text = await file.text();
            return parseCSVorJSON(text, inferredSource);
        }
        return [];
    }

    function upsertRecordsIntoMemory(mappedRecords, fallbackSource = '112-114學年度填報資料') {
        let added = 0, updated = 0, skipped = 0;
        let nextNum = Math.max(0, ...basePublicRecords.map(r => Number(r["編號"] || 0)));

        const byId = {};
        basePublicRecords.forEach(r => {
            const id1 = String(r["識別號"] || '').replace(/^#+/, '').trim();
            const id2 = String(r["編號"] || '').trim();
            if (id1) byId[id1] = r;
            if (id2) byId[id2] = r;
        });

        const isMaskedVal = (val) => {
            const s = String(val || '');
            return s.includes('○') || s.includes('*') || s.includes('已去識別化') || s === '#protected-evidence';
        };

        mappedRecords.forEach(item => {
            const rec = item["競賽或活動名稱"] !== undefined && item["學期"] !== undefined
                ? normalizeAwardRecord(item)
                : mapImportedRowToRecord(item, fallbackSource);

            const evName = rec["競賽或活動名稱"] || rec["活動名稱"] || '';
            if (!evName) return;

            const incomingId = String(rec["識別號"] || '').replace(/^#+/, '').trim();
            if (incomingId && byId[incomingId]) {
                const targetPub = byId[incomingId];
                const recNumKey = String(targetPub["編號"]);
                const beforeSnap = JSON.stringify(convertToStandardExportRow(targetPub, true));
                let piiChanged = false;

                const compareFields = [
                    "學年度", "學期", "會議記錄時間", "活動類別", "活動主辦單位",
                    "活動名稱", "競賽或活動名稱", "競賽項目", "參賽項目或作品名稱",
                    "個人/團體競賽", "人數(男)", "人數(女)", "是否獲獎",
                    "獲獎名次", "榮譽獎項", "活動起始日期", "活動結束日期",
                    "學生所屬系科 - 系所代碼", "競賽項目是否與就讀科系相關",
                    "所屬學院", "系所名稱", "指導老師", "競賽層級",
                    "獎助金金額", "發放與領獎狀態", "通知時間", "領獎截止日期", "備註", "資料來源"
                ];

                compareFields.forEach(f => {
                    if (rec[f] !== undefined && rec[f] !== '') {
                        targetPub[f] = rec[f];
                    }
                });

                ['獲獎學生', '學生學號', '學制班級', '原畢業學校', '佐證連結'].forEach(pf => {
                    if (rec[pf] && !isMaskedVal(rec[pf])) {
                        if (!sessionFullRecordsMap[recNumKey]) {
                            sessionFullRecordsMap[recNumKey] = { ...(decryptedPiiMap && decryptedPiiMap[recNumKey] ? decryptedPiiMap[recNumKey] : {}) };
                        }
                        if (sessionFullRecordsMap[recNumKey][pf] !== rec[pf]) {
                            sessionFullRecordsMap[recNumKey][pf] = rec[pf];
                            piiChanged = true;
                        }
                        targetPub[pf] = rec[pf];
                    }
                });

                const reNorm = deidentifyRecord(normalizeAwardRecord(targetPub));
                Object.assign(targetPub, reNorm);
                const afterSnap = JSON.stringify(convertToStandardExportRow(targetPub, true));

                if (beforeSnap !== afterSnap || piiChanged) updated++;
                else skipped++;
                return;
            }

            // 新紀錄去重檢查
            const dup = basePublicRecords.some(r =>
                (r["競賽或活動名稱"] || r["活動名稱"]) === evName &&
                (r["參賽項目或作品名稱"] || r["競賽項目"]) === (rec["參賽項目或作品名稱"] || rec["競賽項目"]) &&
                String(r["學年度"]) === String(rec["學年度"]) &&
                String(r["系所名稱"]) === String(rec["系所名稱"]) &&
                String(r["獲獎名次"] || r["榮譽獎項"]) === String(rec["獲獎名次"] || rec["榮譽獎項"]) &&
                String(r["活動起始日期"] || '') === String(rec["活動起始日期"] || '')
            );

            if (dup) {
                skipped++;
                return;
            }

            nextNum++;
            rec["編號"] = nextNum;
            if (!incomingId) rec["識別號"] = String(nextNum);
            const idKey = String(nextNum);
            if (!isMaskedVal(rec["獲獎學生"])) {
                sessionFullRecordsMap[idKey] = {
                    "獲獎學生": rec["獲獎學生"],
                    "學生學號": rec["學生學號"],
                    "學制班級": rec["學制班級"],
                    "原畢業學校": rec["原畢業學校"],
                    "佐證連結": rec["佐證連結"]
                };
            }
            clearStaticRecordDeleted(rec);
            const pubCopy = deidentifyRecord(rec);
            basePublicRecords.unshift(pubCopy);
            byId[idKey] = pubCopy;
            if (incomingId) byId[incomingId] = pubCopy;
            added++;
        });

        return { added, updated, skipped };
    }

    async function importBatchFilesFromFolder(fileList, isFromLookupModal = false) {
        const supportedFiles = [...fileList].filter(f => /\.(xlsx|xls|csv|json)$/i.test(f.name || '') && !f.name.startsWith('~$'));
        const term = document.getElementById('update-log-terminal');
        const msgBox = document.getElementById('import-status-msg');

        if (supportedFiles.length === 0) {
            const warnTxt = "所選資料夾內未偵測到 .xlsx / .xls / .csv / .json 獲獎或行政會議檔案。";
            if (isFromLookupModal && term) term.textContent += `\n[提示] ${warnTxt}`;
            else alert(warnTxt);
            return;
        }

        let allMapped = [];
        for (const f of supportedFiles) {
            const rows = await parseSingleImportFile(f);
            allMapped = allMapped.concat(rows);
            if (isFromLookupModal && term) {
                term.textContent += `\n[雲端/資料夾 LOOK] 讀取檔案「${f.name}」-> 解析 ${rows.length} 筆紀錄`;
            }
        }

        const stgRes = enqueueRecordsToStaging(allMapped, '資料夾批次匯入', !isFromLookupModal);
        const summary = `已掃描 ${supportedFiles.length} 個檔案！共 ${stgRes.added} 筆新/異動紀錄送入「暫存審核區」（略過與正式庫完全相同 ${stgRes.skippedExact} 筆、已在暫存區 ${stgRes.skippedDup} 筆）。請確認無誤後寫入正式資料庫！`;
        if (isFromLookupModal && term) term.textContent += `\n[已送暫存審核區] ${summary}`;
        if (msgBox) { msgBox.style.color = '#0D9488'; msgBox.textContent = summary; }
        showToast(`資料夾掃描完成：${stgRes.added} 筆紀錄已送入暫存審核區！`);
    }

    async function handleImportData() {
        const fileInput = document.getElementById('import-file-input');
        const folderInput = document.getElementById('import-folder-input');
        const textInput = document.getElementById('import-text-input').value.trim();
        const msgBox = document.getElementById('import-status-msg');

        if (folderInput && folderInput.files && folderInput.files.length > 0) {
            await importBatchFilesFromFolder(folderInput.files, false);
            folderInput.value = '';
            document.getElementById('import-modal').classList.remove('show');
            return;
        }

        let recordsToImport = [];
        let importLabel = '檔案匯入';

        if (fileInput.files && fileInput.files.length > 0) {
            const names = [...fileInput.files].map(f => f.name).join(', ');
            importLabel = `檔案匯入 (${names})`;
            for (const f of fileInput.files) {
                const parsedRows = await parseSingleImportFile(f);
                recordsToImport = recordsToImport.concat(parsedRows);
            }
        } else if (textInput) {
            importLabel = '剪貼簿貼上匯入';
            recordsToImport = parseCSVorJSON(textInput, '手動貼上匯入');
        } else {
            alert("請選擇匯出的 .xlsx / .xls / .csv / .json 檔案、選取資料夾，或貼上資料內容！");
            return;
        }

        if (!recordsToImport || recordsToImport.length === 0) {
            msgBox.style.color = '#EF4444';
            msgBox.textContent = "無法解析有效資料列，請確認檔案包含標題列（如「識別號、學年度、活動名稱...」）。";
            return;
        }

        const stgRes = enqueueRecordsToStaging(recordsToImport, importLabel, false);
        fileInput.value = '';
        document.getElementById('import-text-input').value = '';

        if (stgRes.added > 0) {
            msgBox.style.color = '#0D9488';
            msgBox.textContent = `已解析並將 ${stgRes.added} 筆新/異動資料送入「暫存審核區」（略過無異動 ${stgRes.skippedExact} 筆）！`;
            document.getElementById('import-modal').classList.remove('show');
            openStagingModal();
            showToast(`已將 ${stgRes.added} 筆匯入資料送入「暫存審核區」，確認無誤後即可寫入正式資料庫！`);
        } else {
            msgBox.style.color = '#D97706';
            msgBox.textContent = `解析 ${recordsToImport.length} 筆紀錄，均與現有正式資料庫或暫存區相同（略過無異動 ${stgRes.skippedExact} 筆、已在暫存 ${stgRes.skippedDup} 筆）。`;
        }
    }

    function parseRFC4180Delimited(text, delimiter = ',') {
        const rows = [];
        let curRow = [];
        let curField = '';
        let inQuotes = false;
        const cleanText = text.replace(/^\uFEFF/, '');

        for (let i = 0; i < cleanText.length; i++) {
            const ch = cleanText[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (cleanText[i + 1] === '"') {
                        curField += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    curField += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === delimiter) {
                    curRow.push(curField);
                    curField = '';
                } else if (ch === '\r') {
                    if (cleanText[i + 1] === '\n') i++;
                    curRow.push(curField);
                    rows.push(curRow);
                    curRow = [];
                    curField = '';
                } else if (ch === '\n') {
                    curRow.push(curField);
                    rows.push(curRow);
                    curRow = [];
                    curField = '';
                } else {
                    curField += ch;
                }
            }
        }
        if (curField !== '' || curRow.length > 0) {
            curRow.push(curField);
            rows.push(curRow);
        }
        return rows;
    }

    function parseCSVorJSON(text, fallbackSource = '112-114學年度填報資料') {
        const trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
        if (!trimmed) return [];

        try {
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                const parsed = JSON.parse(trimmed);
                const arr = Array.isArray(parsed) ? parsed : (parsed.records || [parsed]);
                return arr.map(r => mapImportedRowToRecord(r, fallbackSource));
            }
        } catch (_) {}

        // 自動偵測 Excel 複製貼上之 Tab 分隔 (TSV) 或標準逗號分隔 (CSV)
        const firstLine = trimmed.split(/\r?\n/)[0] || '';
        const delimiter = (firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : ',';
        const matrix = parseRFC4180Delimited(trimmed, delimiter);
        if (matrix.length < 2) return [];

        // 尋找標題列
        let headerIdx = 0;
        for (let r = 0; r < Math.min(matrix.length, 15); r++) {
            if (matrix[r].some(c => ['識別號', '#識別號', '編號', '學年度', '活動名稱', '競賽或活動名稱', '獲獎學生'].some(k => String(c || '').includes(k)))) {
                headerIdx = r;
                break;
            }
        }

        const headers = matrix[headerIdx].map(h => String(h || '').replace(/^[\uFEFF"\s]+|["\s]+$/g, ''));
        const list = [];
        for (let i = headerIdx + 1; i < matrix.length; i++) {
            const vals = matrix[i];
            if (!vals || !vals.some(v => String(v || '').trim() !== '')) continue;
            const obj = {};
            headers.forEach((h, idx) => {
                if (h) obj[h] = vals[idx] !== undefined ? vals[idx] : '';
            });
            list.push(mapImportedRowToRecord(obj, fallbackSource));
        }
        return list;
    }

    // =========================================================
    // 雙模式安全匯出與模版產生引擎（匯出欄位 === 匯入欄位，最後一欄為資料來源）
    // =========================================================
    function convertToStandardExportRow(rawRec, forceMask = false) {
        const norm = normalizeAwardRecord(rawRec);
        const r = forceMask ? deidentifyRecord(norm) : norm;
        const deptCodeStr = resolveDeptCode(r["系所名稱"], r["學生所屬系科 - 系所代碼"]);
        const rawCat = String(r["活動類別"] || '').trim();
        const catExport = rawCat || ((r["競賽層級"] || '').includes('國際') ? '國際(外)' : '全國');
        const isAwarded = String(r["是否獲獎"] || '是').trim() !== '否' ? '是' : '否';

        return {
            "識別號": String(r["識別號"] || r["編號"] || ''),
            "學年度": String(r["學年度"] || '').replace(/學年度/g, '').trim(),
            "學期": r["學期"] || "上",
            "活動類別": catExport,
            "活動主辦單位": r["活動主辦單位"] || "無",
            "活動名稱": r["活動名稱"] || r["競賽或活動名稱"] || "",
            "競賽項目": r["競賽項目"] || r["參賽項目或作品名稱"] || "",
            "個人/團體競賽": r["個人/團體競賽"] || "個人競賽",
            "人數(男)": String(r["人數(男)"] !== undefined ? r["人數(男)"] : 0),
            "人數(女)": String(r["人數(女)"] !== undefined ? r["人數(女)"] : 0),
            "是否獲獎": isAwarded,
            "獲獎名次": r["獲獎名次"] || r["榮譽獎項"] || "",
            "活動起始日期": r["活動起始日期"] || r["會議記錄時間"] || "",
            "活動結束日期": r["活動結束日期"] || "",
            "學生所屬系科 - 系所代碼": deptCodeStr,
            "競賽項目是否與就讀科系相關": r["競賽項目是否與就讀科系相關"] || "是",

            "會議記錄時間": r["會議記錄時間"] || "",
            "所屬學院": r["所屬學院"] || "",
            "系所名稱": r["系所名稱"] || "",
            "學制班級": r["學制班級"] || "無",
            "獲獎學生": r["獲獎學生"] || "無",
            "學生學號": r["學生學號"] || "無",
            "指導老師": r["指導老師"] || "無",
            "競賽層級": r["競賽層級"] || "",
            "榮譽獎項": r["榮譽獎項"] || r["獲獎名次"] || "",
            "獎助金金額": Number(r["獎助金金額"] || 0),
            "發放與領獎狀態": r["發放與領獎狀態"] || (isAwarded === '否' ? "無須發放" : "尚待核定"),
            "通知時間": r["通知時間"] || "",
            "領獎截止日期": r["領獎截止日期"] || "",
            "原畢業學校": r["原畢業學校"] || "無",
            "佐證連結": r["佐證連結"] || "無",
            "備註": r["備註"] || "",
            "資料來源": r["資料來源"] || "無"
        };
    }

    function convertTo112_114OnlyRow(rawRec) {
        const full = convertToStandardExportRow(rawRec, true);
        return {
            "識別號": full["識別號"],
            "學年度": full["學年度"],
            "學期": full["學期"],
            "活動類別": full["活動類別"],
            "活動主辦單位": full["活動主辦單位"],
            "活動名稱": full["活動名稱"],
            "競賽項目": full["競賽項目"],
            "個人/團體競賽": full["個人/團體競賽"],
            "人數(男)": full["人數(男)"],
            "人數(女)": full["人數(女)"],
            "是否獲獎": full["是否獲獎"],
            "獲獎名次": full["獲獎名次"],
            "活動起始日期": full["活動起始日期"],
            "活動結束日期": full["活動結束日期"],
            "學生所屬系科 - 系所代碼": full["學生所屬系科 - 系所代碼"],
            "競賽項目是否與就讀科系相關": full["競賽項目是否與就讀科系相關"],
            "資料來源": full["資料來源"]
        };
    }

    function downloadRowsAsCSV(rows, filename) {
        if (!rows.length) return;
        const keys = Object.keys(rows[0]);
        let csvContent = "\uFEFF" + keys.join(",") + "\n";
        rows.forEach(formatted => {
            const row = keys.map(k => `"${String(formatted[k] !== undefined ? formatted[k] : '').replace(/"/g, '""')}"`).join(",");
            csvContent += row + "\n";
        });
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function downloadRowsAsExcel(rows, filename, sheetName = "獲獎紀錄清冊") {
        if (!rows.length) return;
        if (window.XLSX) {
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            XLSX.writeFile(wb, filename);
        } else {
            downloadRowsAsCSV(rows, filename.replace(/\.xlsx$/i, '.csv'));
        }
    }

    function exportDataToExcel(filename, forceMask = true) {
        if (!filteredRecords.length) return;
        const rows = filteredRecords.map(r => convertToStandardExportRow(r, forceMask));
        downloadRowsAsExcel(rows, filename, "輔英獲獎管理清冊");
    }

    function exportDataToCSV(filename, forceMask = true) {
        if (!filteredRecords.length) return;
        const rows = filteredRecords.map(r => convertToStandardExportRow(r, forceMask));
        downloadRowsAsCSV(rows, filename);
    }

    function export112To114TemplateCSV(filename) {
        if (!filteredRecords.length) return;
        const rows = filteredRecords.map(r => convertTo112_114OnlyRow(r));
        downloadRowsAsCSV(rows, filename);
    }

    function export112To114TemplateExcel(filename) {
        if (!filteredRecords.length) return;
        const rows = filteredRecords.map(r => convertTo112_114OnlyRow(r));
        downloadRowsAsExcel(rows, filename, "data_table4_8_1");
    }

    function downloadSampleImportTemplate(isFullManagementFormat = true, targetYearNum = '115') {
        const cleanYr = String(targetYearNum || '115').replace(/學年度/g, '').trim() || '115';
        const sampleBase = {
            "識別號": "",
            "學年度": cleanYr,
            "學期": "上",
            "會議記錄時間": `${Number(cleanYr) + 1911}-08-06`,
            "活動類別": "國際(外)",
            "活動主辦單位": "World Beauty Art Association (WBAA)",
            "活動名稱": "WBAA第25屆世界美容藝術與設計國際大賽",
            "競賽項目": "皮膚臉部護理",
            "個人/團體競賽": "個人競賽",
            "人數(男)": "0",
            "人數(女)": "1",
            "是否獲獎": "是",
            "獲獎名次": "金牌",
            "活動起始日期": `${Number(cleanYr) + 1911}/08/01`,
            "活動結束日期": `${Number(cleanYr) + 1911}/08/06`,
            "學生所屬系科 - 系所代碼": "健康美容系 - 3839",
            "競賽項目是否與就讀科系相關": "是",
            "所屬學院": "醫學與健康學院",
            "系所名稱": "健康美容系",
            "學制班級": "無",
            "獲獎學生": "無",
            "學生學號": "無",
            "指導老師": "黃曉玲 助理教授",
            "競賽層級": "國際競賽",
            "榮譽獎項": "金牌",
            "獎助金金額": 0,
            "發放與領獎狀態": "尚待核定",
            "通知時間": "",
            "領獎截止日期": "",
            "原畢業學校": "無",
            "佐證連結": "https://epo.fy.edu.tw/p/406-1058-76437,r1306.php?Lang=zh-tw",
            "備註": "範例格式列（識別號留空代表新增；填寫既有識別號則同步更新該筆紀錄；匯入後會先進暫存審核區）",
            "資料來源": `${cleanYr}學年度填報資料`
        };
        if (isFullManagementFormat) {
            const row = convertToStandardExportRow(sampleBase, false);
            row["識別號"] = "";
            downloadRowsAsExcel([row], `輔英獲獎系統_${cleanYr}學年度完整管理匯入模版.xlsx`, "輔英獲獎管理清冊");
        } else {
            const row = convertTo112_114OnlyRow(sampleBase);
            row["識別號"] = "";
            downloadRowsAsExcel([row], `輔英獲獎系統_${cleanYr}學年度填報匯入模版.xlsx`, "data_table4_8_1");
        }
    }

    function exportDataToJSON(filename, forceMask = true, customSourceList = null) {
        const srcList = Array.isArray(customSourceList) ? customSourceList : filteredRecords;
        const exportList = srcList.map(r => convertToStandardExportRow(r, forceMask));
        const blob = new Blob([JSON.stringify(exportList, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // =========================================================
    // 自選學年度 (112 ~ 120) 匯出模版與報表選擇引擎
    // =========================================================
    function extractAcadYearInt(recYear) {
        const m = String(recYear || '').match(/(1[12]\d)/);
        return m ? Number(m[1]) : 0;
    }

    function getCustomExportSelectionState() {
        const modeEl = document.getElementById('export-year-mode');
        const singleEl = document.getElementById('export-single-year');
        const startEl = document.getElementById('export-range-start');
        const endEl = document.getElementById('export-range-end');
        const semEl = document.getElementById('export-semester-filter');
        const fmtEl = document.getElementById('export-format-type');
        const usePageChk = document.getElementById('export-opt-use-page-filter');

        const mode = modeEl ? modeEl.value : 'all';
        const singleYr = Number(singleEl ? singleEl.value : 115) || 115;
        let startYr = Number(startEl ? startEl.value : 112) || 112;
        let endYr = Number(endEl ? endEl.value : 115) || 115;
        if (startYr > endYr) {
            const tmp = startYr;
            startYr = endYr;
            endYr = tmp;
        }
        const sem = semEl ? semEl.value : '';
        const fmt = fmtEl ? fmtEl.value : 'template-xlsx';
        const usePageFilter = Boolean(usePageChk && usePageChk.checked);

        let yearLabel = '112-120學年度';
        if (mode === 'single') yearLabel = `${singleYr}學年度`;
        else if (mode === 'range') yearLabel = startYr === endYr ? `${startYr}學年度` : `${startYr}-${endYr}學年度`;

        const semLabel = sem ? `${sem}學期` : '全部學期';
        return { mode, singleYr, startYr, endYr, sem, fmt, usePageFilter, yearLabel, semLabel };
    }

    function getRecordsForCustomExport() {
        const st = getCustomExportSelectionState();
        const pool = st.usePageFilter ? filteredRecords : allRecords;
        return pool.filter(r => {
            const y = extractAcadYearInt(r["學年度"]);
            if (st.mode === 'single') {
                if (y !== st.singleYr) return false;
            } else if (st.mode === 'range') {
                if (y < st.startYr || y > st.endYr) return false;
            } else {
                if (y < 112 || y > 120) return false;
            }
            if (st.sem && String(r["學期"] || '') !== st.sem) return false;
            return true;
        });
    }

    function updateExportOptionsUI() {
        const st = getCustomExportSelectionState();
        const singleGrp = document.getElementById('export-single-year-group');
        const startGrp = document.getElementById('export-range-start-group');
        const endGrp = document.getElementById('export-range-end-group');
        const prevLbl = document.getElementById('export-preview-label');
        const prevCnt = document.getElementById('export-preview-count');

        if (singleGrp) singleGrp.style.display = st.mode === 'single' ? 'flex' : 'none';
        if (startGrp) startGrp.style.display = st.mode === 'range' ? 'flex' : 'none';
        if (endGrp) endGrp.style.display = st.mode === 'range' ? 'flex' : 'none';

        const matched = getRecordsForCustomExport();
        if (prevLbl) prevLbl.textContent = `${st.yearLabel}（${st.semLabel}${st.usePageFilter ? '，含畫面篩選' : ''}）`;
        if (prevCnt) {
            prevCnt.textContent = st.fmt === 'blank-template-xlsx'
                ? '產生空白範例模版 1 列'
                : `共 ${matched.length} 筆紀錄`;
        }
    }

    function openExportOptionsModal(defaultFormat = 'template-xlsx') {
        const fmtEl = document.getElementById('export-format-type');
        if (fmtEl && defaultFormat) fmtEl.value = defaultFormat;

        // 若主畫面已選特定學年度，智慧同步預設值
        const activeFilterYr = filterYear && filterYear.value ? extractAcadYearInt(filterYear.value) : 0;
        const modeEl = document.getElementById('export-year-mode');
        const singleEl = document.getElementById('export-single-year');
        if (activeFilterYr >= 112 && activeFilterYr <= 120 && modeEl && singleEl) {
            modeEl.value = 'single';
            singleEl.value = String(activeFilterYr);
        }

        updateExportOptionsUI();
        const modal = document.getElementById('export-options-modal');
        if (modal) modal.classList.add('show');
    }

    function executeCustomYearExport() {
        const st = getCustomExportSelectionState();
        const semSuffix = st.sem ? `_${st.sem}學期` : '';
        const filePrefix = `${st.yearLabel}${semSuffix}`;

        if (st.fmt === 'blank-template-xlsx') {
            const sampleYr = st.mode === 'single' ? String(st.singleYr) : (st.mode === 'range' ? String(st.endYr) : '115');
            downloadSampleImportTemplate(false, sampleYr);
            document.getElementById('export-options-modal').classList.remove('show');
            showToast(`已下載 ${sampleYr}學年度 填報空白/範例匯入模版 (.xlsx)！`);
            return;
        }

        const targetRecords = getRecordsForCustomExport();
        if (targetRecords.length === 0) {
            alert(`所選範圍「${st.yearLabel}（${st.semLabel}）」目前尚無獲獎紀錄可匯出！\n若您需要該學年度的空白填報格式，請將匯出格式選為「下載所選學年度空白/範例匯入模版 (.xlsx)」。`);
            return;
        }

        const runExport = (forceMask) => {
            if (st.fmt === 'template-xlsx') {
                const rows = targetRecords.map(r => convertTo112_114OnlyRow(r));
                downloadRowsAsExcel(rows, `${filePrefix}填報資料_匯出.xlsx`, 'data_table4_8_1');
            } else if (st.fmt === 'template-csv') {
                const rows = targetRecords.map(r => convertTo112_114OnlyRow(r));
                downloadRowsAsCSV(rows, `${filePrefix}填報資料_匯出.csv`);
            } else if (st.fmt === 'public-xlsx' || st.fmt === 'admin-xlsx') {
                const rows = targetRecords.map(r => convertToStandardExportRow(r, forceMask));
                const tag = forceMask ? '公開去識別化清冊' : '完整管理清冊';
                downloadRowsAsExcel(rows, `輔英科技大學_${filePrefix}_${tag}.xlsx`, '輔英獲獎管理清冊');
            } else if (st.fmt === 'public-csv' || st.fmt === 'admin-csv') {
                const rows = targetRecords.map(r => convertToStandardExportRow(r, forceMask));
                const tag = forceMask ? '公開去識別化清冊' : '完整管理清冊';
                downloadRowsAsCSV(rows, `輔英科技大學_${filePrefix}_${tag}.csv`);
            } else if (st.fmt === 'json') {
                exportDataToJSON(`fooyin_awards_${filePrefix}.json`, forceMask, targetRecords);
            }
            document.getElementById('export-options-modal').classList.remove('show');
            showToast(`已成功匯出「${filePrefix}」共 ${targetRecords.length} 筆紀錄！`);
        };

        if (st.fmt === 'admin-xlsx' || st.fmt === 'admin-csv') {
            requireAdminUnlock(() => runExport(false), '匯出含完整學生姓名與學號之管理清冊需先驗證管理員密碼。');
        } else if (st.fmt === 'json') {
            runExport(!isAdminUnlocked);
        } else {
            runExport(true);
        }
    }

    // ==========================================
    // 差別比對中心 (會議/官網抓取 vs 現有填報資料庫 實證交叉比對)
    // ==========================================
    let currentDiffData = null;

    function refreshClientDiffSummary() {
        const fmtName = (n) => isAdminUnlocked ? n : maskStudentNames(n);
        const existingById = {};
        basePublicRecords.forEach(r => {
            const cid = String(r["識別號"] || '').replace(/^#+/, '').trim();
            if (cid) existingById[cid] = r;
        });

        let matchedCount = 0, newCount = 0, fieldDiffCount = 0;
        const diffItems = VERIFIED_EPO_PUBLIC_RECORDS.map(epo => {
            const lookupId = String(epo.target_update_id || epo["識別號"] || '').replace(/^#+/, '').trim();
            const inDb = lookupId ? existingById[lookupId] : null;
            const alreadyStaged = isRecordAlreadyInStaging(epo);

            if (inDb) {
                const dbNum = String(inDb["編號"]);
                const dbFullStu = (sessionFullRecordsMap[dbNum] && sessionFullRecordsMap[dbNum]["獲獎學生"]) ||
                    (decryptedPiiMap && decryptedPiiMap[dbNum] && decryptedPiiMap[dbNum]["獲獎學生"]) ||
                    inDb["獲獎學生"] || '無';
                const dbHasStudent = dbFullStu && dbFullStu !== '無';
                const dbHasTeacher = inDb["指導老師"] && inDb["指導老師"] !== '無';

                if (epo.target_update_id && (!dbHasStudent || !dbHasTeacher)) {
                    fieldDiffCount++;
                    const relNote = epo.related_table_ids
                        ? `對應表 4-8-1 識別號 #${epo.related_table_ids}（同賽事五項金牌）`
                        : `對應表 4-8-1 識別號 #${lookupId}`;
                    return {
                        diff_status: "欄位資訊修訂",
                        already_staged: alreadyStaged,
                        source: epo["資料來源"],
                        meeting_date: epo["會議記錄時間"],
                        student_name: fmtName(epo["獲獎學生"]),
                        event_name: `${epo["活動名稱"]}｜${epo["競賽項目"]}`,
                        award_rank: epo["獲獎名次"],
                        amount: epo["獎助金金額"],
                        crawled_detail: { ...epo },
                        explanation: `輔英新聞 (${epo["會議記錄時間"]}) 實證查核：${relNote} 原表未登載姓名與指導老師，採納可補充學生與師長資訊。`
                    };
                }

                matchedCount++;
                return {
                    diff_status: "資料完全相符",
                    already_staged: false,
                    source: epo["資料來源"],
                    meeting_date: epo["會議記錄時間"],
                    student_name: fmtName(epo["獲獎學生"]),
                    event_name: `${epo["活動名稱"]}｜${epo["競賽項目"]}`,
                    award_rank: epo["獲獎名次"],
                    amount: inDb["獎助金金額"] || epo["獎助金金額"],
                    crawled_detail: { ...epo },
                    explanation: `已完整收錄於正式資料庫（識別號 #${lookupId}，${inDb["學年度"]} ${inDb["學期"]}學期）。`
                };
            }

            newCount++;
            return {
                diff_status: "新增獲獎公告",
                already_staged: alreadyStaged,
                source: epo["資料來源"],
                meeting_date: epo["會議記錄時間"],
                student_name: fmtName(epo["獲獎學生"]),
                event_name: `${epo["活動名稱"]}｜${epo["競賽項目"]}`,
                award_rank: epo["獲獎名次"],
                amount: epo["獎助金金額"],
                crawled_detail: { ...epo },
                explanation: `自【${epo["資料來源"]}】(${epo["會議記錄時間"]}，${epo["學年度"]}${epo["學期"]}學期) 實證查核之公開新榮譽（表 4-8-1 5月結算後新增賽事）。`
            };
        });

        currentDiffData = {
            crawled_total: diffItems.length,
            matched_count: matchedCount,
            new_awards_count: newCount,
            field_diff_count: fieldDiffCount,
            diff_items: diffItems
        };
    }

    async function openDiffModal() {
        const modal = document.getElementById('diff-modal');
        const tbody = document.getElementById('diff-table-body');
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">載入會議公告與現有資料庫交叉比對結果中...</td></tr>`;
        modal.classList.add('show');

        refreshClientDiffSummary();
        renderDiffModalData();
    }

    function renderDiffModalData() {
        if (!currentDiffData) return;
        document.getElementById('diff-crawled-total').textContent = currentDiffData.crawled_total;
        document.getElementById('diff-matched-total').textContent = currentDiffData.matched_count;
        document.getElementById('diff-new-total').textContent = currentDiffData.new_awards_count;
        document.getElementById('diff-field-total').textContent = currentDiffData.field_diff_count;

        const tbody = document.getElementById('diff-table-body');
        tbody.innerHTML = '';

        currentDiffData.diff_items.forEach((item, idx) => {
            const tr = document.createElement('tr');
            let badgeClass = 'badge-purple';
            if (item.diff_status === '新增獲獎公告') badgeClass = 'badge-info';
            if (item.diff_status === '欄位資訊修訂') badgeClass = 'badge-warning';
            if (item.diff_status === '資料完全相符') badgeClass = 'badge-success';

            let actionHtml = `<span class="text-muted"><i class="fa-solid fa-check"></i> 已在庫</span>`;
            if (item.diff_status !== '資料完全相符') {
                if (item.already_staged) {
                    actionHtml = `
                        <button type="button" class="btn btn-secondary btn-sm btn-open-stg-from-diff" style="color:#0F766E; border-color:#5EEAD4; background:#F0FDFA;">
                            <i class="fa-solid fa-clipboard-check"></i> 已在暫存區 (點此審核)
                        </button>
                    `;
                } else {
                    actionHtml = `
                        <button type="button" class="btn btn-primary btn-sm btn-adopt-diff" data-idx="${idx}">
                            <i class="fa-solid fa-plus"></i> 採納送暫存
                        </button>
                    `;
                }
            }

            tr.innerHTML = `
                <td><span class="badge ${badgeClass}">${escapeHtml(item.diff_status)}</span></td>
                <td><small class="text-muted">${escapeHtml(item.source)}<br>${escapeHtml(item.meeting_date || '')}</small></td>
                <td><strong>${escapeHtml(item.student_name)}</strong></td>
                <td><strong>${escapeHtml(item.event_name)}</strong><br><small class="text-gold">${escapeHtml(item.award_rank)} (NT$ ${(Number(item.amount) || 0).toLocaleString()})</small></td>
                <td><small style="color:#64748B;">${escapeHtml(item.explanation)}</small></td>
                <td>${actionHtml}</td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-adopt-diff').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.idx);
                const target = currentDiffData.diff_items[idx];
                if (target) adoptDiffItem(target, false);
            });
        });
        tbody.querySelectorAll('.btn-open-stg-from-diff').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('diff-modal').classList.remove('show');
                openStagingModal();
            });
        });
    }

    function adoptDiffItem(item, silentBatch = false) {
        if (!item) return 0;
        const rawRec = item.crawled_detail ? { ...item.crawled_detail } : {
            "識別號": "",
            "會議記錄時間": item.meeting_date || "",
            "活動主辦單位": "無",
            "資料來源": item.source || "學校公開網頁 (輔英新聞)",
            "所屬學院": item.college || "護理學院",
            "系所名稱": item.department || "護理系",
            "學制班級": "無",
            "獲獎學生": item.student_name || "無",
            "學生學號": item.student_id || "無",
            "指導老師": "無",
            "競賽層級": "國內競賽",
            "活動名稱": item.event_name || "",
            "競賽或活動名稱": item.event_name || "",
            "競賽項目": "無",
            "參賽項目或作品名稱": "無",
            "獲獎名次": item.award_rank || "獲獎",
            "榮譽獎項": item.award_rank || "獲獎",
            "獎助金金額": Number(item.amount || 0),
            "發放與領獎狀態": Number(item.amount || 0) > 0 ? "待通知" : "尚待核定",
            "原畢業學校": "無",
            "佐證連結": "https://epo.fy.edu.tw/",
            "備註": "自公開新聞/會議紀錄查核採納"
        };

        const res = enqueueRecordsToStaging([rawRec], '比對中心採納', false);
        refreshClientDiffSummary();
        renderDiffModalData();
        if (!silentBatch) {
            if (res.added > 0) {
                showToast(`已將「${rawRec["活動名稱"]}」送入暫存審核區！可繼續採納或點「開啟暫存審核區」確認入庫。`);
            } else {
                showToast('此項目已在暫存審核區或正式資料庫中！');
            }
        }
        return res.added;
    }

    function handleMergeAllDiff() {
        if (!currentDiffData) refreshClientDiffSummary();
        const pendingItems = (currentDiffData ? currentDiffData.diff_items : []).filter(i => i.diff_status !== '資料完全相符' && !i.already_staged);
        if (pendingItems.length === 0) {
            if (stagingRecords.length > 0) {
                document.getElementById('diff-modal').classList.remove('show');
                openStagingModal();
                showToast('差異項目皆已送入暫存審核區，請檢視確認後寫入正式資料庫！');
            } else {
                showToast('目前所有公告皆與正式資料庫完全相符，無須重複採納！');
            }
            return;
        }

        let totalAdded = 0;
        pendingItems.forEach(item => {
            totalAdded += adoptDiffItem(item, true);
        });
        document.getElementById('diff-modal').classList.remove('show');
        openStagingModal();
        showToast(`已將 ${totalAdded} 筆差異項目送入「暫存審核區」，請檢視確認後按確認寫入正式資料庫！`);
    }

    // ==========================================
    // 未申請獎補助同學提醒與催辦機制
    // ==========================================
    let unappliedStudentsList = [];

    async function openUnappliedModal() {
        const modal = document.getElementById('unapplied-modal');
        const tbody = document.getElementById('unapplied-table-body');
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">載入未申請同學清冊中...</td></tr>`;
        modal.classList.add('show');

        try {
            const resp = await fetch('/api/unapplied-students', { headers: authHeaders() });
            if (resp.ok) {
                unappliedStudentsList = await resp.json();
                renderUnappliedModalData();
                return;
            }
        } catch (_) {}

        unappliedStudentsList = allRecords.filter(r =>
            ["待通知", "未申請", "逾期未申請"].includes(r["發放與領獎狀態"])
        );
        renderUnappliedModalData();
    }

    function renderUnappliedModalData() {
        const totalCount = unappliedStudentsList.length;
        let totalAmount = 0;
        unappliedStudentsList.forEach(r => totalAmount += Number(r["獎助金金額"] || 0));

        document.getElementById('unapplied-modal-count').textContent = totalCount;
        document.getElementById('unapplied-modal-amount').textContent = `$${totalAmount.toLocaleString()}`;

        const badgeCount = document.getElementById('unapplied-badge-count');
        if (badgeCount) badgeCount.textContent = totalCount;
        const kpiUnapplied = document.getElementById('kpi-unapplied-count');
        if (kpiUnapplied) kpiUnapplied.textContent = totalCount;
        const kpiSub = document.getElementById('kpi-unapplied-sub');
        if (kpiSub) kpiSub.textContent = `未簽領金額: $${totalAmount.toLocaleString()}`;

        const tbody = document.getElementById('unapplied-table-body');
        tbody.innerHTML = '';

        if (totalCount === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 30px; color:#10B981;">太棒了！全校獲獎同學皆已完成獎補助金申請與簽領作業。</td></tr>`;
            return;
        }

        unappliedStudentsList.forEach(r => {
            const tr = document.createElement('tr');
            const recId = r["編號"];
            tr.innerHTML = `
                <td><strong>#${escapeHtml(recId)}</strong></td>
                <td><strong>${escapeHtml(r["獲獎學生"] || '無')}</strong><br><small class="text-muted">學號: ${escapeHtml(r["學生學號"] || '無')}</small></td>
                <td><strong>${escapeHtml(r["所屬學院"])}</strong><br><small>${escapeHtml(r["系所名稱"])}</small></td>
                <td><strong>${escapeHtml(r["競賽或活動名稱"] || r["活動名稱"])}</strong><br><small class="text-muted">${escapeHtml(r["榮譽獎項"] || r["獲獎名次"])}</small></td>
                <td><strong class="text-gold">NT$ ${(Number(r["獎助金金額"]) || 0).toLocaleString()}</strong></td>
                <td><span class="badge badge-warning">${escapeHtml(r["發放與領獎狀態"])}</span></td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <button class="btn btn-warning btn-sm btn-send-unapplied-remind" data-id="${escapeHtml(recId)}">
                            <i class="fa-solid fa-paper-plane"></i> 發送催辦
                        </button>
                        <button class="btn btn-success btn-sm btn-sign-unapplied" data-id="${escapeHtml(recId)}">
                            <i class="fa-solid fa-signature"></i> 線上簽領
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll('.btn-send-unapplied-remind').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                requireAdminUnlock(() => sendSingleUnappliedRemind(id), '發送個人催辦通知需先完成管理員解鎖。');
            });
        });
        document.querySelectorAll('.btn-sign-unapplied').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                requireAdminUnlock(() => {
                    handleStudentSign(id);
                    openUnappliedModal();
                }, '辦理學生線上簽領請先完成管理員解鎖。');
            });
        });
    }

    async function sendSingleUnappliedRemind(recordId) {
        const target = allRecords.find(r => String(r["編號"]) === String(recordId));
        if (!target) return;
        const channel = document.getElementById('unapplied-channel-select').value;
        const todayStr = new Date().toISOString().split('T')[0];

        try {
            await fetch('/api/dispatch-unapplied-reminder', {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ record_id: recordId, channel })
            });
        } catch (_) {}

        const targetPub = basePublicRecords.find(r => String(r["編號"]) === String(recordId));
        if (targetPub) {
            targetPub["發放與領獎狀態"] = "通知已發送";
            targetPub["通知時間"] = todayStr;
        }
        syncEffectiveRecords();
        applyFilters();
        openUnappliedModal();
        alert(`已成功向 [${target["獲獎學生"]}] 同學發送獎補助金未申請催辦提醒！`);
    }

    async function triggerBatchUnappliedRemind() {
        if (unappliedStudentsList.length === 0) {
            alert("目前沒有未申請獎補助金之同學！");
            return;
        }

        if (confirm(`確定要一鍵發送催辦提醒給全體 ${unappliedStudentsList.length} 位未申請獎補助金同學？`)) {
            try {
                await fetch('/api/dispatch-unapplied-reminder', {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({})
                });
            } catch (_) {}

            const todayStr = new Date().toISOString().split('T')[0];
            basePublicRecords.forEach(r => {
                if (["待通知", "未申請", "逾期未申請"].includes(r["發放與領獎狀態"])) {
                    r["發放與領獎狀態"] = "通知已發送";
                    r["通知時間"] = todayStr;
                }
            });
            syncEffectiveRecords();
            applyFilters();
            openUnappliedModal();
            alert(`已成功批量派發 ${unappliedStudentsList.length} 封未申請獎補助同學催辦提醒信！`);
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFooyinAwardsApp);
} else {
    initFooyinAwardsApp();
}
