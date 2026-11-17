"""
輔英科技大學 學生獲獎紀錄真實資料清洗與標準化建置腳本
嚴格原則：絕不隨機編造任何學生姓名、學號、金額或虛構賽事！
資料來源：
1. 本校教育部校務資料庫正式匯出表單《112-114學年度填報資料.xls》(表 4-8-1 學生參與競賽資料表)
2. 本校公共事務暨校友服務室公開校園新聞專區 (https://epo.fy.edu.tw/) 經查證之 115 學年度上學期最新獲獎紀錄
"""
import os
import re
import xlrd
from typing import List, Dict, Any

from awards_system import FooyinAwardsManager, FOOYIN_DEPT_CODE_MAP, FOOYIN_COLLEGE_MAP

BASE_DIR = os.path.dirname(__file__)
XLS_SOURCE = os.path.join(BASE_DIR, "112-114學年度填報資料.xls")


def clean_xls_row(raw: Dict[str, str]) -> Dict[str, Any]:
    """對《112-114學年度填報資料.xls》單筆原始紀錄執行實證清洗與勘誤修正"""
    rec_id = raw["識別號"].strip()
    year_num = raw["學年度"].strip()
    term = raw["學期"].strip()
    cat = raw["活動類別"].strip()
    org = raw["活動主辦單位"].strip()
    ev = re.sub(r"\s+", " ", raw["活動名稱"]).strip()
    wk = re.sub(r"\s+", " ", raw["競賽項目"]).lstrip("：:").strip()
    grp = raw["個人/團體競賽"].strip()
    male_cnt = raw["人數(男)"].strip() or "0"
    female_cnt = raw["人數(女)"].strip() or "0"
    is_awarded = raw["是否獲獎"].strip()
    rank = raw["獲獎名次"].strip()
    start_dt = raw["活動起始日期"].strip()
    end_dt = raw["活動結束日期"].strip()
    dept_code = raw["學生所屬系科 - 系所代碼"].strip()
    dept_rel = raw["競賽項目是否與就讀科系相關"].strip() or "是"

    # 1. 修正原始 Excel 曾誤將「教育部」批次取代為「國內」之主辦單位錯誤
    if org == "國內體育署":
        org = "教育部體育署"
    elif org == "國內、國立雲林科技大學":
        org = "教育部、國立雲林科技大學"
    elif org == "中華民國國內" and "運動會" in ev:
        org = "教育部"
    elif org == "國內" and "總統盃全國溜冰錦標賽" in ev:
        org = "中華民國滑輪溜冰協會、臺北市政府體育局"
    elif org == "國內" and ("大專校院籃球聯賽" in ev or "大專校院足球聯賽" in ev):
        org = "教育部（中華民國大專院校體育總會）"
    elif org == "社 團 法 人 中 華 創 新 發 明 學 會":
        org = "社團法人中華創新發明學會"
    elif org == "社團法人中華亞太奧林匹克美業交流協會與國際奧林匹克聯":
        org = "社團法人中華亞太奧林匹克美業交流協會與國際奧林匹克聯盟"
    elif not org or org in ("-", "—", "NA", "N/A"):
        org = "無"

    # 2. 修正明顯錯別字
    ev = ev.replace("全國全國", "全國").replace("緊標賽", "錦標賽").replace("個人競賽賽", "個人競賽")
    wk = wk.replace("個人競賽賽", "個人競賽")
    if rec_id == "374664" and "112 年青年節" in ev and "113年大專優秀青年" in wk:
        ev = "中華民國各界慶祝 113 年青年節表揚大專優秀青年遴選"

    # 3. 修正上海國際護理技能大賽活動類別誤植
    if "上海國際護理技能大賽" in ev and org == "上海健康醫學院" and cat == "全國":
        cat = "大陸、港、澳地區"

    # 4. 修正依實際辦理日期查證誤植之學年度與學期
    # - 378926, 378927: 2024/05/03 全大運為 112學年度 下學期 (與同表 374635~374639 一致)
    # - 378944: 2024/01/20 國際現代書道展為 112學年度 上學期
    if rec_id in ("378926", "378927") and start_dt.startswith("2024/05"):
        year_num, term = "112", "下"
    elif rec_id == "378944" and start_dt.startswith("2024/01"):
        year_num, term = "112", "上"

    # 5. 修正獲獎名次誤填「是」或「無」(當是否獲獎為「是」時)
    if is_awarded == "是":
        if rank == "是":
            rank = "當選" if "優秀青年" in ev or "優秀青年" in wk else "獲獎"
        elif rank in ("無", ""):
            rank = "獲獎"
    else:
        is_awarded = "否"
        if not rank or rank == "無":
            rank = "未獲獎"

    return {
        "識別號": rec_id,
        "學年度": f"{year_num}學年度",
        "學期": term,
        "會議記錄時間": "",
        "活動類別": cat,
        "活動主辦單位": org,
        "活動名稱": ev,
        "競賽項目": wk,
        "個人/團體競賽": grp,
        "人數(男)": male_cnt,
        "人數(女)": female_cnt,
        "是否獲獎": is_awarded,
        "獲獎名次": rank,
        "活動起始日期": start_dt,
        "活動結束日期": end_dt,
        "學生所屬系科 - 系所代碼": dept_code,
        "競賽項目是否與就讀科系相關": dept_rel,
        "獲獎學生": "無",
        "學生學號": "無",
        "指導老師": "無",
        "學制班級": "無",
        "原畢業學校": "無",
        "獎助金金額": 0,
        "發放與領獎狀態": "無須發放" if is_awarded == "否" else "尚待核定",
        "佐證連結": "無",
        "備註": "教育部校務資料庫表 4-8-1 正式填報紀錄（經實證清洗去重）",
        "資料來源": "112-114學年度填報資料",
    }


