#!/usr/bin/env python3
"""Pull COROS strength workouts and sleep, then write training-watch.json.

The file lives in the private data repo (default seven-pro-7/seven-training-data).
The web app only reads it. This script never writes training-data.json.

Required environment:
  COROS_ACCESS_TOKEN   COROS MCP access token
  DATA_GITHUB_TOKEN    token that can write the private data repo
Optional:
  DATA_OWNER           default seven-pro-7
  DATA_REPO            default seven-training-data
  COROS_MCP_URL        不填则先试国内 mcpcn，再试国际 mcp.coros.com
"""
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# 账号在国内登录时，令牌只对 mcpcn 有效。没指定地址就先国内、再国际。
MCP_URLS = [os.environ['COROS_MCP_URL'].strip()] if os.environ.get('COROS_MCP_URL', '').strip() else [
    'https://mcpcn.coros.com/mcp',
    'https://mcp.coros.com/mcp',
]
WATCH_FILE = 'training-watch.json'
LEGACY_FILE = 'gzclp-watch.json'
STRENGTH = 402
SHANGHAI = timezone(timedelta(hours=8))


def today_local():
    """日历日用北京时间。定时任务在 UTC 23:30 触发，这时 UTC 的「今天」还是前一天。"""
    return datetime.now(SHANGHAI).date()


def request(url, method, headers, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read()


def header_get(headers, name):
    name = name.lower()
    for key, value in (headers or {}).items():
        if str(key).lower() == name:
            return value
    return ''


def mcp_call(token, name, arguments):
    errors = []
    for url in MCP_URLS:
        try:
            return mcp_call_url(url, token, name, arguments)
        except SystemExit as exc:
            message = str(exc)
            errors.append(message)
            if '401' not in message and '令牌' not in message:
                raise
    raise SystemExit(errors[-1] if errors else 'COROS 调用失败')


def mcp_call_url(url, token, name, arguments):
    headers = {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
    }
    init = {
        'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
        'params': {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'training-watch-sync', 'version': '1'}},
    }
    status, hdrs, raw = request(url, 'POST', headers, init)
    if status == 401:
        raise SystemExit('COROS 令牌无效或已过期，请更新仓库 Secret COROS_ACCESS_TOKEN')
    if status >= 400:
        raise SystemExit('COROS MCP 初始化失败 HTTP %s' % status)
    session = header_get(hdrs, 'mcp-session-id')
    if session:
        headers['Mcp-Session-Id'] = session
    request(url, 'POST', headers, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})
    call = {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}}
    status, hdrs, raw = request(url, 'POST', headers, call)
    if status == 401:
        raise SystemExit('COROS 令牌无效或已过期，请更新仓库 Secret COROS_ACCESS_TOKEN')
    if status >= 400:
        raise SystemExit('COROS %s 失败 HTTP %s' % (name, status))
    text = decode_mcp(raw)
    if not text:
        raise SystemExit('COROS %s 没有返回内容' % name)
    return text


def decode_mcp(raw):
    blob = raw.decode('utf-8', 'replace')
    payloads = []
    if blob.lstrip().startswith('{'):
        payloads.append(blob)
    for line in blob.splitlines():
        if line.startswith('data:'):
            payloads.append(line[5:].strip())
    texts = []
    for item in payloads:
        if not item or item == '[DONE]':
            continue
        try:
            msg = json.loads(item)
        except ValueError:
            continue
        result = msg.get('result') or {}
        if result.get('isError'):
            raise SystemExit('COROS 返回错误：%s' % text_of(result)[:240])
        found = text_of(result)
        if found:
            texts.append(found)
    return '\n'.join(texts)


def text_of(result):
    if isinstance(result, str):
        return result
    content = result.get('content') if isinstance(result, dict) else None
    if not isinstance(content, list):
        return ''
    out = []
    for part in content:
        if isinstance(part, dict) and part.get('type') == 'text':
            out.append(part.get('text') or '')
    return '\n'.join(out)


def ymd(d):
    return d.strftime('%Y%m%d')


def unescape_text(text):
    """COROS 有时把换行当成两个字符的 \\n 返回。不展开的话，整段会被当成一条，日期还会误用查询范围的起始日。"""
    text = text or ''
    if text.count('\n') < 2 and '\\n' in text:
        text = text.replace('\\r\\n', '\n').replace('\\n', '\n').replace('\\t', '\t')
    return text.replace('\r\n', '\n')


def shanghai_day(ts):
    return datetime.fromtimestamp(int(ts), SHANGHAI).date().isoformat()


