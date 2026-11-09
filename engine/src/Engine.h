// Four Hands Engine: the native audio engine (fase 2, prueba S2; ESTUDIO_FASE2_MOTOR.md, 3).
//
// It hosts one plugin per slot (a slot is a track's sound), plays the MIDI that Four Hands sends
// with a small delay so it lands on time, sums the slots and sends them to the audio device.
// Four Hands keeps the song; the engine only makes sound.
#pragma once

#include "Analyzer.h"
#include "Effects.h"
#include "GsEffects.h"
#include "SoundFontSynth.h"

#include <juce_audio_utils/juce_audio_utils.h>

#include <array>
#include <atomic>
#include <functional>
#include <memory>
#include <vector>

namespace fh
{
/**
 * A2 (F2.2, Fran 03/11/2026): one strip per track, numbered by Four Hands, not by MIDI channel, so
 * a song is not held to 16 tracks. A track that sounds through a plugin has it in the slot of its
 * strip. (Before, 16 slots: the track's MIDI channel.)
 */
constexpr int kStrips = 512;
constexpr int kSlots = kStrips;
/** Buses (F2.2 parte D): channels fed by strips and by other buses, with their own chain and fader. */
constexpr int kBuses = 128;
/** After them, the built-in sounds (SoundFontSynth): one channel of its own per strip. */
constexpr int kSoundsSlot = kSlots;
constexpr int kAllSlots = kSlots + 1;


/**
 * Where the song is, for the hosted plugins (Fran, 04/11/2026: Ozone's assistant listens only while
 * the host plays; synced delays and arpeggiators follow the tempo). Four Hands sends points with the
 * notes; between them the engine moves on at their tempo. Read by plugins on the audio thread.
 */
class Transport final : public juce::AudioPlayHead
{
public:
    juce::Optional<PositionInfo> getPosition() const override { return info; }
    PositionInfo info;
};

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
    // Mix (F2.2, 03/11/2026): one strip per track

    /**
     * A strip's fader (linear gain) and balance (-1 to 1). F2.2 parte B: a strip that is off (`on`
     * false: muted, or not soloed while another is) is silent here, after its sound, so the tails of
     * its plugin and of what it sends stop at once. Parte D: the built-in sounds' volume is here too
     * (Four Hands sends them CC7 at 127); their pan stays in the synth (CC10, per voice).
     */
    void setMix (int strip, double gain, double pan, bool on = true);
    /** A bus's fader, balance and on/off (F2.2 parte D). */
    void setBusMix (int bus, double gain, double pan, bool on = true);
    /** The master fader (linear gain, after the buses and before the master meter). */
    void setMasterGain (double gain) { masterGain.store (juce::jlimit (0.0, 4.0, gain)); }

    /** Where a strip or bus goes (F2.2 parte D): its output (a bus, or -1: the master) and its sends. */
    struct Route
    {
        int out = -1;
        struct Send { int bus = 0; float level = 0; bool pre = false; };
        std::vector<Send> sends;
    };
    /**
     * The whole routing: the strips and buses that do not go straight to the master with no sends,
     * the buses in processing order (each after every bus that feeds it; a bus left out is not
     * processed), and the bus that gets what the built-in instruments send to reverb on their own
     * (their SoundFont's setting; -1: none). Until Four Hands sends it, the engine sounds as before
     * parte D (offline renders, tests): the built-in sounds' CC91 goes to the GS reverb.
     */
    void setRouting (std::vector<std::pair<int, Route>> strips, std::vector<std::pair<int, Route>> buses, std::vector<int> order, int instrumentReverb);
    /** Samples every bus input is delayed (compensation), for tests. */
    int busDelay (int bus);

    /** Peak and RMS (linear) of a strip, or of the master (index kStrips), and samples above 1. */
    struct Level { double peak = 0, rms = 0; juce::int64 clips = 0; };
    /** Since the last call (for the meters), or since `resetLevels` (for the AI, «last playback»). */
    std::vector<Level> takeMeters (bool sinceReset);
    /**
     * F2.3, the AI's ear: what every strip, bus (key kBusChain + n) and the master (kMasterChain)
     * measured since resetLevels, while the song played.
     */
    std::vector<Analyzer::Result> analysis() { return analyzer.results(); }
    int analysisGaps() const { return analyzer.gaps(); }
    /** The buses' levels (up to the highest in the routing), like the strips'. */
    std::vector<Level> takeBusMeters (bool sinceReset);
    /** Strips in use: one past the highest that has sounded, had a plugin or a mix. */
    int stripsInUse() const { return used.load(); }
    void resetLevels();

    // -------------------------------------------------------------------------
    // Insert effects (F2.2 parte C, 03/11/2026)

