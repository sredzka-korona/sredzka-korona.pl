path = '/Users/janicki/myApps/sredzka-korona.pl/dokumenty/index.html'
with open(path, 'r') as f:
    content = f.read()

css = '''

      /* ═══════════ PRZYCISK COOKIES (floating) ═══════════ */
      .cookie-float-btn {
        position: fixed;
        top: auto;
        left: auto;
        right: 2rem;
        bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: var(--bg-elevated);
        border: 1px solid var(--line);
        color: var(--text);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        box-shadow: var(--shadow);
        transition: transform 0.3s ease, box-shadow 0.3s ease, background 0.3s ease, border-color 0.3s ease;
        z-index: 98;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        transform: translateZ(0);
        backface-visibility: hidden;
      }

      .cookie-float-btn:hover {
        transform: translateZ(0) scale(1.1);
        box-shadow: 0 6px 24px rgba(168, 137, 90, 0.25);
        border-color: var(--gold);
        background: rgba(200, 170, 120, 0.08);
      }

      .cookie-float-btn:active {
        transform: translateZ(0) scale(0.95);
      }

      /* ═══════════ PANEL COOKIES (overlay) ═══════════ */
      .cookie-overlay {
        position: fixed;
        inset: 0;
        z-index: 500;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }

      .cookie-overlay[aria-hidden="true"] {
        display: none;
      }

      .cookie-overlay[aria-hidden="false"] {
        animation: cookie-fade-in 0.25s ease;
      }

      @keyframes cookie-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .cookie-panel {
        width: min(560px, 96vw);
        background: var(--bg-elevated);
        border: 1px solid var(--line);
        border-radius: var(--radius-xl);
        padding: 24px;
        box-shadow: 0 -12px 60px rgba(0, 0, 0, 0.18), var(--shadow);
        animation: cookie-slide-up 0.35s ease;
      }

      @keyframes cookie-slide-up {
        from { transform: translateY(40px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      .cookie-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }

      .cookie-icon {
        font-size: 28px;
        line-height: 1;
      }

      .cookie-header h2 {
        font-family: "Cormorant Garamond", serif;
        font-size: 20px;
        font-weight: 700;
        margin: 0;
        color: var(--text);
        letter-spacing: 0.5px;
      }

      .cookie-desc {
        font-size: 13px;
        color: var(--muted);
        line-height: 1.65;
        margin-bottom: 18px;
      }

      .cookie-desc strong {
        color: var(--text);
      }

      .cookie-options {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 16px;
      }

      .cookie-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 12px 14px;
        background: rgba(200, 170, 120, 0.04);
        border: 1px solid var(--line);
        border-radius: 16px;
      }

      .cookie-option-info strong {
        font-size: 13px;
        color: var(--text);
        display: block;
        margin-bottom: 2px;
      }

      .cookie-option-info p {
        font-size: 12px;
        color: var(--muted);
        margin: 0;
        line-height: 1.5;
      }

      .cookie-badge {
        font-size: 10px;
        letter-spacing: 0.5px;
        white-space: nowrap;
        padding: 4px 10px;
        border-radius: 999px;
        font-weight: 600;
        flex-shrink: 0;
      }

      .cookie-badge-essential {
        color: #5a7d3a;
        background: rgba(90, 125, 58, 0.08);
        border: 1px solid rgba(90, 125, 58, 0.25);
      }

      .cookie-badge-extra {
        color: var(--muted);
        background: rgba(107, 93, 79, 0.06);
        border: 1px solid var(--line);
      }

      .cookie-badge-extra.is-enabled {
        color: #5a7d3a;
        background: rgba(90, 125, 58, 0.08);
        border: 1px solid rgba(90, 125, 58, 0.25);
      }

      .cookie-status-indicator {
        font-size: 11px;
        color: var(--muted);
        flex-shrink: 0;
        min-width: 65px;
        text-align: right;
      }

      .cookie-docs-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }

      .cookie-doc-link {
        font-size: 11px;
        font-weight: 600;
        background: transparent;
        border: 1px solid var(--line);
        color: var(--muted);
        padding: 6px 12px;
        border-radius: 10px;
        text-decoration: none;
        transition: all 0.2s;
        cursor: pointer;
        flex: 1;
        text-align: center;
        min-width: 0;
        font-family: inherit;
      }

      .cookie-doc-link:hover {
        border-color: var(--gold);
        color: var(--text);
        background: rgba(200, 170, 120, 0.06);
      }

      .cookie-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .cookie-btn {
        flex: 1;
        min-width: 120px;
        padding: 12px 20px;
        border-radius: 14px;
        font-size: 13px;
        font-weight: 700;
        font-family: inherit;
        border: 1px solid;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 0.3px;
      }

      .cookie-btn-essential {
        border-color: var(--gold);
        background: var(--bg-elevated);
        color: var(--text);
      }

      .cookie-btn-essential:hover {
        background: rgba(200, 170, 120, 0.1);
        box-shadow: 0 2px 12px rgba(200, 170, 120, 0.2);
      }

      .cookie-btn-all {
        border-color: var(--gold);
        background: var(--gold);
        color: #fff;
      }

      .cookie-btn-all:hover {
        background: #b8946a;
        box-shadow: 0 2px 16px rgba(168, 137, 90, 0.35);
      }

      @media (max-width: 820px) {
        .cookie-float-btn {
          right: 0.9rem;
          bottom: calc(4.75rem + env(safe-area-inset-bottom, 0px));
          width: 42px;
          height: 42px;
          font-size: 19px;
        }

        .cookie-panel {
          padding: 18px 14px;
          max-height: 92dvh;
          overflow-y: auto;
        }

        .cookie-docs-row {
          flex-wrap: wrap;
        }

        .cookie-actions {
          flex-direction: column;
        }
      }
'''

old = '      }\n    </style>\n  </head>\n  <body>\n    <div class="scroll-indicator" aria-hidden="true">'
new = '      }' + css + '\n    </style>\n  </head>\n  <body>\n    <div class="scroll-indicator" aria-hidden="true">'
content = content.replace(old, new, 1)

with open(path, 'w') as f:
    f.write(content)
print('dokumenty/index.html - CSS DODANY')
