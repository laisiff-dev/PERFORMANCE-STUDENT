import os
import re
import json
import base64
import hashlib
from typing import Dict, Any, List, Optional
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PBKDF2_ITERATIONS = 150_000
DEFAULT_ADMIN_PASSPHRASE = os.environ.get("FOOYIN_ADMIN_PASSPHRASE", "Fooyin@IR2026!")

PLACEHOLDER_NAMES = {"", "無", "未填", "未填寫", "學生未填", "未公開", "未提供"}


def mask_single_name(name: str) -> str:
    """依台灣個資法去識別化規範遮罩單一姓名（例：李靜美 -> 李○美；若原本為『無』則維持『無』）"""
    n = name.strip()
    if not n or n in PLACEHOLDER_NAMES:
        return "無"
    if "○" in n or "*" in n:
        return n
    length = len(n)
    if length == 1:
        return "○"
    if length == 2:
        return f"{n[0]}○"
    if length == 3:
        return f"{n[0]}○{n[-1]}"
    return f"{n[:2]}{'○' * (length - 3)}{n[-1]}"


def mask_student_names(names_str: Any) -> str:
    """支援多人姓名遮罩（以頓號、逗號、斜線或空白分隔）"""
    if names_str is None:
        return "無"
    raw = str(names_str).strip()
    if not raw or raw in PLACEHOLDER_NAMES:
        return "無"
    parts = re.split(r"[、,，/／;；]+", raw)
    masked_parts = [mask_single_name(p) for p in parts if p.strip()]
    return "、".join(masked_parts) if masked_parts else "無"


def mask_student_id(stu_id: Any) -> str:
    """遮罩學號：僅保留入學年度前 3 碼與末 1 碼（若原本為『無』則維持『無』）"""
    if stu_id is None:
        return "無"
    s = str(stu_id).strip()
    if not s or s in PLACEHOLDER_NAMES:
        return "無"
    if "*" in s:
        return s
    if len(s) <= 4:
        return s[0] + "***"
    return f"{s[:3]}{'*' * (len(s) - 4)}{s[-1]}"


def mask_grade_class(grade: Any) -> str:
    """遮罩班級細項以防交叉比對識別"""
    if grade is None:
        return "無"
    g = str(grade).strip()
    if not g or g in PLACEHOLDER_NAMES:
        return "無"
    return re.sub(r"(\d+年)\s*[0-9一二三四五六七八九十甲乙丙丁]+\s*班", r"\1○班", g)


def mask_high_school(school: Any) -> str:
    """公開掛網模式隱藏原畢業學校（若原本為『無』則維持『無』）"""
    if school is None:
        return "無"
    s = str(school).strip()
    if not s or s in PLACEHOLDER_NAMES:
        return "無"
    if "已去識別化" in s:
        return s
    return "🔒 已去識別化保護"


def mask_evidence_url(url: Any) -> str:
    """保護雲端硬碟私密佐證檔案連結（如 Google Drive），僅公開學校官網新聞連結"""
    if url is None:
        return ""
    u = str(url).strip()
    if not u:
        return ""
    lower_u = u.lower()
    private_domains = ("drive.google.com", "docs.google.com", "onedrive.live.com", "sharepoint.com", "dropbox.com")
    if any(d in lower_u for d in private_domains):
        return "#protected-evidence"
    return u


def extract_pii_entry(record: Dict[str, Any]) -> Dict[str, Any]:
    """擷取單筆紀錄之敏感個資欄位，供 AES-256-GCM 加密保險箱封裝"""
    return {
        "獲獎學生": str(record.get("獲獎學生", "") or ""),
        "學生學號": str(record.get("學生學號", "") or ""),
        "學制班級": str(record.get("學制班級", "") or ""),
        "原畢業學校": str(record.get("原畢業學校", "") or ""),
        "佐證連結": str(record.get("佐證連結", "") or ""),
    }


def deidentify_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """將單筆獲獎紀錄轉為可安全公開於 GitHub Pages 之去識別化版本"""
    safe_rec = dict(record)
    raw_names = str(record.get("獲獎學生", "") or "").strip()
    safe_remarks = str(record.get("備註", "") or "")
    if raw_names and raw_names not in PLACEHOLDER_NAMES and "○" not in raw_names:
        for nm in [s.strip() for s in re.split(r"[、,，/／;；]+", raw_names) if len(s.strip()) >= 2]:
            safe_remarks = safe_remarks.replace(nm, _mask_single_name(nm))
    safe_rec["獲獎學生"] = mask_student_names(record.get("獲獎學生"))
    safe_rec["學生學號"] = mask_student_id(record.get("學生學號"))
    safe_rec["學制班級"] = mask_grade_class(record.get("學制班級"))
    safe_rec["原畢業學校"] = mask_high_school(record.get("原畢業學校"))
    safe_rec["佐證連結"] = mask_evidence_url(record.get("佐證連結"))
    safe_rec["備註"] = safe_remarks
    return safe_rec


def deidentify_records(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """批次轉換為去識別化公開資料集"""
    return [deidentify_record(r) for r in records]


def encrypt_pii_vault(records: List[Dict[str, Any]], passphrase: Optional[str] = None) -> Dict[str, Any]:
    """
    使用 PBKDF2-HMAC-SHA256 (150,000 次迭代) + AES-256-GCM 驗證加密演算法，
    將所有學生敏感個資加密為單一密文保險箱，前端透過 Web Crypto API 於記憶體內解密。
    """
    secret = (passphrase or DEFAULT_ADMIN_PASSPHRASE).encode("utf-8")
    vault_map: Dict[str, Dict[str, Any]] = {}
    for r in records:
        rec_id = str(r.get("編號", r.get("識別號", "")))
        if rec_id:
            vault_map[rec_id] = extract_pii_entry(r)

    plaintext_bytes = json.dumps(vault_map, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    salt = os.urandom(16)
    iv = os.urandom(12)
    key = hashlib.pbkdf2_hmac("sha256", secret, salt, PBKDF2_ITERATIONS, dklen=32)
    aesgcm = AESGCM(key)
    # AESGCM.encrypt 回傳 ciphertext || 16-byte auth tag，與瀏覽器 WebCrypto AES-GCM 格式完全相容
    ciphertext_with_tag = aesgcm.encrypt(iv, plaintext_bytes, None)

    return {
        "version": 1,
        "cipher": "AES-256-GCM",
        "kdf": "PBKDF2-SHA256",
        "iterations": PBKDF2_ITERATIONS,
        "salt": base64.b64encode(salt).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext_with_tag).decode("ascii"),
    }


def decrypt_pii_vault(vault_obj: Dict[str, Any], passphrase: str) -> Dict[str, Dict[str, Any]]:
    """驗證並解密 AES-256-GCM 個資保險箱（供本機測試與 API 驗證使用）"""
    salt = base64.b64decode(vault_obj["salt"])
    iv = base64.b64decode(vault_obj["iv"])
    ciphertext = base64.b64decode(vault_obj["ciphertext"])
    iterations = int(vault_obj.get("iterations", PBKDF2_ITERATIONS))
    key = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, iterations, dklen=32)
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext, None)
    return json.loads(plaintext.decode("utf-8"))