    /** One link as Four Hands sends it: its id in the song, kind, plugin (if any), on/off, parameters. */
    struct InsertSpec
    {
        juce::String id, kind, pluginId;
        bool bypass = false;
        std::vector<std::pair<juce::String, double>> params;
    };
    /** Strip -1 (or kStrips) is the master; kBusChain + n, bus n (F2.2 parte D). */
    static constexpr int kMasterChain = kStrips;
    static constexpr int kBusChain = kStrips + 1;
    /**
     * Makes a strip's chain the one given, keeping the links that are already there (same id and
     * kind: a plugin is not loaded again). Returns, per id, what went wrong (a plugin that would not
     * load is left out of the chain). Message thread.
     */
    std::vector<std::pair<juce::String, juce::String>> setChain (int strip, const std::vector<InsertSpec>& specs);
    /** Sum of the chain's latencies, and the latency every track is delayed to (compensation). */
    int chainLatency (int strip) const;
    int compensation() const { return maxLatency.load(); }
    /** How much a compressor or limiter is reducing now, in dB (0 for others or unknown ids). */
    float insertReduction (const juce::String& id) const;
    /** A plugin effect's window. False if it has none, or the id is not a plugin. */
    bool showInsert (const juce::String& id);
    juce::StringArray openInsertWindows() const;
    juce::MemoryBlock insertState (const juce::String& id);
    bool setInsertState (const juce::String& id, const juce::MemoryBlock& data);
    /** A plugin effect's parameters (or an instrument's: `slot` >= 0 and empty id). */
    struct ParamInfo { int index; juce::String name, text, label; float value; };
    std::vector<ParamInfo> parameters (const juce::String& id, int slot = -1);
    /** Sets a parameter by normalised value, or by text ("-6 dB") when `text` is not empty. Returns its text after. */
    juce::String setParameter (const juce::String& id, int slot, int index, float value, const juce::String& text, bool& ok, float* valueAfter = nullptr);

    // -------------------------------------------------------------------------
    // MIDI

    /**
     * Plays `message` on `slot`, `delaySeconds` from now (Four Hands schedules ahead). For the
     * built-in sounds (kSoundsSlot), `strip` is the synth channel it plays on; -1: the message's own
     * MIDI channel (as before A2). Channel 10 in the message still means drums.
     */
    void schedule (int slot, double delaySeconds, const juce::MidiMessage& message, int strip = -1);
    /** All notes off and pedal up in every slot, now. */
    void panic();

    /** F2.2 (04/11/2026): a transport point, `delaySeconds` from now, like the notes. */
    struct TransportPoint { bool playing = false; double ppq = 0, bpm = 120; int num = 4, den = 4; double bar = 0; };
    void scheduleTransport (double delaySeconds, const TransportPoint& point);
    /** What the plugins read now (tests). */
    juce::AudioPlayHead::PositionInfo transportNow() const { return transport.info; }
    /** Does the plugin in this slot read the engine's transport? (tests) */
    bool pluginHasTransport (int slot) const { return slot >= 0 && slot < kSlots && slots[(size_t) slot] != nullptr && slots[(size_t) slot]->getPlayHead() == &transport; }

    // -------------------------------------------------------------------------
    // Offline (tests): renders into `out` as the device would, without a device.

    void prepareOffline (double rate, int block);
    void renderOffline (juce::AudioBuffer<float>& out);

