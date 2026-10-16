"""把小程序 WXSS + engine/chart + H5 逻辑打包为单文件网页
输出：
  preview/index.html            本地预览（桌面带手机外框，手机端全屏）
  ../gzclp-web/index.html       发布目录（同内容 + manifest + 图标，可“添加到主屏幕”）
"""
import re, base64, json, pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT.parent / 'gzclp-web'


def rpx(css):
    return re.sub(r'(-?\d*\.?\d+)rpx', lambda m: f"{float(m.group(1)) / 2:g}px", css)


def prefix(css, pre):
    out = []
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        sels = [s.strip() for s in m.group(1).split(',')]
        out.append(', '.join(f'{pre} {s}' for s in sels if s) + ' {' + m.group(2) + '}')
    return '\n'.join(out)


def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


app_css = re.sub(r'(?m)^page \{', '.app {', strip_comments((ROOT / 'app.wxss').read_text()))
css = [rpx(app_css)]
for p in ['train', 'plan', 'stats', 'review', 'settings']:
    css.append(prefix(rpx(strip_comments((ROOT / 'pages' / p / f'{p}.wxss').read_text())), f'.pg-{p}'))
# 网页版的动作库是设置页里的子页面
css.append(prefix(rpx(strip_comments((ROOT / 'pages' / 'library' / 'library.wxss').read_text())), '.pg-settings'))


def b64(path):
    return 'data:image/png;base64,' + base64.b64encode(path.read_bytes()).decode()


icons = {}
for name in ['train', 'plan', 'stats', 'review', 'me']:
    for suf in ['', '-on']:
        icons[name + suf] = b64(ROOT / 'assets' / f'tab-{name}{suf}.png')

