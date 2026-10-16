// 获取 canvas 2d 上下文（含 dpr 适配）
function getCtx(page, id) {
  return new Promise((resolve) => {
    wx.createSelectorQuery().in(page).select('#' + id).fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return resolve(null);
      const c = res[0].node, w = res[0].width, h = res[0].height;
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = info.pixelRatio || 2;
      c.width = w * dpr; c.height = h * dpr;
      const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
      resolve({ ctx, w, h });
    });
  });
}
module.exports = { getCtx };