    // AudioIODeviceCallback
    void audioDeviceIOCallbackWithContext (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs, int numSamples, const juce::AudioIODeviceCallbackContext& context) override;
    void audioDeviceAboutToStart (juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;

    /** Blocks processed so far and the largest share of the block budget used (for the log). */
    struct Stats
    {
        juce::int64 blocks = 0;
        double maxLoad = 0, sumLoad = 0;
        int late = 0;
        /** Blocks that took longer than their budget (the audio was cut). */
        int overruns = 0;
        /** What the driver counted as dropouts since the last call (-1: it does not say). */
        int xruns = -1;
        // Where the time goes (09/11/2026), in ms summed over the blocks, and the worst block.
        /** Each strip: its plugin, its effects and its delay line. */
        std::array<double, kStrips> stripSum {}, stripMax {};
        int stripsSeen = 0;
        /** Waiting for the lock the app also takes; the built-in sounds; buses and master; the analysis. */
        double waitSum = 0, waitMax = 0, soundsSum = 0, soundsMax = 0, mixSum = 0, mixMax = 0, analysisSum = 0, analysisMax = 0;
        /** The block budget in ms (block size over sample rate). */
        double budgetMs = 0;
        /** The longest time between two blocks starting, in ms, and blocks that started over twice the budget late. */
        double gapMax = 0;
        int gaps = 0;
    };
    Stats takeStats();

private:
    void changeListenerCallback (juce::ChangeBroadcaster*) override { checkDefaultOutput (false); }
    void timerCallback() override { timerTick(); }
    /** Moves to the system's default output if it is not the one open. `rescan`: ask the system again. */
    void checkDefaultOutput (bool rescan);
    std::function<void (const juce::String&, double)> deviceChanged;
    bool checkingDevice = false;

    struct Pending
    {
        juce::int64 at;
        int slot;
        juce::MidiMessage message;
        int strip = -1;
    };
    /** Grows `used` to cover `strip`. */
    void touch (int strip);

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
    /** The built-in sounds' events of the block, with their strip. */
    std::vector<SynthEvent> soundsEvents;
    std::atomic<int> used { 0 };

    struct Strip { double gain = 1, pan = 0; bool on = true; };
    std::atomic<double> masterGain { 1.0 };
    int lastXRuns = -1;
    struct Meter
    {
        float peak = 0, totalPeak = 0;
        double sum = 0, totalSum = 0;
        juce::int64 count = 0, totalCount = 0, clips = 0;
        void add (const float* L, const float* R, int n);
    };
    std::vector<Strip> mix = std::vector<Strip> ((size_t) kStrips);
    std::vector<Meter> meters = std::vector<Meter> ((size_t) kStrips + 1);
    juce::AudioBuffer<float> strips, sends, master, busIn;
    /** Before parte D's routing arrives: the GS reverb the built-in sounds' CC91 goes to. */
    std::unique_ptr<gs::Reverb> busReverb;
    double busRate = 0;

    // Buses (F2.2 parte D). The routing is built on the message thread and swapped in under the lock.
    struct Edge
    {
        int to = -1; // a bus, or -1: the master
        float level = 1;
        bool pre = false;
        int delay = 0;
        DelayLine line;
    };
    struct Routing
    {
        std::vector<Route> strips = std::vector<Route> ((size_t) kStrips);
        std::vector<Route> buses = std::vector<Route> ((size_t) kBuses);
        std::vector<int> order;
        int instrumentReverb = -1;
        int busesInUse = 0;
        /** Every bus's input from the strips, and the master's, wait for the slowest path. */
        std::vector<int> busInDelay = std::vector<int> ((size_t) kBuses);
        std::vector<DelayLine> busInLines = std::vector<DelayLine> ((size_t) kBuses);
        int masterInDelay = 0;
        DelayLine masterInLine;
        /** Per bus, where its sound goes: its output and its sends. */
        std::vector<std::vector<Edge>> edges = std::vector<std::vector<Edge>> ((size_t) kBuses);
    };
    struct RoutingConfig
    {
        std::vector<std::pair<int, Route>> strips, buses;
        std::vector<int> order;
        int instrumentReverb = -1;
    };
    RoutingConfig routingConfig;
    bool hasRouting = false;
    std::shared_ptr<Routing> routing;
    /** The bus latencies the routing was built with (to rebuild it when one changes). */
    std::vector<int> routedLatency;
    int routedCompensation = -1;
    void rebuildRouting();
    /** F2.3: what the song sounds like, measured off the audio thread. */
    Analyzer analyzer { kStrips + 1 + kBuses, kStrips };
    void ensureAnalysisTaps();
    void analyse (int inUse, int numSamples);
    void mixLegacy (int inUse, int numSamples);
    void mixRouted (Routing& r, int inUse, int numSamples);
    struct BusMix { double gain = 1, pan = 0; bool on = true; };
    std::vector<BusMix> busMix = std::vector<BusMix> ((size_t) kBuses);
    std::vector<Meter> busMeters = std::vector<Meter> ((size_t) kBuses);
    juce::AudioBuffer<float> busBuffers, masterIn, edgeBuffer;

    juce::SpinLock statsLock;
    Stats stats;
    // Audio thread only: the block under way's costs, in ms (added to `stats` at its end).
    std::array<double, kStrips> blockStrip {};
    double blockWait = 0, blockSounds = 0, blockMix = 0, blockAnalysis = 0;
    double lastBlockStart = 0;
    /** Under `lock`: the MIDI channels each slot has been sent something on since the last panic (09/11/2026). */
    std::array<juce::uint16, kAllSlots> channelsSent {};

    // The plugins' transport, and the points still to come.
    Transport transport;
    std::vector<std::pair<juce::int64, TransportPoint>> pendingTransport;
    TransportPoint current;
    void applyTransport (juce::int64 start, int numSamples);

    // Insert effects: one chain per strip and the master's; delay lines for compensation.
    std::array<std::shared_ptr<Chain>, (size_t) kStrips + 1 + kBuses> chains;
    std::vector<DelayLine> delays = std::vector<DelayLine> ((size_t) kStrips);
    std::atomic<int> maxLatency { 0 };
    juce::MidiBuffer noMidi;
    std::shared_ptr<Insert> findInsert (const juce::String& id) const;
    void runChain (Chain& chain, float* L, float* R, int n);
    /** Delay lines long enough for the compensation, for every strip in use (message thread). */
    void ensureDelays();
    void timerTick();
};

} // namespace fh
