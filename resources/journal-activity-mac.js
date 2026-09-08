ObjC.import('AppKit')
ObjC.import('CoreGraphics')

function run() {
  var application = $.NSWorkspace.sharedWorkspace.frontmostApplication
  var pid = Number(application.processIdentifier)
  var windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0)))
  var window = windows.find(function (item) { return item.kCGWindowOwnerPID === pid && item.kCGWindowLayer === 0 })
  return JSON.stringify({ ok: true, pid: pid, app: ObjC.unwrap(application.localizedName),
    title: window && window.kCGWindowName || '', hwnd: String(window ? window.kCGWindowNumber : 0) })
}
