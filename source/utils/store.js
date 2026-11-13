// 本地存储（wx.setStorageSync），数据结构见 engine.defaults()
const GZ = require('./engine.js');
const KEY = 'training_db_v1';
const KEY_OLD = 'gzclp_db_v1';
const OPEN_KEY = 'training_open_v1';
// 读存储抛错时不要把内存里的空档案写回去，否则一次失败的读取会清掉已有训练记录
let readFailed = false;

function load() {
  let db = null;
  readFailed = false;
  try { db = wx.getStorageSync(KEY); } catch (e) { readFailed = true; db = null; }
  if (!db && !readFailed) {
    try { db = wx.getStorageSync(KEY_OLD); } catch (e) { db = null; }
    if (db) save(db);
  }
  if (!db) {
    // 读失败时只用空档案撑住界面，不写入、也不灌入 Excel 样例，避免盖掉还在磁盘上的数据
    db = GZ.defaults(!readFailed);
    if (!readFailed) save(db);
  }
  var prevDays = db.daysVersion;
  db = GZ.normalize(db);
  if (!readFailed && prevDays !== db.daysVersion) save(db);
  return db;
}
function save(db) {
  if (readFailed) return false;
  try { wx.setStorageSync(KEY, db); return true; }
  catch (e) { return false; }
}
function reset(withSeed) { const db = GZ.defaults(withSeed); readFailed = false; save(db); return db; }

/** 还没点「完成训练」的填写。和训练记录分开存，不参与进阶回放 */
function loadOpen() {
  try { return wx.getStorageSync(OPEN_KEY) || null; } catch (e) { return null; }
}
function saveOpen(snap) {
  try {
    if (!snap || !GZ.sessionTouched(snap)) wx.removeStorageSync(OPEN_KEY);
    else wx.setStorageSync(OPEN_KEY, snap);
    return true;
  } catch (e) { return false; }
}

const BK = 'training_last_backup';
const BK_OLD = 'gzclp_last_backup';
function lastBackup() {
  try {
    var v = wx.getStorageSync(BK);
    if (v) return v;
    return wx.getStorageSync(BK_OLD) || 0;
  } catch (e) { return 0; }
}
function markBackup() { wx.setStorageSync(BK, Date.now()); }

module.exports = { load, save, reset, KEY, lastBackup, markBackup, loadOpen, saveOpen, OPEN_KEY };
