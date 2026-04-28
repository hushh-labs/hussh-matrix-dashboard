#!/usr/bin/env swift
import AppKit
import AVFoundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let outDir = root.appendingPathComponent("artifacts/demo")
let frameDir = outDir.appendingPathComponent("frames")

let width = 1920
let height = 1080
let fps: Int32 = 30
let totalDuration = 240.0
let mode = CommandLine.arguments.dropFirst().first ?? "product"

struct Shot {
    let file: String
    let duration: Double
    let caption: String
}

struct DemoConfig {
    let script: String
    let narrationFilename: String
    let voiceoverFilename: String
    let ambientFilename: String
    let silentFilename: String
    let outputFilename: String
    let voiceRate: String
    let shots: [Shot]
}

let productScript = """
Welcome to the Hussh Matrix Dashboard, a single operating view for the products that matter across the Hussh ecosystem. A dashboard is simply one trusted place to understand product health, engagement, reliability, and readiness without asking every team to pull separate reports.

The first thing to notice is that the dashboard is built around aggregate metrics. Aggregate means totals and trends, not individual user records. That matters because leaders can see adoption, traffic, and system health while the product keeps personal data, emails, tokens, and raw records out of the public interface.

At the top, the live status bar shows whether connected sources are loading successfully. A refresh pulls the latest available data, and each product section tells us how fresh its sources are. Freshness means how recent the data is, and whether a source is live, near-live, waiting, or unavailable.

Now let us look at Kai production. Kai combines product analytics with infrastructure signals. GA4, or Google Analytics 4, tells us how people use the product: users, sessions, events, geography, and devices. Cloud Run is the Google Cloud service hosting the production application. It gives us operational signals like request volume, errors, instance count, and latency. P95 latency means the response time experienced by almost all users, excluding the slowest few outliers, so it is a practical way to describe real-world speed.

The readiness section makes the production state clear. If a GA4 export is still waiting, the dashboard does not fake a number. It shows that the source is waiting while still showing Cloud Run traffic, reliability, and production context.

Next is Hushh AI. This section focuses on analytics and infrastructure status. Search Console is Google search visibility data: impressions, clicks, and export readiness. The dashboard keeps these source states visible so teams know whether a metric is live, delayed, or still waiting for an upstream export.

Now we move to HushhTech. This is where PR 6 added a clearer metrics boundary. Supabase provides database-backed aggregate counts, like signups, profiles, onboarding, and business funnel progress. BigQuery export means analytics or search data has been copied into a cloud warehouse, where it can be queried safely and consistently. HushhTech also includes Cloud Run monitoring and Search Console export coverage, giving the team a clean view of product activity and operational health together.

The platform tab shows the trust layer behind the dashboard. Each product has source health, connected provider coverage, and automated checks. A production probe is an automated test that verifies the live system is working. It checks the domain, health endpoint, product analytics endpoint, cache behavior, and freshness payloads. This turns manual dashboard checking into repeatable evidence.

The result is one calm operating surface for three products: Kai, Hushh AI, and HushhTech. It protects privacy by showing aggregate-only data, it explains waiting states honestly, and it connects product metrics with production reliability. For operators, managers, engineers, buyers, and investors, metrics.hushh.ai becomes the live story of what is working, what is ready, and what needs attention next.
"""

let terminologyScript = """
Welcome to the Hussh Matrix Dashboard terminology tour. This video is for anyone new to the platform. Instead of assuming the words are already familiar, we will translate the main dashboard terms into plain English as they appear on screen.

A dashboard is one shared place to see product health. Aggregate metrics are totals, counts, and trends across many users. They are useful for teams because they explain what is happening without exposing raw personal records.

Start with sessions. A session is one visit or active period from a person using a product. If someone opens the site, looks around, leaves, and comes back later, that can become another session. Users count people or devices. Active users are people who returned within a time window. DAU, WAU, and MAU mean daily, weekly, and monthly active users.

Events are actions inside the product, like opening a page, starting onboarding, submitting a form, or using a feature. Page views are a specific kind of event: a page was seen. Engaged sessions are sessions with meaningful activity, not just a quick bounce.

Requests are infrastructure traffic. A request happens when a browser, app, or service asks the server for something: a page, an API response, a file, or a health check. Cloud Run requests tell us how much live production traffic the hosted service is handling. A non-2xx response is a request that did not return a normal success code. Error rate is the share of requests that did not succeed.

Cloud Run is the Google Cloud service that hosts the production app. It runs the container, scales it up when traffic grows, and scales it down when traffic is quiet. Instances are the running copies of that service. More instances usually mean the system is responding to more demand.

Latency means response time: how long users wait after a request is made. P95 latency means the response time for the 95th percentile. In simple terms, if p95 is 600 milliseconds, then 95 percent of requests finished in 600 milliseconds or less, while the slowest 5 percent took longer. P95 is better than only using average latency because one unusually slow request does not hide the real experience for almost everyone.

GA4 means Google Analytics 4. It is product usage analytics: users, sessions, events, devices, locations, and engagement trends. Search Console is Google search visibility data. Impressions mean the site appeared in search results. Clicks mean someone clicked that result. CTR, or click-through rate, is clicks divided by impressions.

Supabase is the database-backed product layer used for aggregate counts such as signups, profiles, onboarding, and stored product activity. BigQuery is a cloud data warehouse. A BigQuery export means analytics or search data has been copied into a place where the dashboard can query it consistently.

A funnel is a sequence of steps, such as signup, profile, onboarding, and activation. Conversion rate shows how many people moved from one step to the next. Dropoff shows where people stopped. Freshness tells us how recent the data is. A source can be live, near-live, waiting, delayed, or unavailable.

Source health is the trust layer. It shows which systems are connected and whether they are reporting cleanly. A production probe is an automated check against the real live service. No-store cache headers mean the API is designed to return fresh dashboard data instead of stale browser cache.

The big idea is simple: product metrics explain what people are doing, search metrics explain how people find the products, database metrics explain what was actually stored, and Cloud Run metrics explain whether production is healthy. Together, they make metrics.hushh.ai understandable for beginners and useful for operators, managers, engineers, buyers, and investors.
"""

