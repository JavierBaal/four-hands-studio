#include "SoundFontSynth.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace fh
{
using namespace sf;

namespace
{
constexpr int kRes = 16384;        // MODULATOR_RESOLUTION
constexpr int kBlock = 128;        // what the app's worklet renders at once (maxBufferSize)
constexpr int kMinCb = -16600;     // MIN_CENTIBELS
constexpr int kMaxCb = 16000;
constexpr double kGainFactor = 0.6; // SPESSASYNTH_GAIN_FACTOR
constexpr double kMinNoteLength = 0.03;
constexpr double kMinExclusiveLength = 0.07;
constexpr int kExclusiveCutoff = -2320;
constexpr double kCbSilence = 960, kPerceivedCbSilence = 900;
constexpr int kDrumChannel = 9;
constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr double kPi = 3.14159265358979323846;

enum Curve { linearCurve = 0, concaveCurve = 1, convexCurve = 2, switchCurve = 3 };

struct Tables
{
    std::vector<float> transforms;
    std::vector<float> centibels;
    std::array<float, 1001> panLeft {}, panRight {};
    std::array<float, 1000> convexAttack {};
    std::vector<float> concave, convex;

    Tables() : concave (kRes + 1, 0.0f), convex (kRes + 1, 0.0f)
    {
        // modulator_curves.ts, with its loop bounds as they are.
        concave[kRes] = 1;
        convex[kRes] = 1;
        for (int i = 1; i < kRes - 1; ++i)
        {
            const double x = -400.0 / 960.0 * std::log ((double) i / kRes) / std::log (10.0);
            convex[(size_t) i] = (float) (1 - x);
            concave[(size_t) (kRes - i)] = (float) x;
        }
        transforms.resize ((size_t) kRes * 16);
        for (int curve = 0; curve < 4; ++curve)
            for (int tt = 0; tt < 4; ++tt)
                for (int v = 0; v < kRes; ++v)
                    transforms[(size_t) (kRes * (curve * 4 + tt) + v)] = curveValue (tt, curve, (double) v / kRes);
        centibels.resize ((size_t) (kMaxCb - kMinCb + 1));
        for (size_t i = 0; i < centibels.size(); ++i)
            centibels[i] = (float) std::pow (10.0, -(kMinCb + (double) i) / 200.0);
        for (int pan = -500; pan <= 500; ++pan)
        {
            const double real = (pan + 500) / 1000.0;
            panLeft[(size_t) (pan + 500)] = (float) std::cos (kPi / 2 * real);
            panRight[(size_t) (pan + 500)] = (float) std::sin (kPi / 2 * real);
        }
        for (int i = 0; i < 1000; ++i)
            convexAttack[(size_t) i] = curveValue (0, convexCurve, i / 1000.0);
    }

    float curveValue (int transformType, int curveType, double value) const
    {
        const bool bipolar = (transformType & 2) != 0;
        if ((transformType & 1) != 0)
            value = 1 - value;
        switch (curveType)
        {
            case linearCurve:
                return (float) (bipolar ? value * 2 - 1 : value);
            case switchCurve:
                value = value > 0.5 ? 1 : 0;
                return (float) (bipolar ? value * 2 - 1 : value);
            case concaveCurve:
            case convexCurve:
            {
                const auto& table = curveType == concaveCurve ? concave : convex;
                if (bipolar)
                {
                    value = value * 2 - 1;
                    if (value < 0)
                        return -table[(size_t) std::trunc (value * -kRes)];
                    return table[(size_t) std::trunc (value * kRes)];
                }
                return table[(size_t) std::trunc (value * kRes)];
            }
            default:
                return 0;
        }
    }
};

const Tables& tables()
{
    static const Tables t;
    return t;
}

float cbToGain (double cb)
{
    const auto& t = tables().centibels;
    const auto i = juce::jlimit (0, (int) t.size() - 1, (int) (cb - kMinCb));
    return t[(size_t) i];
}

double timecentsToSeconds (double tc)
{
    return tc <= -32767 ? 0.0 : std::pow (2.0, tc / 1200.0);
}

double absCentsToHz (double cents)
{
    return 440.0 * std::pow (2.0, (cents - 6900) / 1200.0);
}

std::int16_t toInt16 (double v)
{
    return (std::int16_t) juce::jlimit (-32768.0, 32767.0, std::trunc (v));
}

/** DEFAULT_MIDI_CONTROLLERS in SpessaSynth (14-bit values). */
std::array<int, 128> defaultControllers()
{
    std::array<int, 128> cc {};
    auto set = [&] (int i, int v) { cc[(size_t) i] = v << 7; };
    set (7, 100);
    set (8, 64);
    set (11, 127);
    set (10, 64);
    for (int i : { 71, 72, 73, 74, 75, 76, 77, 78, 81, 83 })
        set (i, 64);
    set (100, 127);
    set (101, 127);
    return cc;
}
} // namespace

// -----------------------------------------------------------------------------
// Envelopes and filter (volume_envelope.ts, modulation_envelope.ts, lowpass_filter.ts)

namespace
{
struct VolEnv
{
    double outputGain = 0, attenuationCb = kCbSilence;
    int state = 0;
    juce::int64 sampleTime = 0, releaseStartTimeSamples = 0;
    double releaseStartCb = kCbSilence;
    double attackDuration = 0, decayDuration = 0, releaseDuration = 0, sustainCb = 0;
    double delayEnd = 0, attackEnd = 0, holdEnd = 0, decayEnd = 0;
    bool enteredRelease = false, canEndOnSilentSustain = false;
};

struct ModEnv
{
    double attackDuration = 0, decayDuration = 0, holdDuration = 0, releaseDuration = 0, sustainLevel = 0;
    double delayEnd = 0, attackEnd = 0, holdEnd = 0, decayEnd = 0, releaseStartLevel = 0, currentValue = 0;
    bool enteredRelease = false;
};

struct Filter
{
    double a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    double lastTargetCutoff = kInf, currentInitialFc = 13500;
    int resonanceCb = 0;
    bool initialized = false;

    void init() { *this = Filter(); }

    void calculate (double cutoffCents, double sampleRate)
    {
        const int cents = (int) cutoffCents;
        const int qCb = resonanceCb;
        const double cutoffHz = std::fmin (absCentsToHz (cents), sampleRate * 0.45);
        const double resonanceGain = cbToGain (-(qCb - 3.01));
        const double qGain = 1 / std::sqrt ((double) cbToGain (-qCb));
        const double w = 2 * kPi * cutoffHz / sampleRate;
        const double cosw = std::cos (w);
        const double alpha = std::sin (w) / (2 * resonanceGain);
        const double b1 = (1 - cosw) * qGain, b0 = b1 / 2, b2 = b0;
        const double A0 = 1 + alpha, A1 = -2 * cosw, A2 = 1 - alpha;
        a0 = b0 / A0;
        a1 = b1 / A0;
        a2 = b2 / A0;
        a3 = A1 / A0;
        a4 = A2 / A0;
    }
};
} // namespace

struct SoundFontSynth::Voice
{
    bool active = false, inRelease = false, held = false, rendered = false;
    int channel = 0, midiNote = 0, targetKey = 0, velocity = 0, rootKey = 60, exclusiveClass = 0, loopingMode = 0;
    std::uint32_t noteID = 0;
    const Region* region = nullptr;
    const Bank* bank = nullptr;
    std::array<std::int16_t, kGens> mg {};
    std::array<std::int16_t, 256> modValues {};
    double startTime = 0, releaseStartTime = kInf;
    double resonanceOffset = 0;
    int overrideReleaseVolEnv = 0;
    // Wavetable (Hermite)
    const float* data = nullptr;
    double cursor = 0, playbackStep = 1;
    int end = 0, loopStart = 0, loopEnd = 0, loopLength = 0;
    bool looping = false;
    int tuningCents = 0;
    double tuningRatio = 1;
    double vibPhase = 0.25, modPhase = 0.25, vibStart = 0, modStart = 0;
    double currentPan = 0, reverbSend = 1, chorusSend = 1;
    VolEnv volEnv;
    ModEnv modEnv;
    Filter filter;

    int modCount() const { return juce::jmin ((int) region->mods.size(), (int) modValues.size()); }
};

struct SoundFontSynth::Channel
{
    std::array<int, 128> cc = defaultControllers();
    int program = 0, bankMSB = 0;
    bool drum = false;
    const Choice* preset = nullptr;
    int pitchWheel = 8192;
    double pitchRange = 2;
    int pressure = 0;
    std::array<std::uint32_t, 128> noteOnID {}, noteOffID {};
};

namespace
{
using Voice = SoundFontSynth::Voice;
using Channel = SoundFontSynth::Channel;

float sourceValue (std::uint16_t src, const Channel& c, const Voice& v)
{
    const bool isCC = (src & 0x80) != 0;
    const int index = src & 0x7F;
    const int curve = (src >> 10) & 3;
    const int tt = (((src >> 9) & 1) << 1) | ((src >> 8) & 1);
    int raw;
    if (isCC)
        raw = c.cc[(size_t) index];
    else
        switch (index)
        {
            case 2: raw = v.velocity << 7; break;
            case 3: raw = v.targetKey << 7; break;
            case 10: raw = 0; break; // poly pressure
            case 13: raw = c.pressure << 7; break;
            case 14: raw = c.pitchWheel; break;
            case 16: raw = (int) std::floor (c.pitchRange * 128); break;
            default: raw = 16383; break;
        }
    raw = juce::jlimit (0, kRes - 1, raw);
    return tables().transforms[(size_t) (kRes * (curve * 4 + tt) + raw)];
}

double computeModulator (Voice& v, const Channel& c, int i)
{
    const auto& m = v.region->mods[(size_t) i];
    if (m.amount == 0)
    {
        v.modValues[(size_t) i] = 0;
        return 0;
    }
    const double s1 = sourceValue (m.source, c, v), s2 = sourceValue (m.amountSource, c, v);
    double amount = m.amount;
    if (m.effect && amount <= 1e3)
        amount = std::fmin (amount * 5.0, 1e3);
    double value = s1 * s2 * amount;
    if (m.transform == 2)
        value = std::fabs (value);
    if (m.resonant)
        v.resonanceOffset = std::fmax (0.0, value / 2);
    v.modValues[(size_t) i] = toInt16 (value);
    return value;
}

void computeModulatorsFull (Voice& v, const Channel& c)
{
    v.mg = v.region->gens;
    const int n = v.modCount();
    for (int i = 0; i < n; ++i)
    {
        const int d = v.region->mods[(size_t) i].destination;
        v.mg[(size_t) d] = toInt16 (juce::jlimit (-32768.0, 32767.0, v.mg[(size_t) d] + computeModulator (v, c, i)));
    }
    for (int g = 0; g < kGens; ++g)
        if (kLimits[(size_t) g].limited)
            v.mg[(size_t) g] = (std::int16_t) juce::jlimit (kLimits[(size_t) g].min, kLimits[(size_t) g].max, (int) v.mg[(size_t) g]);
}

void computeModulatorsFor (Voice& v, const Channel& c, bool isCC, int index)
{
    auto uses = [&] (std::uint16_t src) { return ((src & 0x80) != 0) == isCC && (src & 0x7F) == index; };
    const int n = v.modCount();
    for (int i = 0; i < n; ++i)
    {
        const auto& m = v.region->mods[(size_t) i];
        if (! uses (m.source) && ! uses (m.amountSource))
            continue;
        const int d = m.destination;
        int out = v.region->gens[(size_t) d];
        computeModulator (v, c, i);
        for (int j = 0; j < n; ++j)
            if (v.region->mods[(size_t) j].destination == d)
                out += v.modValues[(size_t) j];
        const auto& l = kLimits[(size_t) d];
        v.mg[(size_t) d] = (std::int16_t) (l.limited ? juce::jlimit (l.min, l.max, out) : juce::jlimit (-32768, 32767, out));
    }
}

juce::int64 timecentsToSamples (double tc, double sampleRate)
{
    return juce::jmax ((juce::int64) 0, (juce::int64) std::floor (timecentsToSeconds (tc) * sampleRate));
}

void volEnvInit (Voice& v, double sampleRate)
{
    auto& e = v.volEnv;
    const auto& mg = v.mg;
    e.enteredRelease = false;
    e.state = 0;
    e.sampleTime = 0;
    e.outputGain = 0;
    e.attenuationCb = kCbSilence;
    e.releaseStartCb = kCbSilence;
    e.releaseStartTimeSamples = 0;
    e.releaseDuration = 0;
    e.canEndOnSilentSustain = mg[sustainVolEnv] >= kPerceivedCbSilence;
    e.sustainCb = std::fmin (kCbSilence, (double) mg[sustainVolEnv]);
    e.attackDuration = (double) timecentsToSamples (mg[attackVolEnv], sampleRate);
    const double keyNumAddition = (60 - v.targetKey) * mg[keyNumToVolEnvDecay];
    const double fraction = e.sustainCb / kCbSilence;
    e.decayDuration = (double) timecentsToSamples (mg[decayVolEnv] + keyNumAddition, sampleRate) * fraction;
    e.delayEnd = (double) timecentsToSamples (mg[delayVolEnv], sampleRate);
    e.attackEnd = e.attackDuration + e.delayEnd;
    const double holdExcursion = (60 - v.targetKey) * mg[keyNumToVolEnvHold];
    e.holdEnd = (double) timecentsToSamples (mg[holdVolEnv] + holdExcursion, sampleRate) + e.attackEnd;
    e.decayEnd = e.decayDuration + e.holdEnd;
    if (e.attackEnd <= kBlock)
        e.state = 2;
}

void volEnvStartRelease (Voice& v, double sampleRate)
{
    auto& e = v.volEnv;
    const auto& mg = v.mg;
    e.releaseStartTimeSamples = e.sampleTime;
    const double timecents = v.overrideReleaseVolEnv != 0 ? v.overrideReleaseVolEnv : mg[releaseVolEnv];
    e.releaseDuration = (double) timecentsToSamples (std::fmax (-7200.0, timecents), sampleRate);
    if (e.enteredRelease)
        e.releaseStartCb = e.attenuationCb;
    else
    {
        const double sustainCb = juce::jlimit (0.0, kCbSilence, e.sustainCb);
        const double fraction = sustainCb / kCbSilence;
        const double keyNumAddition = (60 - v.targetKey) * mg[keyNumToVolEnvDecay];
        e.decayDuration = (double) timecentsToSamples (mg[decayVolEnv] + keyNumAddition, sampleRate) * fraction;
        switch (e.state)
        {
            case 0: e.releaseStartCb = kCbSilence; break;
            case 1:
            {
                const double elapsed = 1 - (e.attackEnd - (double) e.releaseStartTimeSamples) / e.attackDuration;
                e.releaseStartCb = 200 * std::log10 (elapsed) * -1;
                break;
            }
            case 2: e.releaseStartCb = 0; break;
            case 3: e.releaseStartCb = (1 - (e.decayEnd - (double) e.releaseStartTimeSamples) / e.decayDuration) * sustainCb; break;
            case 4: e.releaseStartCb = sustainCb; break;
            default: break;
        }
        if (std::isnan (e.releaseStartCb))
            e.releaseStartCb = kCbSilence;
        e.releaseStartCb = juce::jlimit (0.0, kCbSilence, e.releaseStartCb);
        e.attenuationCb = e.releaseStartCb;
    }
    e.enteredRelease = true;
    e.releaseDuration *= (kCbSilence - e.releaseStartCb) / kCbSilence;
    if (e.releaseStartCb >= kPerceivedCbSilence)
        v.active = false;
}

/** Returns whether the voice still sounds. */
bool volEnvProcess (VolEnv& e, int sampleCount, double gainTarget)
{
    const auto sampleTime = (double) (e.sampleTime += sampleCount);
    if (e.enteredRelease)
    {
        const double elapsed = sampleTime - (double) e.releaseStartTimeSamples;
        e.attenuationCb = (e.releaseDuration > 0 ? elapsed / e.releaseDuration : kInf) * (kCbSilence - e.releaseStartCb) + e.releaseStartCb;
        if (! std::isfinite (e.attenuationCb))
            e.attenuationCb = kCbSilence;
        e.outputGain = cbToGain (e.attenuationCb) * gainTarget;
        return e.attenuationCb < kPerceivedCbSilence;
    }
    switch (e.state)
    {
        case 0:
            if (sampleTime < e.delayEnd)
            {
                e.attenuationCb = kCbSilence;
                e.outputGain = 0;
                return true;
            }
            e.state++;
            [[fallthrough]];
        case 1:
            if (sampleTime < e.attackEnd)
            {
                e.attenuationCb = 0;
                e.outputGain = (1 - (e.attackEnd - sampleTime) / e.attackDuration) * gainTarget;
                return true;
            }
            e.state++;
            [[fallthrough]];
        case 2:
            if (sampleTime < e.holdEnd)
            {
                e.attenuationCb = 0;
                e.outputGain = gainTarget;
                return true;
            }
            e.state++;
            [[fallthrough]];
        case 3:
            if (sampleTime < e.decayEnd)
            {
                e.attenuationCb = (1 - (e.decayEnd - sampleTime) / e.decayDuration) * e.sustainCb;
                e.outputGain = gainTarget * cbToGain (e.attenuationCb);
                return true;
            }
            e.state++;
            [[fallthrough]];
        default:
            if (e.canEndOnSilentSustain && e.sustainCb >= kPerceivedCbSilence)
            {
                e.attenuationCb = kCbSilence;
                e.outputGain = 0;
                return false;
            }
            e.attenuationCb = e.sustainCb;
            e.outputGain = gainTarget * cbToGain (e.sustainCb);
            return true;
    }
}

double modEnvSeconds (double tc)
{
    return tc <= -10114 ? 0.0 : timecentsToSeconds (tc);
}

void modEnvInit (Voice& v)
{
    auto& e = v.modEnv;
    const auto& mg = v.mg;
    e.enteredRelease = false;
    e.sustainLevel = 1 - mg[sustainModEnv] / 1e3;
    e.attackDuration = modEnvSeconds (mg[attackModEnv]);
    const double decayTime = modEnvSeconds (mg[decayModEnv] + (60 - v.targetKey) * mg[keyNumToModEnvDecay]);
    e.decayDuration = decayTime * (1 - e.sustainLevel);
    e.holdDuration = modEnvSeconds ((60 - v.targetKey) * mg[keyNumToModEnvHold] + mg[holdModEnv]);
    e.delayEnd = v.startTime + modEnvSeconds (mg[delayModEnv]);
    e.attackEnd = e.delayEnd + e.attackDuration;
    e.holdEnd = e.attackEnd + e.holdDuration;
    e.decayEnd = e.holdEnd + e.decayDuration;
}

double modEnvProcess (Voice& v, double now)
{
    auto& e = v.modEnv;
    if (e.enteredRelease)
    {
        if (e.releaseStartLevel == 0)
            return 0;
        return std::fmax (0.0, (1 - (now - v.releaseStartTime) / e.releaseDuration) * e.releaseStartLevel);
    }
    if (now < e.delayEnd)
        e.currentValue = 0;
    else if (now < e.attackEnd)
        e.currentValue = tables().convexAttack[(size_t) juce::jlimit (0, 999, (int) ((1 - (e.attackEnd - now) / e.attackDuration) * 1e3))];
    else if (now < e.holdEnd)
        e.currentValue = 1;
    else if (now < e.decayEnd)
        e.currentValue = (1 - (e.decayEnd - now) / e.decayDuration) * (e.sustainLevel - 1) + 1;
    else
        e.currentValue = e.sustainLevel;
    return e.currentValue;
}

void modEnvStartRelease (Voice& v)
{
    auto& e = v.modEnv;
    e.releaseStartLevel = e.currentValue;
    e.enteredRelease = true;
    e.releaseDuration = modEnvSeconds (std::fmax ((double) v.mg[releaseModEnv], -7200.0)) * e.releaseStartLevel;
}

void releaseVoice (Voice& v, double now, double minLength = kMinNoteLength)
{
    v.releaseStartTime = now;
    if (v.releaseStartTime - v.startTime < minLength)
        v.releaseStartTime = v.startTime + minLength;
}

/** Hermite interpolation (HermiteOscillator). Returns false when a sample that does not loop ends. */
bool oscillate (Voice& v, int count, float* out)
{
    const double step = v.tuningRatio * v.playbackStep;
    const float* d = v.data;
    double cursor = v.cursor;
    if (v.looping)
    {
        const int loopEnd = v.loopEnd, loopLength = v.loopLength;
        for (int i = 0; i < count; ++i)
        {
            while (cursor >= loopEnd)
                cursor -= loopLength;
            const int y0 = (int) cursor;
            int y1 = y0 + 1, y2 = y0 + 2, y3 = y0 + 3;
            const double t = cursor - y0;
            while (y1 >= loopEnd) y1 -= loopLength;
            while (y2 >= loopEnd) y2 -= loopLength;
            while (y3 >= loopEnd) y3 -= loopLength;
            const double xm1 = d[y0], x0 = d[y1], x1 = d[y2], x2 = d[y3];
            const double c = (x1 - xm1) * 0.5, vv = x0 - x1, w = c + vv, a = w + vv + (x2 - x0) * 0.5, b = w + a;
            out[i] = (float) (((a * t - b) * t + c) * t + x0);
            cursor += step;
        }
    }
    else
    {
        for (int i = 0; i < count; ++i)
        {
            const int y0 = (int) cursor;
            const double t = cursor - y0;
            if (y0 + 3 >= v.end)
            {
                std::fill (out + i, out + count, 0.0f);
                return false;
            }
            const double xm1 = d[y0], x0 = d[y0 + 1], x1 = d[y0 + 2], x2 = d[y0 + 3];
            const double c = (x1 - xm1) * 0.5, vv = x0 - x1, w = c + vv, a = w + vv + (x2 - x0) * 0.5, b = w + a;
            out[i] = (float) (((a * t - b) * t + c) * t + x0);
            cursor += step;
        }
    }
    v.cursor = cursor;
    return true;
}
} // namespace

// -----------------------------------------------------------------------------

SoundFontSynth::SoundFontSynth()
    : AudioPluginInstance (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      choices (std::make_shared<const std::vector<Choice>>()),
      channels (std::make_unique<std::array<Channel, kChannels>>()),
      voices ((size_t) kVoices)
{
    (*channels)[kDrumChannel].drum = true;
    tables();
    prepareToPlay (48000.0, 512);
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

void SoundFontSynth::prepareToPlay (double sampleRate, int)
{
    const juce::SpinLock::ScopedLockType sl (lock);
    if (reverb != nullptr && sampleRate == rate)
        return;
    rate = sampleRate;
    voiceBuffer.assign (kBlock, 0.0f);
    reverbIn.assign (kBlock, 0.0f);
    chorusIn.assign (kBlock, 0.0f);
    reverb = std::make_unique<gs::Reverb> (rate);
    chorus = std::make_unique<gs::Chorus> (rate);
    for (auto& v : voices)
        v.active = false;
}

// -----------------------------------------------------------------------------
// Banks and presets

juce::String SoundFontSynth::loadBank (int offset, const juce::File& file, int& presets)
{
    presets = 0;
    if (offset != 0 && (offset < kFirstOffset || (offset - kFirstOffset) % kOffsetStep != 0))
        return "Invalid bank offset: " + juce::String (offset);
    const int index = offset == 0 ? 0 : (offset - kFirstOffset) / kOffsetStep + 1;
    if (index >= kBanks)
        return "Too many sound banks at once";
    if (! file.existsAsFile())
        return "Sound bank not found: " + file.getFullPathName();
    auto bank = std::make_shared<Bank>();
    const auto problem = bank->load (file);
    if (problem.isNotEmpty())
        return problem;
    presets = (int) bank->presets().size();

    // The new list of presets is made here; only the swap happens with the audio thread waiting.
    auto next = banks;
    next[(size_t) index] = bank;
    std::vector<Choice> list;
    for (int b = 0; b < kBanks; ++b)
    {
        if (next[(size_t) b] == nullptr)
            continue;
        const int bankOffset = b == 0 ? 0 : kFirstOffset + (b - 1) * kOffsetStep;
        for (const auto& p : next[(size_t) b]->presets())
        {
            Choice c { &p, next[(size_t) b].get(), p.drum ? 128 : p.bank + bankOffset, p.program, p.drum };
            const bool seen = std::any_of (list.begin(), list.end(), [&] (const Choice& x) { return x.drum == c.drum && x.program == c.program && x.bankMSB == c.bankMSB; });
            if (! seen)
                list.push_back (c);
        }
    }
    std::stable_sort (list.begin(), list.end(), [] (const Choice& a, const Choice& b) {
        if (a.drum != b.drum)
            return ! a.drum;
        if (a.program != b.program)
            return a.program < b.program;
        return a.bankMSB < b.bankMSB;
    });
    auto shared = std::make_shared<const std::vector<Choice>> (std::move (list));

    std::shared_ptr<Bank> old;
    std::shared_ptr<const std::vector<Choice>> oldChoices;
    {
        const juce::SpinLock::ScopedLockType sl (lock);
        old = banks[(size_t) index];
        banks = next;
        oldChoices = choices;
        choices = shared;
        // Voices of a bank that goes away stop; every channel looks for its preset again.
        if (old != nullptr)
            for (auto& v : voices)
                if (v.active && v.bank == old.get())
                    v.active = false;
        for (int ch = 0; ch < kChannels; ++ch)
            selectPreset (ch);
    }
    // `old` and `oldChoices` are released here, out of the audio thread's way.
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

void SoundFontSynth::selectPreset (int ch)
{
    auto& c = (*channels)[(size_t) ch];
    const auto& list = *choices;
    c.preset = nullptr;
    if (list.empty())
        return;
    auto find = [&] (auto pred) -> const Choice* {
        for (const auto& x : list)
            if (pred (x))
                return &x;
        return nullptr;
    };
    // MIDIPatchTools.selectPatch, GS: the exact preset, else the same program in any bank, else the first.
    if (c.drum)
    {
        c.preset = find ([&] (const Choice& x) { return x.drum && x.program == c.program; });
        if (c.preset == nullptr)
            c.preset = find ([] (const Choice& x) { return x.drum; });
        return;
    }
    c.preset = find ([&] (const Choice& x) { return ! x.drum && x.program == c.program && x.bankMSB == c.bankMSB; });
    if (c.preset == nullptr)
        c.preset = find ([&] (const Choice& x) { return ! x.drum && x.program == c.program; });
    if (c.preset == nullptr)
        c.preset = &list.front();
}

// -----------------------------------------------------------------------------
// MIDI

void SoundFontSynth::handle (const juce::MidiMessage& m)
{
    const int ch = m.getChannel() - 1;
    if (ch < 0 || ch >= kChannels)
        return;
    auto& c = (*channels)[(size_t) ch];
    if (m.isNoteOn())
        noteOn (ch, m.getNoteNumber(), m.getVelocity());
    else if (m.isNoteOff())
        noteOff (ch, m.getNoteNumber());
    else if (m.isProgramChange())
    {
        c.program = m.getProgramChangeNumber();
        selectPreset (ch);
    }
    else if (m.isPitchWheel())
    {
        c.pitchWheel = m.getPitchWheelValue();
        computeAll (ch, false, 14);
    }
    else if (m.isChannelPressure())
    {
        c.pressure = m.getChannelPressureValue();
        computeAll (ch, false, 13);
    }
    else if (m.isController())
        controller (ch, m.getControllerNumber(), m.getControllerValue());
}

void SoundFontSynth::computeAll (int ch, bool isCC, int index)
{
    const auto& c = (*channels)[(size_t) ch];
    for (auto& v : voices)
        if (v.active && v.channel == ch)
            computeModulatorsFor (v, c, isCC, index);
}

void SoundFontSynth::controller (int ch, int cc, int value)
{
    auto& c = (*channels)[(size_t) ch];
    if (cc >= 33 && cc <= 63)
    {
        const int msb = cc - 32;
        c.cc[(size_t) msb] = (c.cc[(size_t) msb] & 16256) | (value & 127);
        computeAll (ch, true, msb);
    }
    c.cc[(size_t) cc] = (value << 7) | (c.cc[(size_t) cc] & 127);
    switch (cc)
    {
        case 0:
            c.bankMSB = value;
            return;
        case 32:
            return;
        case 64:
            if (value < 64)
                for (auto& v : voices)
                    if (v.active && v.channel == ch && v.held)
                    {
                        v.held = false;
                        releaseVoice (v, currentTime);
                    }
            break;
        case 120:
            stopAll (ch, true);
            break;
        case 123:
        case 124:
        case 125:
            stopAll (ch, false);
            break;
        case 121:
        {
            // Reset all controllers (RP-15): what a reset puts back, then every voice recomputed.
            const auto defaults = defaultControllers();
            for (int i : { 1, 2, 4, 11, 64, 65, 66, 67, 68, 69 })
                c.cc[(size_t) i] = defaults[(size_t) i];
            c.pitchWheel = 8192;
            c.pressure = 0;
            for (auto& v : voices)
                if (v.active && v.channel == ch)
                    computeModulatorsFull (v, c);
            return;
        }
        case 6:
        case 38:
            // Data entry for RPN 0, the pitch wheel's range.
            if ((c.cc[101] >> 7) == 0 && (c.cc[100] >> 7) == 0)
            {
                c.pitchRange = (c.cc[6] >> 7) + (c.cc[6] & 127) / 100.0;
                computeAll (ch, false, 16);
            }
            return;
        default:
            break;
    }
    computeAll (ch, true, cc);
}

void SoundFontSynth::stopAll (int ch, bool force)
{
    auto& c = (*channels)[(size_t) ch];
    c.noteOnID.fill (0);
    c.noteOffID.fill (0);
    for (auto& v : voices)
        if (v.active && v.channel == ch)
        {
            if (force)
                v.active = false;
            else
                releaseVoice (v, currentTime);
        }
}

SoundFontSynth::Voice& SoundFontSynth::assignVoice()
{
    for (auto& v : voices)
        if (! v.active)
            return v;
    // All busy: the one that matters least (in release, then the quietest).
    Voice* lowest = &voices.front();
    double lowestPriority = kInf;
    for (auto& v : voices)
    {
        const double priority = (v.inRelease ? 0.0 : 10.0) - v.volEnv.attenuationCb / 200;
        if (priority < lowestPriority)
        {
            lowestPriority = priority;
            lowest = &v;
        }
    }
    return *lowest;
}

void SoundFontSynth::noteOn (int ch, int note, int velocity)
{
    if (velocity < 1)
    {
        noteOff (ch, note);
        return;
    }
    auto& c = (*channels)[(size_t) ch];
    if (c.preset == nullptr || note < 0 || note > 127)
        return;
    double reverbSend = 1, chorusSend = 1;
    if (c.drum)
    {
        // DEFAULT_DRUM_REVERB: the kicks are dry; GS drums get no chorus.
        reverbSend = (note == 35 || note == 36) ? 0 : 1;
        chorusSend = 0;
    }
    const auto noteID = c.noteOnID[(size_t) note]++;
    const auto& preset = *c.preset->preset;
    const auto& samples = c.preset->bank->samples();
    for (const auto& r : preset.regions)
    {
        if (note < r.keyLo || note > r.keyHi || velocity < r.velLo || velocity > r.velHi)
            continue;
        const auto& sample = samples[(size_t) r.sample];
        if (sample.data == nullptr || sample.length < 4)
            continue;
        auto& v = assignVoice();
        // Voice.setup
        v.active = true;
        v.inRelease = false;
        v.rendered = false;
        v.held = false;
        v.releaseStartTime = kInf;
        v.overrideReleaseVolEnv = 0;
        v.tuningCents = 0;
        v.tuningRatio = 1;
        v.vibPhase = 0.25;
        v.modPhase = 0.25;
        v.startTime = currentTime;
        v.channel = ch;
        v.midiNote = note;
        v.noteID = noteID;
        v.resonanceOffset = 0;
        // CachedVoice
        v.region = &r;
        v.bank = c.preset->bank;
        v.rootKey = r.gens[overridingRootKey] > -1 ? r.gens[overridingRootKey] : sample.originalKey;
        v.targetKey = r.gens[keyNum] > -1 ? r.gens[keyNum] : note;
        v.velocity = r.gens[sf::velocity] > -1 ? r.gens[sf::velocity] : velocity;
        v.exclusiveClass = r.gens[sf::exclusiveClass];
        v.loopingMode = r.gens[sampleModes];
        v.data = sample.data;
        v.playbackStep = sample.rate / rate * std::pow (2.0, sample.pitchCorrection / 1200.0);

        if (v.exclusiveClass != 0)
            for (auto& o : voices)
                if (&o != &v && o.active && o.channel == ch && o.exclusiveClass == v.exclusiveClass && o.rendered)
                {
                    o.overrideReleaseVolEnv = kExclusiveCutoff;
                    o.inRelease = false;
                    releaseVoice (o, currentTime, kMinExclusiveLength);
                }

        computeModulatorsFull (v, c);
        volEnvInit (v, rate);
        modEnvInit (v);
        v.filter.init();
        v.vibStart = currentTime + timecentsToSeconds (v.mg[delayVibLFO]);
        v.modStart = currentTime + timecentsToSeconds (v.mg[delayModLFO]);
        const auto& mg = v.mg;
        const int cursorStart = mg[startAddrsOffset] + mg[startAddrsCoarseOffset] * 32768;
        const int endOffset = mg[endAddrOffset] + mg[endAddrsCoarseOffset] * 32768;
        const int loopStartOffset = mg[startloopAddrsOffset] + mg[startloopAddrsCoarseOffset] * 32768;
        const int loopEndOffset = mg[endloopAddrsOffset] + mg[endloopAddrsCoarseOffset] * 32768;
        const int endExclusive = sample.length;
        v.cursor = juce::jlimit (0, endExclusive - 1, cursorStart);
        v.end = juce::jlimit (0, endExclusive, endExclusive + endOffset);
        v.loopStart = juce::jlimit (0, endExclusive, sample.loopStart + loopStartOffset);
        v.loopEnd = juce::jlimit (0, endExclusive, sample.loopEnd + loopEndOffset);
        if (v.loopEnd < v.loopStart)
            std::swap (v.loopStart, v.loopEnd);
        if (v.loopEnd - v.loopStart < 1 && (v.loopingMode == 1 || v.loopingMode == 3))
            v.loopingMode = 0;
        v.loopLength = v.loopEnd - v.loopStart;
        v.looping = v.loopingMode == 1 || v.loopingMode == 3;
        v.reverbSend = reverbSend;
        v.chorusSend = chorusSend;
        v.currentPan = juce::jlimit (-500.0, 500.0, (double) mg[pan]);
    }
}

void SoundFontSynth::noteOff (int ch, int note)
{
    if (note < 0 || note > 127)
        return;
    auto& c = (*channels)[(size_t) ch];
    const bool sustain = c.cc[64] >= 8192;
    const auto noteID = c.noteOffID[(size_t) note];
    if (noteID < c.noteOnID[(size_t) note])
        c.noteOffID[(size_t) note]++;
    for (auto& v : voices)
        if (v.channel == ch && v.active && v.midiNote == note && v.noteID == noteID && ! v.inRelease)
        {
            if (sustain)
                v.held = true;
            else
                releaseVoice (v, currentTime);
        }
}

// -----------------------------------------------------------------------------
// Sound (render_voice.ts)

void SoundFontSynth::renderVoice (Voice& v, float* outLeft, float* outRight, int start, int count)
{
    const double now = currentTime;
    if (! v.inRelease && now >= v.releaseStartTime)
    {
        v.inRelease = true;
        volEnvStartRelease (v, rate);
        modEnvStartRelease (v);
        if (v.loopingMode == 3)
            v.looping = false;
    }
    v.rendered = true;
    if (! v.active)
        return;
    const auto& mg = v.mg;
    double cents = mg[fineTune];
    const double semitones = mg[coarseTune];
    cents += (v.targetKey - v.rootKey) * (double) mg[scaleTuning];
    double lowpassExcursion = 0, volumeExcursionCb = 0;
    if (now >= v.vibStart && mg[vibLfoToPitch] != 0)
    {
        const double rateInc = std::fmax (0.0, absCentsToHz (mg[freqVibLFO])) * count / rate;
        const double value = 1 - 4 * std::fabs (v.vibPhase - 0.5);
        if ((v.vibPhase += rateInc) >= 1)
            v.vibPhase -= 1;
        cents += value * mg[vibLfoToPitch];
    }
    if (now >= v.modStart && (mg[modLfoToPitch] != 0 || mg[modLfoToFilterFc] != 0 || mg[modLfoToVolume] != 0))
    {
        const double rateInc = std::fmax (0.0, absCentsToHz (mg[freqModLFO])) * count / rate;
        const double value = 1 - 4 * std::fabs (v.modPhase - 0.5);
        if ((v.modPhase += rateInc) >= 1)
            v.modPhase -= 1;
        cents += value * mg[modLfoToPitch];
        volumeExcursionCb += -value * mg[modLfoToVolume];
        lowpassExcursion += value * mg[modLfoToFilterFc];
    }
    if (mg[modEnvToFilterFc] != 0 || mg[modEnvToPitch] != 0)
    {
        const double env = modEnvProcess (v, now);
        lowpassExcursion += env * mg[modEnvToFilterFc];
        cents += env * mg[modEnvToPitch];
    }
    volumeExcursionCb -= v.resonanceOffset;
    const double centsTotal = cents + semitones * 100;
    const int rounded = (int) centsTotal;
    if (rounded != v.tuningCents)
    {
        v.tuningCents = rounded;
        v.tuningRatio = std::pow (2.0, centsTotal / 1200);
    }
    const double gainTarget = (double) cbToGain (mg[initialAttenuation]) * cbToGain (volumeExcursionCb);
    if (v.loopingMode == 2 && ! v.inRelease)
    {
        v.active = volEnvProcess (v.volEnv, count, gainTarget);
        return;
    }
    float* buffer = voiceBuffer.data();
    bool stillPlaying = oscillate (v, count, buffer);
    double gain = v.volEnv.outputGain;
    const bool envActive = volEnvProcess (v.volEnv, count, gainTarget);
    const double gainInc = (v.volEnv.outputGain - gain) / count;
    {
        auto& f = v.filter;
        const double initialFc = mg[initialFilterFc];
        const double smoothing = 0.03 * (44100.0 / rate);
        if (f.initialized)
            f.currentInitialFc += (initialFc - f.currentInitialFc) * smoothing;
        else
        {
            f.initialized = true;
            f.currentInitialFc = initialFc;
        }
        const double targetCutoff = f.currentInitialFc + lowpassExcursion;
        const int resonance = mg[initialFilterQ];
        if (f.currentInitialFc > 13499 && targetCutoff > 13499 && resonance == 0)
        {
            f.currentInitialFc = 13500;
            for (int i = 0; i < count; ++i)
            {
                buffer[i] = (float) (buffer[i] * gain);
                gain += gainInc;
            }
        }
        else
        {
            if (std::fabs (f.lastTargetCutoff - targetCutoff) > 1 || f.resonanceCb != resonance)
            {
                f.lastTargetCutoff = targetCutoff;
                f.resonanceCb = resonance;
                f.calculate (targetCutoff, rate);
            }
            for (int i = 0; i < count; ++i)
            {
                const double input = buffer[i];
                const double filtered = f.a0 * input + f.a1 * f.x1 + f.a2 * f.x2 - f.a3 * f.y1 - f.y2 * f.a4;
                f.x2 = f.x1;
                f.x1 = input;
                f.y2 = f.y1;
                f.y1 = filtered;
                buffer[i] = (float) (filtered * gain);
                gain += gainInc;
            }
        }
    }
    v.active = stillPlaying && envActive;
    v.currentPan += (mg[pan] - v.currentPan) * (0.05 * (44100.0 / rate));
    const int index = (int) (juce::jlimit (-500.0, 500.0, v.currentPan) + 500);
    const double outputGain = kGainFactor;
    const double gl = tables().panLeft[(size_t) index] * outputGain;
    const double gr = tables().panRight[(size_t) index] * outputGain;
    // Split (F2.2): each track's channel strip gets its own sound and its own reverb send.
    float* L = splitOut != nullptr ? splitOut[2 * v.channel] : outLeft;
    float* R = splitOut != nullptr ? splitOut[2 * v.channel + 1] : outRight;
    for (int i = 0; i < count; ++i)
    {
        L[start + i] += (float) (gl * buffer[i]);
        R[start + i] += (float) (gr * buffer[i]);
    }
    const double reverbSend = mg[reverbEffectsSend] * v.reverbSend;
    if (reverbSend > 0)
    {
        const double g = outputGain * (reverbSend / 1e3);
        float* rv = splitReverb != nullptr ? splitReverb[v.channel] + start : reverbIn.data();
        for (int i = 0; i < count; ++i)
            rv[(size_t) i] += (float) (g * buffer[i]);
    }
    const double chorusSend = mg[chorusEffectsSend] * v.chorusSend;
    if (chorusSend > 0)
    {
        const double g = (chorusSend / 1e3) * outputGain;
        for (int i = 0; i < count; ++i)
            chorusIn[(size_t) i] += (float) (g * buffer[i]);
    }
}

void SoundFontSynth::render (float* left, float* right, int start, int count)
{
    while (count > 0)
    {
        const int n = juce::jmin (count, kBlock);
        std::fill (reverbIn.begin(), reverbIn.begin() + n, 0.0f);
        std::fill (chorusIn.begin(), chorusIn.begin() + n, 0.0f);
        for (auto& v : voices)
            if (v.active)
                renderVoice (v, left, right, start, n);
        chorus->process (chorusIn.data(), left, right, reverbIn.data(), start, n);
        // Split: the engine's Reverb bus plays the sends (the chorus sends nothing to it here).
        if (splitReverb == nullptr)
            reverb->process (reverbIn.data(), left, right, start, n);
        currentTime += n / rate;
        start += n;
        count -= n;
    }
}

void SoundFontSynth::processSplit (juce::MidiBuffer& midi, int numSamples, float* const* channelOut, float* const* reverbSends, float* masterLeft, float* masterRight)
{
    const juce::SpinLock::ScopedLockType sl (lock);
    splitOut = channelOut;
    splitReverb = reverbSends;
    int done = 0;
    for (const auto meta : midi)
    {
        const int at = juce::jlimit (0, numSamples, meta.samplePosition);
        render (masterLeft, masterRight, done, at - done);
        done = juce::jmax (done, at);
        handle (meta.getMessage());
    }
    render (masterLeft, masterRight, done, numSamples - done);
    splitOut = nullptr;
    splitReverb = nullptr;
}

void SoundFontSynth::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    buffer.clear();
    const int numSamples = buffer.getNumSamples();
    float* left = buffer.getWritePointer (0);
    float* right = buffer.getWritePointer (juce::jmin (1, buffer.getNumChannels() - 1));
    const juce::SpinLock::ScopedLockType sl (lock);
    int done = 0;
    // Each event at its own sample, as the app's worklet does: render up to it, then apply it.
    for (const auto meta : midi)
    {
        const int at = juce::jlimit (0, numSamples, meta.samplePosition);
        render (left, right, done, at - done);
        done = juce::jmax (done, at);
        handle (meta.getMessage());
    }
    render (left, right, done, numSamples - done);
    if (buffer.getNumChannels() == 1)
        juce::FloatVectorOperations::multiply (left, 0.5f, numSamples);
}

} // namespace fh
