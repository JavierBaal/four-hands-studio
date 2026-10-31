// Four Hands Engine: the built-in sounds (F2.1, Fran 31/10/2026).
//
// The sounds that come with Four Hands (MuseScore_General) and the banks the user adds play here,
// in the engine, like a plugin: everything leaves through the same place and can be exported.
// It plays the same MIDI the window's SoundFont player (SpessaSynth) gets: 16 channels, program
// changes with bank select, and an added bank is reached at its bank select offset (20, 30…), as
// in audio/engine.ts of the app.
//
// TinySoundFont (MIT) reads the banks; stb_vorbis (MIT or public domain) decodes SF3. What the
// SoundFont 2 standard says and TinySoundFont does not do is added here, so the songs sound as with
// SpessaSynth: volume, expression and velocity on a squared curve, the modulation wheel as vibrato
// (+50 cents), and a reverb send per channel (CC91).
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>
#include <memory>

struct tsf;

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

    SoundFontSynth();
    ~SoundFontSynth() override;

    /**
     * Loads a bank file (message thread or a worker; it takes a while for SF3). `offset` is its
     * bank select offset: 0 for the default bank, 20, 30… for the user's. Returns an error or empty.
     */
    juce::String loadBank (int offset, const juce::File& file, int& presets);

    /** Banks loaded, by offset, for the log. */
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

private:
    struct Bank;
    struct Channel
    {
        int bank = 0;        // the bank where its preset is (index in banks)
        int bankSelect = 0;  // the last CC0 seen
        int program = 0;
        int volume = 100;
        int expression = 127;
        int reverb = 0;
    };

    void handle (const juce::MidiMessage& m);
    void choosePreset (int ch);
    void applyVolume (int ch);
    tsf* copyFor (int bank, int ch) const;
    void render (int start, int count);

    std::array<std::unique_ptr<Bank>, kBanks> banks;
    std::array<Channel, kChannels> channels;
    juce::SpinLock bankLock;

    double rate = 48000.0;
    juce::AudioBuffer<float> voice;   // one channel's sound: left, then right, in its first channel
    juce::AudioBuffer<float> send;    // what goes to the reverb
    juce::AudioBuffer<float>* out = nullptr;
    juce::Reverb reverb;
    int reverbTail = 0;
};

} // namespace fh
