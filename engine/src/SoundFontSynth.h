// Four Hands Engine: the built-in sounds (F2.1, Fran 31/10 and 01/11/2026).
//
// The sounds that come with Four Hands (MuseScore_General) and the banks the user adds play here,
// in the engine, like a plugin: everything leaves through the same place and can be exported.
// It plays the same MIDI the window's SoundFont player (SpessaSynth) gets: 16 channels, program
// changes with bank select, and an added bank reached at its bank select offset (60, 66…), as in
// audio/engine.ts of the app.
//
// The voices follow SpessaSynth (Apache-2.0) step by step: generators and modulators as SoundFont 2
// describes them, its volume and modulation envelopes, filter, LFOs, pan law, Hermite
// interpolation, and its GS reverb and chorus (GsEffects.h). That is how the songs sound the same
// as in the app (decided with Fran on 31/10/2026, option 1). TinySoundFont (MIT) only reads the
// banks and decodes SF3 (SoundBank.h).
#pragma once

#include "GsEffects.h"
#include "SoundBank.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>
#include <memory>
#include <vector>

namespace fh
{
/** A MIDI message for one of the synth's channels, at a sample of the block (A2). */
struct SynthEvent
{
    int offset = 0;
    int channel = 0;
    juce::MidiMessage message;
};

class SoundFontSynth final : public juce::AudioPluginInstance
{
public:
    /**
     * A2 (03/11/2026): one channel per track strip, numbered by Four Hands (Engine.h, kStrips), so
     * two tracks never share one. A message from MIDI channel 10 makes its channel a drum kit.
     */
    static constexpr int kChannels = 512;
    /** The default bank plus the user's banks loaded at once (MAX_EXTRA_BANKS in the app). */
    static constexpr int kBanks = 11;
    /** The bank selects of the user's banks: 60, 66, 72… (BANK_OFFSET_FIRST and _STEP in the app). */
    static constexpr int kFirstOffset = 60;
    static constexpr int kOffsetStep = 6;
    /** SpessaSynth's voice cap. */
    static constexpr int kVoices = 350;

    SoundFontSynth();
    ~SoundFontSynth() override;

    /**
     * Loads a bank file (off the audio thread; an SF3 takes seconds). `offset` is its bank select
     * offset: 0 for the default bank, 60, 66… for the user's. Returns an error or empty.
     */
    juce::String loadBank (int offset, const juce::File& file, int& presets);

    /**
     * F2.2 (03/11/2026): renders each channel into its own stereo pair (`channelOut[2 ch]`,
     * `[2 ch + 1]`) and its reverb send into `reverbSends[ch]`, for the engine's strips and its
     * Reverb bus. What belongs to no track (the chorus) goes to `master`. Buffers are added to.
     * `events` are in order of `offset`.
     */
    void processSplit (const std::vector<SynthEvent>& events, int numSamples, float* const* channelOut, float* const* reverbSends, float* masterLeft, float* masterRight);

    /** Pedal up and every note released, on every channel (the engine's panic). */
    void releaseAll();

    /** Banks loaded, for the log. */
    int bankCount() const;

    // AudioProcessor
    const juce::String getName() const override { return "Four Hands Sounds"; }
    void fillInPluginDescription (juce::PluginDescription& d) const override;
    void prepareToPlay (double sampleRate, int maximumBlockSize) override;
    void releaseResources() override {}
    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override;
    double getTailLengthSeconds() const override { return 3.0; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    juce::AudioProcessorEditor* createEditor() override { return nullptr; }
    bool hasEditor() const override { return false; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock&) override {}
    void setStateInformation (const void*, int) override {}

    /** A preset that can be chosen: a bank's preset at its bank select (with the bank's offset). */
    struct Choice
    {
        const sf::Preset* preset = nullptr;
        const sf::Bank* bank = nullptr;
        int bankMSB = 0;
        int program = 0;
        bool drum = false;
    };

    struct Voice;
    struct Channel;

private:
    void handle (int ch, const juce::MidiMessage& m);
    void noteOn (int ch, int note, int velocity);
    void noteOff (int ch, int note);
    void controller (int ch, int cc, int value);
    void selectPreset (int ch);
    void stopAll (int ch, bool force);
    void computeAll (int ch, bool isCC, int index);
    Voice& assignVoice();
    void renderVoice (Voice& v, float* left, float* right, int start, int count);
    void render (float* left, float* right, int start, int count);

    std::array<std::shared_ptr<sf::Bank>, kBanks> banks;
    std::shared_ptr<const std::vector<Choice>> choices;
    std::unique_ptr<std::array<Channel, kChannels>> channels;
    std::vector<Voice> voices;
    juce::SpinLock lock;

    double rate = 48000.0;
    double currentTime = 0.0;
    std::vector<float> voiceBuffer, reverbIn, chorusIn;
    std::unique_ptr<gs::Reverb> reverb;
    std::unique_ptr<gs::Chorus> chorus;
    float* const* splitOut = nullptr;
    float* const* splitReverb = nullptr;
};

} // namespace fh
