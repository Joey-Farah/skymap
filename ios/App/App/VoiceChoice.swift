import AVFoundation

/// What choosing a voice needs to know about one. AVSpeechSynthesisVoice
/// has it all; tests stand in their own.
protocol SpeechVoice {
    var identifier: String { get }
    var language: String { get }
    var quality: AVSpeechSynthesisVoiceQuality { get }
}

extension AVSpeechSynthesisVoice: SpeechVoice {}

enum VoiceChoice {
    /// The most natural English voice on the phone, or nil when it has only
    /// the basic ones and iOS's default should speak.
    ///
    /// The basic voices are the robotic ones. Enhanced and Premium come only
    /// from the walker downloading one (Settings → Accessibility → Read &
    /// Speak → Voices); an app can neither download one nor see which could
    /// be. Quality beats accent: a British Premium sounds less robotic than
    /// an American basic. Among equals, the voice picked in Settings
    /// (`preferring`), then American English.
    static func best<V: SpeechVoice>(_ voices: [V], preferring preferred: String?) -> V? {
        voices
            .filter { $0.language.hasPrefix("en") && $0.quality.rawValue > AVSpeechSynthesisVoiceQuality.default.rawValue }
            .sorted { a, b in
                if a.quality != b.quality { return a.quality.rawValue > b.quality.rawValue }
                if (a.identifier == preferred) != (b.identifier == preferred) { return a.identifier == preferred }
                if (a.language == "en-US") != (b.language == "en-US") { return a.language == "en-US" }
                return a.identifier < b.identifier
            }
            .first
    }
}
