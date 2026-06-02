#!/usr/bin/env python3
"""Usuń pozostałości cookie-panel HTML z 4 stron"""

import re

FILES = [
    "kontakt/index.html",
    "Hotel/index.html",
    "catering/index.html",
    "przyjecia/index.html",
]

for filepath in FILES:
    print(f"\n=== {filepath} ===")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    original = content

    # Usuń pozostały panel HTML: od <div class="cookie-option"> (zawierającego "Analityczne")
    # aż do zamknięcia cookie-overlay (</div>\n    </div>\n\n)
    pattern = r'(<div class="cookie-option">\s*<div class="cookie-option-info">\s*<strong>Analityczne.*?</div>\s*</div>\s*)'
    match = re.search(pattern, content, re.DOTALL)
    if match:
        removed = match.group(1)
        content = content[:match.start()] + content[match.end():]
        print(f"  ✅ Usunięto pozostałość HTML ({len(removed)} znaków)")
    else:
        print(f"  ⚠️  Nie znaleziono")

    # Sprawdź jeszcze czy są inne pozostałości
    for bad in ['cookie-panel', 'cookie-overlay', 'cookie-float-btn', 'cookie-btn', 
                'cookie-header', 'cookie-icon', 'cookie-desc', 'cookie-options',
                'cookie-option', 'cookie-badge', 'cookie-status-indicator',
                'cookie-docs-row', 'cookie-doc-link', 'cookie-actions',
                'openCookiePanel', 'initCookiePanel', 'cookieFloatBtn',
                'cookieOverlay', 'cookieEssentialBtn', 'cookieAcceptAllBtn',
                'cookieExtraBadge', 'cookieAnalyticsStatus']:
        if bad in content:
            # Znajdź linie
            lines = content.split('\n')
            for i, line in enumerate(lines, 1):
                if bad in line:
                    print(f"  ⚠️  POZOSTAŁOŚĆ: '{bad}' w linii {i}: {line.strip()[:80]}")

    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  ✅ ZAPISANO")
