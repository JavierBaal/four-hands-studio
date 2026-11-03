// Four Hands Engine: the native audio engine (fase 2, prueba S2; ESTUDIO_FASE2_MOTOR.md, 3).
//
// It hosts one plugin per slot (a slot is a track's sound), plays the MIDI that Four Hands sends
// with a small delay so it lands on time, sums the slots and sends them to the audio device.
// Four Hands keeps the song; the engine only makes sound.
#pragma once

#include "GsEffects.h"

#include <juce_audio_utils/juce_audio_utils.h>

#include <array>
#include <atomic>
#include <functional>
#include <memory>
#include <vector>

namespace fh
{
/** One per track that sounds through a plugin; 16 like MIDI channels. */
constexpr int kSlots = 16;
/** After them, the built-in sounds (SoundFontSynth): all 16 MIDI channels, as the app sends them. */
constexpr int kSoundsSlot = kSlots;
constexpr int kAllSlots = kSlots + 1;

class SoundFontSynth;

class Engine : public juce::AudioIODeviceCallback, private juce::ChangeListener, private juce::Timer
{
public:
    Engine();
    ~Engine() override;

    // -------------------------------------------------------------------------
    // Audio device

    /** Opens the default output (WASAPI on Windows). Returns an error, or an empty string. */
    juce::String openDevice();
    /**
     * Follows the system's default output (Fran, 03/11/2026): when Windows switches, say, from the
     * TV to the headphones, the engine moves to them. Without this it kept the output it opened.
     * `onDeviceChanged` gets the new device's text and latency, for Four Hands.
     */
    void followDefaultOutput (std::function<void (const juce::String& device, double latency)> onDeviceChanged);
    /** What openDevice said when it failed (empty if the device is open). */
    juce::String deviceError() const { return lastDeviceError; }
    /** "Altavoces (Realtek) · 48000 Hz · 480 muestras", or "none". */
    juce::String deviceText() const;
    double outputLatencySeconds() const;
    double getSampleRate() const { return sampleRate; }

    // -------------------------------------------------------------------------
    // Plugins

    /**
     * Looks for VST3 plugins in `where` (by default, the system's VST3 folders). A plugin that
     * crashes the scan is remembered in `deadMansPedal` and skipped next time. `progress` gets the
     * file being scanned and how far it is (0 to 1).
     */
    void scan (const juce::FileSearchPath& where, const juce::File& deadMansPedal, const std::function<void (const juce::String&, float)>& progress);
    juce::KnownPluginList& known() { return knownPlugins; }
    juce::FileSearchPath defaultSearchPath();

    /** Loads a plugin into a slot (replacing what was there). Returns an error, or an empty string. */
    juce::String load (int slot, const juce::PluginDescription& description);
    void unload (int slot);
    juce::String nameOf (int slot) const;
    /** Opens (or brings to front) the plugin's own window. False if it has none. */
    bool showEditor (int slot);
    /** The slots whose window is on screen now: only their plugins can change from the user's hand. */
    juce::Array<int> openWindows() const;
    /** The plugin's state (preset, loaded library…), to keep with the song. */
    juce::MemoryBlock state (int slot);
    bool setState (int slot, const juce::MemoryBlock& data);

    // -------------------------------------------------------------------------
    // Built-in sounds (F2.1, 31/10/2026)

    /** Creates the built-in sounds in their slot if they are not there (message thread). */
    SoundFontSynth& sounds();
    /**
     * Loads a bank into the built-in sounds at its bank select offset (0: the default bank).
     * Thread-safe against the audio thread; call it from a worker, SF3 takes seconds.
     */
    juce::String loadSoundBank (int offset, const juce::File& file, int& presets);

    // -------------------------------------------------------------------------
    // Mix (F2.2, 03/11/2026): one strip per track's channel

    /**
     * A strip's fader (linear gain), balance (-1 to 1) and send to the Reverb bus (0 to 1, after
     * the fader). The built-in sounds keep their volume, pan and reverb as MIDI (CC7, CC10,
     * CC91) inside their synth, so they sound as before: their strip stays at 1, 0, 0.
     */
    void setMix (int channel, double gain, double pan, double reverb);

    /** Peak and RMS (linear) of a strip, or of the master (index 16), and samples above 1. */
    struct Level { double peak = 0, rms = 0; juce::int64 clips = 0; };
    /** Since the last call (for the meters), or since `resetLevels` (for the AI, «last playback»). */
    std::array<Level, kSlots + 1> takeMeters (bool sinceReset);
    void resetLevels();

    // -------------------------------------------------------------------------
    // MIDI

    /** Plays `message` on `slot` (kSoundsSlot: the built-in sounds, on the message's own channel), `delaySeconds` from now (Four Hands schedules ahead). */
    void schedule (int slot, double delaySeconds, const juce::MidiMessage& message);
    /** All notes off and pedal up in every slot, now. */
    void panic();

    // -------------------------------------------------------------------------
    // Offline (tests): renders into `out` as the device would, without a device.

    void prepareOffline (double rate, int block);
    void renderOffline (juce::AudioBuffer<float>& out);

    // AudioIODeviceCallback
    void audioDeviceIOCallbackWithContext (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs, int numSamples, const juce::AudioIODeviceCallbackContext& context) override;
    void audioDeviceAboutToStart (juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;

    /** Blocks processed so far and the largest share of the block budget used (for the log). */
    struct Stats { juce::int64 blocks = 0; double maxLoad = 0; int late = 0; };
    Stats takeStats();

private:
    void changeListenerCallback (juce::ChangeBroadcaster*) override { checkDefaultOutput (false); }
    void timerCallback() override { checkDefaultOutput (true); }
    /** Moves to the system's default output if it is not the one open. `rescan`: ask the system again. */
    void checkDefaultOutput (bool rescan);
    std::function<void (const juce::String&, double)> deviceChanged;
    bool checkingDevice = false;

    struct Pending
    {
        juce::int64 at;
        int slot;
        juce::MidiMessage message;
    };

    void process (float* const* outputs, int numOutputs, int numSamples);
    void prepare (double rate, int block);

    juce::AudioDeviceManager device;
    juce::String lastDeviceError;
    juce::AudioPluginFormatManager formatManager;
    juce::KnownPluginList knownPlugins;

    // Owned on the message thread; the audio thread sees `live` under `lock`.
    std::array<std::unique_ptr<juce::AudioPluginInstance>, kAllSlots> slots;
    std::array<juce::AudioPluginInstance*, kAllSlots> live {};
    std::array<std::unique_ptr<juce::DocumentWindow>, kAllSlots> windows;

    juce::SpinLock lock;
    std::vector<Pending> pending;
    std::atomic<juce::int64> position { 0 };

    double sampleRate = 48000.0;
    int blockSize = 512;
    juce::AudioBuffer<float> scratch;
    std::array<juce::MidiBuffer, kAllSlots> midi;

    struct Strip { double gain = 1, pan = 0, reverb = 0; };
    struct Meter
    {
        float peak = 0, totalPeak = 0;
        double sum = 0, totalSum = 0;
        juce::int64 count = 0, totalCount = 0, clips = 0;
        void add (const float* L, const float* R, int n);
    };
    std::array<Strip, kSlots> mix {};
    std::array<Meter, kSlots + 1> meters {};
    juce::AudioBuffer<float> strips, sends, master, busIn;
    std::unique_ptr<gs::Reverb> busReverb;
    double busRate = 0;

    juce::SpinLock statsLock;
    Stats stats;
};

} // namespace fh
