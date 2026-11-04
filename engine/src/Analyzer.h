// Four Hands Engine: the AI's ear (F2.3, Fran 04/11/2026).
//
// While the song plays, every strip, bus and the master are measured: loudness (LUFS, ITU-R
// BS.1770: K-weighting, 400 ms gated blocks), short-term loudness and its range, peaks, energy in
// seven bands and, on the master, true peak and stereo image. One frame per second, with where the
// song was (its quarter-note position), so Four Hands can say what happens in which bars.
//
// The audio thread only copies what it hears into ring buffers; a thread of its own does the maths,
// so measuring never costs the audio a dropout.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>

#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <vector>

namespace fh
{
/** The seven bands, as people name them: sub, bass, low-mids, mids, high-mids, presence, air. */
constexpr int kBands = 7;
constexpr double kBandEdges[kBands + 1] = { 20, 60, 250, 500, 2000, 4000, 6000, 20000 };

class Analyzer final : private juce::Thread
{
public:
    /** `taps`: how many places can be measured (keys 0..taps-1); `masterKey` gets true peak and stereo. */
    Analyzer (int taps, int masterKey);
    ~Analyzer() override;

    /** Message thread. Throws away what was measured and starts again at the next playing block. */
    void reset();
    void prepare (double sampleRate);
    /** Message thread: makes sure taps 0..count-1 exist (their buffers are allocated here, not on the audio thread). */
    void ensureTaps (const std::vector<int>& keys);

    // --- Audio thread -----------------------------------------------------------------------------
    /** One block while the song plays: `ppq` where it starts, and how far it moves per sample. Then `write` for every tap. */
    bool beginBlock (int numSamples, double ppq, double ppqPerSample);
    void write (int key, const float* left, const float* right, int numSamples);
    void endBlock();

    // --- Results (message thread) -------------------------------------------------------------------
    struct Frame
    {
        double ppq = 0;
        float loudness = -100; // LUFS of that second (momentary-like, K-weighted)
        std::array<float, kBands> bands {}; // dBFS per band (mean square)
        float peak = 0; // linear
        float correlation = 1; // master only
        float side = 0; // master only: side energy over mid + side (0 mono, 0.5 wide, 1 out of phase)
    };
    struct Result
    {
        int key = -1;
        double integrated = -100, shortMax = -100, range = 0, peak = 0, truePeak = 0;
        double seconds = 0;
        std::vector<Frame> frames;
    };
    std::vector<Result> results();
    /** Blocks that could not be measured (the analysis thread fell behind). */
    int gaps() const { return dropped.load(); }

private:
    void run() override;

    struct Tap
    {
        juce::AbstractFifo fifo { 1 << 15 };
        std::array<std::vector<float>, 2> data;
        std::atomic<juce::int64> firstBlock { -1 };
        Tap();
    };
    struct BlockInfo
    {
        juce::int64 index = 0;
        int n = 0;
        double ppq = 0, ppqPerSample = 0;
    };

    /** The maths for one tap, on the analysis thread. */
    struct Channel
    {
        struct Biquad
        {
            double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
            double run (double x)
            {
                const double y = b0 * x + z1;
                z1 = b1 * x - a1 * y + z2;
                z2 = b2 * x - a2 * y;
                return y;
            }
        };
        std::array<Biquad, 2> kL, kR; // K-weighting: high shelf, then high-pass
        std::array<Biquad, kBands> bandFilters;
        std::array<double, kBands> bandSum {};
        double subSum = 0, frameSum = 0, framePeak = 0, lr = 0, ll = 0, rr = 0, mid = 0, side = 0;
        int subCount = 0, frameCount = 0;
        double framePpq = 0;
        bool frameStarted = false;
        double seconds = 0, peak = 0, truePeak = 0;
        std::vector<float> subBlocks; // mean square per 100 ms
        std::vector<Frame> frames;
        // True peak: 4x oversampling (master only).
        std::array<std::array<float, 12>, 2> history {};
        int historyPos = 0;
        void setup (double rate);
        void process (const float* l, const float* r, int n, double ppq, double ppqPerSample, double rate, bool master);
        void closeFrame();
        Frame current() const;
    };
    int frameLengthOf (const Channel&) const;

    std::vector<std::atomic<Tap*>> taps;
    std::vector<std::unique_ptr<Tap>> owned;
    juce::AbstractFifo infoFifo { 1024 };
    std::vector<BlockInfo> infos;
    juce::int64 blockIndex = 0;
    BlockInfo pending;
    bool writing = false;
    std::atomic<int> dropped { 0 };
    std::atomic<bool> resetWanted { false };
    std::atomic<double> rate { 48000 };

    std::mutex lock; // guards `channels` against results()
    std::map<int, Channel> channels;
    const int masterKey;
    std::vector<char> written; // audio thread: taps written in the block under way
    std::array<std::vector<float>, 2> scratch;
};

} // namespace fh
