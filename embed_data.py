import os
import argparse
import json

from awards_system import FooyinAwardsManager, normalize_award_record, FOOYIN_DEPT_CODE_MAP
from security_crypto import (
    deidentify_records,
    encrypt_pii_vault,
    DEFAULT_ADMIN_PASSPHRASE,
    PLACEHOLDER_NAMES,
)


def build_secure_data_js(passphrase: str, public_only: bool = False):
    base_dir = os.path.dirname(__file__)
    data_js_path = os.path.join(base_dir, "web", "data.js")
    sources_cfg_path = os.path.join(base_dir, "sources_config.json")

    mgr = FooyinAwardsManager()
    records = [normalize_award_record(r) for r in mgr.records]
    public_records = deidentify_records(records)

    encrypted_vault = None if public_only else encrypt_pii_vault(records, passphrase=passphrase)

    sources_cfg = {}
    if os.path.exists(sources_cfg_path):
        try:
            with open(sources_cfg_path, "r", encoding="utf-8") as sf:
                sources_cfg = json.load(sf)
        except Exception:
            sources_cfg = {}

    js_content = f"""// 輔英科技大學 學生獲獎紀錄公開去識別化資料庫 (共 {len(public_records)} 筆)
// 資安防護說明：本檔案僅包含依《個人資料保護法》去識別化遮罩後之公開欄位；
// 完整學生個資經 PBKDF2-SHA256 (150,000 次迭代) + AES-256-GCM 驗證加密保護，原始碼不含任何明文個資或金鑰。
window.INITIAL_AWARDS_DATA = {json.dumps(public_records, ensure_ascii=False, indent=2)};

// AES-256-GCM 端對端加密個資保險箱 (僅授權管理員於瀏覽器記憶體內透過 WebCrypto 解鎖，不落地儲存)
window.ENCRYPTED_PII_VAULT = {json.dumps(encrypted_vault, ensure_ascii=False, indent=2)};

// 三大來源 LOOK 監看與每週自動更新設定 (個人雲端硬碟/行政會議檔案夾、學校公開網頁、系上公開網頁)
window.DATA_SOURCES_CONFIG = {json.dumps(sources_cfg, ensure_ascii=False, indent=2)};

// 定義輔英科技大學四大學院與正式系科對照表 (依據教育部表 4-8-1 與 fy.edu.tw 正式編制)
window.FOOYIN_COLLEGES_MAP = {{
    "護理學院": ["護理系", "護理科", "高齡及長期照護事業系", "健康事業管理系", "助產與婦嬰健康照護系"],
    "醫學與健康學院": ["健康美容系", "醫學檢驗生物技術系", "物理治療系", "保健營養系"],
    "環境與生命學院": ["環境工程與科學系", "應用化學及材料科學系", "職業安全衛生系", "生物科技系"],
    "人文與管理學院": ["休閒與遊憩事業管理系", "資訊科技與管理系", "應用外語系", "幼兒保育暨產業系"]
}};

// 教育部校務填報正式系科代碼表
window.FOOYIN_DEPT_CODE_MAP = {json.dumps(FOOYIN_DEPT_CODE_MAP, ensure_ascii=False, indent=2)};
"""

    # 自動化零明文個資外洩稽核 (Zero-Plaintext PII Audit)
    leaked = []
    for r in records:
        raw_stu = str(r.get("獲獎學生", "") or "").strip()
        for name in raw_stu.split("、"):
            n = name.strip()
            if len(n) >= 2 and n not in PLACEHOLDER_NAMES and "○" not in n:
                if f'"{n}"' in js_content or n in js_content:
                    leaked.append(f"姓名:{n}")
        raw_id = str(r.get("學生學號", "") or "").strip()
        if len(raw_id) >= 6 and raw_id not in PLACEHOLDER_NAMES and "*" not in raw_id:
            if raw_id in js_content:
                leaked.append(f"學號:{raw_id}")

    if leaked:
        raise RuntimeError(f"[資安阻斷] 偵測到未遮罩明文個資殘留，已中止產出 data.js: {leaked[:5]}")

    os.makedirs(os.path.dirname(data_js_path), exist_ok=True)
    with open(data_js_path, "w", encoding="utf-8") as f:
        f.write(js_content)

    mode_desc = "純公開去識別化模式 (不含加密保險箱)" if public_only else "去識別化公開層 + AES-256-GCM 加密保險箱模式"
    print(f"[資安封裝成功] 已將 {len(public_records)} 筆紀錄安全寫入 web/data.js ({mode_desc})")
    print("[資安稽核通過] web/data.js 零明文學生姓名與學號外洩！")


def main():
    parser = argparse.ArgumentParser(description="產出掛網於 GitHub Pages 之去識別化與 AES-256-GCM 加密前端資料庫")
    parser.add_argument(
        "--passphrase",
        type=str,
        default=DEFAULT_ADMIN_PASSPHRASE,
        help="設定管理員解鎖通行密碼（亦可透過環境變數 FOOYIN_ADMIN_PASSPHRASE 指定）",
    )
    parser.add_argument(
        "--public-only",
        action="store_true",
        help="僅輸出公開去識別化遮罩資料，不封裝任何加密個資保險箱",
    )
    args = parser.parse_args()
    build_secure_data_js(passphrase=args.passphrase, public_only=args.public_only)


if __name__ == "__main__":
    main()
