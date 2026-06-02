#!/usr/bin/env python3
"""Usuń pozostałości cookie-panel - docs-row, actions i zamykające divy"""

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

    # Usuń: <div class="cookie-docs-row"> ... </div> </div> (zamykające panel i overlay)
    # Wzorzec: od cookie-docs-row aż do zamknięcia overlay (</div>\n    </div>\n)
    pattern = r'<div class="cookie-docs-row">.*?</div>\s*</div>\s*'
    match = re.search(pattern, content, re.DOTALL)
    if match:
        # Rozszerz dopasowanie o poprzedzające </div> i </div> (sieroty po cookie-options)
        # Sprawdź co jest przed dopasowaniem
        prefix_check = content[max(0, match.start()-30):match.start()]
        # Usuń też ewentualne sieroty </div> przed cookie-docs-row
        start = match.start()
        prefix = content[max(0, start-60):start]
        # Cofnij się by objąć </div>\n        </div>\n\n które są sierotami
        m2 = re.search(r'(</div>\s*</div>\s*\n\s*\n\s*)' + re.escape(match.group(0)), 
                       content[max(0, start-200):match.end()], re.DOTALL)
        if m2:
            # Zawęź do całego bloku
            full_match_start = max(0, start-200) + m2.start()
            full_block = content[full_match_start:max(0, start-200) + m2.end()]
            content = content[:full_match_start] + content[full_match_start + len(full_block):]
            print(f"  ✅ Usunięto blok z sierotami ({len(full_block)} znaków)")
        else:
            removed = match.group(0)
            content = content[:start] + content[match.end():]
            print(f"  ✅ Usunięto docs-row+actions ({len(removed)} znaków)")
    else:
        print(f"  ⚠️  Nie znaleziono cookie-docs-row")

    # Końcowe sprawdzenie
    for bad in ['cookie-panel', 'cookie-overlay', 'cookie-float-btn', 'cookie-btn', 
                'cookie-header', 'cookie-icon', 'cookie-desc', 'cookie-options',
                'cookie-option', 'cookie-badge', 'cookie-status-indicator',
                'cookie-docs-row', 'cookie-doc-link', 'cookie-actions',
                'openCookiePanel', 'initCookiePanel', 'cookieFloatBtn',
                'cookieOverlay', 'cookieEssentialBtn', 'cookieAcceptAllBtn',
                'cookieExtraBadge', 'cookieAnalyticsStatus', 'cookies-banner']:
        if bad in content:
            lines = content.split('\n')
            for i, line in enumerate(lines, 1):
                if bad in line:
                    print(f"  ⚠️  POZOSTAŁOŚĆ: '{bad}' w linii {i}: {line.strip()[:80]}")

    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  ✅ ZAPISANO")
