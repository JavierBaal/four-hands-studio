// Four Hands Engine: insert effects (F2.2 part C, 03/11/2026).
//
// A chain per strip (after its sound, before its fader) and one on the master (before its fader).
// Each link is one of Four Hands' own effects (EQ, compressor, limiter: their parameters live in the
// song, Four Hands sends them) or a hosted plugin (VST3). The engine only makes the sound.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>
#include <atomic>
#include <memory>
#include <vector>

namespace fh
{
/** One of Four Hands' own effects. Parameters are set from the message thread (atomics). */
class OwnEffect
{
public:
    virtual ~OwnEffect() = default;
    virtual void prepare (double rate, int block) = 0;
    /**
     * In place, stereo. Bypassed, the sound goes through untouched but still delayed by its
     * latency, so turning it off does not shift the track against the others.
     */
    virtual void process (float* left, float* right, int n, bool bypass) = 0;
    /** False if it has no such parameter. */
    virtual bool setParam (const juce::String& id, double value) = 0;
    virtual int latency() const { return 0; }
    /** How much it is reducing now, in dB (compressor and limiter), for the meters later. */
    virtual float reduction() const { return 0.0f; }
    /** The song's tempo now (the delay's note values follow it). Audio thread, before process. */
    virtual void setTempo (double /*bpm*/) {}
};

/** "eq", "compressor", "limiter", "reverb" or "delay"; null for anything else. */
std::unique_ptr<OwnEffect> makeOwnEffect (const juce::String& kind);

/** A link of a chain: an own effect or a plugin, with its id in the song and whether it is off. */
struct Insert
{
    juce::String id;
    juce::String kind;
    std::unique_ptr<OwnEffect> own;
    std::unique_ptr<juce::AudioPluginInstance> plugin;
    juce::String pluginId;
    std::atomic<bool> bypass { false };
    std::unique_ptr<juce::DocumentWindow> window;

    int latency() const;
};

/** A strip's chain, swapped whole under the engine's lock when it changes. */
struct Chain
{
    std::vector<std::shared_ptr<Insert>> inserts;
    /** Sum of its links' latencies, in samples. */
    int latency = 0;
};

/**
 * A short delay for a strip that has less latency than the slowest one, so every track arrives at
 * the master together (plugin delay compensation). Up to three channels: left, right and the
 * built-in sounds' own reverb send.
 */
class DelayLine
{
public:
    void setSize (int samples);
    int size() const { return length; }
    void process (float* const* channels, int numChannels, int n, int delay);

private:
    std::array<std::vector<float>, 3> buffers;
    int length = 0;
    int write = 0;
};

} // namespace fh
