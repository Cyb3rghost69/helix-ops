import Foundation
import Speech

guard CommandLine.arguments.count > 1 else {
    fputs("usage: helix-stt <audio-file>\n", stderr)
    exit(2)
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
var exitCode: Int32 = 0
var printed = false

func finish(_ text: String, _ err: String, _ code: Int32) {
    if printed { return }
    printed = true
    if code != 0 {
        fputs(err + "\n", stderr)
    } else {
        fputs(text + "\n", stdout)
    }
    exitCode = code
    CFRunLoopStop(CFRunLoopGetMain())
}

SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else {
        finish("", "speech-unauthorized", 3)
        return
    }
    let rec = SFSpeechRecognizer(locale: Locale(identifier: "en-AU"))
        ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        ?? SFSpeechRecognizer()
    guard let rec, rec.isAvailable else {
        finish("", "speech-unavailable", 4)
        return
    }
    let req = SFSpeechURLRecognitionRequest(url: url)
    req.shouldReportPartialResults = false
    rec.recognitionTask(with: req) { result, error in
        if let error {
            finish("", error.localizedDescription, 1)
            return
        }
        if let result, result.isFinal {
            finish(result.bestTranscription.formattedString, "", 0)
        }
    }
}

DispatchQueue.main.asyncAfter(deadline: .now() + 22) {
    finish("", "speech-timeout", 5)
}

CFRunLoopRun()
exit(exitCode)
