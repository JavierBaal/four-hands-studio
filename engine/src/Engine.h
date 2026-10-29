// Four Hands Engine: the native audio engine (fase 2, prueba S2; ESTUDIO_FASE2_MOTOR.md, 3).
//
// It hosts one plugin per slot (a slot is a track's sound), plays the MIDI that Four Hands sends
// with a small delay so it lands on time, sums the slots and sends them to the audio device.
// Four Hands keeps the song; the engine only makes sound.
#pragma once

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

class Engine : public juce::AudioIODeviceCallback
{
public:
    Engine();
    ~Engine() override;

    // -------------------------------------------------------------------------
    // Audio device

    /** Opens the default output (WASAPI on Windows). Returns an error, or an empty string. */
    juce::String openDevice();
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
    // MIDI

    /** Plays `message` on `slot`, `delaySeconds` from now (Four Hands schedules ahead). */
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
    std::array<std::unique_ptr<juce::AudioPluginInstance>, kSlots> slots;
    std::array<juce::AudioPluginInstance*, kSlots> live {};
    std::array<std::unique_ptr<juce::DocumentWindow>, kSlots> windows;

    juce::SpinLock lock;
    std::vector<Pending> pending;
    std::atomic<juce::int64> position { 0 };

    double sampleRate = 48000.0;
    int blockSize = 512;
    juce::AudioBuffer<float> scratch;
    std::array<juce::MidiBuffer, kSlots> midi;

    juce::SpinLock statsLock;
    Stats stats;
};

} // namespace fh
