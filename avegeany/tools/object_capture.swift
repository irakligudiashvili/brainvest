// Apple Object Capture (RealityKit PhotogrammetrySession) command-line helper.
// macOS 12+ on Apple Silicon (or Intel + AMD GPU with 4 GB VRAM).
//
//   swiftc -O tools/object_capture.swift -o tools/object_capture
//   tools/object_capture <images_dir> <output_dir> [preview|reduced|medium|full|raw]
//
// When the output URL is a folder, RealityKit writes an OBJ (+ MTL + textures)
// that the Python pipeline can read directly.
import Foundation
import RealityKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    print("usage: object_capture <images_dir> <output_dir> [preview|reduced|medium|full|raw]")
    exit(2)
}
let inputURL = URL(fileURLWithPath: args[1], isDirectory: true)
let outputURL = URL(fileURLWithPath: args[2], isDirectory: true)
try? FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

let detailName = args.count > 3 ? args[3] : "medium"
let detail: PhotogrammetrySession.Request.Detail
switch detailName {
case "preview": detail = .preview
case "reduced": detail = .reduced
case "full": detail = .full
case "raw": detail = .raw
default: detail = .medium
}

guard PhotogrammetrySession.isSupported else {
    print("ERROR: PhotogrammetrySession is not supported on this Mac.")
    exit(1)
}

var config = PhotogrammetrySession.Configuration()
config.featureSensitivity = .high      // rooms have large low-texture surfaces
config.sampleOrdering = .unordered
config.isObjectMaskingEnabled = false  // keep the whole scene, not a single object

let session: PhotogrammetrySession
do {
    session = try PhotogrammetrySession(input: inputURL, configuration: config)
} catch {
    print("ERROR: could not create session: \(error)")
    exit(1)
}

let waiter = Task {
    do {
        for try await output in session.outputs {
            switch output {
            case .requestProgress(_, let fraction):
                print(String(format: "progress %.1f%%", fraction * 100))
                fflush(stdout)
            case .requestComplete(_, let result):
                if case .modelFile(let url) = result {
                    print("model written: \(url.path)")
                }
            case .requestError(_, let error):
                print("ERROR: request failed: \(error)")
                exit(1)
            case .processingComplete:
                print("done")
                exit(0)
            case .processingCancelled:
                print("cancelled")
                exit(1)
            case .invalidSample(let id, let reason):
                print("warning: invalid sample \(id): \(reason)")
            case .skippedSample(let id):
                print("warning: skipped sample \(id)")
            case .automaticDownsampling:
                print("note: images were downsampled to fit in memory")
            case .inputComplete:
                print("input loaded, reconstructing ...")
            default:
                break
            }
        }
    } catch {
        print("ERROR: \(error)")
        exit(1)
    }
}

do {
    try session.process(requests: [.modelFile(url: outputURL, detail: detail)])
} catch {
    print("ERROR: \(error)")
    exit(1)
}
withExtendedLifetime(waiter) { RunLoop.main.run() }
