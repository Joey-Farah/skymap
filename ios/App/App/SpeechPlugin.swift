import AVFoundation
import Capacitor

/// Voice turn-by-turn's bridge to iOS's speech synthesizer.
///
/// Native rather than the web view's speechSynthesis because only native
/// code can set the audio session, and the session is the whole difference
/// between a prompt and a sound: `.playback` plays through the silent switch
/// the way Apple Maps does, `.voicePrompt` tells iOS this is navigation, and
/// ducking turns music down under the prompt instead of talking over it.
@objc(SpeechPlugin)
public class SpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "SpeechPlugin"
    public let jsName = "Speech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    /// Touched only on the main queue: the bridge calls in on its own
    /// thread, and delegate callbacks come in on the synthesizer's.
    nonisolated(unsafe) private let synthesizer = AVSpeechSynthesizer()

    override public func load() {
        synthesizer.delegate = self
    }

    /// Says `text`, cutting off anything still being said: a stale
    /// instruction finished is worse than the current one started late.
    /// Resolves once it is queued, not when it has been said.
    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        DispatchQueue.main.async {
            self.synthesizer.stopSpeaking(at: .immediate)
            guard !text.isEmpty else { return call.resolve() }
            let session = AVAudioSession.sharedInstance()
            // Spoken audio (a podcast) is paused rather than ducked: two
            // voices at once can't both be followed.
            try? session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
            try? session.setActive(true)
            let utterance = AVSpeechUtterance(string: text)
            // The instructions are written in English, whatever the phone's
            // language; another language's voice would mangle them.
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
            self.synthesizer.speak(utterance)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.synthesizer.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        handBackAudio()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        handBackAudio()
    }

    /// Done or cut off: let the music come back up and a paused podcast
    /// resume. Not when a newer line is already playing — cutting one off
    /// to say the next lands here too.
    private func handBackAudio() {
        DispatchQueue.main.async {
            guard !self.synthesizer.isSpeaking else { return }
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}
