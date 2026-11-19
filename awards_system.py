import os
import re
import json
import csv
import argparse
from typing import List, Dict, Any, Optional, Tuple

from security_crypto import deidentify_record, deidentify_records, decrypt_pii_vault, DEFAULT_ADMIN_PASSPHRASE

JSON_FILE = os.path.join(os.path.dirname(__file__), "fooyin_student_awards_standardized.json")
CSV_FILE = os.path.join(os.path.dirname(__file__), "fooyin_student_awards_standardized.csv")

INTERNAL_SOURCE_KEYWORDS = (
    "行政會議", "校務會議", "官方網站", "官網", "公開網站", "公開新聞", "公開網頁", "填報資料模版", "填報資料"
)

# 輔英科技大學 教育部校務填報正式系科代碼表 (100% 依據表 4-8-1 正式核定代碼)
FOOYIN_DEPT_CODE_MAP = {
    "護理系": "護理系 - 1445",
    "護理科": "護理科 - 1460",
    "高齡及長期照護事業系": "高齡及長期照護事業系 - 4084",
    "健康事業管理系": "健康事業管理系 - 1451",
    "助產與婦嬰健康照護系": "助產與婦嬰健康照護系 - 1447",
    "健康美容系": "健康美容系 - 3839",
    "醫學檢驗生物技術系": "醫學檢驗生物技術系 - 1448",
    "物理治療系": "物理治療系 - 1449",
    "保健營養系": "保健營養系 - 1450",
    "環境工程與科學系": "環境工程與科學系 - 1452",
    "應用化學及材料科學系": "應用化學及材料科學系 - 1453",
    "職業安全衛生系": "職業安全衛生系 - 1454",
    "生物科技系": "生物科技系 - 2124",
    "生物科技與綠色產業系": "生物科技系 - 2124",
    "休閒與遊憩事業管理系": "休閒與遊憩事業管理系 - 1457",
    "資訊科技與管理系": "資訊科技與管理系 - 4593",
    "應用外語系": "應用外語系 - 1458",
    "幼兒保育暨產業系": "幼兒保育暨產業系 - 4594",
}

# 輔英科技大學 四大學院正式歸屬對照表 (依據輔英科技大學官網 fy.edu.tw 學術單位編制)
FOOYIN_COLLEGE_MAP = {
    "護理系": "護理學院",
    "護理科": "護理學院",
    "高齡及長期照護事業系": "護理學院",
    "健康事業管理系": "護理學院",
    "助產與婦嬰健康照護系": "護理學院",
    "健康美容系": "醫學與健康學院",
    "醫學檢驗生物技術系": "醫學與健康學院",
    "物理治療系": "醫學與健康學院",
    "保健營養系": "醫學與健康學院",
    "環境工程與科學系": "環境與生命學院",
    "應用化學及材料科學系": "環境與生命學院",
    "職業安全衛生系": "環境與生命學院",
    "生物科技系": "環境與生命學院",
    "生物科技與綠色產業系": "環境與生命學院",
    "休閒與遊憩事業管理系": "人文與管理學院",
    "資訊科技與管理系": "人文與管理學院",
    "應用外語系": "人文與管理學院",
    "幼兒保育暨產業系": "人文與管理學院",
}


def classify_competition_level(cat: str, event_name: str, work_name: str, organizer: str) -> str:
    """依據正式活動類別與賽事名稱精準歸類五大競賽層級（不臆測、不亂編）"""
    c = (cat or "").strip()
    ev = f"{event_name or ''} {work_name or ''} {organizer or ''}"

    if c in ("國際(外)", "大陸、港、澳地區", "國際") or any(
        kw in ev for kw in ("國際", "世界", "亞洲", "亞太", "WBA", "WBAA", "IIIC", "KIDE", "MIVA", "WORLD", "上海")
    ):
        return "國際競賽"
    if any(kw in ev for kw in ("TQC", "認證", "證照", "國考", "國家考試", "檢定")):
        return "專業證照"
    if any(kw in ev for kw in ("優秀青年", "社團之光", "技職之光", "優秀幹部", "志工")):
        return "特殊優良事蹟"
    if any(
        kw in ev for kw in (
            "運動會", "全大運", "全障運", "排球", "籃球", "足球", "羽球", "桌球", "網球",
            "飛鏢", "溜冰", "滑冰", "冰球", "田徑", "游泳", "跆拳道", "空手道", "射箭", "街舞", "醫技盃", "體育總會", "大專體總", "運動部"
        )
    ):
        return "體育競賽"
    return "國內競賽"


def is_internal_meeting_or_web_source(val: str) -> bool:
    """判斷字串是否為會議紀錄或網站來源（而非實際活動主辦單位）"""
    s = (val or "").strip()
    if not s:
        return False
    if re.search(r"\d{3}\s*[-—~第]\s*\d+\s*次?\s*(行政|校務)", s):
        return True
    return any(kw in s for kw in INTERNAL_SOURCE_KEYWORDS)


def parse_source_to_year_semester(source_str: str) -> Tuple[Optional[str], Optional[str]]:
    """
    從『資料來源』解析學年度與學期：
    1. 行政會議 (例：113-3行政會議、114-6行政會議紀錄)：
       - 第 1~5 次（8月~1月召開） -> 上學期 ('上')
       - 第 6 次以上（2月~7月召開） -> 下學期 ('下')
    2. 校務會議 (例：115-2校務會議紀錄、114-3校務會議)：
       - 第 1~2 次（8月~1月召開） -> 上學期 ('上')
       - 第 3 次以上（2月~7月召開） -> 下學期 ('下')
    3. 明確字樣：含『上學期 / 第一學期 / 第1學期』-> '上'；『下學期 / 第二學期 / 第2學期』-> '下'
    """
    src = (source_str or "").strip()
    if not src:
        return None, None

    m = re.search(r"(\d{3})\s*[-—~第]\s*(\d+)\s*次?\s*(行政會議|校務會議)", src)
    if m:
        roc_year = m.group(1)
        session = int(m.group(2))
        m_type = m.group(3)
        year_str = f"{roc_year}學年度"
        if m_type == "校務會議":
            term = "上" if session <= 2 else "下"
        else:
            term = "上" if session <= 5 else "下"
        return year_str, term

    year_only = None
    m_yr = re.search(r"(\d{3})\s*學年度", src)
    if m_yr:
        year_only = f"{m_yr.group(1)}學年度"

    if any(k in src for k in ("上學期", "第一學期", "第1學期")):
        return year_only, "上"
    if any(k in src for k in ("下學期", "第二學期", "第2學期")):
        return year_only, "下"

    return year_only, None


