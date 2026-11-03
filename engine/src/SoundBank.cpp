#include "SoundBank.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <mutex>

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
#pragma GCC diagnostic ignored "-Wfloat-equal"
#endif
#include "../third_party/stb/stb_vorbis.c"
#define TSF_IMPLEMENTATION
#include "../third_party/tinysoundfont/tsf.h"
#if defined(_MSC_VER)
#pragma warning(pop)
#elif defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

namespace fh::sf
{
const std::array<Limit, kGens> kLimits = { {
    { 0, 32768, 0, true },          // 0 startAddrsOffset
    { -32768, 32768, 0, true },     // 1 endAddrOffset
    { -32768, 32768, 0, true },     // 2 startloopAddrsOffset
    { -32768, 32768, 0, true },     // 3 endloopAddrsOffset
    { 0, 32768, 0, true },          // 4 startAddrsCoarseOffset
    { -12000, 12000, 0, true },     // 5 modLfoToPitch
    { -12000, 12000, 0, true },     // 6 vibLfoToPitch
    { -12000, 12000, 0, true },     // 7 modEnvToPitch
    { 1500, 13500, 13500, true },   // 8 initialFilterFc
    { 0, 960, 0, true },            // 9 initialFilterQ
    { -12000, 12000, 0, true },     // 10 modLfoToFilterFc
    { -12000, 12000, 0, true },     // 11 modEnvToFilterFc
    { -32768, 32768, 0, true },     // 12 endAddrsCoarseOffset
    { -960, 960, 0, true },         // 13 modLfoToVolume
    { -32768, 32767, 0, false },    // 14
    { 0, 1000, 0, true },           // 15 chorusEffectsSend
    { 0, 1000, 0, true },           // 16 reverbEffectsSend
    { -500, 500, 0, true },         // 17 pan
    { -32768, 32767, 0, false },    // 18
    { -32768, 32767, 0, false },    // 19
    { -32768, 32767, 0, false },    // 20
    { -12000, 5000, -12000, true }, // 21 delayModLFO
    { -16000, 4500, 0, true },      // 22 freqModLFO
    { -12000, 5000, -12000, true }, // 23 delayVibLFO
    { -16000, 4500, 0, true },      // 24 freqVibLFO
    { -32768, 5000, -32768, true }, // 25 delayModEnv
    { -32768, 8000, -32768, true }, // 26 attackModEnv
    { -12000, 5000, -12000, true }, // 27 holdModEnv
    { -12000, 8000, -12000, true }, // 28 decayModEnv
    { 0, 1000, 0, true },           // 29 sustainModEnv
    { -12000, 8000, -12000, true }, // 30 releaseModEnv
    { -1200, 1200, 0, true },       // 31 keyNumToModEnvHold
    { -1200, 1200, 0, true },       // 32 keyNumToModEnvDecay
    { -12000, 5000, -12000, true }, // 33 delayVolEnv
    { -12000, 8000, -12000, true }, // 34 attackVolEnv
    { -12000, 5000, -12000, true }, // 35 holdVolEnv
    { -12000, 8000, -12000, true }, // 36 decayVolEnv
    { 0, 1440, 0, true },           // 37 sustainVolEnv
    { -12000, 8000, -12000, true }, // 38 releaseVolEnv
    { -1200, 1200, 0, true },       // 39 keyNumToVolEnvHold
    { -1200, 1200, 0, true },       // 40 keyNumToVolEnvDecay
    { 0, 0, 0, true },              // 41 instrument
    { -32768, 32767, 0, false },    // 42
    { 0, 0, 0, true },              // 43 keyRange
    { 0, 0, 0, true },              // 44 velRange
    { -32768, 32768, 0, true },     // 45 startloopAddrsCoarseOffset
    { -1, 127, -1, true },          // 46 keyNum
    { -1, 127, -1, true },          // 47 velocity
    { 0, 1440, 0, true },           // 48 initialAttenuation
    { -32768, 32767, 0, false },    // 49
    { -32768, 32768, 0, true },     // 50 endloopAddrsCoarseOffset
    { -120, 120, 0, true },         // 51 coarseTune
    { -12700, 12700, 0, true },     // 52 fineTune
    { 0, 0, 0, true },              // 53 sampleID
    { 0, 3, 0, true },              // 54 sampleModes
    { -32768, 32767, 0, false },    // 55
    { 0, 1200, 100, true },         // 56 scaleTuning
    { 0, 99999, 0, true },          // 57 exclusiveClass
    { -1, 127, -1, true },          // 58 overridingRootKey
    { -32768, 32767, 0, false },    // 59
    { 0, 0, 0, true },              // 60 endOper
} };

bool identical (const Modulator& a, const Modulator& b)
{
    return a.source == b.source && a.amountSource == b.amountSource && a.destination == b.destination && a.transform == b.transform;
}

namespace
{
Modulator makeModulator (std::uint16_t source, std::uint16_t amountSource, int destination, int amount, std::uint16_t transform)
{
    Modulator m;
    m.source = source;
    m.amountSource = amountSource;
    m.destination = destination;
    m.amount = amount;
    m.transform = transform;
    // VoiceModulator.fromData in SpessaSynth: CC91 or CC93, linear, to a send, with no second source.
    m.effect = (source == 219 || source == 221) && amountSource == 0 && (destination == reverbEffectsSend || destination == chorusEffectsSend);
    m.resonant = source == 711 && amountSource == 0 && destination == initialFilterQ;
    return m;
}
} // namespace

const std::vector<Modulator>& defaultModulators()
{
    // Source enum: curve << 10 | bipolar << 9 | negative << 8 | CC << 7 | index.
    static const std::vector<Modulator> list = {
        makeModulator (1282, 0, initialAttenuation, 960, 0), // velocity, negative concave
        makeModulator (129, 0, vibLfoToPitch, 50, 0),        // CC1 modulation wheel
        makeModulator (1415, 0, initialAttenuation, 960, 0), // CC7 volume, negative concave
        makeModulator (13, 0, vibLfoToPitch, 50, 0),         // channel pressure
        makeModulator (526, 16, fineTune, 12700, 0),         // pitch wheel × its range
        makeModulator (650, 0, pan, 500, 0),                 // CC10 pan, bipolar
        makeModulator (1419, 0, initialAttenuation, 960, 0), // CC11 expression, negative concave
        makeModulator (219, 0, reverbEffectsSend, 200, 0),   // CC91 reverb
        makeModulator (221, 0, chorusEffectsSend, 200, 0),   // CC93 chorus
        makeModulator (2761, 0, attackVolEnv, 6000, 0),      // CC73 attack, convex bipolar
        makeModulator (712, 0, releaseVolEnv, 3600, 0),      // CC72 release
        makeModulator (715, 0, decayVolEnv, 3600, 0),        // CC75 decay
        makeModulator (714, 0, initialFilterFc, 9600, 0),    // CC74 brightness
        makeModulator (711, 0, initialFilterQ, 250, 0),      // CC71 resonance
        makeModulator (3267, 0, initialFilterFc, -1200, 0),  // CC67 soft pedal, switch
    };
    return list;
}

namespace
{
/** A zone as the file has it: generators set, ranges, modulators. */
struct Zone
{
    std::array<bool, kGens> set {};
    std::array<int, kGens> value {};
    bool hasKey = false, hasVel = false;
    int keyLo = 0, keyHi = 127, velLo = 0, velHi = 127;
    std::vector<Modulator> mods;
    int link = -1; // instrument (preset zone) or sample (instrument zone)
};

void addUnique (std::vector<Modulator>& main, const std::vector<Modulator>& adder)
{
    for (const auto& m : adder)
        if (std::none_of (main.begin(), main.end(), [&] (const Modulator& x) { return identical (x, m); }))
            main.push_back (m);
}

/** Generators that only make sense in an instrument zone (SoundFont 2, 8.1.3). */
bool instrumentOnly (int g)
{
    switch (g)
    {
        case startAddrsOffset: case endAddrOffset: case startloopAddrsOffset: case endloopAddrsOffset:
        case startAddrsCoarseOffset: case endAddrsCoarseOffset: case startloopAddrsCoarseOffset:
        case endloopAddrsCoarseOffset: case keyNum: case velocity: case sampleModes: case exclusiveClass:
        case overridingRootKey:
            return true;
        default:
            return false;
    }
}

template <typename Gen, typename Mod>
Zone readZone (const Gen* gens, int genFrom, int genTo, const Mod* mods, int modFrom, int modTo, int linkGen)
{
    Zone z;
    for (int i = genFrom; i < genTo; ++i)
    {
        const auto& g = gens[i];
        const int type = g.genOper;
        if (type == keyRange)
        {
            z.hasKey = true;
            z.keyLo = g.genAmount.range.lo;
            z.keyHi = g.genAmount.range.hi;
        }
        else if (type == velRange)
        {
            z.hasVel = true;
            z.velLo = g.genAmount.range.lo;
            z.velHi = g.genAmount.range.hi;
        }
        else if (type == linkGen)
            z.link = g.genAmount.wordAmount;
        else if (type >= 0 && type < kGens && type != instrument && type != sampleID)
        {
            z.set[(size_t) type] = true;
            z.value[(size_t) type] = g.genAmount.shortAmount;
        }
    }
    for (int i = modFrom; i < modTo; ++i)
    {
        const auto& m = mods[i];
        if (m.modDestOper >= kGens)
            continue; // SpessaSynth makes it invalid: it changes nothing
        z.mods.push_back (makeModulator (m.modSrcOper, m.modAmtSrcOper, m.modDestOper, m.modAmount, m.modTransOper));
    }
    return z;
}
} // namespace

struct BankReader
{
    Bank& bank;

