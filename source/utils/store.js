// 本地存储（wx.setStorageSync），数据结构见 engine.defaults()
const GZ = require('./engine.js');
const KEY = 'training_db_v1';
const KEY_OLD = 'gzclp_db_v1';

function load() {
  let db = null;
  try { db = wx.getStorageSync(KEY); } catch (e) { db = null; }
  if (!db) {
    try { db = wx.getStorageSync(KEY_OLD); } catch (e) { db = null; }
    if (db) save(db);
  }
  if (!db) { db = GZ.defaults(true); save(db); }
  return GZ.normalize(db);
}
function save(db) { wx.setStorageSync(KEY, db); }
function reset(withSeed) { const db = GZ.defaults(withSeed); save(db); return db; }

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

module.exports = { load, save, reset, KEY, lastBackup, markBackup };