def parse_date_to_year_semester(date_str: str) -> Tuple[Optional[str], Optional[str]]:
    """
    從『會議記錄時間 / 活動起始日期 / 活動結束日期 / 通知時間』推算台灣學年度與學期：
    - 8月 ~ 12月：學年度 = 西元年 - 1911，學期 = '上'
    - 1月：學年度 = 西元年 - 1912，學期 = '上'
    - 2月 ~ 7月：學年度 = 西元年 - 1912，學期 = '下'
    """
    s = (date_str or "").strip()
    if not s:
        return None, None

    m = re.search(r"(\d{3,4})\s*[-/年.]\s*(\d{1,2})", s)
    if not m:
        return None, None

    yr = int(m.group(1))
    month = int(m.group(2))
    if not (1 <= month <= 12):
        return None, None

    ad_year = yr + 1911 if yr < 1911 else yr
    if month >= 8:
        roc_acad_year = ad_year - 1911
        term = "上"
    elif month == 1:
        roc_acad_year = ad_year - 1912
        term = "上"
    else:
        roc_acad_year = ad_year - 1912
        term = "下"

    return f"{roc_acad_year}學年度", term


def infer_year_and_semester(record: Dict[str, Any]) -> Tuple[str, str]:
    """
    綜合『資料來源』與『會議記錄時間 / 活動日期』推導正確學年度與學期：
    優先順序：
    1. 資料來源中之會議期別（如 113-3行政會議 -> 113學年度 上；114-6行政會議 -> 114學年度 下）
    2. 會議記錄時間（若有紀錄）
    3. 既有明確有效學期（針對 112-114 教育部填報表匯入且無會議期別衝突之紀錄）
    4. 活動起始日期 -> 活動結束日期 -> 通知時間
    """
    source_str = str(record.get("資料來源", "") or "").strip()
    src_year, src_term = parse_source_to_year_semester(source_str)

    raw_year = str(record.get("學年度", "") or "").replace("學年度", "").strip()
    cur_year = f"{raw_year}學年度" if raw_year else ""
    cur_term = str(record.get("學期", "") or "").strip()
    if cur_term not in ("上", "下"):
        cur_term = ""

    # 1. 若資料來源帶有明確會議代碼 (如 113-3行政會議)，優先對齊會議所屬學年度與學期
    if src_year and src_term:
        return src_year, src_term

    # 2. 從會議記錄時間讀取
    meet_year, meet_term = parse_date_to_year_semester(str(record.get("會議記錄時間", "") or ""))
    if meet_term:
        final_year = cur_year or src_year or meet_year or "114學年度"
        return final_year, meet_term

    # 3. 若已有明確學期 (支援 112 ~ 120 學年度上、下學期)
    if cur_term in ("上", "下"):
        final_year = cur_year or src_year or "114學年度"
        return final_year, cur_term

    # 4. 從活動結束日期 -> 活動起始日期 -> 通知時間讀取（跨月賽事以結案/頒獎日期為準）
    for dt_field in ("活動結束日期", "活動起始日期", "通知時間"):
        dt_year, dt_term = parse_date_to_year_semester(str(record.get(dt_field, "") or ""))
        if dt_term:
            final_year = cur_year or src_year or dt_year or "114學年度"
            return final_year, dt_term

    final_year = cur_year or src_year or "114學年度"
    default_term = src_term or "上"
    return final_year, default_term


def normalize_award_record(record: Dict[str, Any], preserve_explicit_year_term: bool = False) -> Dict[str, Any]:
    """
    標準化單筆獲獎紀錄：
    - 自動由資料來源或會議記錄時間校正『學年度』與『學期』(手動編輯模式保留明確指定之學年度與學期)
    - 『活動主辦單位』若無記錄或誤填為會議/官網來源，統一寫為 "無"
    - 確保『資料來源』獨立且完整保留
    """
    r = dict(record)
    raw_org = str(r.get("活動主辦單位", "") or "").strip()
    raw_src = str(r.get("資料來源", "") or "").strip()
    remarks = str(r.get("備註", "") or "")

    # 修正過去從 112-114 填報模版匯入時把活動主辦單位誤複製到資料來源的情況
    if "112-114" in remarks and raw_org and raw_src == raw_org:
        raw_src = "112-114學年度填報資料"

    # 若活動主辦單位無記錄，或誤填為行政/校務會議、官網來源，統一設為 "無"
    if not raw_org or raw_org in ("無", "未填", "未提供", "None") or is_internal_meeting_or_web_source(raw_org):
        if is_internal_meeting_or_web_source(raw_org) and not raw_src:
            raw_src = raw_org
        normalized_org = "無"
    else:
        normalized_org = raw_org

    if not raw_src:
        raw_src = "112-114學年度填報資料" if "112-114" in remarks else "無"

    r["活動主辦單位"] = normalized_org
    r["資料來源"] = raw_src

    explicit_yr = str(r.get("學年度", "") or "").replace("學年度", "").strip()
    explicit_tm = str(r.get("學期", "") or "").strip()
    if preserve_explicit_year_term and explicit_yr and explicit_tm in ("上", "下"):
        r["學年度"] = f"{explicit_yr}學年度"
        r["學期"] = explicit_tm
    else:
        norm_year, norm_term = infer_year_and_semester(r)
        r["學年度"] = norm_year
        r["學期"] = norm_term
    return r