def chunks(days=180, size=30):
    end = today_local()
    start = end - timedelta(days=days - 1)
    cur = start
    while cur <= end:
        stop = min(end, cur + timedelta(days=size - 1))
        yield ymd(cur), ymd(stop)
        cur = stop + timedelta(days=1)


def minutes_of(part):
    match = re.search(r'Duration:\s*(\d+):(\d+)(?::(\d+))?', part)
    if not match:
        return None
    a, b, c = match.group(1), match.group(2), match.group(3)
    if c is None:
        total = int(a) * 60 + int(b)
    else:
        total = int(a) * 3600 + int(b) * 60 + int(c)
    return max(1, int(round(total / 60.0)))


def parse_sports(text):
    workouts = []
    text = unescape_text(text)
    for part in re.split(r'\n(?=\d+\.\s)', text):
        title = ''
        for line in part.splitlines():
            if re.match(r'\d+\.\s', line):
                title = line
                break
        # 日期只认「1. Strength — 2026-10-20」这种标题，不认「查询范围 — 起始日 to 结束日」
        date_m = re.search(r'—\s*(\d{4}-\d{2}-\d{2})', title)
        start_m = re.search(r'startTimestamp=(\d+)', part)
        sets_m = re.search(r'Sets:\s*(\d+)', part)
        if not (date_m and start_m and sets_m):
            continue
        hr_m = re.search(r'Avg HR:\s*(\d+)', part)
        kcal_m = re.search(r'Calories:\s*(\d+)', part)
        minutes = minutes_of(part)
        if minutes is None:
            continue
        start = int(start_m.group(1))
        day = date_m.group(1)
        if shanghai_day(start) != day:
            continue
        workouts.append({
            'date': day,
            'start': start,
            'min': minutes,
            'sets': int(sets_m.group(1)),
            'avgHr': int(hr_m.group(1)) if hr_m else 0,
            'kcal': int(kcal_m.group(1)) if kcal_m else 0,
        })
    return workouts


def parse_sleep(text):
    sleep = {}
    text = unescape_text(text)
    for block in re.split(r'\n(?=\d{4}-\d{2}-\d{2}\n)', '\n' + text):
        date_m = re.search(r'(\d{4}-\d{2}-\d{2})', block)
        score_m = re.search(r'Sleep Score:\s*(\d+)', block)
        dur_m = re.search(r'Daily Sleep:\s*(?:(\d+)h\s*)?(\d+)\s*min', block)
        if not (date_m and score_m):
            continue
        hours = int(dur_m.group(1) or 0) if dur_m else 0
        mins = int(dur_m.group(2)) if dur_m else 0
        sleep[date_m.group(1)] = {'score': int(score_m.group(1)), 'min': hours * 60 + mins}
    return sleep


def merge(old, incoming_workouts, incoming_sleep):
    base = old if isinstance(old, dict) else {}
    seen = {}
    workouts = []
    for item in (base.get('workouts') or []) + incoming_workouts:
        if not isinstance(item, dict):
            continue
        try:
            if shanghai_day(item.get('start')) != item.get('date'):
                continue
        except (TypeError, ValueError, OSError):
            continue
        key = '%s|%s' % (item.get('date'), item.get('start'))
        if key in seen:
            continue
        seen[key] = 1
        workouts.append(item)
    workouts.sort(key=lambda w: w.get('start') or 0)
    sleep = dict(base.get('sleep') or {})
    sleep.update(incoming_sleep)
    return workouts, sleep


def github_api(token, owner, repo, path, method, body=None):
    url = 'https://api.github.com/repos/%s/%s/contents/%s' % (owner, repo, path)
    headers = {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'training-watch-sync',
    }
    status, _headers, raw = request(url, method, headers, body)
    try:
        parsed = json.loads(raw.decode() or 'null')
    except ValueError:
        parsed = None
    return status, parsed


def load_cloud(token, owner, repo):
    for path in (WATCH_FILE, LEGACY_FILE):
        status, payload = github_api(token, owner, repo, path, 'GET')
        if status == 200 and payload and payload.get('content'):
            try:
                data = json.loads(base64.b64decode(payload['content']).decode())
            except ValueError:
                data = {}
            sha = payload.get('sha') if path == WATCH_FILE else None
            return data, sha
        if status not in (200, 404):
            raise SystemExit('读取私有仓库 %s 失败 HTTP %s' % (path, status))
    return {}, None


