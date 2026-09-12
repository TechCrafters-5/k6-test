#!/usr/bin/env python3
"""从 xxl-job 的 loadTestUserJobHandler 执行日志中提取 token，写入 tokens.json。

用法：把该任务打印的日志整段粘贴进 token_data.json，然后执行本脚本。
    ./extract_tokens.py [输入文件，默认 token_data.json]
"""
import json
import re
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEST = BASE_DIR / "tokens.json"


def main() -> None:
    src = BASE_DIR / (sys.argv[1] if len(sys.argv) > 1 else "token_data.json")
    if not src.is_file():
        sys.exit(f"找不到输入文件: {src}")

    raw = src.read_text(encoding="utf-8")
    tokens = re.findall(r"token=(\S+)", raw)
    if not tokens:
        sys.exit(f"未从 {src} 中提取到任何 token，未写入 {DEST}")

    DEST.write_text(json.dumps(tokens, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写入 {len(tokens)} 个 token 到 {DEST}")


if __name__ == "__main__":
    main()