shell_css = """
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; height: 100%; background: #E5E5EA; font-family: -apple-system, "SF Pro Text", "PingFang SC", sans-serif; }
body { display: flex; align-items: center; justify-content: center; gap: 56px; }
.side { width: 300px; color: #6E6E73; font-size: 14px; line-height: 1.7; }
.side h1 { color: #1C1C1E; font-size: 28px; margin: 0 0 4px; letter-spacing: -0.5px; }
.side h1 span { color: #FF6B1A; }
.side b { color: #1C1C1E; font-weight: 600; }
.side ul { padding-left: 18px; margin: 12px 0 18px; }
.side .tag { display: inline-block; background: #fff; border-radius: 6px; padding: 1px 8px; margin: 3px 4px 3px 0; font-size: 12px; color: #3A3A3C; }
.phone { width: 390px; height: 844px; border-radius: 54px; padding: 11px; background: #1C1C1E; box-shadow: 0 40px 90px rgba(0,0,0,.25), inset 0 0 0 2px #3A3A3C; flex-shrink: 0; }
.app { position: relative; width: 100%; height: 100%; border-radius: 44px; overflow: hidden; display: flex; flex-direction: column; }
.status { height: 47px; flex-shrink: 0; display: flex; align-items: flex-end; justify-content: space-between; padding: 0 32px 6px; font-size: 15px; font-weight: 600; color: #1C1C1E; background: #F2F2F7; }
.nav { position: relative; height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: rgba(242,242,247,0.92); color: #1C1C1E; font-size: 17px; font-weight: 600; z-index: 5; }
.capsule { position: absolute; right: 8px; top: 7px; width: 87px; height: 31px; border-radius: 16px; border: 0.5px solid rgba(0,0,0,.12); display: flex; align-items: center; justify-content: space-around; color: #1C1C1E; font-size: 14px; background: rgba(255,255,255,.7); }
.capsule i { width: 0.5px; height: 18px; background: rgba(0,0,0,.15); }
#body { flex: 1; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; -webkit-overflow-scrolling: touch; background: #F2F2F7; }
#body::-webkit-scrollbar { display: none; }
.tabbar { flex-shrink: 0; display: flex; padding: 6px 0 calc(6px + env(safe-area-inset-bottom)); background: rgba(249,249,249,0.94); border-top: 0.5px solid rgba(0,0,0,0.16); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); }
.phone .tabbar { padding-bottom: 26px; }
.tb-item { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 10px; font-weight: 500; color: #8E8E93; cursor: pointer; user-select: none; }
.tb-item img { width: 26px; height: 26px; margin-bottom: 1px; }
.tb-item .on-i { display: none; }
.tb-item.on { color: #FF6B1A; }
.tb-item.on .on-i { display: block; } .tb-item.on .off-i { display: none; }
#toast { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%) scale(.96); background: rgba(28,28,30,.86); color: #fff; padding: 12px 20px; border-radius: 14px; font-size: 15px; opacity: 0; pointer-events: none; transition: all .2s; z-index: 300; max-width: 78%; text-align: center; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
#toast.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.app .mask { position: absolute; }
.app #body .mask { bottom: calc(54px + env(safe-area-inset-bottom)); }
#rest .mask { z-index: 200; bottom: 0; }
.bk-nag { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; padding: 12px 12px 12px 14px; border-radius: 14px; background: rgba(255,159,10,0.10); }
.bk-t { font-size: 14px; font-weight: 600; color: #C77700; }
.bk-s { font-size: 12.5px; color: var(--label2); margin-top: 2px; line-height: 1.45; }
.bk-go { flex-shrink: 0; font-size: 13px; font-weight: 600; color: #fff; background: #FF9F0A; border-radius: 999px; padding: 6px 14px; }
.bk-x { flex-shrink: 0; font-size: 18px; color: var(--label3, #AEAEB2); padding: 0 4px; line-height: 1; }
.sync-in { text-align: right; min-width: 0; flex: 1; font-size: 15px; }
.sync-l { white-space: nowrap; flex-shrink: 0; margin-right: 12px; }
.sync-err { font-size: 13px; color: var(--red); line-height: 1.45; }

input, textarea, select, button { font: inherit; color: inherit; outline: none; }
input, textarea { border: none; background: transparent; -webkit-appearance: none; appearance: none; }
.app input::placeholder, .app textarea::placeholder { color: #C7C7CC; }
.app input { caret-color: #FF6B1A; }
.app button.btn-primary { width: 100%; cursor: pointer; }
.app [data-act], .app .tb-item, .app label { cursor: pointer; }
.app .cv, .app .cv-sq { display: block; }
.app textarea.note { resize: none; display: block; font-family: inherit; }
.app textarea.imp { resize: vertical; display: block; }
.date-pick, .ex-pick, .base-pick, .pick-cell { position: relative; }
.date-pick input, .ex-pick select, .base-pick select, .pick-cell select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.lib-back { color: #FF6B1A; font-size: 17px; padding: 2px 0 12px; display: inline-block; }
.app .lib-list { overflow-y: auto; -webkit-overflow-scrolling: touch; }
.cyc-nav { display: flex; align-items: center; gap: 4px; }
.cyc-btn { width: 24px; height: 24px; border-radius: 50%; background: #EFEFF4; color: #FF6B1A; font-size: 17px; font-weight: 700; display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; }
.cyc-btn.off { color: #C7C7CC; opacity: .5; cursor: default; }
.cyc-label { font-size: 15px; }
.total-cap { display: block; margin-top: 7px; }
.ios-sw { position: relative; display: inline-block; width: 51px; height: 31px; flex-shrink: 0; }
.ios-sw input { display: none; }
.ios-sw i { position: absolute; inset: 0; background: #E9E9EA; border-radius: 16px; transition: background .2s; }
.ios-sw i::after { content: ''; position: absolute; left: 2px; top: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0,0,0,.15), 0 1px 1px rgba(0,0,0,.16); transition: left .2s; }
.ios-sw input:checked + i { background: #FF6B1A; }
.ios-sw.green input:checked + i { background: #34C759; }
.ios-sw input:checked + i::after { left: 22px; }
@media (max-width: 760px) {
  html, body { background: #F2F2F7; height: 100%; overflow: hidden; }
  body { display: block; }
  .side, .status, .capsule { display: none; }
  .phone { width: 100%; height: 100%; height: 100dvh; border-radius: 0; padding: 0; box-shadow: none; background: none; }
  .app { border-radius: 0; }
  .nav { padding-top: env(safe-area-inset-top); height: calc(44px + env(safe-area-inset-top)); }
  .phone .tabbar { padding-bottom: calc(6px + env(safe-area-inset-bottom)); }
  .app .f-in.sm, .app .note, .app .imp { font-size: 16px; }
}
"""