let productShots: [Shot] = [
    Shot(file: "01-opening.png", duration: 20, caption: "One dashboard for product health"),
    Shot(file: "02-key-metrics.png", duration: 35, caption: "Aggregate metrics"),
    Shot(file: "03-kai-production.png", duration: 40, caption: "GA4 - Cloud Run - p95 latency"),
    Shot(file: "04-hushh-ai.png", duration: 35, caption: "Freshness - Search Console"),
    Shot(file: "05-hushhtech-report.png", duration: 24, caption: "Supabase - BigQuery export"),
    Shot(file: "06-hushhtech-database.png", duration: 21, caption: "Database-backed product counts"),
    Shot(file: "07-source-health.png", duration: 35, caption: "Production probe"),
    Shot(file: "08-closing.png", duration: 30, caption: "metrics.hushh.ai"),
]

let terminologyShots: [Shot] = [
    Shot(file: "01-opening.png", duration: 18, caption: "Metrics, in Plain English"),
    Shot(file: "02-key-metrics.png", duration: 32, caption: "Aggregate Metrics"),
    Shot(file: "03-kai-production.png", duration: 32, caption: "Sessions + Events"),
    Shot(file: "03-kai-production.png", duration: 34, caption: "Requests + Error Rate"),
    Shot(file: "04-hushh-ai.png", duration: 32, caption: "p95 Latency + Cloud Run"),
    Shot(file: "05-hushhtech-report.png", duration: 32, caption: "Impressions + CTR"),
    Shot(file: "06-hushhtech-database.png", duration: 28, caption: "Supabase + BigQuery"),
    Shot(file: "07-source-health.png", duration: 20, caption: "Source Health + Probes"),
    Shot(file: "08-closing.png", duration: 12, caption: "metrics.hushh.ai"),
]

let config: DemoConfig
switch mode {
case "product", "technical":
    config = DemoConfig(
        script: productScript,
        narrationFilename: "narration.txt",
        voiceoverFilename: "voiceover.aiff",
        ambientFilename: "ambient.wav",
        silentFilename: "demo-silent.mp4",
        outputFilename: "hussh-matrix-dashboard-technical-demo.mp4",
        voiceRate: "145",
        shots: productShots
    )
case "terms", "terminology":
    config = DemoConfig(
        script: terminologyScript,
        narrationFilename: "terminology-narration.txt",
        voiceoverFilename: "terminology-voiceover.aiff",
        ambientFilename: "terminology-ambient.wav",
        silentFilename: "terminology-demo-silent.mp4",
        outputFilename: "hussh-matrix-dashboard-terminology-demo.mp4",
        voiceRate: "166",
        shots: terminologyShots
    )
default:
    fatalError("Unknown demo mode '\(mode)'. Use product or terminology.")
}

let script = config.script
let shots = config.shots
let narrationText = outDir.appendingPathComponent(config.narrationFilename)
let voiceover = outDir.appendingPathComponent(config.voiceoverFilename)
let ambient = outDir.appendingPathComponent(config.ambientFilename)
let silentVideo = outDir.appendingPathComponent(config.silentFilename)
let outputVideo = outDir.appendingPathComponent(config.outputFilename)

let shotDuration = shots.reduce(0.0) { $0 + $1.duration }
precondition(abs(shotDuration - totalDuration) < 0.001, "Shot durations must total \(totalDuration) seconds")