    static void onHydra (void* user, const tsf_hydra* hydra, const float* samples, unsigned int sampleCount)
    {
        static_cast<BankReader*> (user)->read (*hydra, samples, sampleCount);
    }

    void read (const tsf_hydra& h, const float* samples, unsigned int sampleCount)
    {
        // Samples (SF3 positions are already where the decoded samples are).
        // Every record, the terminal one too, so a zone's sample number is its index here.
        for (int i = 0; i < h.shdrNum; ++i)
        {
            const auto& s = h.shdrs[i];
            Sample out;
            const auto start = juce::jmin ((unsigned int) s.start, sampleCount);
            const auto end = juce::jlimit (start, sampleCount, (unsigned int) s.end);
            out.data = samples + start;
            out.length = (int) (end - start);
            out.loopStart = (int) s.startLoop - (int) s.start;
            out.loopEnd = (int) s.endLoop - (int) s.start;
            out.rate = (int) s.sampleRate > 0 ? (int) s.sampleRate : 44100;
            out.originalKey = s.originalPitch > 127 ? 60 : s.originalPitch;
            out.pitchCorrection = s.pitchCorrection;
            bank.sampleList.push_back (out);
        }

        // Instruments: their zones, with the global zone apart.
        struct Instrument
        {
            Zone global;
            std::vector<Zone> zones;
        };
        std::vector<Instrument> instruments ((size_t) juce::jmax (0, h.instNum - 1));
        for (int i = 0; i + 1 < h.instNum; ++i)
        {
            auto& inst = instruments[(size_t) i];
            for (int b = h.insts[i].instBagNdx; b < h.insts[i + 1].instBagNdx; ++b)
            {
                auto z = readZone (h.igens, h.ibags[b].instGenNdx, h.ibags[b + 1].instGenNdx, h.imods, h.ibags[b].instModNdx, h.ibags[b + 1].instModNdx, sampleID);
                if (z.link < 0)
                {
                    if (b == h.insts[i].instBagNdx)
                        inst.global = std::move (z);
                    continue;
                }
                inst.zones.push_back (std::move (z));
            }
        }

        // Presets: every preset zone with every instrument zone (SpessaSynth's getVoiceParameters).
        for (int p = 0; p + 1 < h.phdrNum; ++p)
        {
            const auto& ph = h.phdrs[p];
            Preset preset;
            preset.name = juce::String (juce::CharPointer_ASCII (ph.presetName), (size_t) strnlen (ph.presetName, 20));
            preset.bank = ph.bank;
            preset.program = ph.preset;
            preset.drum = ph.bank == 128;
            Zone global;
            std::vector<Zone> zones;
            for (int b = ph.presetBagNdx; b < h.phdrs[p + 1].presetBagNdx; ++b)
            {
                auto z = readZone (h.pgens, h.pbags[b].genNdx, h.pbags[b + 1].genNdx, h.pmods, h.pbags[b].modNdx, h.pbags[b + 1].modNdx, instrument);
                if (z.link < 0)
                {
                    if (b == ph.presetBagNdx)
                        global = std::move (z);
                    continue;
                }
                zones.push_back (std::move (z));
            }

            for (const auto& pz : zones)
            {
                if (pz.link >= (int) instruments.size())
                    continue;
                const auto& inst = instruments[(size_t) pz.link];
                const int pKeyLo = pz.hasKey ? pz.keyLo : global.keyLo, pKeyHi = pz.hasKey ? pz.keyHi : global.keyHi;
                const int pVelLo = pz.hasVel ? pz.velLo : global.velLo, pVelHi = pz.hasVel ? pz.velHi : global.velHi;

                std::array<int, kGens> presetGens {};
                for (int g = 0; g < kGens; ++g)
                {
                    if (instrumentOnly (g))
                        continue;
                    if (global.set[(size_t) g])
                        presetGens[(size_t) g] = global.value[(size_t) g];
                    if (pz.set[(size_t) g])
                        presetGens[(size_t) g] = pz.value[(size_t) g];
                }
                auto presetMods = pz.mods;
                addUnique (presetMods, global.mods);

                for (const auto& iz : inst.zones)
                {
                    const int iKeyLo = iz.hasKey ? iz.keyLo : inst.global.keyLo, iKeyHi = iz.hasKey ? iz.keyHi : inst.global.keyHi;
                    const int iVelLo = iz.hasVel ? iz.velLo : inst.global.velLo, iVelHi = iz.hasVel ? iz.velHi : inst.global.velHi;
                    Region r;
                    r.keyLo = (std::uint8_t) juce::jmax (pKeyLo, iKeyLo);
                    r.keyHi = (std::uint8_t) juce::jmin (pKeyHi, iKeyHi);
                    r.velLo = (std::uint8_t) juce::jmax (pVelLo, iVelLo);
                    r.velHi = (std::uint8_t) juce::jmin (pVelHi, iVelHi);
                    if (r.keyLo > r.keyHi || r.velLo > r.velHi || iz.link >= (int) bank.sampleList.size())
                        continue;
                    r.sample = iz.link;

                    r.mods = iz.mods;
                    addUnique (r.mods, inst.global.mods);
                    addUnique (r.mods, defaultModulators());
                    for (const auto& pm : presetMods)
                    {
                        auto it = std::find_if (r.mods.begin(), r.mods.end(), [&] (const Modulator& x) { return identical (x, pm); });
                        if (it == r.mods.end())
                            r.mods.push_back (pm);
                        else
                            it->amount += pm.amount;
                    }

                    for (int g = 0; g < kGens; ++g)
                    {
                        int v = kLimits[(size_t) g].def;
                        if (inst.global.set[(size_t) g])
                            v = inst.global.value[(size_t) g];
                        if (iz.set[(size_t) g])
                            v = iz.value[(size_t) g];
                        r.gens[(size_t) g] = (std::int16_t) juce::jlimit (-32768, 32767, v + presetGens[(size_t) g]);
                    }
                    // The EMU attenuation correction SpessaSynth applies to the file's attenuation.
                    r.gens[initialAttenuation] = (std::int16_t) std::floor (r.gens[initialAttenuation] * 0.4);
                    preset.regions.push_back (std::move (r));
                }
            }
            bank.presetList.push_back (std::move (preset));
        }
    }
};

Bank::~Bank()
{
    if (font != nullptr)
        tsf_close (font);
}

juce::String Bank::load (const juce::File& file)
{
    // The hook is TinySoundFont's static: one load at a time.
    static std::mutex loading;
    const std::lock_guard<std::mutex> guard (loading);
    BankReader reader { *this };
    tsf_fh_on_hydra = &BankReader::onHydra;
    tsf_fh_user = &reader;
    // Read with JUCE, not fopen: on Windows a path with accents (a folder named after a person)
    // would not open.
    juce::MemoryBlock data;
    if (! file.loadFileAsData (data) || data.getSize() > (size_t) std::numeric_limits<int>::max())
    {
        tsf_fh_on_hydra = nullptr;
        tsf_fh_user = nullptr;
        return "The sound bank could not be read: " + file.getFileName();
    }
    font = tsf_load_memory (data.getData(), (int) data.getSize());
    tsf_fh_on_hydra = nullptr;
    tsf_fh_user = nullptr;
    if (font == nullptr)
        return "The sound bank could not be read: " + file.getFileName();
    if (presetList.empty())
        return "The sound bank has no presets: " + file.getFileName();
    return {};
}

} // namespace fh::sf
