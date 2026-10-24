export const reportCss = String.raw`
:root {
  --bg: #f5f6f8; --card: #fff; --text: #1b1f24; --muted: #667085; --line: #e4e7ec; --accent: #4f46e5;
  --critical: #b42318; --high: #e04f16; --medium: #dc8b00; --low: #3b82f6; --info: #98a2b3; --ok: #12b76a;
  --radius: 10px; --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
code, .mono { font-family: var(--mono); font-size: 12px; }
code { background: #f2f4f7; padding: 1px 5px; border-radius: 4px; word-break: break-all; }
pre { background: #101828; color: #e4e7ec; padding: 10px 12px; border-radius: 8px; overflow: auto; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.wrap { max-width: 1280px; margin: 0 auto; padding: 0 24px; }
header.top { background: #101828; color: #fff; padding: 28px 0 22px; }
header.top .brand { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #a5b4fc; font-weight: 600; }
header.top h1 { margin: 6px 0 4px; font-size: 26px; }
header.top .meta { color: #cbd5e1; font-size: 13px; }
header.top .meta a { color: #c7d2fe; }
.status-banner { margin-top: 12px; padding: 8px 12px; border-radius: 8px; background: #7a2e0e; color: #fff; font-size: 13px; }
.summary { display: grid; grid-template-columns: 200px 1fr 1fr; gap: 16px; margin: 20px 0; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; }
.card h3 { margin: 0 0 10px; font-size: 13px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.score { display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ring { --p: 50; --c: var(--ok); width: 120px; height: 120px; border-radius: 50%; display: grid; place-items: center;
  background: conic-gradient(var(--c) calc(var(--p) * 1%), #eef0f3 0); }
.ring span { width: 94px; height: 94px; border-radius: 50%; background: #fff; display: grid; place-items: center; font-size: 30px; font-weight: 700; }
.score small { color: var(--muted); margin-top: 6px; }
.sevs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.sev-box { border-radius: 8px; padding: 10px; background: #f9fafb; border-left: 4px solid var(--c); }
.sev-box b { display: block; font-size: 22px; }
.sev-box span { color: var(--muted); font-size: 12px; }
.cats { display: flex; gap: 14px; margin-top: 12px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
.cmp .delta-up { color: var(--ok); font-weight: 600; } .cmp .delta-down { color: var(--critical); font-weight: 600; }
.cmp ul { margin: 6px 0 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
.ai-summary { margin-bottom: 20px; }
.ai-summary .md h3 { font-size: 15px; margin: 14px 0 6px; text-transform: none; letter-spacing: 0; color: var(--text); }
.ai-summary .md ul, .ai-summary .md ol { margin: 4px 0 8px; padding-left: 22px; }
.ai-summary .md p { margin: 6px 0; }
nav.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 16px; position: sticky; top: 0; background: var(--bg); z-index: 5; padding-top: 6px; flex-wrap: wrap; }
nav.tabs button { border: 0; background: none; padding: 10px 14px; font: inherit; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; font-weight: 500; }
nav.tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
nav.tabs .count { background: #eef0f3; border-radius: 10px; padding: 0 7px; font-size: 12px; margin-left: 4px; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.chip { border: 1px solid var(--line); background: #fff; border-radius: 16px; padding: 4px 11px; font: inherit; font-size: 13px; cursor: pointer; color: var(--text); }
.chip.on { background: #eef2ff; border-color: #c7d2fe; color: #3730a3; }
.chip .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--c); margin-right: 5px; }
.filters input[type=search], .filters select { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; font: inherit; background: #fff; }
.filters input[type=search] { min-width: 220px; }
.filters label { font-size: 13px; color: var(--muted); display: flex; gap: 4px; align-items: center; }
.issue { background: #fff; border: 1px solid var(--line); border-left: 4px solid var(--c); border-radius: var(--radius); margin-bottom: 10px; }
.issue > summary { list-style: none; cursor: pointer; padding: 12px 16px; }
.issue > summary::-webkit-details-marker { display: none; }
.issue .head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.issue .title { font-weight: 600; }
.issue .msg { margin: 4px 0 0; color: #344054; }
.issue .where { margin-left: auto; color: var(--muted); font-size: 12px; white-space: nowrap; }
.issue .body { padding: 0 16px 16px; border-top: 1px dashed var(--line); }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 12px; }
.cols.single { grid-template-columns: 1fr; }
.crop { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; cursor: zoom-in; background: #fff; }
.badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; color: #fff; background: var(--c); white-space: nowrap; }
.badge.soft { background: #eef0f3; color: #344054; }
.badge.new { background: #fef0c7; color: #93370d; }
.badge.global { background: #ede9fe; color: #5b21b6; }
.badge.ai { background: #d1fadf; color: #05603a; }
.sev-critical { --c: var(--critical); } .sev-high { --c: var(--high); } .sev-medium { --c: var(--medium); } .sev-low { --c: var(--low); } .sev-info { --c: var(--info); }
.kv { margin: 8px 0; } .kv b { display: block; font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 2px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12px; background: #f9fafb; }
td.url { max-width: 360px; word-break: break-all; }
.btn { border: 1px solid var(--line); background: #fff; border-radius: 7px; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; color: var(--text); }
.btn:hover { border-color: #c7d2fe; background: #eef2ff; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.empty { padding: 40px; text-align: center; color: var(--muted); background: #fff; border: 1px dashed var(--line); border-radius: var(--radius); }
.task-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.tchip { border: 1px solid var(--line); border-radius: 6px; padding: 3px 7px; font-size: 12px; cursor: pointer; background: #fff; display: inline-flex; gap: 5px; align-items: center; }
.tchip i { font-style: normal; font-weight: 700; color: var(--c); }
.tchip.ok i { color: var(--ok); }
.tchip.err { background: #fef3f2; }
.sweep-row { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 10px; }
.bar { position: relative; height: 22px; background: #ecfdf3; border-radius: 6px; margin: 8px 0 22px; border: 1px solid #d1fadf; }
.bar .rng { position: absolute; top: 0; bottom: 0; background: var(--critical); opacity: .85; border-radius: 3px; min-width: 3px; }
.bar .tick { position: absolute; top: -3px; bottom: -3px; width: 1px; background: #667085; }
.bar .tick span { position: absolute; top: 26px; transform: translateX(-50%); font-size: 10px; color: var(--muted); white-space: nowrap; }
.bar.err { background: #f2f4f7; border-color: var(--line); }
.ranges { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
.range { border: 1px solid var(--line); border-radius: 8px; padding: 10px; font-size: 13px; }
.range img { width: 100%; margin-top: 8px; }
.modal { position: fixed; inset: 0; background: rgba(16,24,40,.72); z-index: 50; display: flex; align-items: stretch; justify-content: center; padding: 24px; }
.modal .panel { background: #fff; border-radius: 12px; width: 100%; max-width: 1500px; display: flex; flex-direction: column; overflow: hidden; }
.modal .ph { display: flex; gap: 10px; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.modal .ph h2 { margin: 0; font-size: 16px; flex: 1; min-width: 200px; word-break: break-all; }
.modal .pb { display: grid; grid-template-columns: 1fr 380px; flex: 1; min-height: 0; }
.modal .shot-area { overflow: auto; background: #e4e7ec; padding: 16px; }
.modal .side { overflow: auto; border-left: 1px solid var(--line); padding: 12px; }
.shot { position: relative; margin: 0 auto; box-shadow: 0 4px 18px rgba(0,0,0,.18); background: #fff; }
.shot img { display: block; width: 100%; }
.shot .box { position: absolute; border: 2px solid #ff2d55; background: rgba(255,45,85,.12); border-radius: 2px; cursor: pointer; }
.shot .box.flash { animation: flash 1s 2; }
.shot .box b { position: absolute; top: -10px; left: -10px; background: #ff2d55; color: #fff; font-size: 10px; border-radius: 9px; min-width: 18px; height: 18px; display: grid; place-items: center; padding: 0 4px; }
@keyframes flash { 50% { background: rgba(255,45,85,.55); } }
.side .si { border: 1px solid var(--line); border-left: 3px solid var(--c); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; cursor: pointer; font-size: 13px; }
.side .si .n { display: inline-grid; place-items: center; min-width: 18px; height: 18px; border-radius: 9px; background: #ff2d55; color: #fff; font-size: 10px; margin-right: 4px; }
.vtabs { display: flex; gap: 4px; flex-wrap: wrap; }
.vtabs .chip { font-size: 12px; padding: 3px 9px; }
.lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.85); z-index: 60; overflow: auto; padding: 30px; text-align: center; cursor: zoom-out; }
.lightbox img { max-width: 100%; background: #fff; }
.toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #101828; color: #fff; padding: 10px 16px; border-radius: 8px; z-index: 70; }
.muted { color: var(--muted); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.section-title { font-size: 18px; margin: 26px 0 12px; }
footer { color: var(--muted); font-size: 12px; text-align: center; padding: 30px 0; }
@media (max-width: 900px) {
  .summary, .cols, .grid2 { grid-template-columns: 1fr; }
  .modal .pb { grid-template-columns: 1fr; }
  .sevs { grid-template-columns: repeat(2, 1fr); }
}
@media print {
  body { background: #fff; font-size: 11px; }
  nav.tabs, .filters, .btn, .no-print { display: none !important; }
  .issue, .card, .sweep-row { break-inside: avoid; }
  .issue .body { display: block !important; }
  .crop { max-height: 360px; object-fit: contain; object-position: top left; }
  header.top { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .badge, .sev-box, .ring, .bar .rng { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
