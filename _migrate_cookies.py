#!/usr/bin/env python3
"""Migracja cookies: usuwa zduplikowany CSS/JS/HTML i zastępuje cookies-full.js"""

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

    # 1. Usuń CSS cookies: od "/* ═══════════ PRZYCISK COOKIES" do ostatniego "}" przed "</style>"
    #    Wzorzec: wszystko od komentarza "PRZYCISK COOKIES" do (i włączając) "    </style>"
    css_pattern = r"(      /\* ═+ PRZYCISK COOKIES.*?</style>)"
    match = re.search(css_pattern, content, re.DOTALL)
    if match:
        removed = match.group(1)
        # Sprawdź czy w usuniętym bloku są też inne style (nie-cookies)
        if "admin-corner" not in removed:
            content = content[:match.start()] + content[match.end():]
            print(f"  CSS: usunięto {len(removed)} znaków")
        else:
            print(f"  CSS: POMINIĘTO (zawiera admin-corner)")
    else:
        print(f"  CSS: NIE ZNALEZIONO wzorca")

    # 2. Usuń JS cookies: od "/* ═══════════ PANEL COOKIES" do "    </script>"
    js_pattern = r"(        /\* ═+ PANEL COOKIES.*?    </script>)"
    match = re.search(js_pattern, content, re.DOTALL)
    if match:
        removed = match.group(1)
        content = content[:match.start()] + content[match.end():]
        print(f"  JS:  usunięto {len(removed)} znaków")
    else:
        print(f"  JS:  NIE ZNALEZIONO wzorca")

    # 3. Usuń floating button + overlay panel HTML
    html_pattern = r'(    <button class="cookie-float-btn".*?</div>\s*</div>\s*)'
    match = re.search(html_pattern, content, re.DOTALL)
    if match:
        removed = match.group(1)
        content = content[:match.start()] + content[match.end():]
        print(f"  HTML: usunięto {len(removed)} znaków")
    else:
        print(f"  HTML: NIE ZNALEZIONO wzorca")

    # 4. Zamień cookies-banner.js na cookies-full.js
    old_ref = '<script src="../assets/js/cookies-banner.js">'
    new_ref = '<script src="../assets/js/cookies-full.js">'
    if old_ref in content:
        content = content.replace(old_ref, new_ref)
        print(f"  REF:  cookies-banner.js → cookies-full.js")
    else:
        print(f"  REF:  NIE ZNALEZIONO cookies-banner.js")

    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  ✅ ZAPISANO")
    else:
        print(f"  ⚠️  BRAK ZMIAN")
