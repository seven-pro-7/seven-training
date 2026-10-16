App({
  globalData: { gotoDay: null, editRecordId: null },
  onLaunch() {
    // 首次启动时自动导入 Excel 默认参数与第 1 周记录
    require('./utils/store.js').load();
  }
});
