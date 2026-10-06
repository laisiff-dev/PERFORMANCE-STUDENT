import os
import json
import csv
import random
import argparse
from typing import List, Dict, Any, Optional

JSON_FILE = os.path.join(os.path.dirname(__file__), "fooyin_student_awards_standardized.json")
CSV_FILE = os.path.join(os.path.dirname(__file__), "fooyin_student_awards_standardized.csv")

class FooyinAwardsManager:
    """輔英科技大學 學生國內外獲獎紀錄與領獎管理核心類別"""

    def __init__(self, data_path: str = JSON_FILE):
        self.data_path = data_path
        self.records: List[Dict[str, Any]] = self.load_data()

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
        return []

    def save_data(self):
        """同步儲存至 JSON 與 CSV"""
        # 儲存 JSON
        with open(self.data_path, "w", encoding="utf-8") as f:
            json.dump(self.records, f, ensure_ascii=False, indent=2)
        
        # 儲存 CSV (蒐集所有紀錄的合規欄位)
        if self.records:
            fieldnames = []
            for r in self.records:
                for k in r.keys():
                    if k not in fieldnames:
                        fieldnames.append(k)
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
            if year and r.get("學年度") != year:
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
        record_data["編號"] = max_id + 1
        if "發放與領獎狀態" not in record_data or not record_data["發放與領獎狀態"]:
            record_data["發放與領獎狀態"] = "待通知"
        
        self.records.append(record_data)
        self.save_data()
        return record_data

    def import_records(self, new_records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """批次匯入多筆獲獎紀錄 (支援 CSV/JSON 匯入)"""
        added_count = 0
        skipped_count = 0

        existing_keys = {
            (r.get("獲獎學生"), r.get("競賽或活動名稱"), r.get("學年度"))
            for r in self.records
        }

        max_id = max([r.get("編號", 0) for r in self.records], default=0)

        for rec in new_records:
            key = (rec.get("獲獎學生"), rec.get("競賽或活動名稱"), rec.get("學年度"))
            if key in existing_keys:
                skipped_count += 1
            else:
                max_id += 1
                rec["編號"] = max_id
                if "發放與領獎狀態" not in rec or not rec["發放與領獎狀態"]:
                    rec["發放與領獎狀態"] = "待通知"
                self.records.append(rec)
                existing_keys.add(key)
                added_count += 1

        self.save_data()
        return {
            "status": "success",
            "imported_total": len(new_records),
            "added_count": added_count,
            "skipped_count": skipped_count,
            "current_total_records": len(self.records)
        }

    def update_status(self, record_id: int, new_status: str, notify_time: Optional[str] = None) -> bool:
        """更新領獎與發放狀態"""
        for r in self.records:
            if r.get("編號") == record_id:
                r["發放與領獎狀態"] = new_status
                if notify_time:
                    r["通知時間"] = notify_time
                self.save_data()
                return True
        return False

    def to_112_114_format(self, r: Dict[str, Any]) -> Dict[str, Any]:
        """將系統內部獲獎紀錄轉換為「112-114學年度填報資料」標準 16 欄位模版格式"""
        dept_str = r.get("系所名稱", "")
        if dept_str and "14" not in dept_str and "系" in dept_str:
            dept_code_str = f"{dept_str} - 1445"
        else:
            dept_code_str = dept_str if dept_str else "護理系 - 1445"

        year_num = str(r.get("學年度", "")).replace("學年度", "").strip()
        if not year_num:
            year_num = "114"

        category = r.get("競賽層級", "國內競賽")
        if "國際" in category:
            cat_type = "國際"
        elif "體育" in category:
            cat_type = "體育"
        elif "證照" in category:
            cat_type = "證照"
        else:
            cat_type = "全國"

        return {
            "識別號": str(r.get("編號", "")),
            "學年度": year_num,
            "學期": r.get("學期", "下"),
            "活動類別": r.get("活動類別", cat_type),
            "活動主辦單位": r.get("活動主辦單位", r.get("資料來源", "輔英科技大學")),
            "活動名稱": r.get("競賽或活動名稱", ""),
            "競賽項目": r.get("參賽項目或作品名稱", r.get("競賽項目", "")),
            "個人/團體競賽": r.get("個人/團體競賽", "個人競賽"),
            "人數(男)": str(r.get("人數(男)", 0)),
            "人數(女)": str(r.get("人數(女)", 1)),
            "是否獲獎": "是" if r.get("榮譽獎項") and r.get("榮譽獎項") != "未獲獎" else "是",
            "獲獎名次": r.get("榮譽獎項", ""),
            "活動起始日期": r.get("活動起始日期", r.get("通知時間", "2026-03-01")),
            "活動結束日期": r.get("活動結束日期", r.get("領獎截止日期", "2026-03-15")),
            "學生所屬系科 - 系所代碼": dept_code_str,
            "競賽項目是否與就讀科系相關": r.get("競賽項目是否與就讀科系相關", "是")
        }

    def from_112_114_format(self, template_row: Dict[str, Any]) -> Dict[str, Any]:
        """將「112-114學年度填報資料」標準模版列反向轉為內部獲獎紀錄格式"""
        raw_dept = str(template_row.get("學生所屬系科 - 系所代碼", ""))
        dept_name = raw_dept.split(" - ")[0].strip() if " - " in raw_dept else raw_dept
        
        # 學院自動推導
        college_map = {
            "護理系": "護理學院", "高齡全程照顧視導學士學位學程": "護理學院", "長期照顧學位學程": "護理學院",
            "醫學檢驗生物技術系": "醫學與健康學院", "物理治療系": "醫學與健康學院", "醫學影像暨放射科學系": "醫學與健康學院", "健康美容系": "醫學與健康學院",
            "環境工程與科學系": "環境與生命學院", "應用化學及材料科學系": "環境與生命學院", "生物科技系": "環境與生命學院",
            "資訊管理系": "人文與管理學院", "幼兒保育系": "人文與管理學院", "應用外語系": "人文與管理學院"
        }
        college = college_map.get(dept_name, "護理學院")

        year_val = str(template_row.get("學年度", "114")).strip()
        if "學年度" not in year_val:
            year_val = f"{year_val}學年度"

        cat = str(template_row.get("活動類別", "全國"))
        if "國際" in cat:
            level = "國際競賽"
        elif "體育" in cat:
            level = "體育競賽"
        elif "證照" in cat:
            level = "專業證照"
        else:
            level = "國內競賽"

        return {
            "學年度": year_val,
            "學期": template_row.get("學期", "下"),
            "資料來源": template_row.get("活動主辦單位", "112-114填報資料模版匯入"),
            "所屬學院": college,
            "系所名稱": dept_name if dept_name else "護理系",
            "學制班級": "四技3年1班",
            "獲獎學生": template_row.get("獲獎學生", "學生未填"),
            "學生學號": template_row.get("學生學號", "114" + str(random.randint(10000, 99999))),
            "指導老師": template_row.get("指導老師", "指導老師"),
            "競賽層級": level,
            "競賽或活動名稱": template_row.get("活動名稱", ""),
            "參賽項目或作品名稱": template_row.get("競賽項目", ""),
            "榮譽獎項": template_row.get("獲獎名次", "獲獎"),
            "獎助金金額": 5000,
            "發放與領獎狀態": "待通知",
            "通知時間": "",
            "領獎截止日期": "2026-11-30",
            "原畢業學校": "高雄市立高雄高級中學",
            "佐證連結": "https://www.fooyin.edu.tw/",
            "備註": "從 112-114 學年度填報資料模版匯入之獲獎紀錄",
            "活動類別": cat,
            "活動主辦單位": template_row.get("活動主辦單位", ""),
            "人數(男)": template_row.get("人數(男)", "0"),
            "人數(女)": template_row.get("人數(女)", "1"),
            "活動起始日期": template_row.get("活動起始日期", ""),
            "活動結束日期": template_row.get("活動結束日期", ""),
            "競賽項目是否與就讀科系相關": template_row.get("競賽項目是否與就讀科系相關", "是")
        }

    def import_from_excel_file(self, filepath: str) -> Dict[str, Any]:
        """自動抓取與解析 .xls / .xlsx Excel 試算表檔案並完成資料併入」"""
        if not os.path.exists(filepath):
            return {"status": "error", "message": f"找不到檔案: {filepath}"}

        ext = os.path.splitext(filepath)[1].lower()
        records_to_import = []

        try:
            if ext == ".xls":
                import xlrd
                wb = xlrd.open_workbook(filepath)
                sheet = wb.sheet_by_index(0)
                header_idx = -1
                headers = []
                for i in range(min(sheet.nrows, 20)):
                    row_vals = [str(sheet.cell_value(i, c)).strip() for c in range(sheet.ncols)]
                    if any(h in row_vals for h in ['識別號', '學年度', '活動名稱', '競賽或活動名稱', '獲獎學生']):
                        header_idx = i
                        headers = row_vals
                        break
                
                if header_idx != -1:
                    start_row = header_idx + 1
                    if start_row < sheet.nrows and any(c in [str(sheet.cell_value(start_row, col)).strip() for col in range(sheet.ncols)] for c in ['男', '女', '人數']):
                        start_row += 1 # 跳過次抬頭欄
                    for i in range(start_row, sheet.nrows):
                        row_vals = [sheet.cell_value(i, c) for c in range(sheet.ncols)]
                        if not any(row_vals): continue
                        item = {}
                        for h_idx, h in enumerate(headers):
                            if h and h_idx < len(row_vals):
                                item[h] = str(row_vals[h_idx]).strip()
                        records_to_import.append(self.from_112_114_format(item))
            else:
                import pandas as pd
                df = pd.read_excel(filepath)
                records_to_import = [self.from_112_114_format(r) for r in df.to_dict(orient="records")]
        except Exception as e:
            return {"status": "error", "message": f"解析 Excel 失敗: {str(e)}"}

        if not records_to_import:
            return {"status": "error", "message": "未能從 Excel 檔中讀取到有效紀錄"}

        return self.import_records(records_to_import)

    def export_112_114_template_csv(self, filename: str, records: Optional[List[Dict[str, Any]]] = None) -> str:
        """依據「112-114學年度填報資料」16 欄位模版匯出 CSV"""
        data = records if records is not None else self.records
        template_rows = [self.to_112_114_format(r) for r in data]
        fieldnames = [
            "識別號", "學年度", "學期", "活動類別", "活動主辦單位", "活動名稱", "競賽項目",
            "個人/團體競賽", "人數(男)", "人數(女)", "是否獲獎", "獲獎名次",
            "活動起始日期", "活動結束日期", "學生所屬系科 - 系所代碼", "競賽項目是否與就讀科系相關"
        ]
        with open(filename, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(template_rows)
        return f"已成功依『112-114學年度填報資料』模版匯出 CSV 至: {filename}"

    def export_112_114_template_excel(self, filename: str, records: Optional[List[Dict[str, Any]]] = None) -> str:
        """依據「112-114學年度填報資料」模版格式匯出 Excel (.xlsx)"""
        data = records if records is not None else self.records
        template_rows = [self.to_112_114_format(r) for r in data]
        try:
            import pandas as pd
            df = pd.DataFrame(template_rows)
            df.to_excel(filename, index=False, sheet_name="data_table4_8_1")
            return f"已成功依『112-114學年度填報資料』模版匯出 Excel 至: {filename}"
        except Exception as e:
            # 備用 openpyxl
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

    def get_unapplied_students(self) -> List[Dict[str, Any]]:
        """取得未申請或未領取獎補助金之同學清冊 (發放與領獎狀態為 待通知 / 未申請 / 逾期未申請)"""
        unapplied = []
        for r in self.records:
            st = r.get("發放與領獎狀態", "")
            if st in ["待通知", "未申請", "逾期未申請", "提醒未回應"]:
                unapplied.append(r)
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
        status_counts = {}
        total_scholarship = 0

        for r in self.records:
            col = r.get("所屬學院", "未分類")
            college_counts[col] = college_counts.get(col, 0) + 1

            lvl = r.get("競賽層級", "未分類")
            level_counts[lvl] = level_counts.get(lvl, 0) + 1

            dept = r.get("系所名稱", "未分類")
            dept_counts[dept] = dept_counts.get(dept, 0) + 1

            yr = r.get("學年度", "未分類")
            year_counts[yr] = year_counts.get(yr, 0) + 1

            st = r.get("發放與領獎狀態", "未分類")
            status_counts[st] = status_counts.get(st, 0) + 1

            amt = r.get("獎助金金額", 0)
            if isinstance(amt, int) or (isinstance(amt, str) and amt.isdigit()):
                total_scholarship += int(amt)

        # 排名前 10 大系所
        top_depts = sorted(dept_counts.items(), key=lambda x: x[1], reverse=True)[:10]

        return {
            "全校獲獎總筆數": total,
            "總發放獎助金金額(NTD)": total_scholarship,
            "學院獲獎統計": college_counts,
            "競賽層級分佈": level_counts,
            "學年度統計": year_counts,
            "領獎狀態統計": status_counts,
            "Top10獲獎熱門系所": dict(top_depts)
        }

    def export_data(self, output_filename: str, records: Optional[List[Dict[str, Any]]] = None) -> str:
        """匯出為 Excel 或 CSV"""
        data_to_export = records if records is not None else self.records
        ext = os.path.splitext(output_filename)[1].lower()

        if "112" in output_filename or "填報" in output_filename:
            if ext == ".xlsx":
                return self.export_112_114_template_excel(output_filename, data_to_export)
            else:
                return self.export_112_114_template_csv(output_filename, data_to_export)

        if ext == ".xlsx":
            try:
                import pandas as pd
                df = pd.DataFrame(data_to_export)
                df.to_excel(output_filename, index=False)
                return f"成功匯出 Excel 試算表至: {output_filename}"
            except ImportError:
                # 降級匯出 CSV 如果未安裝 pandas
                csv_file = output_filename.replace(".xlsx", ".csv")
                self._export_csv(csv_file, data_to_export)
                return f"[提示] 未安裝 pandas/openpyxl，已自動降級匯出 CSV 至: {csv_file}"
        else:
            self._export_csv(output_filename, data_to_export)
            return f"成功匯出 CSV 檔案至: {output_filename}"

    def _export_csv(self, filename: str, records: List[Dict[str, Any]]):
        if not records:
            return
        fieldnames = list(records[0].keys())
        with open(filename, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(records)


def main():
    parser = argparse.ArgumentParser(description="輔英科技大學 學生國內外獲獎紀錄管理與 IR 分析工具")
    parser.add_argument("--report", action="store_true", help="產出全校校務研究 (IR) 統計報表")
    parser.add_argument("--search", type=str, help="關鍵字全文檢索")
    parser.add_argument("--college", type=str, help="依學院篩選")
    parser.add_argument("--year", type=str, help="依學年度篩選")
    parser.add_argument("--level", type=str, help="依競賽層級篩選")
    parser.add_argument("--status", type=str, help="依領獎狀態篩選")
    parser.add_argument("--export", type=str, help="匯出檔案名稱 (.xlsx 或 .csv)")
    parser.add_argument("--export-template", type=str, help="依『112-114學年度填報資料』模版格式匯出檔案")
    parser.add_argument("--import-excel", type=str, help="將 .xls 或 .xlsx Excel 試算表匯入系統資料庫")
    parser.add_argument("--unapplied", action="store_true", help="查詢未申請獎補助金學生清冊")

    args = parser.parse_args()
    mgr = FooyinAwardsManager()

    if args.import_excel:
        res = mgr.import_from_excel_file(args.import_excel)
        print("\n==========================================")
        print("  Excel (.xls / .xlsx) 資料匯入結果")
        print("==========================================")
        print(json.dumps(res, ensure_ascii=False, indent=2))
        print("==========================================\n")
        return

    if args.unapplied:
        unapplied = mgr.get_unapplied_students()
        print(f"\n==========================================")
        print(f" 輔英科技大學 未申請獎補助同學清冊 (共 {len(unapplied)} 人)")
        print(f"==========================================")
        for r in unapplied[:15]:
            print(f"#{r['編號']} [{r['學年度']}] {r['所屬學院']} {r['系所名稱']} - {r['獲獎學生']} (學號:{r['學生學號']}) | 獎助金: ${r.get('獎助金金額', 0)} | 狀態: {r['發放與領獎狀態']}")
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
        level=args.level,
        status=args.status
    )

    if args.export_template:
        if args.export_template.endswith(".xlsx"):
            msg = mgr.export_112_114_template_excel(args.export_template, filtered)
        else:
            msg = mgr.export_112_114_template_csv(args.export_template, filtered)
        print(msg)
    elif args.export:
        msg = mgr.export_data(args.export, filtered)
        print(msg)
    else:
        print(f"\n查詢結果共 {len(filtered)} 筆獲獎紀錄:")
        for r in filtered[:10]:
            print(f"#{r['編號']} [{r['學年度']}] [{r['競賽層級']}] {r['所屬學院']} - {r['獲獎學生']} ({r['競賽或活動名稱']}: {r['榮譽獎項']}) | 狀態: {r['發放與領獎狀態']}")
        if len(filtered) > 10:
            print(f"... 尚有 {len(filtered) - 10} 筆未顯示。使用 --export 指定檔案匯出完整清冊。")

if __name__ == "__main__":
    main()

