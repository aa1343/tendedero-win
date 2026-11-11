// UI strings, zh + en. The Chinese column is the original macOS app's zh-Hans
// localisation with Mac wording swapped for the Windows equivalent; the English
// column is the original app's source strings.
//
// Values use {0}, {1}, … placeholders so a language can reorder them.
const DICT = {
  zh: {
    // ---- tray menu ----
    'tray.showLine': '显示晾衣绳',
    'tray.hideLine': '隐藏晾衣绳',
    'tray.search': '在晾衣绳上搜索',
    'tray.putBack': '撤销',
    'tray.clearAll': '全部取下',
    'tray.hangAllBack': '全部放回绳上',
    'tray.screenshotsSection': '截图',
    'tray.takeNow': '立即截一张图',
    'tray.handleShots': '接管截图',
    'tray.watchFolders': '同时监视文件夹',
    'tray.addFolder': '添加文件夹…',
    'tray.openShotsFolder': '打开截图文件夹',
    'tray.hangCopySection': '挂上复制的内容',
    'tray.images': '图片',
    'tray.text': '文字',
    'tray.links': '链接',
    'tray.bringDown': '放下晾衣绳',
    'tray.whenPointer': '指针停在屏幕顶边时',
    'tray.whenNew': '有新内容挂上时',
    'tray.overFullScreen': '在全屏应用之上',
    'tray.keep': '绳上保留',
    'tray.asMany': '放得下的数量',
    'tray.photos': '{0} 张',
    'tray.autoClean': '自动清理',
    'tray.cleanLineGroup': '绳上取下',
    'tray.cleanLineOff': '不取下',
    'tray.cleanLineDay1': '1 天后取下',
    'tray.cleanLineDays': '{0} 天后取下',
    'tray.cleanTrashGroup': '回收站删除',
    'tray.cleanTrashOff': '不删除',
    'tray.cleanTrashDay1': '1 天后删除',
    'tray.cleanTrashDays': '{0} 天后删除',
    'tray.autoCleanNow': '现在清理一次',
    'tray.size': '大小',
    'tray.small': '小',
    'tray.medium': '中',
    'tray.large': '大',
    'tray.zoom': '悬停时放大',
    'tray.shortcut': '快捷键',
    'tray.changeShortcut': '更改快捷键…',
    'tray.shotShortcut': '截图快捷键',
    'tray.changeShotShortcut': '更改截图快捷键…',
    'tray.sounds': '声音',
    'tray.openAtLogin': '开机自启',
    'tray.openData': '打开数据文件夹',
    'tray.quit': '退出 Tendedero',
    'tray.language': '语言',
    'tray.langZh': '中文',
    'tray.langEn': 'English',
    'tray.none': '无',

    // ---- tray tooltip ----
    'tip.watching': 'Tendedero，正在挂上复制的图片',
    'tip.idle': 'Tendedero',
    'tip.empty': '晾衣绳上是空的',
    'tip.count': '晾衣绳上有 {0} 张',

    // ---- card menu ----
    'menu.copy': '复制',
    'menu.open': '打开',
    'menu.openLink': '打开链接',
    'menu.quickLook': '快速查看',
    'menu.markup': '标记',
    'menu.showInExplorer': '在资源管理器中显示',
    'menu.share': '共享…',
    'menu.saveToDesktop': '另存到桌面',
    'menu.pin': '固定',
    'menu.unpin': '取消固定',
    'menu.hold': '拿在手上',
    'menu.hangBack': '放回绳上',
    'menu.discard': '丢弃',
    'menu.takeDown': '取下',
    'menu.recycle': '移到回收站',
    'menu.takeDownLeft': '取下左侧全部',
    'menu.takeDownRight': '取下右侧全部',
    'menu.selected': '已选择 {0} 张',

    // ---- in-window ui ----
    'ui.hintEmpty': '截个图，它就会挂在这里',
    'ui.hintDelete': '悬停按 Del 取下',
    'ui.copied': '已复制',
    'ui.heldHint': 'Esc 放回绳上 · Ctrl+C 复制 · Ctrl+滚轮缩放',
    'ui.searchPlaceholder': '在晾衣绳上搜索',
    'ui.shortcutPress': '请按下新的快捷键',
    'ui.shortcutHint': '按 Esc 取消，按删除键移除快捷键。',
    'ui.space': '空格',
    'ui.none': '无',

    // ---- window titles ----
    'win.held': '拿在手上',
    'win.search': '在晾衣绳上搜索',
    'win.shortcut': '更改快捷键',
    'win.zoom': '放大预览',

    // ---- generated file names ----
    'file.shot': '截图',
    'file.clip': '剪贴板',
    'file.text': '文字',
    'file.link': '链接',

    // ---- note dates ----
    'date.today': '今天 {0}',
    'date.yesterday': '昨天 {0}',
    'date.md': '{0}月{1}日 {2}',
    'date.ymd': '{0}年{1}月{2}日 {3}',
  },

  en: {
    'tray.showLine': 'Show line',
    'tray.hideLine': 'Hide line',
    'tray.search': 'Search the line',
    'tray.putBack': 'Put back',
    'tray.clearAll': 'Take everything down',
    'tray.hangAllBack': 'Hang everything back',
    'tray.screenshotsSection': 'Screenshots',
    'tray.takeNow': 'Take a screenshot now',
    'tray.handleShots': 'Handle screenshots',
    'tray.watchFolders': 'Also watch folders',
    'tray.addFolder': 'Add Folder…',
    'tray.openShotsFolder': 'Open screenshots folder',
    'tray.hangCopySection': 'Hang what you copy',
    'tray.images': 'Images',
    'tray.text': 'Text',
    'tray.links': 'Links',
    'tray.bringDown': 'Bring the line down',
    'tray.whenPointer': 'When the pointer rests at the top',
    'tray.whenNew': 'When something new hangs',
    'tray.overFullScreen': 'Over full screen apps',
    'tray.keep': 'Keep on line',
    'tray.asMany': 'As many as fit',
    'tray.photos': '{0} photos',
    'tray.autoClean': 'Auto-clean',
    'tray.cleanLineGroup': 'Off the line',
    'tray.cleanLineOff': 'Keep on line',
    'tray.cleanLineDay1': 'After 1 day',
    'tray.cleanLineDays': 'After {0} days',
    'tray.cleanTrashGroup': 'Out of the Trash',
    'tray.cleanTrashOff': 'Keep in Trash',
    'tray.cleanTrashDay1': 'Delete after 1 day',
    'tray.cleanTrashDays': 'Delete after {0} days',
    'tray.autoCleanNow': 'Clean up now',
    'tray.size': 'Size',
    'tray.small': 'Small',
    'tray.medium': 'Medium',
    'tray.large': 'Large',
    'tray.zoom': 'Zoom on hover',
    'tray.shortcut': 'Shortcut',
    'tray.changeShortcut': 'Change Shortcut…',
    'tray.shotShortcut': 'Screenshot shortcut',
    'tray.changeShotShortcut': 'Change Screenshot Shortcut…',
    'tray.sounds': 'Sounds',
    'tray.openAtLogin': 'Open at login',
    'tray.openData': 'Open data folder',
    'tray.quit': 'Quit Tendedero',
    'tray.language': 'Language',
    'tray.langZh': '中文',
    'tray.langEn': 'English',
    'tray.none': 'None',

    'tip.watching': 'Tendedero, hanging copied images',
    'tip.idle': 'Tendedero',
    'tip.empty': 'The line is empty',
    'tip.count': '{0} on the line',

    'menu.copy': 'Copy',
    'menu.open': 'Open',
    'menu.openLink': 'Open Link',
    'menu.quickLook': 'Quick Look',
    'menu.markup': 'Markup',
    'menu.showInExplorer': 'Show in Explorer',
    'menu.share': 'Share…',
    'menu.saveToDesktop': 'Save to Desktop',
    'menu.pin': 'Pin',
    'menu.unpin': 'Unpin',
    'menu.hold': 'Hold',
    'menu.hangBack': 'Hang back',
    'menu.discard': 'Discard',
    'menu.takeDown': 'Take down',
    'menu.recycle': 'Move to Recycle Bin',
    'menu.takeDownLeft': 'Take down everything to the left',
    'menu.takeDownRight': 'Take down everything to the right',
    'menu.selected': '{0} selected',

    'ui.hintEmpty': 'Take a screenshot and it will hang here',
    'ui.hintDelete': 'Del takes down the card under the pointer',
    'ui.copied': 'Copied',
    'ui.heldHint': 'Esc to hang back · Ctrl+C to copy · Ctrl+wheel to zoom',
    'ui.searchPlaceholder': 'Search the line',
    'ui.shortcutPress': 'Press the new shortcut',
    'ui.shortcutHint': 'Escape cancels. Delete removes the shortcut.',
    'ui.space': 'Space',
    'ui.none': 'None',

    'win.held': 'Held',
    'win.search': 'Search the line',
    'win.shortcut': 'Change Shortcut',
    'win.zoom': 'Zoom',

    'file.shot': 'Screenshot',
    'file.clip': 'Clipboard',
    'file.text': 'Text',
    'file.link': 'Link',

    'date.today': 'Today, {0}',
    'date.yesterday': 'Yesterday, {0}',
    'date.md': '{0}/{1}, {2}',
    'date.ymd': '{0}/{1}/{2}, {3}',
  },
};

const LANGS = ['zh', 'en'];

function normalize(lang) {
  const s = String(lang || '').toLowerCase();
  if (s.startsWith('en')) return 'en';
  if (s.startsWith('zh')) return 'zh';
  return '';
}

function t(lang, key, ...args) {
  const table = DICT[lang] || DICT.zh;
  let s = table[key];
  if (s === undefined) s = DICT.zh[key];
  if (s === undefined) return key;
  return String(s).replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? '' : String(args[i])));
}

module.exports = { DICT, LANGS, normalize, t };