func shell(_ launchPath: String, _ arguments: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: launchPath)
    process.arguments = arguments
    try process.run()
    process.waitUntilExit()
    if process.terminationStatus != 0 {
        throw NSError(domain: "DemoRender", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: "\(launchPath) failed"])
    }
}

func createAmbientWav(url: URL, seconds: Double) throws {
    let sampleRate = 44_100
    let sampleCount = Int(seconds * Double(sampleRate))
    var pcm = Data()
    let frequencies = [146.83, 220.00, 293.66, 440.00]
    for sample in 0..<sampleCount {
        let t = Double(sample) / Double(sampleRate)
        let envelope = min(1.0, min(t / 6.0, (seconds - t) / 8.0))
        let value = frequencies.enumerated().reduce(0.0) { partial, item in
            let phase = 2.0 * Double.pi * item.element * t
            return partial + sin(phase) * (0.012 / Double(item.offset + 1))
        } * max(0.0, envelope)
        let intValue = Int16(max(-1.0, min(1.0, value)) * Double(Int16.max))
        pcm.append(UInt8(truncatingIfNeeded: intValue & 0xff))
        pcm.append(UInt8(truncatingIfNeeded: (intValue >> 8) & 0xff))
    }

    var data = Data()
    func appendString(_ value: String) { data.append(value.data(using: .ascii)!) }
    func appendLE32(_ value: UInt32) {
        data.append(UInt8(value & 0xff))
        data.append(UInt8((value >> 8) & 0xff))
        data.append(UInt8((value >> 16) & 0xff))
        data.append(UInt8((value >> 24) & 0xff))
    }
    func appendLE16(_ value: UInt16) {
        data.append(UInt8(value & 0xff))
        data.append(UInt8((value >> 8) & 0xff))
    }

    appendString("RIFF")
    appendLE32(UInt32(36 + pcm.count))
    appendString("WAVEfmt ")
    appendLE32(16)
    appendLE16(1)
    appendLE16(1)
    appendLE32(UInt32(sampleRate))
    appendLE32(UInt32(sampleRate * 2))
    appendLE16(2)
    appendLE16(16)
    appendString("data")
    appendLE32(UInt32(pcm.count))
    data.append(pcm)
    try data.write(to: url)
}

func cgImage(from url: URL) throws -> CGImage {
    guard let image = NSImage(contentsOf: url) else {
        throw NSError(domain: "DemoRender", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not load \(url.path)"])
    }
    var rect = CGRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        throw NSError(domain: "DemoRender", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not convert \(url.path)"])
    }
    return cgImage
}

func drawCaption(_ caption: String, in context: CGContext) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let attrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 36, weight: .semibold),
        .foregroundColor: NSColor.white,
        .paragraphStyle: paragraph,
    ]
    let text = NSAttributedString(string: caption, attributes: attrs)
    let textSize = text.size()
    let paddingX: CGFloat = 34
    let paddingY: CGFloat = 18
    let pill = CGRect(
        x: (CGFloat(width) - textSize.width - paddingX * 2) / 2,
        y: 56,
        width: textSize.width + paddingX * 2,
        height: textSize.height + paddingY * 2
    )
    context.saveGState()
    context.setFillColor(NSColor.black.withAlphaComponent(0.58).cgColor)
    context.addPath(CGPath(roundedRect: pill, cornerWidth: 28, cornerHeight: 28, transform: nil))
    context.fillPath()
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    text.draw(in: CGRect(x: pill.minX + paddingX, y: pill.minY + paddingY - 2, width: textSize.width, height: textSize.height + 4))
    NSGraphicsContext.restoreGraphicsState()
    context.restoreGState()
}

func makePixelBuffer(image: CGImage, caption: String, progress: Double, pool: CVPixelBufferPool) throws -> CVPixelBuffer {
    var pixelBuffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer)
    guard let buffer = pixelBuffer else {
        throw NSError(domain: "DemoRender", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not create pixel buffer"])
    }

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let baseAddress = CVPixelBufferGetBaseAddress(buffer) else {
        throw NSError(domain: "DemoRender", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not access pixel buffer"])
    }

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let context = CGContext(
        data: baseAddress,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
    )!

    context.setFillColor(NSColor(calibratedRed: 0.96, green: 0.96, blue: 0.97, alpha: 1).cgColor)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let zoom = 1.0 + CGFloat(progress) * 0.018
    let drawWidth = CGFloat(width) * zoom
    let drawHeight = CGFloat(height) * zoom
    let drawRect = CGRect(x: (CGFloat(width) - drawWidth) / 2, y: (CGFloat(height) - drawHeight) / 2, width: drawWidth, height: drawHeight)
    context.draw(image, in: drawRect)

    let gradient = CGGradient(colorsSpace: colorSpace, colors: [NSColor.black.withAlphaComponent(0.28).cgColor, NSColor.clear.cgColor] as CFArray, locations: [0.0, 1.0])!
    context.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: 180), options: [])
    drawCaption(caption, in: context)

    return buffer
}

