/** iOS 不能装 APK：给出「添加到主屏幕」的说明 */
export const isIOS = (): boolean =>
  typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)

export const IOS_HINT =
  'iPhone 不能安装安卓安装包。\n\n请用 Safari 打开本页，点底部「分享」→「添加到主屏幕」，图标会自动变成小虎鲸，点开就能全屏使用。'