class FooyinAwardsManager:
    """輔英科技大學 學生國內外獲獎紀錄與領獎管理核心類別"""

    def __init__(self, data_path: str = JSON_FILE):
        self.data_path = data_path
        self.records: List[Dict[str, Any]] = [normalize_award_record(r) for r in self.load_data()]

    def load_data(self) -> List[Dict[str, Any]]:
        """載入 JSON 資料庫"""
        if os.path.exists(self.data_path):
            try:
                with open(self.data_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"[警告] 讀取 JSON 失敗 ({e})，嘗試載入 CSV...")

        # 降級載入 CSV
        if os.path.exists(CSV_FILE):
            try:
                records = []
                with open(CSV_FILE, "r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        row["編號"] = int(row.get("編號", 0))
                        row["獎助金金額"] = int(row.get("獎助金金額", 0)) if row.get("獎助金金額") else 0
                        records.append(row)
                return records
            except Exception as e:
                print(f"[錯誤] 讀取 CSV 失敗: {e}")

        # 若無本機 JSON/CSV（例如自 GitHub 下載之專案目錄），自動由 web/data.js 載入並還原加密個資保險箱
        for candidate_js in (
            os.path.join(os.path.dirname(__file__), "web", "data.js"),
            os.path.join(os.path.dirname(__file__), "data.js"),
        ):
            if os.path.exists(candidate_js):
                try:
                    with open(candidate_js, "r", encoding="utf-8") as f:
                        js_txt = f.read()
                    m_pub = re.search(r"window\.INITIAL_AWARDS_DATA\s*=\s*(\[.*?\]);\s*(?://|window\.)", js_txt, re.S)
                    if not m_pub:
                        continue
                    records = json.loads(m_pub.group(1))
                    m_vault = re.search(r"window\.ENCRYPTED_PII_VAULT\s*=\s*(\{.*?\});\s*(?://|window\.)", js_txt, re.S)
                    if m_vault:
                        try:
                            vault_obj = json.loads(m_vault.group(1))
                            pii_map = decrypt_pii_vault(vault_obj, DEFAULT_ADMIN_PASSPHRASE)
                            for r in records:
                                rid = str(r.get("編號", r.get("識別號", "")))
                                if rid in pii_map:
                                    r.update(pii_map[rid])
                        except Exception as ve:
                            print(f"[提示] 無法以預設通行密碼解密 data.js 保險箱，維持公開欄位載入: {ve}")
                    return records
                except Exception as e:
                    print(f"[警告] 自 {candidate_js} 載入備援資料失敗: {e}")
        return []

    def save_data(self):
        """同步儲存至本機 JSON 與 CSV（最後一欄固定為資料來源）"""
        self.records = [normalize_award_record(r) for r in self.records]
        with open(self.data_path, "w", encoding="utf-8") as f:
            json.dump(self.records, f, ensure_ascii=False, indent=2)

        if self.records:
            fieldnames = []
            for r in self.records:
                for k in r.keys():
                    if k != "資料來源" and k not in fieldnames:
                        fieldnames.append(k)
            fieldnames.append("資料來源")
            with open(CSV_FILE, "w", encoding="utf-8-sig", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(self.records)

    def filter_records(
        self,
        keyword: Optional[str] = None,
        college: Optional[str] = None,
        department: Optional[str] = None,
        year: Optional[str] = None,
        semester: Optional[str] = None,
        level: Optional[str] = None,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """多條件過濾查詢"""
        results = []
        for r in self.records:
            if college and r.get("所屬學院") != college:
                continue
            if department and r.get("系所名稱") != department:
                continue
            if year:
                ry = str(r.get("學年度", "")).replace("學年度", "").strip()
                ty = str(year).replace("學年度", "").strip()
                if ry != ty:
                    continue
            if semester and r.get("學期") != semester:
                continue
            if level and r.get("競賽層級") != level:
                continue
            if status and r.get("發放與領獎狀態") != status:
                continue
            if keyword:
                kw = keyword.lower()
                match = any(
                    kw in str(val).lower()
                    for key, val in r.items()
                    if val and key not in ["編號", "佐證連結"]
                )
                if not match:
                    continue
            results.append(r)
        return results

    def add_record(self, record_data: Dict[str, Any]) -> Dict[str, Any]:
        """新增獲獎紀錄"""
        max_id = max([r.get("編號", 0) for r in self.records], default=0)
        rec = normalize_award_record(record_data)
        rec["編號"] = max_id + 1
        if "發放與領獎狀態" not in rec or not rec["發放與領獎狀態"]:
            rec["發放與領獎狀態"] = "待通知"

        self.records.append(rec)
        self.save_data()
        return rec

    def import_records(self, new_records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """批次匯入多筆獲獎紀錄 (完全相容所有匯出格式，支援新增與既有編號同步更新 Upsert)"""
        added_count = 0
        updated_count = 0
        skipped_count = 0

        existing_by_id: Dict[str, Dict[str, Any]] = {}
        for r in self.records:
            rid = str(r.get("識別號") or r.get("編號") or "").lstrip("#").strip()
            if rid:
                existing_by_id[rid] = r
            num_id = str(r.get("編號") or "").strip()
            if num_id:
                existing_by_id[num_id] = r

        def make_content_key(item: Dict[str, Any]):
            stu = str(item.get("獲獎學生", "") or "").strip()
            ev = str(item.get("競賽或活動名稱", item.get("活動名稱", "")) or "").strip()
            wk = str(item.get("參賽項目或作品名稱", item.get("競賽項目", "")) or "").strip()
            yr = str(item.get("學年度", "") or "").replace("學年度", "").strip()
            rk = str(item.get("榮譽獎項", item.get("獲獎名次", "")) or "").strip()
            dp = str(item.get("系所名稱", "") or "").strip()
            dt = str(item.get("活動起始日期", "") or "").strip()
            return (stu, ev, wk, yr, rk, dp, dt)

        existing_content_keys = {make_content_key(r) for r in self.records}
        max_id = max([int(r.get("編號", 0) or 0) for r in self.records], default=0)

        for raw_item in new_records:
            # 統一透過標準匯出/模版欄位映射器轉換，確保匯入格式 100% 相容匯出格式
            rec = self.from_112_114_format(raw_item)
            incoming_id = str(rec.get("識別號", "") or "").lstrip("#").strip()

            if incoming_id and incoming_id in existing_by_id:
                target = existing_by_id[incoming_id]
                before_export = self.to_112_114_format(target, public_mode=True)
                changed = False
                for k, v in rec.items():
                    if k == "編號":
                        continue
                    v_str = str(v or "")
                    if k in ("獲獎學生", "學生學號", "學制班級", "原畢業學校", "佐證連結") and (
                        "○" in v_str or "*" in v_str or "已去識別化" in v_str or v_str == "#protected-evidence"
                    ):
                        continue
                    if v != "" and target.get(k) != v:
                        target[k] = v
                updated_norm = normalize_award_record(target)
                after_export = self.to_112_114_format(updated_norm, public_mode=True)
                # 比對實際匯出欄位或真實個資是否有實質異動
                if before_export != after_export or any(
                    target.get(pk) != updated_norm.get(pk) for pk in ("獲獎學生", "學生學號", "學制班級", "原畢業學校", "佐證連結")
                ):
                    changed = True
                target.clear()
                target.update(updated_norm)
                if changed:
                    updated_count += 1
                else:
                    skipped_count += 1
                continue

            ckey = make_content_key(rec)
            if ckey in existing_content_keys and rec.get("競賽或活動名稱"):
                skipped_count += 1
            else:
                max_id += 1
                rec["編號"] = max_id
                if not incoming_id:
                    rec["識別號"] = str(max_id)
                if not rec.get("發放與領獎狀態"):
                    rec["發放與領獎狀態"] = "待通知"
                self.records.append(rec)
                existing_by_id[str(max_id)] = rec
                if incoming_id:
                    existing_by_id[incoming_id] = rec
                existing_content_keys.add(ckey)
                added_count += 1

        self.save_data()
        return {
            "status": "success",
            "imported_total": len(new_records),
            "added_count": added_count,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
            "current_total_records": len(self.records)
        }

    def update_status(
        self,
        record_id: Any,
        new_status: str,
        notify_time: Optional[str] = None,
        amount: Optional[int] = None,
    ) -> bool:
        """更新領獎與發放狀態（並支援同步核定更新獎助金金額）"""
        target_str = str(record_id if record_id is not None else "").lstrip("#").strip()
        for r in self.records:
            if str(r.get("編號", "")).strip() == target_str or str(r.get("識別號", "")).lstrip("#").strip() == target_str:
                if new_status:
                    r["發放與領獎狀態"] = new_status
                if notify_time is not None:
                    r["通知時間"] = notify_time
                if amount is not None:
                    r["獎助金金額"] = max(0, int(amount))
                self.save_data()
                return True
        return False

    def update_record(
        self,
        record_id: Any,
        updates: Dict[str, Any],
        custom_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """完整修訂並更新單筆獲獎紀錄欄位"""
        target_num = str(record_id if record_id is not None else "").lstrip("#").strip()
        target_cid = str(custom_id or "").lstrip("#").strip()

        target_idx = -1
        if target_num:
            for idx, r in enumerate(self.records):
                if str(r.get("編號", "")).strip() == target_num:
                    target_idx = idx
                    break
        if target_idx == -1 and (target_cid or target_num):
            fb = target_cid or target_num
            for idx, r in enumerate(self.records):
                if str(r.get("識別號", "")).lstrip("#").strip() == fb:
                    target_idx = idx
                    break
        if target_idx == -1:
            return None

        cur = dict(self.records[target_idx])
        orig_num = cur.get("編號")

        for k, v in (updates or {}).items():
            if k == "編號" or v is None:
                continue
            cur[k] = v

        # 同步雙向欄位別名與系所代碼
        ev = str(cur.get("活動名稱") or cur.get("競賽或活動名稱") or "").strip()
        if "活動名稱" in updates:
            ev = str(updates["活動名稱"]).strip()
        elif "競賽或活動名稱" in updates:
            ev = str(updates["競賽或活動名稱"]).strip()
        cur["活動名稱"] = ev
        cur["競賽或活動名稱"] = ev

        wk = str(cur.get("競賽項目") or cur.get("參賽項目或作品名稱") or "").strip()
        if "競賽項目" in updates:
            wk = str(updates["競賽項目"]).strip()
        elif "參賽項目或作品名稱" in updates:
            wk = str(updates["參賽項目或作品名稱"]).strip()
        cur["競賽項目"] = wk
        cur["參賽項目或作品名稱"] = wk

        rk = str(cur.get("獲獎名次") or cur.get("榮譽獎項") or "").strip()
        if "獲獎名次" in updates:
            rk = str(updates["獲獎名次"]).strip()
        elif "榮譽獎項" in updates:
            rk = str(updates["榮譽獎項"]).strip()
        cur["獲獎名次"] = rk
        cur["榮譽獎項"] = rk

        dept_name = str(cur.get("系所名稱", "") or "").strip()
        if dept_name in FOOYIN_DEPT_CODE_MAP and "學生所屬系科 - 系所代碼" not in updates:
            cur["學生所屬系科 - 系所代碼"] = FOOYIN_DEPT_CODE_MAP[dept_name]
        if dept_name in FOOYIN_COLLEGE_MAP and not cur.get("所屬學院"):
            cur["所屬學院"] = FOOYIN_COLLEGE_MAP[dept_name]

        raw_amt = re.sub(r"[^\d]", "", str(cur.get("獎助金金額", 0)))
        cur["獎助金金額"] = int(raw_amt) if raw_amt else 0

        normalized = normalize_award_record(cur, preserve_explicit_year_term=True)
        normalized["編號"] = orig_num
        self.records[target_idx] = normalized
        self.save_data()
        return normalized

    def delete_record(self, record_id: Any, custom_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """刪除單筆錯誤或重複匯入之獲獎紀錄"""
        target_num = str(record_id if record_id is not None else "").lstrip("#").strip()
        target_cid = str(custom_id or "").lstrip("#").strip()

        if target_num:
            for idx, r in enumerate(self.records):
                if str(r.get("編號", "")).strip() == target_num:
                    removed = self.records.pop(idx)
                    self.save_data()
                    return removed

        fallback_id = target_cid or target_num
        if fallback_id:
            for idx, r in enumerate(self.records):
                if str(r.get("識別號", "")).lstrip("#").strip() == fallback_id:
                    removed = self.records.pop(idx)
                    self.save_data()
                    return removed
        return None

    def delete_records(self, record_ids: List[Any]) -> Dict[str, Any]:
        """批次刪除多筆錯誤匯入之獲獎紀錄"""
        target_set = {str(x).lstrip("#").strip() for x in record_ids if str(x).lstrip("#").strip()}
        if not target_set:
            return {"status": "error", "deleted_count": 0, "current_total_records": len(self.records)}

        before_len = len(self.records)
        kept = []
        for r in self.records:
            num_str = str(r.get("編號", "")).strip()
            cid_str = str(r.get("識別號", "")).lstrip("#").strip()
            if num_str in target_set or (not num_str and cid_str in target_set):
                continue
            kept.append(r)

        deleted_count = before_len - len(kept)
        if deleted_count > 0:
            self.records = kept
            self.save_data()

        return {
            "status": "success",
            "deleted_count": deleted_count,
            "current_total_records": len(self.records),
        }

    def to_112_114_format(self, raw_r: Dict[str, Any], public_mode: bool = False) -> Dict[str, Any]:
        """將系統內部獲獎紀錄轉換為「112-114學年度填報資料」標準欄位與延伸欄位格式（最後一欄為資料來源）"""
        r = normalize_award_record(raw_r)
        if public_mode:
            r = deidentify_record(r)

        dept_str = str(r.get("系所名稱", "") or "").strip()
        existing_code = str(r.get("學生所屬系科 - 系所代碼", "") or "").strip()
        if existing_code and " - " in existing_code:
            dept_code_str = existing_code
        elif dept_str in FOOYIN_DEPT_CODE_MAP:
            dept_code_str = FOOYIN_DEPT_CODE_MAP[dept_str]
        else:
            dept_code_str = dept_str or "無"

        year_num = str(r.get("學年度", "")).replace("學年度", "").strip() or "114"

        cat_val = str(r.get("活動類別", "") or "").strip()
        if not cat_val:
            lvl = str(r.get("競賽層級", "") or "")
            cat_val = "國際(外)" if "國際" in lvl else "全國"

        organizer = r.get("活動主辦單位", "無") or "無"
        data_source = r.get("資料來源", "無") or "無"
        rank_val = str(r.get("獲獎名次") or r.get("榮譽獎項") or "").strip()
        is_awarded = str(r.get("是否獲獎") or "").strip()
        if is_awarded not in ("是", "否"):
            is_awarded = "否" if rank_val in ("未獲獎", "否") else "是"

        return {
            # 112-114 學年度填報資料第 12 列前 16 個標準欄位
            "識別號": str(r.get("識別號", r.get("編號", ""))),
            "學年度": year_num,
            "學期": r.get("學期", "上"),
            "活動類別": cat_val,
            "活動主辦單位": organizer,
            "活動名稱": r.get("活動名稱") or r.get("競賽或活動名稱", ""),
            "競賽項目": r.get("競賽項目") or r.get("參賽項目或作品名稱", ""),
            "個人/團體競賽": r.get("個人/團體競賽", "個人競賽"),
            "人數(男)": str(r.get("人數(男)", 0)),
            "人數(女)": str(r.get("人數(女)", 1)),
            "是否獲獎": is_awarded,
            "獲獎名次": rank_val,
            "活動起始日期": r.get("活動起始日期", r.get("會議記錄時間", "")),
            "活動結束日期": r.get("活動結束日期", ""),
            "學生所屬系科 - 系所代碼": dept_code_str,
            "競賽項目是否與就讀科系相關": r.get("競賽項目是否與就讀科系相關", "是"),

            # 其餘後續延伸欄位，最後一欄為「資料來源」
            "會議記錄時間": r.get("會議記錄時間", ""),
            "所屬學院": r.get("所屬學院", ""),
            "系所名稱": dept_str,
            "學制班級": r.get("學制班級", "無"),
            "獲獎學生": r.get("獲獎學生", "無"),
            "學生學號": r.get("學生學號", "無"),
            "指導老師": r.get("指導老師", "無"),
            "競賽層級": r.get("競賽層級", ""),
            "榮譽獎項": rank_val,
            "獎助金金額": r.get("獎助金金額", 0),
            "發放與領獎狀態": r.get("發放與領獎狀態", "尚待核定"),
            "通知時間": r.get("通知時間", ""),
            "領獎截止日期": r.get("領獎截止日期", ""),
            "原畢業學校": r.get("原畢業學校", "無"),
            "佐證連結": r.get("佐證連結", "無"),
            "備註": r.get("備註", ""),
            "資料來源": data_source,
        }

    def from_112_114_format(self, raw_row: Dict[str, Any], default_source: str = "112-114學年度填報資料") -> Dict[str, Any]:
        """將所有系統匯出格式 (.xlsx/.csv/.json) 或「112-114學年度填報資料」模版列雙向對稱轉為內部格式（嚴禁編造未記錄欄位）"""
        template_row: Dict[str, Any] = {}
        for k, v in raw_row.items():
            clean_k = str(k or "").replace("\ufeff", "").strip().strip('"')
            if v is None:
                clean_v = ""
            elif isinstance(v, float) and str(v) == "nan":
                clean_v = ""
            elif isinstance(v, float) and v.is_integer():
                clean_v = str(int(v))
            else:
                clean_v = str(v).strip()
                if clean_v.lower() == "nan":
                    clean_v = ""
            template_row[clean_k] = clean_v

        raw_dept_code = (
            template_row.get("學生所屬系科 - 系所代碼")
            or template_row.get("學生所屬系科代碼")
            or ""
        )
        raw_dept = template_row.get("系所名稱") or raw_dept_code
        dept_name = raw_dept.split(" - ")[0].strip() if " - " in raw_dept else raw_dept.strip()
        dept_code_full = raw_dept_code if " - " in raw_dept_code else FOOYIN_DEPT_CODE_MAP.get(dept_name, dept_name)

        college = template_row.get("所屬學院") or FOOYIN_COLLEGE_MAP.get(dept_name, "護理學院")

        year_val = template_row.get("學年度", "").strip()
        if year_val and "學年度" not in year_val:
            year_val = f"{year_val}學年度"

        raw_org = template_row.get("活動主辦單位", "")
        raw_src = template_row.get("資料來源", "") or default_source

        event_name = (template_row.get("活動名稱") or template_row.get("競賽或活動名稱") or "").strip()
        work_name = (template_row.get("競賽項目") or template_row.get("參賽項目或作品名稱") or "").lstrip("：:").strip()
        award_rank = (template_row.get("獲獎名次") or template_row.get("榮譽獎項") or "").strip()
        is_awarded = template_row.get("是否獲獎", "").strip()
        if is_awarded not in ("是", "否"):
            is_awarded = "否" if award_rank == "未獲獎" else "是"
        if not award_rank:
            award_rank = "未獲獎" if is_awarded == "否" else "獲獎"

        cat = template_row.get("活動類別") or "全國"
        explicit_level = template_row.get("競賽層級", "").strip()
        level = explicit_level if explicit_level else classify_competition_level(cat, event_name, work_name, raw_org)

        raw_id = (
            template_row.get("識別號")
            or template_row.get("#識別號")
            or template_row.get("編號")
            or ""
        ).lstrip("#").strip()

        raw_amt_str = re.sub(r"[^\d]", "", template_row.get("獎助金金額") or template_row.get("獎助金額") or "")
        amount_val = int(raw_amt_str) if raw_amt_str else 0

        default_status = "無須發放" if is_awarded == "否" else "尚待核定"
        status_val = template_row.get("發放與領獎狀態") or template_row.get("領獎與發放狀態") or default_status

        rec = {
            "識別號": raw_id,
            "學年度": year_val,
            "學期": template_row.get("學期", ""),
            "會議記錄時間": template_row.get("會議記錄時間", ""),
            "資料來源": raw_src,
            "所屬學院": college,
            "系所名稱": dept_name or "無",
            "學制班級": template_row.get("學制班級") or "無",
            "獲獎學生": template_row.get("獲獎學生") or "無",
            "學生學號": template_row.get("學生學號") or "無",
            "指導老師": template_row.get("指導老師") or "無",
            "競賽層級": level,
            "競賽或活動名稱": event_name,
            "活動名稱": event_name,
            "參賽項目或作品名稱": work_name,
            "競賽項目": work_name,
            "榮譽獎項": award_rank,
            "獲獎名次": award_rank,
            "獎助金金額": amount_val,
            "發放與領獎狀態": status_val,
            "通知時間": template_row.get("通知時間", ""),
            "領獎截止日期": template_row.get("領獎截止日期", ""),
            "原畢業學校": template_row.get("原畢業學校") or "無",
            "佐證連結": template_row.get("佐證連結") or template_row.get("佐證") or "無",
            "備註": template_row.get("備註") or "",
            "活動類別": cat,
            "活動主辦單位": raw_org if raw_org else "無",
            "個人/團體競賽": template_row.get("個人/團體競賽") or template_row.get("個人/團體") or "個人競賽",
            "人數(男)": template_row.get("人數(男)") or template_row.get("男") or "0",
            "人數(女)": template_row.get("人數(女)") or template_row.get("女") or "0",
            "是否獲獎": is_awarded,
            "活動起始日期": template_row.get("活動起始日期", ""),
            "活動結束日期": template_row.get("活動結束日期", ""),
            "學生所屬系科 - 系所代碼": dept_code_full,
            "競賽項目是否與就讀科系相關": template_row.get("競賽項目是否與就讀科系相關") or template_row.get("科系相關") or "是",
        }
        return normalize_award_record(rec)

    def import_from_excel_file(self, filepath: str, source_override: Optional[str] = None) -> Dict[str, Any]:
        """自動解析 .xls / .xlsx / .csv / .json 檔案（完全相容系統匯出格式與 112-114 模版）並併入資料庫"""
        if not os.path.exists(filepath):
            return {"status": "error", "message": f"找不到檔案: {filepath}"}

        ext = os.path.splitext(filepath)[1].lower()
        base_fname = os.path.splitext(os.path.basename(filepath))[0]
        inferred_src = source_override or (base_fname if is_internal_meeting_or_web_source(base_fname) else "112-114學年度填報資料")
        records_to_import = []

        try:
            if ext == ".csv":
                with open(filepath, "r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        if any(str(v or "").strip() for v in row.values()):
                            records_to_import.append(self.from_112_114_format(row, default_source=inferred_src))
            elif ext == ".json":
                with open(filepath, "r", encoding="utf-8") as f:
                    parsed = json.load(f)
                    items = parsed if isinstance(parsed, list) else parsed.get("records", [parsed])
                    for row in items:
                        records_to_import.append(self.from_112_114_format(row, default_source=inferred_src))
            elif ext == ".xls":
                import xlrd
                wb = xlrd.open_workbook(filepath)
                sheet = wb.sheet_by_index(0)
                header_idx = -1
                headers = []
                for i in range(min(sheet.nrows, 25)):
                    row_vals = [str(sheet.cell_value(i, c)).strip() for c in range(sheet.ncols)]
                    if any(h in row_vals for h in ['識別號', '#識別號', '編號', '學年度', '活動名稱', '競賽或活動名稱', '獲獎學生']):
                        header_idx = i
                        headers = row_vals
                        break

                if header_idx != -1:
                    start_row = header_idx + 1
                    sub_headers = [str(sheet.cell_value(start_row, col)).strip() for col in range(sheet.ncols)] if start_row < sheet.nrows else []
                    if any(c in sub_headers for c in ['男', '女', '人數']):
                        for col_i, sh in enumerate(sub_headers):
                            if sh == '男':
                                headers[col_i] = '人數(男)'
                            elif sh == '女':
                                headers[col_i] = '人數(女)'
                        start_row += 1
                    for i in range(start_row, sheet.nrows):
                        row_vals = [sheet.cell_value(i, c) for c in range(sheet.ncols)]
                        if not any(str(x).strip() for x in row_vals):
                            continue
                        item = {}
                        for h_idx, h in enumerate(headers):
                            if h and h_idx < len(row_vals):
                                val = row_vals[h_idx]
                                if isinstance(val, float) and val.is_integer():
                                    val = int(val)
                                item[h] = str(val).strip()
                        records_to_import.append(self.from_112_114_format(item, default_source=inferred_src))
            else:
                import pandas as pd
                raw_df = pd.read_excel(filepath, header=None, dtype=str).fillna("")
                header_idx = 0
                for idx in range(min(len(raw_df), 25)):
                    row_vals = [str(v).strip() for v in raw_df.iloc[idx].tolist()]
                    if any(h in row_vals for h in ['識別號', '#識別號', '編號', '學年度', '活動名稱', '競賽或活動名稱', '獲獎學生']):
                        header_idx = idx
                        break
                headers = [str(v).strip() for v in raw_df.iloc[header_idx].tolist()]
                start_row = header_idx + 1
                if start_row < len(raw_df):
                    sub_vals = [str(v).strip() for v in raw_df.iloc[start_row].tolist()]
                    if any(c in sub_vals for c in ['男', '女']) and not sub_vals[0]:
                        for col_i, sh in enumerate(sub_vals):
                            if sh == '男':
                                headers[col_i] = '人數(男)'
                            elif sh == '女':
                                headers[col_i] = '人數(女)'
                        start_row += 1
                for idx in range(start_row, len(raw_df)):
                    row_vals = [str(v).strip() for v in raw_df.iloc[idx].tolist()]
                    if not any(row_vals):
                        continue
                    item = {headers[c]: row_vals[c] for c in range(min(len(headers), len(row_vals))) if headers[c]}
                    records_to_import.append(self.from_112_114_format(item, default_source=inferred_src))
        except Exception as e:
            return {"status": "error", "message": f"解析檔案失敗: {str(e)}"}

        if not records_to_import:
            return {"status": "error", "message": "未能從檔案中讀取到有效紀錄"}

        return self.import_records(records_to_import)

    def export_112_114_template_csv(
        self, filename: str, records: Optional[List[Dict[str, Any]]] = None, public_mode: bool = False
    ) -> str:
        """依據「112-114學年度填報資料」模版匯出 CSV（含最後新增之資料來源欄位）"""
        data = records if records is not None else self.records
        template_rows = [self.to_112_114_format(r, public_mode=public_mode) for r in data]
        fieldnames = [
            "識別號", "學年度", "學期", "活動類別", "活動主辦單位", "活動名稱", "競賽項目",
            "個人/團體競賽", "人數(男)", "人數(女)", "是否獲獎", "獲獎名次",
            "活動起始日期", "活動結束日期", "學生所屬系科 - 系所代碼", "競賽項目是否與就讀科系相關",
            "資料來源"
        ]
        with open(filename, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(template_rows)
        return f"已成功依『112-114學年度填報資料』模版匯出 CSV 至: {filename}"

    def export_112_114_template_excel(
        self, filename: str, records: Optional[List[Dict[str, Any]]] = None, public_mode: bool = False
    ) -> str:
        """依據「112-114學年度填報資料」模版格式匯出 Excel (.xlsx)"""
        data = records if records is not None else self.records
        template_rows = [self.to_112_114_format(r, public_mode=public_mode) for r in data]
        try:
            import pandas as pd
            df = pd.DataFrame(template_rows)
            df.to_excel(filename, index=False, sheet_name="data_table4_8_1")
            return f"已成功依『112-114學年度填報資料』模版匯出 Excel 至: {filename}"
        except Exception:
            import openpyxl
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "112-114學年度填報資料"
            if template_rows:
                headers = list(template_rows[0].keys())
                ws.append(headers)
                for row in template_rows:
                    ws.append([row.get(h, "") for h in headers])
            wb.save(filename)
            return f"已使用 openpyxl 成功匯出 112-114 填報模版 Excel 至: {filename}"

    def get_unapplied_students(self, public_mode: bool = False) -> List[Dict[str, Any]]:
        """取得未申請或未領取獎補助金之同學清冊"""
        unapplied = []
        for r in self.records:
            st = r.get("發放與領獎狀態", "")
            if st in ["待通知", "未申請", "逾期未申請", "提醒未回應"]:
                unapplied.append(deidentify_record(r) if public_mode else r)
        return unapplied

    def generate_ir_report(self) -> Dict[str, Any]:
        """產出校務研究 (IR) 統計分析資料"""
        total = len(self.records)
        if total == 0:
            return {"error": "無獲獎紀錄數據"}

        college_counts = {}
        level_counts = {}
        dept_counts = {}
        year_counts = {}
        semester_counts = {}
        status_counts = {}
        total_scholarship = 0

        for r in self.records:
            col = r.get("所屬學院", "未分類")
            college_counts[col] = college_counts.get(col, 0) + 1

            lvl = r.get("競賽層級", "未分類")
            level_counts[lvl] = level_counts.get(lvl, 0) + 1

            dept = r.get("系所名稱", "未分類")
            dept_counts[dept] = dept_counts.get(dept, 0) + 1

            yr = f"{r.get('學年度', '未分類')} ({r.get('學期', '上')}學期)"
            semester_counts[yr] = semester_counts.get(yr, 0) + 1

            yr_only = r.get("學年度", "未分類")
            year_counts[yr_only] = year_counts.get(yr_only, 0) + 1

            st = r.get("發放與領獎狀態", "未分類")
            status_counts[st] = status_counts.get(st, 0) + 1

            amt = r.get("獎助金金額", 0)
            if isinstance(amt, int) or (isinstance(amt, str) and amt.isdigit()):
                total_scholarship += int(amt)

        top_depts = sorted(dept_counts.items(), key=lambda x: x[1], reverse=True)[:10]

        return {
            "全校獲獎總筆數": total,
            "總發放獎助金金額(NTD)": total_scholarship,
            "學院獲獎統計": college_counts,
            "競賽層級分佈": level_counts,
            "學年度統計": year_counts,
            "學年度學期統計": dict(sorted(semester_counts.items())),
            "領獎狀態統計": status_counts,
            "Top10獲獎熱門系所": dict(top_depts)
        }

    def export_data(
        self, output_filename: str, records: Optional[List[Dict[str, Any]]] = None, public_mode: bool = False
    ) -> str:
        """匯出為 Excel 或 CSV（支援 public_mode 去識別化匯出）"""
        raw_data = records if records is not None else self.records
        data_to_export = deidentify_records(raw_data) if public_mode else raw_data
        ext = os.path.splitext(output_filename)[1].lower()

        if "112" in output_filename or "填報" in output_filename:
            if ext == ".xlsx":
                return self.export_112_114_template_excel(output_filename, raw_data, public_mode=public_mode)
            else:
                return self.export_112_114_template_csv(output_filename, raw_data, public_mode=public_mode)

        formatted_rows = [self.to_112_114_format(r, public_mode=public_mode) for r in data_to_export]
        if ext == ".xlsx":
            try:
                import pandas as pd
                df = pd.DataFrame(formatted_rows)
                df.to_excel(output_filename, index=False)
                return f"成功匯出 Excel 試算表至: {output_filename}"
            except ImportError:
                csv_file = output_filename.replace(".xlsx", ".csv")
                self._export_csv(csv_file, formatted_rows)
                return f"[提示] 未安裝 pandas/openpyxl，已自動降級匯出 CSV 至: {csv_file}"
        else:
            self._export_csv(output_filename, formatted_rows)
            return f"成功匯出 CSV 檔案至: {output_filename}"

    def _export_csv(self, filename: str, records: List[Dict[str, Any]]):
        if not records:
            return
        fieldnames = [k for k in records[0].keys() if k != "資料來源"] + ["資料來源"]
        with open(filename, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(records)


def main():
    parser = argparse.ArgumentParser(description="輔英科技大學 學生國內外獲獎紀錄管理與 IR 分析工具")
    parser.add_argument("--report", action="store_true", help="產出全校校務研究 (IR) 統計報表")
    parser.add_argument("--normalize-db", action="store_true", help="執行全庫學期、活動主辦單位與資料來源欄位標準化校正")
    parser.add_argument("--search", type=str, help="關鍵字全文檢索")
    parser.add_argument("--college", type=str, help="依學院篩選")
    parser.add_argument("--year", type=str, help="依學年度篩選")
    parser.add_argument("--semester", type=str, help="依學期篩選 (上/下)")
    parser.add_argument("--level", type=str, help="依競賽層級篩選")
    parser.add_argument("--status", type=str, help="依領獎狀態篩選")
    parser.add_argument("--export", type=str, help="匯出檔案名稱 (.xlsx 或 .csv)")
    parser.add_argument("--export-template", type=str, help="依『112-114學年度填報資料』模版格式匯出檔案")
    parser.add_argument("--public-export", action="store_true", help="以個資去識別化公開安全模式匯出")
    parser.add_argument("--import-excel", type=str, help="將 .xls 或 .xlsx Excel 試算表匯入系統資料庫")
    parser.add_argument("--unapplied", action="store_true", help="查詢未申請獎補助金學生清冊")

    args = parser.parse_args()
    mgr = FooyinAwardsManager()

    if args.normalize_db:
        mgr.save_data()
        print(f"已完成 {len(mgr.records)} 筆紀錄之學期、活動主辦單位與資料來源欄位校正！")
        return

    if args.import_excel:
        res = mgr.import_from_excel_file(args.import_excel)
        print("\n==========================================")
        print("  Excel (.xls / .xlsx) 資料匯入結果")
        print("==========================================")
        print(json.dumps(res, ensure_ascii=False, indent=2))
        print("==========================================\n")
        return

    if args.unapplied:
        unapplied = mgr.get_unapplied_students(public_mode=args.public_export)
        print(f"\n==========================================")
        print(f" 輔英科技大學 未申請獎補助同學清冊 (共 {len(unapplied)} 人)")
        print(f"==========================================")
        for r in unapplied[:15]:
            print(f"#{r['編號']} [{r['學年度']} {r['學期']}] {r['所屬學院']} {r['系所名稱']} - {r['獲獎學生']} (學號:{r['學生學號']}) | 獎助金: ${r.get('獎助金金額', 0)} | 狀態: {r['發放與領獎狀態']} | 來源: {r.get('資料來源', '無')}")
        return

    if args.report:
        report = mgr.generate_ir_report()
        print("\n==========================================")
        print("  輔英科技大學 學生獲獎紀錄與 IR 統計分析總表")
        print("==========================================")
        for k, v in report.items():
            if isinstance(v, dict):
                print(f"\n【{k}】:")
                for sub_k, sub_v in v.items():
                    print(f"  - {sub_k}: {sub_v}")
            else:
                print(f"【{k}】: {v}")
        print("==========================================\n")
        return

    filtered = mgr.filter_records(
        keyword=args.search,
        college=args.college,
        year=args.year,
        semester=args.semester,
        level=args.level,
        status=args.status
    )

    if args.export_template:
        if args.export_template.endswith(".xlsx"):
            msg = mgr.export_112_114_template_excel(args.export_template, filtered, public_mode=args.public_export)
        else:
            msg = mgr.export_112_114_template_csv(args.export_template, filtered, public_mode=args.public_export)
        print(msg)
    elif args.export:
        msg = mgr.export_data(args.export, filtered, public_mode=args.public_export)
        print(msg)
    else:
        print(f"\n查詢結果共 {len(filtered)} 筆獲獎紀錄:")
        for r in filtered[:10]:
            print(f"#{r['編號']} [{r['學年度']}-{r['學期']}] [{r['競賽層級']}] 主辦:{r.get('活動主辦單位','無')} | {r['所屬學院']} - {r['獲獎學生']} ({r['競賽或活動名稱']}: {r['榮譽獎項']}) | 來源: {r.get('資料來源','無')}")
        if len(filtered) > 10:
            print(f"... 尚有 {len(filtered) - 10} 筆未顯示。使用 --export 指定檔案匯出完整清冊。")


if __name__ == "__main__":
    main()