def save_cloud(token, owner, repo, snapshot, sha):
    body = {
        'message': '同步手表数据 · %s' % today_local().isoformat(),
        'content': base64.b64encode(json.dumps(snapshot, ensure_ascii=False, indent=2).encode()).decode(),
    }
    if sha:
        body['sha'] = sha
    status, payload = github_api(token, owner, repo, WATCH_FILE, 'PUT', body)
    if status not in (200, 201):
        message = payload.get('message') if isinstance(payload, dict) else ''
        raise SystemExit('写入 %s 失败 HTTP %s %s' % (WATCH_FILE, status, message))


def same(left, right):
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def self_test():
    sport = """
1. Strength — 2026-10-20
   Time Window: startTimestamp=1792470652 | endTimestamp=1792473425
   Duration: 46:13 | Sets: 14
 | Avg HR: 106 bpm | Calories: 169 kcal
2. Strength — 2026-10-16
   Duration: 1:01:04 | Sets: 17
   Time Window: startTimestamp=1792125000 | endTimestamp=1792128664
 | Avg HR: 98 bpm | Calories: 261 kcal
"""
    sleep = """
2026-10-16
Sleep Score: 85
Daily Sleep: 6h 49min (incl. naps)
"""
    workouts = parse_sports(sport)
    nights = parse_sleep(sleep)
    assert len(workouts) == 2, workouts
    assert workouts[0]['min'] == 46 and workouts[0]['sets'] == 14 and workouts[0]['kcal'] == 169
    assert workouts[1]['min'] == 61
    assert nights['2026-10-16'] == {'score': 85, 'min': 6 * 60 + 49}
    collapsed = sport.replace('\n', '\\n')
    collapsed = 'Sport Records — 2026-10-01 to 2026-10-22 (2 records)\n========================\n\n' + collapsed
    collapsed = collapsed.replace('\n', '\\n')
    repaired = parse_sports(collapsed)
    assert [w['date'] for w in repaired] == ['2026-10-20', '2026-10-16'], repaired
    bogus = {'date': '2026-10-01', 'start': 1792470652, 'min': 46, 'sets': 14, 'avgHr': 106, 'kcal': 169}
    merged_w, merged_s = merge({'workouts': [workouts[0], bogus], 'sleep': {'2026-10-15': {'score': 80, 'min': 400}}}, workouts, nights)
    assert all(w['date'] != '2026-10-01' for w in merged_w)
    assert len(merged_w) == 2
    assert merged_s['2026-10-15']['score'] == 80
    print('self-test ok')


def main():
    if '--self-test' in sys.argv:
        self_test()
        return
    coros = os.environ.get('COROS_ACCESS_TOKEN', '').strip()
    github = os.environ.get('DATA_GITHUB_TOKEN', '').strip()
    owner = os.environ.get('DATA_OWNER', '').strip() or 'seven-pro-7'
    repo = os.environ.get('DATA_REPO', '').strip() or 'seven-training-data'
    if not coros or not github:
        raise SystemExit('缺少 COROS_ACCESS_TOKEN 或 DATA_GITHUB_TOKEN')
    workouts, sleep = [], {}
    for start, end in chunks():
        sport_text = mcp_call(coros, 'querySportRecords', {
            'startDate': start, 'endDate': end, 'sportTypeCodes': [STRENGTH], 'limit': 100,
        })
        sleep_text = mcp_call(coros, 'querySleepOverview', {'startDate': start, 'endDate': end})
        workouts.extend(parse_sports(sport_text))
        sleep.update(parse_sleep(sleep_text))
    old, sha = load_cloud(github, owner, repo)
    merged_w, merged_s = merge(old, workouts, sleep)
    if not merged_w and not merged_s:
        print('没有可写入的力量训练或睡眠')
        return
    if same(old.get('workouts') or [], merged_w) and same(old.get('sleep') or {}, merged_s):
        print('手表数据已是最新，%s 次训练，%s 晚睡眠' % (len(merged_w), len(merged_s)))
        return
    snapshot = {
        'schema': 'training-watch-v1',
        'source': 'COROS',
        'generatedAt': datetime.now(SHANGHAI).isoformat(timespec='seconds'),
        'workouts': merged_w,
        'sleep': merged_s,
    }
    save_cloud(github, owner, repo, snapshot, sha)
    print('已写入 %s/%s %s：%s 次训练，%s 晚睡眠' % (owner, repo, WATCH_FILE, len(merged_w), len(merged_s)))


if __name__ == '__main__':
    main()
