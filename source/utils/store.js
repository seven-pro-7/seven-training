// 本地存储（wx.setStorageSync），数据结构见 engine.defaults()
const GZ = require('./engine.js');
const KEY = 'gzclp_db_v1';

function load() {
  let db = null;
  try { db = wx.getStorageSync(KEY); } catch (e) { db = null; }
  if (!db) { db = GZ.defaults(true); save(db); }
  return GZ.normalize(db);
}
function save(db) { wx.setStorageSync(KEY, db); }
function reset(withSeed) { const db = GZ.defaults(withSeed); save(db); return db; }

const BK = 'gzclp_last_backup';
function lastBackup() { try { return wx.getStorageSync(BK) || 0; } catch (e) { return 0; } }
function markBackup() { wx.setStorageSync(BK, Date.now()); }

module.exports = { load, save, reset, KEY, lastBackup, markBackup };
