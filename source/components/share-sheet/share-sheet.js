const store = require('../../utils/store.js');
const Share = require('../../utils/share.js');
const Monthly = require('../../utils/monthly.js');
const Weekly = require('../../utils/weekly.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    kind: { type: String, value: 'day' },
    recordId: { type: String, value: '' },
    week: { type: Number, value: 0 },
    ym: { type: String, value: '' }
  },
  data: {
    title: '训练战报', theme: 'sage', body: false, hasName: true, showBadge: false, showWatch: false,
    periods: [], periodIndex: 0, periodLabel: '', artH: 460
  },
  observers: {
    'show, kind, recordId, week, ym': function (show) {
      if (!show) return;
      this._fun = 0; this._body = false; this._badgeVar = 0; this._badgePick = null;
      this._week = this.properties.week || null;
      this._ym = this.properties.ym || null;
      this._theme = 'sage';
      this.rebuild();
    }
  },
  methods: {
    noop() {},
    onClose() { this.triggerEvent('close'); },
    onProfile() {
      this.triggerEvent('close');
      wx.switchTab({ url: '/pages/settings/settings' });
    },
    onTheme(e) { this._theme = e.currentTarget.dataset.theme; this.rebuild(); },
    onFun() { this._fun = (this._fun || 0) + 1; this.rebuild(); },
    onBadge() { this._badgeVar = (this._badgeVar || 0) + 1; this._badgePick = null; this.rebuild(); },
    onBody() { this._body = !this._body; this.rebuild(); },
    onPeriod(e) {
      const i = Number(e.detail.value);
      const key = (this._keys || [])[i];
      if (this.properties.kind === 'week') this._week = key;
      else this._ym = key;
      this._fun = 0;
      this.rebuild();
    },
    opts() {
      return { funVariant: this._fun || 0, theme: this._theme || 'sage', body: !!this._body, badgePick: this._badgePick, badgeVariant: this._badgeVar || 0 };
    },
    rebuild() {
      if (!this.properties.show) return;
      const db = store.load();
      const kind = this.properties.kind || 'day';
      const sh = this.opts();
      let data = null;
      if (kind === 'week') data = Weekly.build(db, this._week, sh);
      else if (kind === 'month') data = Monthly.build(db, this._ym, sh);
      else data = Share.build(db, this.properties.recordId, sh);
      if (!data) { this.setData({ title: '还没有可分享的训练', periods: [] }); return; }
      const title = kind === 'week' ? '周度报告' : kind === 'month' ? '月度报告' : '训练战报';
      let periods = [], keys = [], periodIndex = 0, periodLabel = '';
      if (kind === 'week') {
        keys = data.weeks || [];
        const GZ = require('../../utils/engine.js');
        periods = keys.map((w) => GZ.weekText(w, db.params));
        periodIndex = Math.max(0, keys.indexOf(data.week));
        periodLabel = data.weekText;
        this._week = data.week;
      } else if (kind === 'month') {
        keys = data.months || [];
        periods = keys.map((m) => Monthly.ymText(m));
        periodIndex = Math.max(0, keys.indexOf(data.ym));
        periodLabel = Monthly.ymText(data.ym);
        this._ym = data.ym;
      }
      this._keys = keys;
      this._payload = data;
      this._kind = kind;
      this.setData({
        title, theme: sh.theme, body: !!sh.body, hasName: !!data.hasName,
        showBadge: kind === 'day' && !!(data.badgeCands && data.badgeCands.length),
        showWatch: kind === 'day' ? !!data.watchBody : !!data.watch,
        periods, periodIndex, periodLabel
      }, () => this.paint());
    },
    paint() {
      const data = this._payload;
      if (!data) return;
      const query = this.createSelectorQuery();
      query.select('#poster').fields({ node: true, size: true }).exec((res) => {
        const node = res && res[0] && res[0].node;
        if (!node) return;
        const drawer = this._kind === 'month' ? Monthly.draw : this._kind === 'week' ? Weekly.draw : Share.draw;
        this._canvas = node;
        drawer(node, data, this._theme || 'sage').then(() => {
          const width = (res[0].width || 320);
          const artH = Math.max(220, Math.round(width * node.height / 1080));
          if (artH !== this.data.artH) this.setData({ artH });
        }).catch(() => {});
      });
    },
    onCopy() {
      const data = this._payload;
      if (!data) return;
      wx.setClipboardData({ data: data.caption });
    },
    onSave() { this.export(false); },
    onShare() { this.export(true); },
    export(system) {
      const canvas = this._canvas;
      if (!canvas) { wx.showToast({ title: '图片正在生成', icon: 'none' }); return; }
      wx.canvasToTempFilePath({
        canvas,
        success: (r) => {
          if (system && wx.showShareImageMenu) {
            wx.showShareImageMenu({ path: r.tempFilePath, fail: () => wx.saveImageToPhotosAlbum({ filePath: r.tempFilePath }) });
            return;
          }
          wx.saveImageToPhotosAlbum({
            filePath: r.tempFilePath,
            success: () => wx.showToast({ title: '已保存', icon: 'none' }),
            fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
          });
        },
        fail: () => wx.showToast({ title: '导出失败', icon: 'none' })
      });
    }
  }
});
