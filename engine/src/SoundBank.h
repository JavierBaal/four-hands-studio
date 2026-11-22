// Four Hands Engine: a SoundFont bank as SoundFont 2 describes it (F2.1, 01/11/2026).
//
// TinySoundFont reads the file and decodes SF3 samples; this keeps, for every pair of preset zone
// and instrument zone, the generators in their own units and the modulators that apply, merged the
// way SpessaSynth merges them (default modulators, instrument, preset). The voices of
// SoundFontSynth play from here, so the built-in sounds come out as they do in the app today.
#pragma once

#include <juce_core/juce_core.h>

#include <array>
#include <cstdint>
#include <vector>

struct tsf;

namespace fh::sf
{
/** SoundFont 2 generators 0 to 60. */
constexpr int kGens = 61;

enum Gen
{
    startAddrsOffset = 0,
    endAddrOffset = 1,
    startloopAddrsOffset = 2,
    endloopAddrsOffset = 3,
    startAddrsCoarseOffset = 4,
    modLfoToPitch = 5,
    vibLfoToPitch = 6,
    modEnvToPitch = 7,
    initialFilterFc = 8,
    initialFilterQ = 9,
    modLfoToFilterFc = 10,
    modEnvToFilterFc = 11,
    endAddrsCoarseOffset = 12,
    modLfoToVolume = 13,
    chorusEffectsSend = 15,
    reverbEffectsSend = 16,
    pan = 17,
    delayModLFO = 21,
    freqModLFO = 22,
    delayVibLFO = 23,
    freqVibLFO = 24,
    delayModEnv = 25,
    attackModEnv = 26,
    holdModEnv = 27,
    decayModEnv = 28,
    sustainModEnv = 29,
    releaseModEnv = 30,
    keyNumToModEnvHold = 31,
    keyNumToModEnvDecay = 32,
    delayVolEnv = 33,
    attackVolEnv = 34,
    holdVolEnv = 35,
    decayVolEnv = 36,
    sustainVolEnv = 37,
    releaseVolEnv = 38,
    keyNumToVolEnvHold = 39,
    keyNumToVolEnvDecay = 40,
    instrument = 41,
    keyRange = 43,
    velRange = 44,
    startloopAddrsCoarseOffset = 45,
    keyNum = 46,
    velocity = 47,
    initialAttenuation = 48,
    endloopAddrsCoarseOffset = 50,
    coarseTune = 51,
    fineTune = 52,
    sampleID = 53,
    sampleModes = 54,
    scaleTuning = 56,
    exclusiveClass = 57,
    overridingRootKey = 58,
};

struct Limit
{
    int min, max, def;
    bool limited;
};

/** Minimum, maximum and default of every generator (SpessaSynth's GeneratorLimits). */
extern const std::array<Limit, kGens> kLimits;

/** A modulator: sources as the SoundFont 2 enums, destination generator, amount, transform. */
struct Modulator
{
    std::uint16_t source = 0;
    std::uint16_t amountSource = 0;
    std::uint16_t transform = 0;
    int destination = 0;
    int amount = 0;
    /** The default reverb and chorus send (CC91, CC93): its amount counts five times (SpessaSynth). */
    bool effect = false;
    /** The default resonance modulator (CC71): it does not change the filter's gain. */
    bool resonant = false;
};

/** Same sources, destination and transform: the amount is not compared (SoundFont 2, 9.5.1). */
bool identical (const Modulator& a, const Modulator& b);

/** The default modulators SpessaSynth uses (the SoundFont 2 ones plus its own), in its order. */
const std::vector<Modulator>& defaultModulators();

struct Sample
{
    const float* data = nullptr;
    int length = 0;     // samples; the end is exclusive
    int loopStart = 0;  // from the sample's start
    int loopEnd = 0;
    int rate = 44100;
    int originalKey = 60;
    int pitchCorrection = 0;
};

/** One preset zone with one instrument zone: what a note in its ranges plays. */
struct Region
{
    std::uint8_t keyLo = 0, keyHi = 127, velLo = 0, velHi = 127;
    std::array<std::int16_t, kGens> gens {};
    std::vector<Modulator> mods;
    int sample = -1;
};

struct Preset
{
    juce::String name;
    int bank = 0;
    int program = 0;
    bool drum = false; // bank 128 (GM and GS drums)
    std::vector<Region> regions;
};

class Bank
{
public:
    Bank() = default;
    ~Bank();
    Bank (const Bank&) = delete;
    Bank& operator= (const Bank&) = delete;

    /** Reads a .sf2 or .sf3 file. Returns an error, or an empty string. */
    juce::String load (const juce::File& file);

    const std::vector<Preset>& presets() const { return presetList; }
    const std::vector<Sample>& samples() const { return sampleList; }

private:
    friend struct BankReader;
    tsf* font = nullptr; // owns the decoded samples
    std::vector<Preset> presetList;
    std::vector<Sample> sampleList;
};

} // namespace fh::sf