def load_and_clean_official_xls() -> List[Dict[str, Any]]:
    wb = xlrd.open_workbook(XLS_SOURCE)
    sheet = wb.sheet_by_index(0)

    headers = [str(sheet.cell_value(11, c)).strip() for c in range(sheet.ncols)]
    subheaders = [str(sheet.cell_value(12, c)).strip() for c in range(sheet.ncols)]
    for idx, sh in enumerate(subheaders):
        if sh == "男":
            headers[idx] = "人數(男)"
        elif sh == "女":
            headers[idx] = "人數(女)"

    raw_by_id: Dict[int, Dict[str, str]] = {}
    ordered_rows: List[Dict[str, str]] = []

    for r in range(13, sheet.nrows):
        vals = [sheet.cell_value(r, c) for c in range(sheet.ncols)]
        if not any(str(v).strip() for v in vals):
            continue
        item: Dict[str, str] = {}
        for c, h in enumerate(headers):
            val = vals[c]
            if isinstance(val, float) and val.is_integer():
                val = int(val)
            item[h] = str(val).strip()
        ordered_rows.append(item)
        if item["識別號"].isdigit():
            raw_by_id[int(item["識別號"])] = item

    # 偵測並移除 114 上學期整批重複匯入區塊 (409634~409760 為 409507~409633 完全相同之 +127 批次重複)
    duplicate_batch_ids = set()
    for num_id, item in raw_by_id.items():
        if 409507 <= num_id <= 409633 and (num_id + 127) in raw_by_id:
            other = raw_by_id[num_id + 127]
            same_content = all(item[k] == other[k] for k in headers if k != "識別號")
            if same_content:
                duplicate_batch_ids.add(str(num_id + 127))

    cleaned_list: List[Dict[str, Any]] = []
    for item in ordered_rows:
        if item["識別號"] in duplicate_batch_ids:
            continue
        cleaned_list.append(clean_xls_row(item))

    print(f"[清洗完成] 原始 XLS 共 {len(ordered_rows)} 列，移除整批重複匯入 {len(duplicate_batch_ids)} 列，保留 {len(cleaned_list)} 筆真實紀錄。")
    return cleaned_list


