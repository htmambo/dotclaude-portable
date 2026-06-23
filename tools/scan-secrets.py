#!/usr/bin/env python3
"""scan-secrets.py — 扫仓库内疑似 secret。

扫描规则：
  - sk-[A-Za-z0-9]{20,}      OpenAI / Anthropic style
  - sk-ant-...               Anthropic specific
  - AKIA[0-9A-Z]{16}         AWS access key
  - ghp_[A-Za-z0-9]{30,}     GitHub PAT
  - xox[baprs]-[A-Za-z0-9-]+ Slack
  - \\d{8,12}:[A-Za-z0-9_-]{30,}  Telegram bot token
  - long hex >= 32 chars     generic high-entropy

扫描范围：仓库根下除 .git/ 外的所有文本文件。
退出码：0=clean，1=命中。
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

PATTERNS: list[tuple[str, re.Pattern]] = [
    ("openai/anthropic sk-", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")),
    ("anthropic sk-ant-",     re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("aws AKIA",              re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github ghp_",           re.compile(r"\bghp_[A-Za-z0-9]{30,}\b")),
    ("slack xox[baprs]-",     re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("telegram bot token",    re.compile(r"\b\d{8,12}:[A-Za-z0-9_-]{30,}\b")),
]

# 上下文限定的高熵长 hex：仅在 token/key/secret/password/bearer/api_key 等 key 上下文中报
SENSITIVE_KEYS = re.compile(
    r'(?i)(token|secret|password|api[_-]?key|bearer|auth[_-]?token|access[_-]?key|credential)'
    r'\s*[:=]\s*["\']?([0-9a-f]{32,})["\']?'
)
HEX_LONG = re.compile(r"\b[0-9a-f]{40,}\b")

# 跳过二进制
BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".tar", ".gz", ".ico",
              ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".bin", ".so", ".dylib"}

# 跳过目录
SKIP_DIRS = {".git", "node_modules", "backups", ".omc", ".cache", "tests"}

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(".").resolve()
# 全仓库扫描（含 tests/fixtures 负样本）时跳过 tests/，子目录扫描时仅跳运行时目录
# cwd 不影响判断：用 ROOT 自身是否含 tests/ 段决定（避免 v1.0.2 已知 cwd 漂移 bug 复发）
SKIP_DEFAULT = SKIP_DIRS  # 全仓库扫描时跳过 tests/fixtures
SKIP_TIGHT: set[str] = {".git", ".omc", ".cache"}  # 子目录扫描时仅跳运行时

def _is_repo_scan() -> bool:
    # ROOT 是仓库根的判定：ROOT 路径直接包含 tests/ 或 docs/Usage/INSTALL.md 等仓库特征
    # 这样无论 cwd 在哪都不会误判
    return (ROOT / "tests" / "fixtures").is_dir() and (ROOT / "global" / "CLAUDE.md").is_file()

def iter_files() -> list[Path]:
    out: list[Path] = []
    skip = SKIP_DEFAULT if _is_repo_scan() else SKIP_TIGHT
    for p in ROOT.rglob("*"):
        if not p.is_file():
            continue
        if any(part in skip for part in p.parts):
            continue
        if p.suffix.lower() in BINARY_EXT:
            continue
        out.append(p)
    return out

def scan_text(path: Path, text: str) -> list[tuple[str, int, str]]:
    hits: list[tuple[str, int, str]] = []
    for label, pat in PATTERNS:
        for m in pat.finditer(text):
            line = text[: m.start()].count("\n") + 1
            hits.append((label, line, m.group(0)[:30] + ("…" if len(m.group(0)) > 30 else "")))
    # 高熵 hex 在敏感 key 上下文
    for m in SENSITIVE_KEYS.finditer(text):
        line = text[: m.start()].count("\n") + 1
        hits.append(("sensitive-key+hex", line, m.group(0)[:50]))
    # 裸长 hex 单独报（噪音大，仅 top-level 文本文件报）
    if path.suffix in {".json", ".env", ".yaml", ".yml", ".toml", ".sh", ".mjs", ".js", ".ts"}:
        for m in HEX_LONG.finditer(text):
            line = text[: m.start()].count("\n") + 1
            hits.append(("bare-long-hex", line, m.group(0)[:30] + "…"))
    return hits

def main() -> int:
    files = iter_files()
    total_hits = 0
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            print(f"[skip] {f}: {e}", file=sys.stderr)
            continue
        for label, line, snippet in scan_text(f, text):
            print(f"[hit] {f}:{line}  {label}  {snippet}")
            total_hits += 1
    if total_hits == 0:
        print("[scan-secrets] clean")
        return 0
    print(f"[scan-secrets] {total_hits} hit(s)", file=sys.stderr)
    return 1

if __name__ == "__main__":
    sys.exit(main())
