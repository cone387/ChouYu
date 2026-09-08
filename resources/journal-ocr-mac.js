ObjC.import('Foundation')
ObjC.import('Vision')

function run(args) {
  var request = $.VNRecognizeTextRequest.alloc.init
  request.recognitionLevel = 0
  request.usesLanguageCorrection = true
  request.recognitionLanguages = $(['zh-Hans', 'en-US'])
  var handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(args[0]), $.NSDictionary.dictionary)
  var error = Ref()
  if (!handler.performRequestsError($([request]), error)) throw new Error('macOS 本地文字识别失败')
  var result = request.results
  var lines = []
  for (var i = 0; i < result.count; i++) {
    var candidates = result.objectAtIndex(i).topCandidates(1)
    if (candidates.count) lines.push(ObjC.unwrap(candidates.objectAtIndex(0).string))
  }
  return JSON.stringify({ text: lines.join('\n').slice(0, 30000) })
}