def get_verified_115_epo_awards() -> List[Dict[str, Any]]:
    """
    經查證自輔英科技大學公共事務暨校友服務室公開新聞專區 (https://epo.fy.edu.tw/)
    發佈日期：2026-08-06 (115學年度 上學期)
    新聞標題：世界看見輔英！健美系韓國勇奪四金 國際合作再升級培育美業菁英
    原始網址：https://epo.fy.edu.tw/p/406-1058-76437,r1306.php?Lang=zh-tw
    """
    epo_url = "https://epo.fy.edu.tw/p/406-1058-76437,r1306.php?Lang=zh-tw"
    event_title = "WBAA第25屆世界美容藝術與設計國際大賽暨2026 WBA Global Triple Challenge全球美學現場賽"
    organizer = "World Beauty Art Association (WBAA)"

    verified_entries = [
        ("FY115-001", "健康美容系", "李靜美", "個人競賽", "0", "1", "皮膚臉部護理", "金牌", "黃曉玲 助理教授", "同場另榮獲複方精油香水銀牌及現場香氛調製品牌特別獎（輔英新聞 2026-08-06 查證）"),
        ("FY115-002", "應用化學及材料科學系", "林冠呈", "個人競賽", "1", "0", "男士香水調製《寂靜地中海》", "金牌", "黃曉玲 助理教授", "跨系參與國際調香大賽勇奪金牌（輔英新聞 2026-08-06 查證）"),
        ("FY115-003", "健康美容系", "黃嫃穎", "個人競賽", "0", "1", "皮膚筋膜刀護理", "金牌", "黃曉玲 助理教授", "同場另榮獲按摩治療護理銀牌（輔英新聞 2026-08-06 查證）"),
        ("FY115-004", "健康美容系", "陳宜姍", "個人競賽", "0", "1", "國際創意面具設計", "銀牌", "黃曉玲 助理教授", "輔英校園新聞公開表揚紀錄（2026-08-06）"),
        ("FY115-005", "健康美容系", "陳俐榛", "個人競賽", "0", "1", "背部護理", "銀牌", "黃曉玲 助理教授", "輔英校園新聞公開表揚紀錄（2026-08-06）"),
        ("FY115-006", "健康美容系", "鄭宇璇", "個人競賽", "0", "1", "複方精油香水調製", "銀牌", "黃曉玲 助理教授", "輔英校園新聞公開表揚紀錄（2026-08-06）"),
        ("FY115-007", "健康美容系", "蔡欣瑀、王佳瑜", "團體競賽", "0", "2", "創意美睫設計", "銀牌", "黃曉玲 助理教授", "輔英校園新聞公開表揚紀錄（2026-08-06）"),
        ("FY115-008", "健康美容系", "石欣雅", "個人競賽", "0", "1", "創意香水調製《浮生草木》", "銅牌", "黃曉玲 助理教授", "輔英校園新聞公開表揚紀錄（2026-08-06）"),
        ("FY115-009", "健康美容系", "陳悅慈", "個人競賽", "0", "1", "創意美睫設計", "銅牌", "黃曉玲 助理教授", "輔英校園新聞公開表揚紀錄（2026-08-06）"),
    ]

    records = []
    for ext_id, dept, stu, grp, m_cnt, f_cnt, work, rank, advisor, note in verified_entries:
        records.append({
            "識別號": ext_id,
            "學年度": "115學年度",
            "學期": "上",
            "會議記錄時間": "2026-08-06",
            "活動類別": "國際(外)",
            "活動主辦單位": organizer,
            "活動名稱": event_title,
            "競賽項目": work,
            "個人/團體競賽": grp,
            "人數(男)": m_cnt,
            "人數(女)": f_cnt,
            "是否獲獎": "是",
            "獲獎名次": rank,
            "活動起始日期": "2026/08/01",
            "活動結束日期": "2026/08/06",
            "學生所屬系科 - 系所代碼": FOOYIN_DEPT_CODE_MAP[dept],
            "競賽項目是否與就讀科系相關": "是",
            "所屬學院": FOOYIN_COLLEGE_MAP[dept],
            "系所名稱": dept,
            "學制班級": "無",
            "獲獎學生": stu,
            "學生學號": "無",
            "指導老師": advisor,
            "競賽層級": "國際競賽",
            "獎助金金額": 0,
            "發放與領獎狀態": "尚待核定",
            "佐證連結": epo_url,
            "備註": note,
            "資料來源": "學校公開網頁 (輔英新聞)",
        })
    return records


def main():
    mgr = FooyinAwardsManager(data_path="__rebuild_empty__.json")
    mgr.data_path = os.path.join(BASE_DIR, "fooyin_student_awards_standardized.json")
    mgr.records = []

    all_clean_rows = get_verified_115_epo_awards() + load_and_clean_official_xls()
    for idx, raw_row in enumerate(all_clean_rows, start=1):
        converted = mgr.from_112_114_format(raw_row, default_source=raw_row["資料來源"])
        converted["編號"] = idx
        mgr.records.append(converted)

    mgr.save_data()
    print(f"[重建完成] 已將 {len(mgr.records)} 筆經實證查核之真實獲獎紀錄寫入 JSON 與 CSV（零虛構資料）！")


if __name__ == "__main__":
    main()