func renderSilentVideo() throws {
    try? FileManager.default.removeItem(at: silentVideo)
    let writer = try AVAssetWriter(outputURL: silentVideo, fileType: .mp4)
    let settings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 12_000_000,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: input,
        sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ]
    )
    writer.add(input)
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)

    var frameIndex: Int64 = 0
    for shot in shots {
        let image = try cgImage(from: frameDir.appendingPathComponent(shot.file))
        let frameCount = Int(shot.duration * Double(fps))
        for frame in 0..<frameCount {
            while !input.isReadyForMoreMediaData {
                Thread.sleep(forTimeInterval: 0.01)
            }
            let progress = Double(frame) / Double(max(frameCount - 1, 1))
            let buffer = try makePixelBuffer(image: image, caption: shot.caption, progress: progress, pool: adaptor.pixelBufferPool!)
            adaptor.append(buffer, withPresentationTime: CMTime(value: frameIndex, timescale: fps))
            frameIndex += 1
        }
    }

    input.markAsFinished()
    let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting { semaphore.signal() }
    semaphore.wait()
    if writer.status != .completed {
        throw writer.error ?? NSError(domain: "DemoRender", code: 5, userInfo: [NSLocalizedDescriptionKey: "Video writer failed"])
    }
}

func firstTrack(_ asset: AVURLAsset, _ mediaType: AVMediaType) throws -> AVAssetTrack {
    guard let track = asset.tracks(withMediaType: mediaType).first else {
        throw NSError(domain: "DemoRender", code: 6, userInfo: [NSLocalizedDescriptionKey: "Missing \(mediaType.rawValue) track in \(asset.url.path)"])
    }
    return track
}

func mergeAudioAndVideo() throws {
    try? FileManager.default.removeItem(at: outputVideo)
    let composition = AVMutableComposition()
    let videoAsset = AVURLAsset(url: silentVideo)
    let voiceAsset = AVURLAsset(url: voiceover)
    let ambientAsset = AVURLAsset(url: ambient)
    let duration = CMTime(seconds: totalDuration, preferredTimescale: 600)

    let videoTrack = try firstTrack(videoAsset, .video)
    let compositionVideo = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
    try compositionVideo.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: videoTrack, at: .zero)
    compositionVideo.preferredTransform = videoTrack.preferredTransform

    let voiceTrack = try firstTrack(voiceAsset, .audio)
    let compositionVoice = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
    try compositionVoice.insertTimeRange(CMTimeRange(start: .zero, duration: min(voiceAsset.duration, duration)), of: voiceTrack, at: .zero)

    let ambientTrack = try firstTrack(ambientAsset, .audio)
    let compositionAmbient = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
    try compositionAmbient.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: ambientTrack, at: .zero)

    let voiceMix = AVMutableAudioMixInputParameters(track: compositionVoice)
    voiceMix.setVolume(1.0, at: .zero)
    let ambientMix = AVMutableAudioMixInputParameters(track: compositionAmbient)
    ambientMix.setVolume(0.08, at: .zero)
    let audioMix = AVMutableAudioMix()
    audioMix.inputParameters = [voiceMix, ambientMix]

    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
        throw NSError(domain: "DemoRender", code: 7, userInfo: [NSLocalizedDescriptionKey: "Could not create exporter"])
    }
    exporter.outputURL = outputVideo
    exporter.outputFileType = .mp4
    exporter.audioMix = audioMix
    exporter.shouldOptimizeForNetworkUse = true

    let semaphore = DispatchSemaphore(value: 0)
    exporter.exportAsynchronously { semaphore.signal() }
    semaphore.wait()
    if exporter.status != .completed {
        throw exporter.error ?? NSError(domain: "DemoRender", code: 8, userInfo: [NSLocalizedDescriptionKey: "Export failed"])
    }
}

try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
try script.write(to: narrationText, atomically: true, encoding: .utf8)
try shell("/usr/bin/say", ["-v", "Samantha", "-r", config.voiceRate, "-f", narrationText.path, "-o", voiceover.path])
try createAmbientWav(url: ambient, seconds: totalDuration)
try renderSilentVideo()
try mergeAudioAndVideo()

print("""
{
  "ok": true,
  "mode": "\(mode)",
  "output": "\(outputVideo.path)",
  "durationSeconds": \(Int(totalDuration)),
  "resolution": "\(width)x\(height)"
}
""")
