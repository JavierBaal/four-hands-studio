#include "SoundFontSynth.h"

#include <cmath>

// TinySoundFont reads SF3 (Ogg Vorbis samples) when stb_vorbis is included before it.
#if defined(_MSC_VER)
#pragma warning(push, 0)
#elif defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wall"
#pragma GCC diagnostic ignored "-Wextra"
#pragma GCC diagnostic ignored "-Wconversion"
#pragma GCC diagnostic ignored "-Wsign-conversion"
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wcast-align"
#pragma GCC diagnostic ignored "-Wfloat-conversion"
#pragma GCC diagnostic ignored "-Wimplicit-fallthrough"
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wunused-variable"
#pragma GCC diagnostic ignored "-Wold-style-cast"
#pragma GCC diagnostic ignored "-Wzero-as-null-pointer-constant"
#pragma GCC diagnostic ignored "-Wuseless-cast"
#pragma GCC diagnostic ignored "-Wredundant-decls"
#pragma GCC diagnostic ignored "-Wswitch-enum"
#pragma GCC diagnostic ignored "-Wmaybe-uninitialized"
#endif
#include "../third_party/stb/stb_vorbis.c"
#define TSF_IMPLEMENTATION
#include "../third_party/tinysoundfont/tsf.h"
#if defined(_MSC_VER)
#pragma warning(pop)
#elif defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

namespace fh
{
namespace
{
/** Voices each channel of a bank can play at once (pedal chords on a piano use many). */
constexpr int kVoices = 96;
/** The SoundFont 2 default modulator: the modulation wheel adds up to 50 cents of vibrato. */
constexpr float kModWheelCents = 50.0f;
constexpr int kDrumChannel = 9;
/**
 * The same loudness as SpessaSynth in the app: measured on Dilatación with MuseScore_General
 * (31/10/2026), TinySoundFont at 0 dB came out 6.3 dB louder all along the song.
 */
constexpr float kGainDb = -6.3f;

/** The SoundFont 2 default curve for volume, expression and velocity: squared (40·log10 dB). */
float squared (int value)
{
    const auto x = juce::jlimit (0, 127, value) / 127.0f;
    return x * x;
}
} // namespace

/** A bank file, and one copy of it per MIDI channel (they share the samples). */
struct SoundFontSynth::Bank
{
    tsf* base = nullptr;
    int offset = 0;
    std::array<tsf*, kChannels> copies {};

