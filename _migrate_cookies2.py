#!/usr/bin/env python3
"""Migracja cookies dla dokumenty i f-and-q"""

import re

FILES = [
    "dokumenty/index.html",
    "f-and-q/index.html",
]

for filepath in FILES:
    print(f"\n=== {filepath} ===")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    original = content

    # 1. Usuń CSS cookies
    css_pattern = r"(      /\* ═+ PRZYCISK COOKIES.*?</style>)"
    match = re.search(css_pattern, content, re.DOTALL)
    if match:
        removed = match.group(1)
        if "admin-corner" not in removed:
            content = content[:match.start()] + content[match.end():]
            print(f"  CSS: usunięto {len(removed)} znaków")
        else:
            print(f"  CSS: POMINIĘTO (zawiera admin-corner)")
    else:
        print(f"  CSS: NIE ZNALEZIONO")

    # 2. Usuń JS cookies
    js_pattern = r"(        /\* ═+ PANEL COOKIES.*?    </script>)"
    match = re.search(js_pattern, content, re.DOTALL)
    if match:
        removed = match.group(1)
        content = content[:match.start()] + content[match.end():]
        print(f"  JS:  usunięto {len(removed)} znaków")
    else:
        print(f"  JS:  NIE ZNALEZIONO")

    # 3. Usuń HTML panel - od <button> do </div>\n    </div>\n
    html_pattern = r'(    <button class="cookie-float-btn".*?</div>\s*</div>\s*)'
    match = re.search(html_pattern, content, re.DOTALL)
    if match:
        removed = match.group(1)
        content = content[:match.start()] + content[match.end():]
        print(f"  HTML(1): usunięto {len(removed)} znaków")
    else:
        print(f"  HTML(1): NIE ZNALEZIONO")

    # 4. Usuń pozostałości docs-row + actions
    leftover = ("</div>\n        </div>\n\n"
                '        <div class="cookie-docs-row">\n'
                '          <a class="cookie-doc-link" href="../dokumenty/">Dokumenty: Polityka prywatności i cookies oraz informacja RODO</a>\n'
                '        </div>\n\n'
                '        <div class="cookie-actions">\n'
                '          <button class="cookie-btn cookie-btn-essential" id="cookieEssentialBtn" type="button">Tylko niezbędne</button>\n'
                '          <button class="cookie-btn cookie-btn-all" id="cookieAcceptAllBtn" type="button">Akceptuję wszystkie</button>\n'
                '        </div>\n'
                '      </div>\n'
                '    </div>\n\n')
    if leftover in content:
        content = content.replace(leftover, "\n")
        print(f"  HTML(2): usunięto pozostałości docs-row")
    else:
        print(f"  HTML(2): NIE ZNALEZIONO (może już usunięte)")

    # 5. Dodaj cookies-full.js przed </body>
    old_ref = '<script src="../assets/js/cookies-banner.js">'
    new_ref = '<script src="../assets/js/cookies-full.js">'
    if old_ref in content:
        content = content.replace(old_ref, new_ref)
        print(f"  REF: cookies-banner.js → cookies-full.js")
    elif 'cookies-full.js' not in content:
        # Wstaw przed </body>
        content = content.replace('</body>', '    <script src="../assets/js/cookies-full.js"></script>\n</body>')
        print(f"  REF: dodano cookies-full.js")
    else:
        print(f"  REF: już ma cookies-full.js")

    # 6. Sprawdź pozostałości
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
