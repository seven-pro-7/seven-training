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
.app .pg-train .ex-act { color: var(--label2); font-weight: 400; }
.app .pg-train .w-edit { color: var(--label2); background: var(--fill); font-weight: 500; }
.app .pg-train .st-btn { color: var(--label); }
.app .pg-train .dot.amrap { box-shadow: inset 0 0 0 1.5px var(--label3); color: var(--label2); background: transparent; width: auto; min-width: 30px; padding: 0 9px; border-radius: 15px; }
.app .pg-train .dot.amrap.on { background: var(--accent); color: #fff; box-shadow: none; }
.app .pg-train .st-val::placeholder { color: var(--label3); }
.app .pg-train .ex-row { display: flex; align-items: center; gap: 10px; padding: 14px 16px; margin-bottom: 8px; min-height: 52px; }
.app .pg-train .ex-row.is-fin .exr-n { color: var(--label2); }
.app .pg-train .ex-row.skipped { opacity: 0.55; }
.app .pg-train .exr-n { font-size: 15px; font-weight: 500; color: var(--label); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.app .pg-train .exr-right { display: flex; align-items: baseline; gap: 8px; flex-shrink: 0; }
.app .pg-train .exr-w { font-size: 15px; font-weight: 600; color: var(--label); }
.app .pg-train .exr-u { font-size: 12px; font-weight: 400; color: var(--label2); }
.app .pg-train .exr-r { font-size: 13px; color: var(--label2); }
.app .pg-train .exr-st { font-size: 13px; font-weight: 600; }
.app .pg-train .exr-nx { font-size: 13px; color: var(--label2); }
.app .pg-train .exr-chev { color: var(--label3); font-size: 18px; margin-left: 2px; }
.app .pg-train .ex.is-focus { margin-bottom: 8px; }
.app .pg-train .ex-next { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 14px; padding: 12px 0 2px; border-top: 0.5px solid var(--sep); font-size: 15px; font-weight: 500; color: var(--label); }
.app .pg-train .submit-bar { position: sticky; bottom: 0; z-index: 4; display: flex; align-items: center; gap: 14px; margin: 16px -16px -32px; padding: 10px 16px 12px; background: rgba(242,242,247,0.94); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); border-top: 0.5px solid rgba(0,0,0,0.08); }
.app .pg-train .sb-count { font-size: 14px; color: var(--label2); white-space: nowrap; }
.app .pg-train .sb-count b { color: var(--label); font-size: 17px; font-weight: 600; }
.app .pg-train button.sb-btn { flex: 1; margin: 0; height: 48px; }
.app .pg-train .t3-group { padding: 4px 0; margin-bottom: 8px; }
.app .pg-train .ex-row.g { margin: 0; border-radius: 0; background: transparent; padding: 12px 16px; min-height: 48px; }
.app .pg-train .ex-row.g + .ex-row.g { border-top: 0.5px solid var(--sep); }
.app .pg-train .ex-row.g .exr-n { font-size: 15px; font-weight: 400; }
.app .pg-stats .empty-chart { margin: 12px 0 4px; padding: 22px 16px; border-radius: 14px; background: var(--fill2); text-align: center; }
.app .pg-stats .ec-dots { display: flex; justify-content: center; gap: 6px; margin-bottom: 10px; }
.app .pg-stats .ec-dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--label3); }
.app .pg-stats .ec-dots i.on { background: var(--accent); }
.app .pg-stats .ec-t { font-size: 15px; font-weight: 600; color: var(--label); }
.app .pg-stats .ec-s { font-size: 13px; color: var(--label2); margin-top: 4px; line-height: 1.5; }
.app .pg-stats .kv-na { display: block; font-size: 22px; font-weight: 600; color: var(--label3); line-height: 1.3; }
.app .pg-review .lt-head, .app .pg-review .lt-row { display: flex; align-items: center; gap: 8px; }
.app .pg-review .lt-head { font-size: 11px; color: var(--label2); padding: 2px 0 8px; border-bottom: 0.5px solid var(--sep); }
.app .pg-review .lt-row { padding: 12px 0; }
.app .pg-review .lt-row + .lt-row { border-top: 0.5px solid var(--sep); }
.app .pg-review .lt-c1 { flex: 1.5; min-width: 0; display: flex; flex-direction: column; }
.app .pg-review .lt-c2, .app .pg-review .lt-c3, .app .pg-review .lt-c4 { flex: 1; display: flex; flex-direction: column; align-items: flex-end; text-align: right; }
.app .pg-review .lt-n { font-size: 15px; font-weight: 600; color: var(--label); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.app .pg-review .lt-s { font-size: 11px; color: var(--label2); margin-top: 2px; white-space: nowrap; }
.app .pg-review .lt-v { font-size: 17px; font-weight: 600; color: var(--label); }
.app .pg-review .lt-j { font-size: 11px; font-weight: 600; margin-top: 2px; }
.app .pg-review .lt-g { font-size: 17px; font-weight: 600; color: var(--label2); }
.app .pg-review .lt-g.up { color: var(--accent); }
.app .pg-settings .adv-head { margin-top: 20px; }
.app .pg-settings .slot-rec { color: var(--label2); }
.app .pg-settings .adv-head .val { font-size: 13px; color: var(--label2); margin-right: 6px; }
/* 计划页动作面板 */
.app .pg-plan .rot-row.tap { cursor: pointer; }
.app .pg-plan .rot-row.tap:active { background: var(--fill); }
.app .pg-plan .rot-cw { display: inline-block; margin-right: 8px; font-weight: 600; color: var(--label); font-size: 13px; }
.app .pg-plan .rot-chev { color: var(--label3); font-size: 18px; margin-left: 6px; align-self: center; }
.app .slot-sheet .slot-head { display: flex; align-items: center; gap: 8px; padding: 4px 0 14px; }
.app .slot-sheet .slot-name { font-size: 22px; font-weight: 700; letter-spacing: -0.4px; color: var(--label); }
.app .slot-sheet .slot-now { display: flex; align-items: flex-end; gap: 14px; padding: 4px 2px 16px; }
.app .slot-sheet .slot-wv { font-size: 34px; font-weight: 700; letter-spacing: -1px; line-height: 1; }
.app .slot-sheet .slot-wu { font-size: 13px; color: var(--label2); margin-left: 4px; }
.app .slot-sheet .slot-meta { display: flex; flex-direction: column; gap: 2px; padding-bottom: 3px; }
.app .slot-sheet .slot-reps { font-size: 15px; font-weight: 600; color: var(--label); }
.app .slot-sheet .slot-when { font-size: 13px; color: var(--label2); }
.app .slot-sheet .slot-adj { display: flex; align-items: center; gap: 12px; }
.app .slot-sheet .slot-adj .stepper { display: flex; flex-direction: row; align-items: center; background: var(--fill); border-radius: 999px; overflow: hidden; }
.app .slot-sheet .slot-adj .stepper .st-btn { display: flex; align-items: center; justify-content: center; width: 44px; height: 40px; flex-shrink: 0; font-size: 22px; font-weight: 500; color: var(--label); cursor: pointer; user-select: none; }
.app .slot-sheet .slot-adj .stepper .st-btn:active { background: rgba(0,0,0,0.06); }
.app .slot-sheet .slot-adj .stepper .st-val { width: 72px; height: 40px; text-align: center; font-size: 20px; font-weight: 600; background: transparent; border: 0; outline: 0; color: var(--label); padding: 0; }
.app .slot-sheet .slot-ok { margin-top: 16px; }
.app .slot-sheet .lib-row .lib-s { font-size: 13px; color: var(--label2); font-weight: 400; }
.app .slot-sheet .lib-row .lib-n { font-size: 17px; font-weight: 600; }
.app .slot-sheet .lib-row .lib-rec { font-size: 11px; }
.app .slot-sheet .lib-row .lib-s { font-size: 13px; color: var(--label2); font-weight: 400; }
.app .slot-sheet .lib-row .lib-n { font-size: 17px; font-weight: 600; }
.app .slot-sheet .lib-row .lib-rec { font-size: 11px; }
.rest-float { position: absolute; right: 14px; z-index: 210; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.rest-cap { display: flex; align-items: center; gap: 8px; padding: 8px 14px 8px 8px; border-radius: 999px; background: #1C1C1E; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,0.18); cursor: pointer; user-select: none; }
.rc-ring { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.rc-ring i { width: 20px; height: 20px; border-radius: 50%; background: #1C1C1E; }
.rc-t { font-size: 17px; font-weight: 600; letter-spacing: -0.3px; }
.rc-l { font-size: 12px; color: rgba(255,255,255,0.6); }
.rest-pop { background: #fff; border-radius: 16px; padding: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.16); width: 248px; }
.rp-n { font-size: 13px; color: #8E8E93; margin-bottom: 10px; }
.rp-btns { display: flex; gap: 8px; }
.rp-b { flex: 1; text-align: center; font-size: 13px; font-weight: 500; padding: 9px 0; border-radius: 10px; background: rgba(118,118,128,0.12); color: #1C1C1E; cursor: pointer; }
.rp-b.main { background: #FF6B1A; color: #fff; }


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

def type_scale(css_text):
    """统一字号阶梯：11 / 13 / 15 / 17 / 22 / 28 px；> 30px 的展示型数字（重量、倒计时）不动"""
    def fix(m):
        v = float(m.group(1))
        if v > 40:
            return m.group(0)
        if v > 30:
            return "font-size: 34px"
        n = 11 if v < 12 else 13 if v < 14 else 15 if v < 16 else 17 if v < 19 else 22 if v < 25 else 28
        return f"font-size: {n}px"
    return re.sub(r'font-size:\s*(\d*\.?\d+)px', fix, css_text)


shell_css = type_scale(shell_css)
GLASS_CSS = r'''
/* ===== Liquid Glass（iOS 26/27 设计语言）=====
 * 1 层级：导航与标签栏是浮在内容之上的玻璃层，内容铺满并从下方滚过
 * 2 和谐：胶囊形控件、同心圆角、更高的控件、更大更粗的左对齐标题
 * 3 一致：同一套玻璃材质用于标签栏、弹层、完成栏；适配降低透明度 / 增强对比度 / 减弱动态效果
 */
.app { --navh: 44px; --tabh: 62px; --tabgap: 12px; --tabbottom: calc(var(--tabgap) + env(safe-area-inset-bottom));
  --glass: rgba(250,250,252,0.78); --glass-edge: inset 0 1px 1px rgba(255,255,255,0.95), inset 0 -1px 1px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.09);
  --glass-blur: blur(28px) saturate(190%); }
@media (min-width: 761px) { .app { --tabbottom: 22px; } }
@media (max-width: 760px) { .app { --navh: calc(44px + env(safe-area-inset-top)); } }

/* 导航栏：透明，内容从下面滚过；滚动后出现「滚动边缘效果」与小标题 */
.app .nav { height: var(--navh); margin-bottom: calc(-1 * var(--navh)); background: transparent; z-index: 20; pointer-events: none; }
.app .nav .capsule { pointer-events: auto; }
.app .nav::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: calc(100% + 22px); z-index: -1; pointer-events: none;
  background: linear-gradient(to bottom, rgba(242,242,247,0.96) 0%, rgba(242,242,247,0.82) 62%, rgba(242,242,247,0) 100%);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  -webkit-mask-image: linear-gradient(to bottom, #000 58%, transparent); mask-image: linear-gradient(to bottom, #000 58%, transparent);
  opacity: 0; transition: opacity .25s ease; }
.app .nav.edge::before { opacity: 1; }
.app #navTitle { opacity: 0; transform: translateY(4px); transition: opacity .2s ease, transform .2s ease; }
.app .nav.titled #navTitle { opacity: 1; transform: none; }
.app #body { padding-top: var(--navh); padding-bottom: 0; }
.app #body > div > .page::after { content: ''; display: block; height: calc(var(--tabh) + var(--tabbottom) + 16px); }

/* 大号、加粗、左对齐的页面标题 */
.app .pg-title { font-size: 34px; font-weight: 700; letter-spacing: -0.6px; line-height: 1.15; margin: 6px 4px 16px; color: var(--label); }
.app .large-title { font-weight: 700; letter-spacing: -0.6px; }
.app .head { padding-left: 4px; }

/* 浮动玻璃标签栏 */
.app .tabbar { position: absolute; left: 16px; right: 16px; bottom: var(--tabbottom); height: var(--tabh); padding: 0 6px; z-index: 50;
  align-items: center; border-top: none; border-radius: 999px; background: var(--glass);
  -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-edge), 0 10px 30px rgba(0,0,0,0.12); }
.phone .tabbar, .app .tabbar { padding-bottom: 0; }
.app .tb-item { height: calc(var(--tabh) - 12px); border-radius: 999px; transition: background .25s ease, transform .15s ease; }
.app .tb-item.on { background: rgba(118,118,128,0.14); }
.app .tb-item:active { transform: scale(0.92); }

/* 卡片与分组列表：更柔和的同心圆角、更高的行 */
.app .card { border-radius: 26px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
.app .list { border-radius: 26px; }
.app .cell { min-height: 52px; }
.app .sec-h { font-size: 17px; font-weight: 600; color: var(--label); padding: 26px 6px 10px; }
.app .sec-f { padding-left: 6px; padding-right: 6px; }
.app .card-title .t { font-weight: 700; }

/* 胶囊形控件 */
.app .seg, .app .tabs { border-radius: 999px; padding: 3px; }
.app .seg-i, .app .tabs .tab { border-radius: 999px; padding-top: 8px; padding-bottom: 8px; transition: background .2s ease, box-shadow .2s ease; }
.app .seg-i.on, .app .tabs .tab.on { box-shadow: 0 3px 8px rgba(0,0,0,0.10), 0 0 0 0.5px rgba(0,0,0,0.04), inset 0 1px 0 #fff; }
.app .btn-primary { border-radius: 999px; min-height: 52px; font-weight: 600; box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px rgba(255,107,26,0.26); transition: transform .15s ease, opacity .15s; }
.app .btn-primary:active, .app .btn-ghost:active, .app .go-btn:active { transform: scale(0.97); }
.app .btn-ghost { border-radius: 999px; }
.app .pg-train .stepper { border-radius: 999px; }
.app .pg-train .verdict { border-radius: 16px; }
.app .pg-train .w-edit { border-radius: 999px; }

/* 按压反馈：轻微收缩，像在按一块玻璃 */
.app .ex-row, .app .cell.tap, .app .gcell { transition: transform .15s ease, background .15s ease; }
.app .ex-row:active, .app .cell.tap:active { transform: scale(0.985); }

/* 训练页完成栏：浮在标签栏上方的玻璃胶囊 */
.app .pg-train .submit-bar { bottom: calc(var(--tabh) + var(--tabbottom) + 10px); margin: 14px 0 0; padding: 0; gap: 10px;
  background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; border-top: none; }
.app .pg-train .sb-count { height: 52px; padding: 0 18px; display: flex; align-items: center; border-radius: 999px; background: var(--glass);
  -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); box-shadow: var(--glass-edge), 0 6px 18px rgba(0,0,0,0.08); }
.app .pg-train button.sb-btn { height: 52px; }

/* 弹层：浮起的玻璃面板，四角与屏幕圆角同心 */
.app #body .mask, .app .mask { bottom: 0; background: rgba(0,0,0,0.22); z-index: 100; }
.app .sheet { --bg: #F5F5F8; width: calc(100% - 16px); margin: 0 8px calc(8px + env(safe-area-inset-bottom)); border-radius: 34px;
  background: rgba(245,245,248,0.97); -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), 0 20px 60px rgba(0,0,0,0.18); max-height: calc(100% - 70px); }
.app .grabber { width: 36px; height: 5px; background: rgba(60,60,67,0.25); }
.app .sheet-title { font-weight: 700; }

/* 休息胶囊、提示：同一套玻璃语言 */
.app .rest-cap { background: rgba(28,28,30,0.82); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 8px 24px rgba(0,0,0,0.22); }
.app .rc-ring i { background: #2A2A2C; }
.app .rest-pop { border-radius: 24px; background: var(--glass); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); box-shadow: var(--glass-edge), 0 12px 32px rgba(0,0,0,0.16); }
.app .rp-b { border-radius: 999px; }
.app #toast { border-radius: 999px; padding: 12px 22px; }

.app .lib-rec { color: var(--label2); }
/* 辅助功能 */
@media (prefers-reduced-transparency: reduce) {
  .app .tabbar, .app .sheet, .app .pg-train .sb-count, .app .rest-pop { background: #FFFFFF; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .app .nav::before { background: #F2F2F7; -webkit-mask-image: none; mask-image: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .app .rest-cap { background: #1C1C1E; }
}
@media (prefers-contrast: more) {
  .app .tabbar, .app .sheet, .app .pg-train .sb-count { box-shadow: 0 0 0 1px rgba(0,0,0,0.45); }
  .app .card, .app .list { box-shadow: 0 0 0 1px rgba(0,0,0,0.18); }
}
@media (prefers-reduced-motion: reduce) {
  .app *, .app *::before { transition: none !important; }
}
'''
css.append(GLASS_CSS)
css.append("""
.app .profile-list .profile-in { border: 0; background: transparent; text-align: right; font-size: 16px; color: var(--label); width: 62%; min-width: 0; outline: none; }
.app .profile-avatar { width: 44px; height: 44px; border-radius: 50%; background: #E6EDDF; color: #354531; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-right: 10px; cursor: pointer; }
.app .profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.app .profile-avatar input { display: none; }
.app .share-entry { background: linear-gradient(125deg,#FFFFFF,#EEF2E8); }
.app .share-entry-title { font-size: 22px; font-weight: 700; color: var(--label); margin: 10px 0; letter-spacing: -.5px; }
.app .share-entry-meta { font-size: 13px; color: var(--label2); margin-bottom: 16px; }
.app .share-entry .btn-primary { width: 100%; font-size: 15px; height: 48px; }
.app .share-sheet { padding: 12px 16px 16px; }
.app .share-toolbar { display: flex; align-items: center; justify-content: space-between; }
.app .share-toolbar .sheet-title { margin: 6px 0 10px; }
.app .share-sheet button { border: 0; font-family: inherit; cursor: pointer; }
.app .share-close { width: 44px; height: 44px; border-radius: 50%; background: var(--fill); font-size: 22px; color: var(--label2); }
.app .share-options { display: flex; justify-content: space-between; align-items: center; margin: 8px 0; font-size: 13px; color: var(--label2); gap: 8px; }
.app .share-options select { border: 0; background: transparent; font: inherit; color: var(--label); max-width: 144px; }
.app .share-options button { color: var(--label2); font-size: 13px; background: transparent; padding: 8px 0; }
.app .share-pills { display: flex; gap: 6px; margin: 10px 0; }
.app .share-pills button { background: var(--fill); border-radius: 999px; color: var(--label2); padding: 10px 13px; font-size: 13px; min-height: 44px; }
.app .share-pills button.on { color: #304129; background: #DFE8D7; font-weight: 600; }
.app .share-art { border-radius: 20px; overflow: hidden; background: #F5F6F3; min-height: 200px; }
.app .share-art img { width: 100%; height: auto; display: block; -webkit-touch-callout: default; user-select: auto; }
.app .share-art span { display: block; padding: 80px 12px; color: var(--label2); text-align: center; }
.app .share-hint { font-size: 11px; line-height: 1.5; margin: 12px 4px; color: var(--label2); }
.app .share-actions { display: flex; gap: 7px; position: sticky; bottom: -16px; padding: 12px 0 16px; background: #F5F5F8; z-index: 2; }
.app .share-actions button { flex: 1; min-width: 0; height: 48px; border-radius: 999px; background: var(--fill); color: var(--label); font-size: 13px; font-weight: 600; }
.app .share-actions button.main { background: var(--accent); color: #FFF; }
.app .share-actions button:disabled { opacity: .45; }
""")

css = [type_scale(c) for c in css]

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
<script>{(ROOT / 'utils' / 'share.js').read_text()}</script>
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