tabs = [('train', 'train', '训练'), ('plan', 'plan', '计划'), ('stats', 'stats', '数据'), ('review', 'review', '回顾'), ('settings', 'me', '设置')]
tabbar = ''.join(
    f'<div class="tb-item" data-tab="{tid}"><img class="off-i" src="{icons[ic]}" alt=""><img class="on-i" src="{icons[ic + "-on"]}" alt="">{txt}</div>'
    for tid, ic, txt in tabs)

side = """
<div class="side">
  <h1>GZCLP <span>训练追踪</span></h1>
  <div>8 周 · A1 → B1 → A2 → B2 循环</div>
  <ul>
    <li><b>训练</b>：只填末组次数或是否完成，下次重量自动算出</li>
    <li><b>计划</b>：下一次训练、8 周矩阵、当前状态</li>
    <li><b>数据</b>：e1RM 回归、重量走势、容量、判定分布</li>
    <li><b>回顾</b>：训练小结、周报、日志（可改可删，自动重算）</li>
    <li><b>设置</b>：1RM、步幅、规则、动作替换、备份</li>
  </ul>
  <div>手机打开此链接 → 分享 → <b>添加到主屏幕</b>，即可全屏使用。</div>
  <div style="margin-top:14px">
  <span class="tag">参数设置 → 设置</span><span class="tag">A1/B1/A2/B2 → 训练</span><span class="tag">状态总览 → 计划</span><span class="tag">图表 → 数据</span><span class="tag">规则备查 → 回顾</span>
  </div>
</div>
"""

head = """<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F2F2F7">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="GZCLP">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" href="icon-180.png">
<link rel="manifest" href="manifest.webmanifest">
<title>GZCLP 训练追踪</title>"""

html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head>{head}
<style>{shell_css}
{chr(10).join(css)}</style></head>
<body>
{side}
<div class="phone"><div class="app">
  <div class="status"><span>9:41</span><span>􀙇 􀛨</span></div>
  <div class="nav"><span id="navTitle">训练</span><div class="capsule">•••<i></i>◎</div></div>
  <div id="body"></div>
  <div class="tabbar" id="tabbar">{tabbar}</div>
  <div id="rest"></div>
  <div id="toast"></div>
</div></div>
<script>{(ROOT / 'utils' / 'engine.js').read_text()}</script>
<script>{(ROOT / 'utils' / 'chart.js').read_text()}</script>
<script>{(ROOT / 'preview' / 'app-h5.js').read_text()}</script>
</body></html>"""
html = html.replace('<span>􀙇 􀛨</span>', '<span>●●● ▮</span>')

(ROOT / 'preview' / 'index.html').write_text(html)
if not WEB.exists():
    WEB.mkdir()
(WEB / 'index.html').write_text(html)
manifest = {
    'name': 'GZCLP 训练追踪', 'short_name': 'GZCLP', 'start_url': './', 'scope': './', 'display': 'standalone',
    'background_color': '#F2F2F7', 'theme_color': '#F2F2F7', 'lang': 'zh-CN',
    'icons': [{'src': 'icon-180.png', 'sizes': '180x180', 'type': 'image/png'}, {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'}]
}
(WEB / 'manifest.webmanifest').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
for sz in (180, 512):
    shutil.copy(ROOT / 'preview' / f'icon-{sz}.png', WEB / f'icon-{sz}.png')
print('built', len(html) // 1024, 'KB ->', WEB)