    ~Bank()
    {
        for (auto* c : copies)
            if (c != nullptr)
                tsf_close (c);
        if (base != nullptr)
            tsf_close (base);
    }
};

SoundFontSynth::SoundFontSynth()
    : AudioPluginInstance (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
    juce::Reverb::Parameters p;
    p.roomSize = 0.75f;
    p.damping = 0.45f;
    p.wetLevel = 0.5f;
    p.dryLevel = 0.0f;
    p.width = 1.0f;
    reverb.setParameters (p);
}

SoundFontSynth::~SoundFontSynth() = default;

void SoundFontSynth::fillInPluginDescription (juce::PluginDescription& d) const
{
    d.name = getName();
    d.descriptiveName = "Four Hands built-in sounds (SoundFont)";
    d.pluginFormatName = "Internal";
    d.category = "Instrument";
    d.manufacturerName = "Four Hands Studio";
    d.version = "1.0";
    d.fileOrIdentifier = "fourhands:sounds";
    d.uniqueId = 0x46485344; // "FHSD"
    d.isInstrument = true;
    d.numInputChannels = 0;
    d.numOutputChannels = 2;
}

juce::String SoundFontSynth::loadBank (int offset, const juce::File& file, int& presets)
{
    presets = 0;
    const int index = offset == 0 ? 0 : (offset - kFirstOffset) / kOffsetStep + 1;
    if (offset != 0 && (offset < kFirstOffset || (offset - kFirstOffset) % kOffsetStep != 0))
        return "Invalid bank offset: " + juce::String (offset);
    if (index < 0 || index >= kBanks)
        return "Too many sound banks at once";
    if (! file.existsAsFile())
        return "Sound bank not found: " + file.getFullPathName();

    auto bank = std::make_unique<Bank>();
    bank->offset = offset;
    bank->base = tsf_load_filename (file.getFullPathName().toRawUTF8());
    if (bank->base == nullptr)
        return "The sound bank could not be read: " + file.getFileName();
    presets = tsf_get_presetcount (bank->base);
    const auto sampleRate = (int) rate;
    for (int ch = 0; ch < kChannels; ++ch)
    {
        auto* c = tsf_copy (bank->base);
        if (c == nullptr)
            return "Out of memory";
        bank->copies[(size_t) ch] = c;
        tsf_set_output (c, TSF_STEREO_UNWEAVED, sampleRate, kGainDb);
        tsf_set_max_voices (c, kVoices);
        // Every channel the audio thread will touch exists now: nothing is allocated there later.
        if (ch == kDrumChannel)
            tsf_channel_set_presetnumber (c, 0, 0, 1);
        else
            tsf_channel_set_presetindex (c, 0, 0);
        tsf_channel_set_volume (c, 0, squared (100));
    }

    std::unique_ptr<Bank> old;
    {
        const juce::SpinLock::ScopedLockType sl (bankLock);
        old = std::move (banks[(size_t) index]);
        banks[(size_t) index] = std::move (bank);
        // A channel that asked for this bank before it was here gets its preset now.
        for (int ch = 0; ch < kChannels; ++ch)
            choosePreset (ch);
    }
    // The old copy (if any) is released here, out of the audio thread's way.
    return {};
}

int SoundFontSynth::bankCount() const
{
    int n = 0;
    for (auto& b : banks)
        if (b != nullptr)
            ++n;
    return n;
}

tsf* SoundFontSynth::copyFor (int bank, int ch) const
{
    if (bank < 0 || bank >= kBanks || banks[(size_t) bank] == nullptr)
        return nullptr;
    return banks[(size_t) bank]->copies[(size_t) ch];
}

void SoundFontSynth::prepareToPlay (double sampleRate, int maximumBlockSize)
{
    rate = sampleRate;
    voice.setSize (2, 2 * juce::jmax (64, maximumBlockSize), false, true, true);
    send.setSize (2, juce::jmax (64, maximumBlockSize), false, true, true);
    reverb.setSampleRate (sampleRate);
    reverb.reset();
    const juce::SpinLock::ScopedLockType sl (bankLock);
    for (auto& b : banks)
        if (b != nullptr)
            for (auto* c : b->copies)
                tsf_set_output (c, TSF_STEREO_UNWEAVED, (int) sampleRate, kGainDb);
}

// -----------------------------------------------------------------------------
// MIDI

void SoundFontSynth::choosePreset (int ch)
{
    auto& c = channels[(size_t) ch];
    // Where the bank select points: an added bank (20, 30…) or the default one.
    int index = 0;
    int bankNumber = c.bankSelect;
    if (c.bankSelect >= kFirstOffset)
    {
        index = (c.bankSelect - kFirstOffset) / kOffsetStep + 1;
        bankNumber = c.bankSelect - (kFirstOffset + (index - 1) * kOffsetStep);
    }
    auto* copy = copyFor (index, ch);
    if (copy == nullptr)
    {
        // That bank is not loaded: the default bank's General MIDI program, as the app does.
        index = 0;
        bankNumber = 0;
        copy = copyFor (0, ch);
        if (copy == nullptr)
            return;
    }
    bool ok;
    if (ch == kDrumChannel)
        ok = tsf_channel_set_presetnumber (copy, 0, c.program, 1) != 0 || tsf_channel_set_presetnumber (copy, 0, 0, 1) != 0;
    else
        ok = tsf_channel_set_bank_preset (copy, 0, bankNumber, c.program) != 0 || tsf_channel_set_bank_preset (copy, 0, 0, c.program) != 0;
    if (! ok && index != 0)
    {
        index = 0;
        copy = copyFor (0, ch);
        if (copy != nullptr)
            tsf_channel_set_bank_preset (copy, 0, 0, c.program);
    }
    c.bank = index;
}

void SoundFontSynth::applyVolume (int ch)
{
    const auto& c = channels[(size_t) ch];
    const auto gain = squared (c.volume) * squared (c.expression);
    for (int b = 0; b < kBanks; ++b)
        if (auto* copy = copyFor (b, ch))
            tsf_channel_set_volume (copy, 0, gain);
}

void SoundFontSynth::handle (const juce::MidiMessage& m)
{
    const int ch = m.getChannel() - 1;
    if (ch < 0 || ch >= kChannels)
        return;
    auto& c = channels[(size_t) ch];

    if (m.isNoteOn())
    {
        if (auto* copy = copyFor (c.bank, ch))
            tsf_channel_note_on (copy, 0, m.getNoteNumber(), m.getVelocity() / 127.0f);
        return;
    }
    if (m.isNoteOff())
    {
        // Every bank: the note may have started before a program change.
        for (int b = 0; b < kBanks; ++b)
            if (auto* copy = copyFor (b, ch))
                tsf_channel_note_off (copy, 0, m.getNoteNumber());
        return;
    }
    if (m.isProgramChange())
    {
        c.program = m.getProgramChangeNumber();
        choosePreset (ch);
        return;
    }
    if (m.isPitchWheel())
    {
        for (int b = 0; b < kBanks; ++b)
            if (auto* copy = copyFor (b, ch))
                tsf_channel_set_pitchwheel (copy, 0, m.getPitchWheelValue());
        return;
    }
    if (! m.isController())
        return;

    const int cc = m.getControllerNumber();
    const int value = m.getControllerValue();
    switch (cc)
    {
        case 0:
            c.bankSelect = value;
            return;
        case 32:
            return; // bank select LSB: unused, as in the app
        case 7:
            c.volume = value;
            applyVolume (ch);
            return;
        case 11:
            c.expression = value;
            applyVolume (ch);
            return;
        case 91:
            c.reverb = value;
            return;
        case 1:
            for (int b = 0; b < kBanks; ++b)
                if (auto* copy = copyFor (b, ch))
                    copy->modWheelCents = kModWheelCents * value / 127.0f;
            return;
        case 121:
            c.volume = 100;
            c.expression = 127;
            break;
        default:
            break;
    }
    // Pan, sustain pedal, pitch bend range, all notes or sounds off: TinySoundFont knows them.
    for (int b = 0; b < kBanks; ++b)
        if (auto* copy = copyFor (b, ch))
            tsf_channel_midi_control (copy, 0, cc, value);
    if (cc == 121)
        applyVolume (ch);
}

// -----------------------------------------------------------------------------
// Sound

void SoundFontSynth::render (int start, int count)
{
    if (count <= 0)
        return;
    // TinySoundFont writes left then right, one after the other: `voice` is two channels of
    // `count` samples laid out that way in its first channel's memory (sized for it below).
    auto* scratch = voice.getWritePointer (0);
    send.clear (0, count);
    bool anyReverb = false;
    for (int ch = 0; ch < kChannels; ++ch)
    {
        const auto amount = channels[(size_t) ch].reverb / 127.0f;
        for (int b = 0; b < kBanks; ++b)
        {
            auto* copy = copyFor (b, ch);
            if (copy == nullptr || tsf_active_voice_count (copy) == 0)
                continue;
            tsf_render_float (copy, scratch, count, 0);
            for (int side = 0; side < 2; ++side)
            {
                const auto* from = scratch + side * count;
                out->addFrom (juce::jmin (side, out->getNumChannels() - 1), start, from, count);
                if (amount > 0.0f)
                {
                    send.addFrom (side, 0, from, count, amount);
                    anyReverb = true;
                }
            }
        }
    }
    if (anyReverb || reverbTail > 0)
    {
        reverb.processStereo (send.getWritePointer (0), send.getWritePointer (1), count);
        for (int side = 0; side < juce::jmin (2, out->getNumChannels()); ++side)
            out->addFrom (side, start, send, side, 0, count);
        // The reverb keeps ringing a few seconds after its last input.
        reverbTail = anyReverb ? (int) (rate * 4.0) : juce::jmax (0, reverbTail - count);
    }
}

void SoundFontSynth::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    buffer.clear();
    const int numSamples = buffer.getNumSamples();
    // Room for the render, left and right one after the other, and for the reverb's send.
    if (voice.getNumSamples() < 2 * numSamples)
        voice.setSize (2, 2 * numSamples, false, true, true);
    if (send.getNumSamples() < numSamples)
        send.setSize (2, numSamples, false, true, true);

    const juce::SpinLock::ScopedLockType sl (bankLock);
    out = &buffer;
    int done = 0;
    // Each event at its own sample: render up to it, then apply it.
    for (const auto meta : midi)
    {
        const int at = juce::jlimit (0, numSamples, meta.samplePosition);
        render (done, at - done);
        done = juce::jmax (done, at);
        handle (meta.getMessage());
    }
    render (done, numSamples - done);
    out = nullptr;
}

} // namespace fh
