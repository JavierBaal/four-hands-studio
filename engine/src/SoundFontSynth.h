// Four Hands Engine: the built-in sounds (F2.1, Fran 31/10 and 01/11/2026).
//
// The sounds that come with Four Hands (MuseScore_General) and the banks the user adds play here,
// in the engine, like a plugin: everything leaves through the same place and can be exported.
// It plays the same MIDI the window's SoundFont player (SpessaSynth) gets: 16 channels, program
// changes with bank select, and an added bank reached at its bank select offset (20, 30…), as in
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
class SoundFontSynth final : public juce::AudioPluginInstance
{
public:
    static constexpr int kChannels = 16;
    /** The default bank plus the user's banks loaded at once (MAX_EXTRA_BANKS in the app). */
    static constexpr int kBanks = 11;
    static constexpr int kFirstOffset = 20;
    static constexpr int kOffsetStep = 10;
    /** SpessaSynth's voice cap. */
    static constexpr int kVoices = 350;

    SoundFontSynth();
    ~SoundFontSynth() override;

    /**
     * Loads a bank file (off the audio thread; an SF3 takes seconds). `offset` is its bank select
     * offset: 0 for the default bank, 20, 30… for the user's. Returns an error or empty.
     */
    juce::String loadBank (int offset, const juce::File& file, int& presets);

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
    void handle (const juce::MidiMessage& m);
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
};

} // namespace fh
