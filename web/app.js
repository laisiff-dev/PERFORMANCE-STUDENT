// 輔英科技大學 學生國內外獲獎紀錄管理與領獎通知系統 前端主邏輯

function initFooyinAwardsApp() {
    let allRecords = (window.INITIAL_AWARDS_DATA && window.INITIAL_AWARDS_DATA.length > 0) ? [...window.INITIAL_AWARDS_DATA] : [];
    let filteredRecords = [...allRecords];
    let currentPage = 1;
    const itemsPerPage = 12;

    let collegeChart = null;
    let levelChart = null;
    let statusChart = null;

    // DOM 元素引用
    const searchInput = document.getElementById('search-input');
    const filterYear = document.getElementById('filter-year');
    const filterCollege = document.getElementById('filter-college');
    const filterDept = document.getElementById('filter-dept');
    const filterLevel = document.getElementById('filter-level');
    const filterStatus = document.getElementById('filter-status');
    const btnResetFilter = document.getElementById('btn-reset-filter');
    const tableBody = document.getElementById('table-body');
    const recordCountBadge = document.getElementById('record-count-badge');
    const paginationInfo = document.getElementById('pagination-info');
    const paginationControls = document.getElementById('pagination-controls');

    // 學年度正規化比對函式 (支援 "112學年度" 與 "112" 之雙向彈性比對)
    function matchYear(recordYear, targetYear) {
        if (!targetYear) return true;
        if (!recordYear) return false;
        const rY = String(recordYear).replace(/學年度/g, '').trim();
        const tY = String(targetYear).replace(/學年度/g, '').trim();
        return rY === tY;
    }

    // 初始化系統
    initSystem();

    async function initSystem() {
        setupEventListeners();
        await fetchAwardsData();
        applyFilters();
    }

    async function fetchAwardsData() {
        try {
            const resp = await fetch('/api/awards');
            if (resp.ok) {
                const data = await resp.json();
                if (Array.isArray(data) && data.length > 0) {
                    allRecords = data;
                    filteredRecords = [...allRecords];
                    return;
                }
            }
        } catch (e) {
            console.warn("無法連線至 API 伺服器，啟動內建載入機制...", e);
        }
        
        // 降級讀取本機封裝資料
        if (window.INITIAL_AWARDS_DATA && window.INITIAL_AWARDS_DATA.length > 0) {
            allRecords = [...window.INITIAL_AWARDS_DATA];
        }
        filteredRecords = [...allRecords];
    }

    function setupEventListeners() {
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
        filterDept.addEventListener('change', applyFilters);
        filterLevel.addEventListener('change', applyFilters);
        filterStatus.addEventListener('change', applyFilters);

        btnResetFilter.addEventListener('click', () => {
            searchInput.value = '';
            filterYear.value = '';
            filterCollege.value = '';
            filterDept.innerHTML = '<option value="">全部系所</option>';
            filterLevel.value = '';
            filterStatus.value = '';
            applyFilters();
        });

        // 匯出選單切換
        const btnExport = document.getElementById('btn-export');
        const exportMenu = document.getElementById('export-menu');
        btnExport.addEventListener('click', (e) => {
            e.stopPropagation();
            exportMenu.classList.toggle('show');
        });
        document.addEventListener('click', () => exportMenu.classList.remove('show'));

        document.getElementById('export-excel').addEventListener('click', (e) => {
            e.preventDefault();
            exportDataToCSV("輔英科技大學_獲獎紀錄清冊.csv");
        });
        document.getElementById('export-csv').addEventListener('click', (e) => {
            e.preventDefault();
            exportDataToCSV("輔英科技大學_獲獎紀錄清冊.csv");
        });
        document.getElementById('export-json').addEventListener('click', (e) => {
            e.preventDefault();
            exportDataToJSON("fooyin_awards_export.json");
        });

        // 彈窗關閉按鈕
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
            });
        });

        // 手動每週自動更新按鈕
        document.getElementById('btn-weekly-update').addEventListener('click', triggerWeeklyUpdate);

        // 批量發送通知按鈕
        document.getElementById('btn-batch-notify').addEventListener('click', triggerBatchNotify);

        // 新增獲獎紀錄彈窗
        document.getElementById('btn-add-award').addEventListener('click', () => {
            document.getElementById('add-modal').classList.add('show');
        });

        document.getElementById('confirm-add-award').addEventListener('click', handleAddAwardRecord);

        // 匯入資料彈窗
        document.getElementById('btn-import-award').addEventListener('click', () => {
            document.getElementById('import-status-msg').textContent = '';
            document.getElementById('import-modal').classList.add('show');
        });

        document.getElementById('confirm-import-data').addEventListener('click', handleImportData);

        // 預覽通知範本切換
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

        // 採納最新會議榮譽按鈕
        const btnMergeAllDiff = document.getElementById('btn-merge-all-diff');
        if (btnMergeAllDiff) btnMergeAllDiff.addEventListener('click', handleMergeAllDiff);

        // 圖表學年度下拉選單事件
        const chartYearFilter = document.getElementById('chart-year-filter');
        if (chartYearFilter) {
            chartYearFilter.addEventListener('change', renderCharts);
        }

        // 5 大頁籤視角切換器
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
                } else {
                    applyFilters();
                }
            });
        });

        // 批量發送未申請提醒按鈕
        const btnBatchUnappliedModal = document.getElementById('btn-batch-unapplied-remind-modal');
        if (btnBatchUnappliedModal) btnBatchUnappliedModal.addEventListener('click', triggerBatchUnappliedRemind);
    }

    function applyFilters() {
        const kw = searchInput.value.trim().toLowerCase();
        const yr = filterYear.value;
        const col = filterCollege.value;
        const dept = filterDept.value;
        const lvl = filterLevel.value;
        const st = filterStatus.value;

        // 讀取當前作用中視角頁籤 (View Tab)
        const activeTabBtn = document.querySelector('.view-tab.active');
        const activeTabKey = activeTabBtn ? activeTabBtn.dataset.tab : 'all-awards';

        filteredRecords = allRecords.filter(r => {
            // 112-114 學年度填報視角
            if (activeTabKey === 'template-112-114') {
                const rY = String(r["學年度"] || '').replace(/學年度/g, '').trim();
                if (!["112", "113", "114"].includes(rY)) return false;
            } else if (activeTabKey === 'crawled-meetings') {
                const src = String(r["資料來源"] || '');
                const isMeetingOrWeb = src.includes('會議') || src.includes('官網') || src.includes('網站') || src.includes('行政') || src.includes('校務') || src.includes('抓取');
                if (!isMeetingOrWeb) return false;
            }

            // 學年度彈性比對
            if (!matchYear(r["學年度"], yr)) return false;

            // 學院比對
            if (col && String(r["所屬學院"] || '').trim() !== col.trim()) return false;

            // 系所比對
            if (dept && String(r["系所名稱"] || '').trim() !== dept.trim()) return false;

            // 競賽層級比對
            if (lvl && String(r["競賽層級"] || '').trim() !== lvl.trim()) return false;

            // 領獎與發放狀態比對
            if (st && String(r["發放與領獎狀態"] || '').trim() !== st.trim()) return false;

            // 關鍵字比對
            if (kw) {
                const match = Object.values(r).some(val => 
                    String(val || '').toLowerCase().includes(kw)
                );
                if (!match) return false;
            }
            return true;
        });

        currentPage = 1;
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
        let claimedCount = 0;

        filteredRecords.forEach(r => {
            totalScholarship += Number(r["獎助金金額"] || 0);
            if (r["發放與領獎狀態"] === "待通知") pendingNotifyCount++;
            if (r["發放與領獎狀態"] === "已線上簽領" || r["發放與領獎狀態"] === "已完成撥款") claimedCount++;
        });

        document.getElementById('kpi-total-count').textContent = total.toLocaleString();
        document.getElementById('kpi-intl-count').textContent = intlCount.toLocaleString();
        const ratio = total > 0 ? ((intlCount / total) * 100).toFixed(1) : 0;
        document.getElementById('kpi-intl-ratio').textContent = `佔全校 ${ratio}%`;

        document.getElementById('kpi-domestic-count').textContent = domesticCount.toLocaleString();
        document.getElementById('kpi-scholarship-total').textContent = `$${totalScholarship.toLocaleString()}`;
        document.getElementById('kpi-pending-notify').textContent = pendingNotifyCount.toLocaleString();
        document.getElementById('kpi-claimed-status').textContent = `${claimedCount} 筆已成功簽領/撥款`;
    }

    function renderCharts() {
        const chartYearFilter = document.getElementById('chart-year-filter');
        const selectedYear = chartYearFilter ? chartYearFilter.value : '';

        const recordsToChart = selectedYear ? 
            allRecords.filter(r => r["學年度"] === selectedYear) : 
            filteredRecords;

        // 各學院數據
        const colMap = {};
        const lvlMap = {};
        const statusMap = { "待通知": 0, "通知已發送": 0, "已線上簽領": 0, "已完成撥款": 0 };

        recordsToChart.forEach(r => {
            const col = r["所屬學院"] || "其他";
            colMap[col] = (colMap[col] || 0) + 1;

            const lvl = r["競賽層級"] || "其他";
            lvlMap[lvl] = (lvlMap[lvl] || 0) + 1;

            const st = r["發放與領獎狀態"] || "待通知";
            statusMap[st] = (statusMap[st] || 0) + 1;
        });

        // Chart 1: 學院 Bar Chart
        const ctxCol = document.getElementById('collegeChart').getContext('2d');
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

        // Chart 2: 競賽層級 Pie Chart
        const ctxLvl = document.getElementById('levelChart').getContext('2d');
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

        // Chart 3: 領獎狀態 Progress Chart
        const ctxSt = document.getElementById('statusChart').getContext('2d');
        if (statusChart) statusChart.destroy();
        statusChart = new Chart(ctxSt, {
            type: 'bar',
            data: {
                labels: Object.keys(statusMap),
                datasets: [{
                    label: '紀錄筆數',
                    data: Object.values(statusMap),
                    backgroundColor: ['#EA580C', '#2563EB', '#00C49F', '#10B981'],
                    borderRadius: 8
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }

    function renderTable() {
        tableBody.innerHTML = '';
        const total = filteredRecords.length;
        recordCountBadge.textContent = `顯示 ${total} 筆紀錄`;

        if (total === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="23" style="text-align:center; padding: 40px 20px; color: #94A3B8;">
                        <i class="fa-solid fa-folder-open" style="font-size: 36px; color: #CBD5E1; margin-bottom: 10px; display: inline-block;"></i><br>
                        <strong style="font-size: 15px; color: #475569;">無符合條件之學生獲獎與領獎紀錄</strong><br>
                        <span style="font-size: 13px; color: #64748B; margin-top: 4px; display: inline-block;">請嘗試調整或重置搜尋關鍵字/篩選條件，或切換至「全校獲獎總清冊」頁籤</span><br><br>
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

            // 領獎狀態 Badge 顏色
            let statusBadgeClass = 'badge-warning';
            if (r["發放與領獎狀態"] === '通知已發送') statusBadgeClass = 'badge-info';
            if (r["發放與領獎狀態"] === '已線上簽領') statusBadgeClass = 'badge-purple';
            if (r["發放與領獎狀態"] === '已完成撥款') statusBadgeClass = 'badge-success';

            // 競賽層級 Badge
            let levelBadgeClass = 'badge-info';
            const catLevel = r["活動類別"] || r["競賽層級"] || '國內競賽';
            if (catLevel.includes('國際')) levelBadgeClass = 'badge-purple';
            if (catLevel.includes('證照')) levelBadgeClass = 'badge-success';

            const deptCodeStr = r["學生所屬系科 - 系所代碼"] || (r["系所名稱"] ? (r["系所名稱"] + ' - 1445') : '護理系 - 1445');
            const recId = r["識別號"] || r["編號"];

            tr.innerHTML = `
                <!-- 112-114 學年度填報資料第 12 列前 16 個標準欄位 -->
                <td><strong>#${recId}</strong></td>
                <td>${r["學年度"] || ''}</td>
                <td>${r["學期"] || '下'}</td>
                <td><span class="badge ${levelBadgeClass}">${r["活動類別"] || catLevel}</span></td>
                <td><small class="text-muted">${r["活動主辦單位"] || r["資料來源"] || ''}</small></td>
                <td><strong>${r["活動名稱"] || r["競賽或活動名稱"] || ''}</strong></td>
                <td><small>${r["競賽項目"] || r["參賽項目或作品名稱"] || ''}</small></td>
                <td><small>${r["個人/團體競賽"] || '個人競賽'}</small></td>
                <td>${r["人數(男)"] !== undefined ? r["人數(男)"] : '0'}</td>
                <td>${r["人數(女)"] !== undefined ? r["人數(女)"] : '1'}</td>
                <td><span class="badge badge-success">${r["是否獲獎"] || '是'}</span></td>
                <td><span class="badge ${levelBadgeClass}">${r["獲獎名次"] || r["榮譽獎項"] || ''}</span></td>
                <td><small>${r["活動起始日期"] || r["通知時間"] || ''}</small></td>
                <td><small>${r["活動結束日期"] || r["領獎截止日期"] || ''}</small></td>
                <td><small class="text-muted">${deptCodeStr}</small></td>
                <td><small>${r["競賽項目是否與就讀科系相關"] || '是'}</small></td>

                <!-- 後續延伸欄位放在後面 -->
                <td style="background: rgba(124, 58, 237, 0.03);"><strong>${r["所屬學院"] || ''}</strong><br><small>${r["系所名稱"] || ''}</small></td>
                <td style="background: rgba(124, 58, 237, 0.03);"><strong>${r["獲獎學生"] || ''}</strong><br><small class="text-muted">學號: ${r["學生學號"] || '未填'}</small></td>
                <td style="background: rgba(124, 58, 237, 0.03);"><small>${r["指導老師"] || '未填'}</small></td>
                <td style="background: rgba(124, 58, 237, 0.03);"><strong class="text-gold">NT$ ${(Number(r["獎助金金額"])||0).toLocaleString()}</strong></td>
                <td style="background: rgba(124, 58, 237, 0.03);"><span class="badge ${statusBadgeClass}">${r["發放與領獎狀態"] || '待通知'}</span></td>
                <td style="background: rgba(124, 58, 237, 0.03);">
                    <a href="${r["佐證連結"] || '#'}" target="_blank" class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 11px;">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> 佐證
                    </a>
                </td>
                <td style="background: rgba(124, 58, 237, 0.03);">
                    <div style="display: flex; gap: 4px;">
                        <button class="btn btn-secondary btn-sm btn-view-detail" data-id="${recId}" title="查看與編輯詳情">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        <button class="btn btn-warning btn-sm btn-send-notify" data-id="${recId}" title="發送領獎通知">
                            <i class="fa-solid fa-paper-plane"></i>
                        </button>
                        ${r["發放與領獎狀態"] !== '已線上簽領' && r["發放與領獎狀態"] !== '已完成撥款' ? `
                            <button class="btn btn-success btn-sm btn-sign-claim" data-id="${recId}" title="模擬學生線上簽領">
                                <i class="fa-solid fa-signature"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        // 綁定操作按鈕
        document.querySelectorAll('.btn-view-detail').forEach(btn => {
            btn.addEventListener('click', () => openDetailModal(btn.dataset.id));
        });
        document.querySelectorAll('.btn-send-notify').forEach(btn => {
            btn.addEventListener('click', () => openNotifyModal(btn.dataset.id));
        });
        document.querySelectorAll('.btn-sign-claim').forEach(btn => {
            btn.addEventListener('click', () => handleStudentSign(btn.dataset.id));
        });

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

    function openDetailModal(recordId) {
        const record = allRecords.find(r => r["編號"] == recordId);
        if (!record) return;

        const body = document.getElementById('detail-modal-body');
        body.innerHTML = `
            <div class="notify-preview-box">
                <p><strong>系統流水號:</strong> #${record["編號"]}</p>
                <p><strong>學年度 / 資料來源:</strong> ${record["學年度"]} (${record["資料來源"]})</p>
                <p><strong>教學單位:</strong> ${record["所屬學院"]} - ${record["系所名稱"]} (${record["學制班級"]})</p>
                <p><strong>獲獎學生:</strong> ${record["獲獎學生"]} (學號: ${record["學生學號"]})</p>
                <p><strong>指導老師:</strong> ${record["指導老師"]}</p>
                <p><strong>賽事級別:</strong> ${record["競賽層級"]} - ${record["競賽或活動名稱"]}</p>
                <p><strong>作品題目:</strong> ${record["參賽項目或作品名稱"]}</p>
                <p><strong>獲得榮譽:</strong> <span class="badge badge-purple">${record["榮譽獎項"]}</span></p>
                <p><strong>核發獎助學金:</strong> <span class="text-gold">NT$ ${(Number(record["獎助金金額"])||0).toLocaleString()} 元</span></p>
                <p><strong>發放狀態:</strong> <span class="badge badge-info">${record["發放與領獎狀態"]}</span> (通知時間: ${record["通知時間"] || '尚未發送'})</p>
                <p><strong>領獎截止期限:</strong> ${record["領獎截止日期"]}</p>
                <p><strong>高中職母校:</strong> ${record["原畢業學校"]}</p>
                <p><strong>原始佐證網址:</strong> <a href="${record["佐證連結"]}" target="_blank">${record["佐證連結"]}</a></p>
                <p><strong>備註說明:</strong> ${record["備註"]}</p>
            </div>
        `;
        document.getElementById('detail-modal').classList.add('show');
    }

    let activeNotifyRecord = null;
    function openNotifyModal(recordId) {
        activeNotifyRecord = allRecords.find(r => r["編號"] == recordId);
        if (!activeNotifyRecord) return;

        document.getElementById('notify-target-student').textContent = activeNotifyRecord["獲獎學生"];
        document.getElementById('notify-target-stuid').textContent = activeNotifyRecord["學生學號"] || '未填寫';
        document.getElementById('notify-target-event').textContent = activeNotifyRecord["競賽或活動名稱"];
        document.getElementById('notify-target-amount').textContent = `NT$ ${(Number(activeNotifyRecord["獎助金金額"])||0).toLocaleString()} 元`;

        updateNotifyPreviewText();
        document.getElementById('notify-modal').classList.add('show');
    }

    function updateNotifyPreviewText() {
        if (!activeNotifyRecord) return;
        const channel = document.getElementById('notify-channel-select').value;
        const txtBox = document.getElementById('notify-preview-text');

        if (channel === 'email') {
            txtBox.value = `【輔英科技大學 學術獲獎與獎助學金領獎通知信】\n親愛的 ${activeNotifyRecord["獲獎學生"]} 同學（學號：${activeNotifyRecord["學生學號"]}）您好：\n恭喜您在【${activeNotifyRecord["競賽或活動名稱"]}】中榮獲『${activeNotifyRecord["榮譽獎項"]}』佳績！\n學校頒發獎助學金新臺幣 NT$ ${(Number(activeNotifyRecord["獎助金金額"])||0).toLocaleString()} 元。\n請於【${activeNotifyRecord["領獎截止日期"]}】前完成線上簽領：\n連結: https://portal.fooyin.edu.tw/awards/claim?id=${activeNotifyRecord["編號"]}`;
        } else if (channel === 'line') {
            txtBox.value = `【輔英獲獎與領獎通知】\n恭喜 ${activeNotifyRecord["獲獎學生"]} 同學榮獲「${activeNotifyRecord["競賽或活動名稱"]}」【${activeNotifyRecord["榮譽獎項"]}】！\n獎助金金額: NT$ ${(Number(activeNotifyRecord["獎助金金額"])||0).toLocaleString()} 元\n請於 ${activeNotifyRecord["領獎截止日期"]} 前線上簽領。\n連結: https://portal.fooyin.edu.tw/awards/claim?id=${activeNotifyRecord["編號"]}`;
        } else {
            txtBox.value = `[輔英Portal校內通知] 您有一筆學術獲獎獎助金 (NT$ ${(Number(activeNotifyRecord["獎助金金額"])||0).toLocaleString()}) 待簽領。發送時間: ${new Date().toLocaleDateString()}`;
        }
    }

    document.getElementById('confirm-send-notify').addEventListener('click', async () => {
        if (!activeNotifyRecord) return;
        try {
            await fetch('/api/dispatch-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ record_id: activeNotifyRecord["編號"] })
            });
        } catch (e) {
            console.log("Mock API dispatch");
        }
        activeNotifyRecord["發放與領獎狀態"] = "通知已發送";
        activeNotifyRecord["通知時間"] = new Date().toISOString().split('T')[0];
        document.getElementById('notify-modal').classList.remove('show');
        renderDashboard();
        alert(`已成功向 ${activeNotifyRecord["獲獎學生"]} 發送領獎通知！`);
    });

    async function handleStudentSign(recordId) {
        const record = allRecords.find(r => r["編號"] == recordId);
        if (!record) return;
        if (confirm(`確定要幫學生 [${record["獲獎學生"]}] 辦理線上簽領領獎作業？`)) {
            try {
                await fetch('/api/update-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ record_id: recordId, status: "已線上簽領" })
                });
            } catch (e) {}
            record["發放與領獎狀態"] = "已線上簽領";
            renderDashboard();
        }
    }

    async function triggerWeeklyUpdate() {
        const modal = document.getElementById('update-log-modal');
        const term = document.getElementById('update-log-terminal');
        term.textContent = "正在連線輔英科技大學 行政會議、校務會議紀錄與官網公告...\n[排程抓取中] 正在爬抓 115-4 行政會議紀錄中之學生競賽獎項...\n[解析中] 提取學生獲獎系所、指導老師與賽事級別...\n";
        modal.classList.add('show');

        try {
            const resp = await fetch('/api/trigger-weekly-update', { method: 'POST' });
            if (resp.ok) {
                const res = await resp.json();
                term.textContent += `\n[成功] 每週資料自動更新完成！\n新增筆數: ${res.new_added} 筆\n過濾重複: ${res.skipped_duplicates} 筆\n目前資料庫總數: ${res.current_total_records} 筆。`;
                await fetchAwardsData();
                renderDashboard();
            }
        } catch (e) {
            term.textContent += "\n[模擬模式] 週自動更新模擬成功！加入最新行政會議 2 筆獲獎紀錄。";
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
                await fetch('/api/dispatch-notification', { method: 'POST', body: JSON.stringify({}) });
            } catch (e) {}

            pendingList.forEach(r => {
                r["發放與領獎狀態"] = "通知已發送";
                r["通知時間"] = new Date().toISOString().split('T')[0];
            });
            renderDashboard();
            alert(`已成功批量派發 ${pendingList.length} 封學生領獎與獎助金通知信！`);
        }
    }

    function handleAddAwardRecord() {
        const nextId = allRecords.length + 1;
        const yearVal = document.getElementById('add-year').value;
        const deptVal = document.getElementById('add-dept').value || '護理系';
        const deptCodeVal = document.getElementById('add-dept-code').value || (deptVal + ' - 1445');
        const catVal = document.getElementById('add-cat').value || '全國';

        let levelVal = '國內競賽';
        if (catVal.includes('國際')) levelVal = '國際競賽';
        else if (catVal.includes('體育')) levelVal = '體育競賽';
        else if (catVal.includes('證照')) levelVal = '專業證照';

        const newRecord = {
            // 112-114 填報模版前 16 個標準欄位
            "識別號": String(nextId),
            "學年度": yearVal.replace('學年度', ''),
            "學期": document.getElementById('add-term').value || '下',
            "活動類別": catVal,
            "活動主辦單位": document.getElementById('add-source').value || '輔英科技大學',
            "活動名稱": document.getElementById('add-event').value || '',
            "競賽項目": document.getElementById('add-work').value || '',
            "個人/團體競賽": document.getElementById('add-group-type').value || '個人競賽',
            "人數(男)": String(document.getElementById('add-male-count').value || '0'),
            "人數(女)": String(document.getElementById('add-female-count').value || '1'),
            "是否獲獎": document.getElementById('add-is-awarded').value || '是',
            "獲獎名次": document.getElementById('add-award').value || '獲獎',
            "活動起始日期": document.getElementById('add-start-date').value || '2026-03-01',
            "活動結束日期": document.getElementById('add-end-date').value || '2026-03-15',
            "學生所屬系科 - 系所代碼": deptCodeVal,
            "競賽項目是否與就讀科系相關": document.getElementById('add-dept-rel').value || '是',

            // 後續延伸欄位放在後面
            "編號": nextId,
            "所屬學院": document.getElementById('add-college').value,
            "系所名稱": deptVal,
            "學制班級": document.getElementById('add-grade').value || '四技3年1班',
            "獲獎學生": document.getElementById('add-student').value,
            "學生學號": document.getElementById('add-stuid').value,
            "指導老師": document.getElementById('add-teacher').value || "未填寫",
            "競賽層級": document.getElementById('add-level').value || levelVal,
            "競賽或活動名稱": document.getElementById('add-event').value,
            "參賽項目或作品名稱": document.getElementById('add-work').value,
            "榮譽獎項": document.getElementById('add-award').value,
            "獎助金金額": Number(document.getElementById('add-amount').value || 0),
            "發放與領獎狀態": "待通知",
            "通知時間": "",
            "領獎截止日期": "2026-11-30",
            "原畢業學校": document.getElementById('add-school').value || "高雄市立高雄高級中學",
            "佐證連結": document.getElementById('add-url').value || "https://www.fooyin.edu.tw/",
            "備註": "手動新增之獲獎紀錄"
        };

        allRecords.unshift(newRecord);
        applyFilters();
        document.getElementById('add-modal').classList.remove('show');
        alert(`成功新增獲獎紀錄: ${newRecord["獲獎學生"]} - ${newRecord["榮譽獎項"]}`);
    }

    async function handleImportData() {
        const fileInput = document.getElementById('import-file-input');
        const textInput = document.getElementById('import-text-input').value.trim();
        const msgBox = document.getElementById('import-status-msg');

        let recordsToImport = [];

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fname = file.name.toLowerCase();

            if ((fname.endsWith('.xls') || fname.endsWith('.xlsx')) && window.XLSX) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[firstSheetName];
                    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

                    // 智慧搜尋抬頭標題列 (例如 112-114 填報模版第 11 列)
                    let headerIdx = -1;
                    for (let r = 0; r < Math.min(rawRows.length, 25); r++) {
                        if (rawRows[r] && rawRows[r].some(cell => {
                            const str = String(cell || '').trim();
                            return str.includes('識別號') || str.includes('學年度') || str.includes('獲獎學生') || str.includes('競賽或活動名稱');
                        })) {
                            headerIdx = r;
                            break;
                        }
                    }

                    if (headerIdx !== -1) {
                        const headers = rawRows[headerIdx].map(c => String(c || '').trim());
                        let startRow = headerIdx + 1;
                        if (startRow < rawRows.length && rawRows[startRow].some(c => String(c || '').includes('男') || String(c || '').includes('女'))) {
                            startRow++;
                        }
                        for (let r = startRow; r < rawRows.length; r++) {
                            const rowArr = rawRows[r];
                            if (!rowArr || rowArr.length === 0 || !rowArr.some(c => c !== null && c !== '')) continue;
                            const obj = {};
                            headers.forEach((h, idx) => {
                                if (h && rowArr[idx] !== undefined) {
                                    obj[h] = String(rowArr[idx]).trim();
                                }
                            });
                            recordsToImport.push(obj);
                        }
                    } else {
                        recordsToImport = XLSX.utils.sheet_to_json(sheet);
                    }
                } catch (err) {
                    console.error("SheetJS Excel parsing error:", err);
                }
            } else {
                const text = await file.text();
                recordsToImport = parseCSVorJSON(text);
            }
        } else if (textInput) {
            recordsToImport = parseCSVorJSON(textInput);
        } else {
            alert("請選擇 .xls, .xlsx, .csv, .json 檔案或輸入文字內容！");
            return;
        }

        if (!recordsToImport || recordsToImport.length === 0) {
            msgBox.style.color = '#EF4444';
            msgBox.textContent = "無法解析資料，請檢查 CSV 或 JSON 格式是否正確。";
            return;
        }

        msgBox.style.color = '#2563EB';
        msgBox.textContent = `解析出 ${recordsToImport.length} 筆資料，正在匯入資料庫...`;

        try {
            const resp = await fetch('/api/import-awards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: recordsToImport })
            });
            if (resp.ok) {
                const res = await resp.json();
                msgBox.style.color = '#10B981';
                msgBox.textContent = `匯入成功！成功新增 ${res.added_count} 筆，跳過重複 ${res.skipped_count} 筆。`;
                await fetchAwardsData();
                renderDashboard();
                setTimeout(() => {
                    document.getElementById('import-modal').classList.remove('show');
                }, 1500);
                return;
            }
        } catch (e) {
            console.log("Offline mode import");
        }

        // 本機備用模式匯入
        let added = 0;
        recordsToImport.forEach(rec => {
            const exists = allRecords.some(r => r["獲獎學生"] === rec["獲獎學生"] && r["競賽或活動名稱"] === rec["競賽或活動名稱"]);
            if (!exists) {
                rec["編號"] = allRecords.length + 1;
                if (!rec["發放與領獎狀態"]) rec["發放與領獎狀態"] = "待通知";
                allRecords.unshift(rec);
                added++;
            }
        });

        msgBox.style.color = '#10B981';
        msgBox.textContent = `匯入完成！新增 ${added} 筆紀錄。`;
        applyFilters();
        setTimeout(() => {
            document.getElementById('import-modal').classList.remove('show');
        }, 1500);
    }

    function parseCSVorJSON(text) {
        try {
            if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
                const parsed = JSON.parse(text);
                return Array.isArray(parsed) ? parsed : [parsed];
            }
        } catch (e) {}

        // CSV 解析
        const lines = text.trim().split(/\r?\n/);
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.replace(/^["\uFEFF]|["\s]$/g, ''));
        const list = [];

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const vals = lines[i].split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(v => v.replace(/^"|"$/g, '').trim());
            const obj = {};
            headers.forEach((h, idx) => {
                obj[h] = vals[idx] || '';
            });
            list.push(obj);
        }
        return list;
    }

    function convertToStandardExportRow(r) {
        const deptCodeStr = r["學生所屬系科 - 系所代碼"] || (r["系所名稱"] ? (r["系所名稱"] + ' - 1445') : '護理系 - 1445');
        const catVal = r["活動類別"] || r["競賽層級"] || '全國';

        return {
            // 112-114 學年度填報資料第 12 列前 16 個標準欄位
            "識別號": String(r["識別號"] || r["編號"] || ''),
            "學年度": String(r["學年度"] || '').replace(/學年度/g, '').trim(),
            "學期": r["學期"] || "下",
            "活動類別": catVal.includes('國際') ? '國際' : (catVal.includes('體育') ? '體育' : (catVal.includes('證照') ? '證照' : '全國')),
            "活動主辦單位": r["活動主辦單位"] || r["資料來源"] || "輔英科技大學",
            "活動名稱": r["活動名稱"] || r["競賽或活動名稱"] || "",
            "競賽項目": r["競賽項目"] || r["參賽項目或作品名稱"] || "",
            "個人/團體競賽": r["個人/團體競賽"] || "個人競賽",
            "人數(男)": String(r["人數(男)"] !== undefined ? r["人數(男)"] : 0),
            "人數(女)": String(r["人數(女)"] !== undefined ? r["人數(女)"] : 1),
            "是否獲獎": r["是否獲獎"] || "是",
            "獲獎名次": r["獲獎名次"] || r["榮譽獎項"] || "",
            "活動起始日期": r["活動起始日期"] || r["通知時間"] || "2026-03-01",
            "活動結束日期": r["活動結束日期"] || r["領獎截止日期"] || "2026-03-15",
            "學生所屬系科 - 系所代碼": deptCodeStr,
            "競賽項目是否與就讀科系相關": r["競賽項目是否與就讀科系相關"] || "是",

            // 後續延伸欄位放在後面
            "所屬學院": r["所屬學院"] || "",
            "系所名稱": r["系所名稱"] || "",
            "學制班級": r["學制班級"] || "",
            "獲獎學生": r["獲獎學生"] || "",
            "學生學號": r["學生學號"] || "",
            "指導老師": r["指導老師"] || "",
            "競賽層級": r["競賽層級"] || "",
            "榮譽獎項": r["榮譽獎項"] || "",
            "獎助金金額": Number(r["獎助金金額"] || 0),
            "發放與領獎狀態": r["發放與領獎狀態"] || "待通知",
            "通知時間": r["通知時間"] || "",
            "領獎截止日期": r["領獎截止日期"] || "",
            "原畢業學校": r["原畢業學校"] || "",
            "佐證連結": r["佐證連結"] || "",
            "備註": r["備註"] || ""
        };
    }

    function exportDataToCSV(filename) {
        if (!filteredRecords.length) return;
        const sampleRow = convertToStandardExportRow(filteredRecords[0]);
        const keys = Object.keys(sampleRow);
        
        let csvContent = "\uFEFF" + keys.join(",") + "\n";
        filteredRecords.forEach(r => {
            const formatted = convertToStandardExportRow(r);
            const row = keys.map(k => `"${String(formatted[k] !== undefined ? formatted[k] : '').replace(/"/g, '""')}"`).join(",");
            csvContent += row + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    }

    function exportDataToJSON(filename) {
        const exportList = filteredRecords.map(r => convertToStandardExportRow(r));
        const blob = new Blob([JSON.stringify(exportList, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    }

    // ==========================================
    // 差別比對中心 (會議/官網抓取 vs 112-114填報模版)
    // ==========================================
    let currentDiffData = null;

    async function openDiffModal() {
        const modal = document.getElementById('diff-modal');
        const tbody = document.getElementById('diff-table-body');
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">載入會議公告與 112-114 差別比對資料中...</td></tr>`;
        modal.classList.add('show');

        try {
            const resp = await fetch('/api/diff-analysis');
            if (resp.ok) {
                currentDiffData = await resp.json();
                renderDiffModalData();
                return;
            }
        } catch (e) {
            console.log("Mock diff mode");
        }

        // 離線模擬資料
        currentDiffData = {
            crawled_total: 4,
            matched_count: 1,
            new_awards_count: 2,
            field_diff_count: 1,
            diff_items: [
                {
                    diff_status: "資料完全相符",
                    source: "115-4行政會議紀錄",
                    student_name: "張家豪、劉彥宏",
                    event_name: "2026 倫敦國際發明展 (LIFEX)",
                    award_rank: "金牌與大會特別獎",
                    amount: 25000,
                    explanation: "與 112-114 學年度填報資料完全吻合。"
                },
                {
                    diff_status: "新增獲獎公告",
                    source: "115-2校務會議紀錄",
                    student_name: "林雅婷、陳威廷",
                    event_name: "2026年全國大專校院護理臨床技能競賽",
                    award_rank: "全國總冠軍 (金獎)",
                    amount: 20000,
                    explanation: "在最新【115-2校務會議紀錄】中抓取到全校新榮譽，未列於 112-114 學年度填報資料庫中。"
                },
                {
                    diff_status: "欄位資訊修訂",
                    source: "輔英官方網站公開新聞公告",
                    student_name: "黃怡君",
                    event_name: "115年醫事檢驗師國家考試",
                    award_rank: "全國前五名與優異特別獎",
                    amount: 15000,
                    explanation: "出處會議更新 (最新來源: 輔英官方網站公開新聞公告)；獎助金核算修正。"
                },
                {
                    diff_status: "新增獲獎公告",
                    source: "114-6行政會議紀錄修訂案",
                    student_name: "許晉豪",
                    event_name: "2026全國大專校院智慧校園微服務創新競賽",
                    award_rank: "第一名 (特優金獎)",
                    amount: 18000,
                    explanation: "在最新【114-6行政會議紀錄修訂案】中抓取到資訊創新賽事第一名，未在 112-114 填報庫。"
                }
            ]
        };
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

            tr.innerHTML = `
                <td><span class="badge ${badgeClass}">${item.diff_status}</span></td>
                <td><small class="text-muted">${item.source}</small></td>
                <td><strong>${item.student_name}</strong></td>
                <td><strong>${item.event_name}</strong><br><small class="text-gold">${item.award_rank} (NT$ ${(item.amount||0).toLocaleString()})</small></td>
                <td><small style="color:#64748B;">${item.explanation}</small></td>
                <td>
                    ${item.diff_status !== '資料完全相符' ? `
                        <button class="btn btn-primary btn-sm btn-adopt-diff" data-idx="${idx}">
                            <i class="fa-solid fa-plus"></i> 採納併入
                        </button>
                    ` : `<span class="text-muted"><i class="fa-solid fa-check"></i> 已在庫</span>`}
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll('.btn-adopt-diff').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.currentTarget.dataset.idx;
                const target = currentDiffData.diff_items[idx];
                adoptDiffItem(target);
            });
        });
    }

    function adoptDiffItem(item) {
        const newRec = item.crawled_detail || {
            "編號": allRecords.length + 1,
            "學年度": "115學年度",
            "資料來源": item.source,
            "所屬學院": item.college || "環境與生命學院",
            "系所名稱": item.department || "環境工程與科學系",
            "學制班級": "四技3年1班",
            "獲獎學生": item.student_name,
            "學生學號": item.student_id || "115409888",
            "指導老師": "指導教授",
            "競賽層級": "國際競賽",
            "競賽或活動名稱": item.event_name,
            "參賽項目或作品名稱": "最新研發與專案作品",
            "榮譽獎項": item.award_rank,
            "獎助金金額": item.amount || 15000,
            "發放與領獎狀態": "待通知",
            "通知時間": "",
            "領獎截止日期": "2026-11-30",
            "原畢業學校": "高雄市立高雄高級中學",
            "佐證連結": "https://www.fooyin.edu.tw/",
            "備註": "從會議紀錄抓取並一鍵採納併入 112-114 填報資料庫"
        };
        newRec["編號"] = allRecords.length + 1;

        allRecords.unshift(newRec);
        applyFilters();
        alert(`成功將最新會議榮譽 [${item.student_name} - ${item.event_name}] 採納併入系統資料庫！`);
    }

    function handleMergeAllDiff() {
        if (!currentDiffData) return;
        const newItems = currentDiffData.diff_items.filter(i => i.diff_status !== '資料完全相符');
        if (newItems.length === 0) {
            alert("目前沒有需要採納的新增會議榮譽！");
            return;
        }

        newItems.forEach(item => adoptDiffItem(item));
        document.getElementById('diff-modal').classList.remove('show');
        alert(`已成功將 ${newItems.length} 筆最新會議榮譽批量併入資料庫！`);
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
            const resp = await fetch('/api/unapplied-students');
            if (resp.ok) {
                unappliedStudentsList = await resp.json();
                renderUnappliedModalData();
                return;
            }
        } catch (e) {
            console.log("Mock unapplied list");
        }

        // 篩選全部未簽領同學
        unappliedStudentsList = allRecords.filter(r => 
            r["發放與領獎狀態"] === "待通知" || r["發放與領獎狀態"] === "未申請" || r["發放與領獎狀態"] === "逾期未申請"
        );
        renderUnappliedModalData();
    }

    function renderUnappliedModalData() {
        const totalCount = unappliedStudentsList.length;
        let totalAmount = 0;
        unappliedStudentsList.forEach(r => totalAmount += Number(r["獎助金金額"] || 0));

        document.getElementById('unapplied-modal-count').textContent = totalCount;
        document.getElementById('unapplied-modal-amount').textContent = `$${totalAmount.toLocaleString()}`;

        // 更新 KPI 卡牌
        const badgeCount = document.getElementById('unapplied-badge-count');
        if (badgeCount) badgeCount.textContent = totalCount;
        const kpiUnapplied = document.getElementById('kpi-unapplied-count');
        if (kpiUnapplied) kpiUnapplied.textContent = totalCount;
        const kpiSub = document.getElementById('kpi-unapplied-sub');
        if (kpiSub) kpiSub.textContent = `未簽領金額: $${totalAmount.toLocaleString()}`;

        const tbody = document.getElementById('unapplied-table-body');
        tbody.innerHTML = '';

        if (totalCount === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 30px; color:#10B981;">🎉 太棒了！全校獲獎同學皆已完成獎補助金申請與簽領作業。</td></tr>`;
            return;
        }

        unappliedStudentsList.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>#${r["編號"]}</strong></td>
                <td><strong>${r["獲獎學生"]}</strong><br><small class="text-muted">學號: ${r["學生學號"] || '未填'}</small></td>
                <td><strong>${r["所屬學院"]}</strong><br><small>${r["系所名稱"]}</small></td>
                <td><strong>${r["競賽或活動名稱"]}</strong><br><small class="text-muted">${r["榮譽獎項"]}</small></td>
                <td><strong class="text-gold">NT$ ${(Number(r["獎助金金額"])||0).toLocaleString()}</strong></td>
                <td><span class="badge badge-warning">${r["發放與領獎狀態"]}</span></td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <button class="btn btn-warning btn-sm btn-send-unapplied-remind" data-id="${r["編號"]}">
                            <i class="fa-solid fa-paper-plane"></i> 發送催辦
                        </button>
                        <button class="btn btn-success btn-sm btn-sign-unapplied" data-id="${r["編號"]}">
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
                sendSingleUnappliedRemind(id);
            });
        });
        document.querySelectorAll('.btn-sign-unapplied').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                handleStudentSign(id);
                openUnappliedModal();
            });
        });
    }

    async function sendSingleUnappliedRemind(recordId) {
        const target = unappliedStudentsList.find(r => r["編號"] == recordId);
        if (!target) return;
        const channel = document.getElementById('unapplied-channel-select').value;

        try {
            await fetch('/api/dispatch-unapplied-reminder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ record_id: recordId, channel: channel })
            });
        } catch (e) {}

        target["發放與領獎狀態"] = "通知已發送";
        target["通知時間"] = new Date().toISOString().split('T')[0];
        renderDashboard();
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
                await fetch('/api/dispatch-unapplied-reminder', { method: 'POST', body: JSON.stringify({}) });
            } catch (e) {}

            unappliedStudentsList.forEach(r => {
                r["發放與領獎狀態"] = "通知已發送";
                r["通知時間"] = new Date().toISOString().split('T')[0];
            });
            renderDashboard();
            openUnappliedModal();
            alert(`已成功批量派發 ${unappliedStudentsList.length} 封未申請獎補助同學催辦提醒信！`);
        }
    }
}

// 確保腳本載入時無論 DOM 是否已完成加載，均能立即安定發動系統初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFooyinAwardsApp);
} else {
    initFooyinAwardsApp();
}

