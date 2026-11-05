#include "Analyzer.h"

#include <algorithm>
#include <cmath>

namespace fh
{
namespace
{
constexpr double kPi = juce::MathConstants<double>::pi;

/** RBJ cookbook coefficients, normalised. */
void setBiquad (double& b0, double& b1, double& b2, double& a1, double& a2, double nb0, double nb1, double nb2, double na0, double na1, double na2)
{
    b0 = nb0 / na0;
    b1 = nb1 / na0;
    b2 = nb2 / na0;
    a1 = na1 / na0;
    a2 = na2 / na0;
}

/** Loudness of a mean square (K-weighted, both channels summed), in LUFS. */
double lufs (double ms) { return ms > 1e-12 ? -0.691 + 10.0 * std::log10 (ms) : -100.0; }

/**
 * 4x oversampling for the true peak: the value at 5 + phase / 4 samples into a window of 12
 * (windowed sinc, each phase normalised to unity at DC).
 */
const std::array<std::array<float, 12>, 4>& truePeakTaps()
{
    static const auto taps = [] {
        std::array<std::array<float, 12>, 4> t {};
        for (int phase = 0; phase < 4; ++phase)
        {
            double sum = 0;
            for (int k = 0; k < 12; ++k)
            {
                const double x = 5.0 + phase / 4.0 - k;
                const double sinc = std::abs (x) < 1e-9 ? 1.0 : std::sin (kPi * x) / (kPi * x);
                const double w = 0.5 + 0.5 * std::cos (kPi * (k - 5.5) / 6.5);
                t[(size_t) phase][(size_t) k] = (float) (sinc * w);
                sum += sinc * w;
            }
            for (auto& v : t[(size_t) phase])
                v = (float) (v / sum);
        }
        return t;
    }();
    return taps;
}
} // namespace

Analyzer::Tap::Tap()
{
    for (auto& d : data)
        d.assign ((size_t) fifo.getTotalSize(), 0.0f);
}

Analyzer::Analyzer (int count, int master) : juce::Thread ("Four Hands analysis"), taps ((size_t) count), masterKey (master)
{
    for (auto& t : taps)
        t.store (nullptr);
    owned.resize ((size_t) count);
    written.assign ((size_t) count, 0);
    infos.resize ((size_t) infoFifo.getTotalSize());
    for (auto& s : scratch)
        s.assign (1 << 15, 0.0f);
    startThread (juce::Thread::Priority::low);
}

Analyzer::~Analyzer()
{
    stopThread (2000);
}

void Analyzer::reset()
{
    resetWanted.store (true);
}

void Analyzer::prepare (double sampleRate)
{
    rate.store (sampleRate);
    reset();
}

void Analyzer::ensureTaps (const std::vector<int>& keys)
{
    for (int key : keys)
        if (juce::isPositiveAndBelow (key, (int) taps.size()) && taps[(size_t) key].load() == nullptr)
        {
            owned[(size_t) key] = std::make_unique<Tap>();
            taps[(size_t) key].store (owned[(size_t) key].get());
        }
}

bool Analyzer::beginBlock (int numSamples, double ppq, double ppqPerSample)
{
    writing = false;
    if (infoFifo.getFreeSpace() < 1)
    {
        dropped.fetch_add (1);
        return false;
    }
    // Every tap must take the whole block, or none does (they stay in step).
    for (auto& t : taps)
        if (auto* tap = t.load(); tap != nullptr && tap->fifo.getFreeSpace() < numSamples)
        {
            dropped.fetch_add (1);
            return false;
        }
    pending = { blockIndex, numSamples, ppq, ppqPerSample };
    std::fill (written.begin(), written.end(), (char) 0);
    writing = true;
    return true;
}

void Analyzer::write (int key, const float* left, const float* right, int numSamples)
{
    if (! writing || ! juce::isPositiveAndBelow (key, (int) taps.size()))
        return;
    auto* tap = taps[(size_t) key].load();
    if (tap == nullptr || written[(size_t) key])
        return;
    if (tap->firstBlock.load() < 0)
        tap->firstBlock.store (pending.index);
    int s1, n1, s2, n2;
    tap->fifo.prepareToWrite (numSamples, s1, n1, s2, n2);
    for (int c = 0; c < 2; ++c)
    {
        const float* src = c == 0 ? left : right;
        auto& d = tap->data[(size_t) c];
        if (src != nullptr)
        {
            std::copy (src, src + n1, d.begin() + s1);
            std::copy (src + n1, src + n1 + n2, d.begin() + s2);
        }
        else
        {
            std::fill (d.begin() + s1, d.begin() + s1 + n1, 0.0f);
            std::fill (d.begin() + s2, d.begin() + s2 + n2, 0.0f);
        }
    }
    tap->fifo.finishedWrite (n1 + n2);
    written[(size_t) key] = 1;
}

void Analyzer::endBlock()
{
    if (! writing)
        return;
    // Taps measured before but silent now (a bus gone, a strip not used) get silence: in step.
    for (size_t k = 0; k < taps.size(); ++k)
        if (auto* tap = taps[k].load(); tap != nullptr && ! written[k] && tap->firstBlock.load() >= 0)
            write ((int) k, nullptr, nullptr, pending.n);
    int s1, n1, s2, n2;
    infoFifo.prepareToWrite (1, s1, n1, s2, n2);
    infos[(size_t) (n1 > 0 ? s1 : s2)] = pending;
    infoFifo.finishedWrite (1);
    ++blockIndex;
    writing = false;
}

void Analyzer::run()
{
    while (! threadShouldExit())
    {
        wait (20);
        const bool resetting = resetWanted.exchange (false);
        for (;;)
        {
            if (infoFifo.getNumReady() < 1)
                break;
            int s1, n1, s2, n2;
            infoFifo.prepareToRead (1, s1, n1, s2, n2);
            const auto info = infos[(size_t) (n1 > 0 ? s1 : s2)];
            infoFifo.finishedRead (1);
            const double sr = rate.load();
            for (size_t k = 0; k < taps.size(); ++k)
            {
                auto* tap = taps[k].load();
                if (tap == nullptr)
                    continue;
                const auto first = tap->firstBlock.load();
                if (first < 0 || first > info.index)
                    continue;
                int r1, m1, r2, m2;
                tap->fifo.prepareToRead (info.n, r1, m1, r2, m2);
                for (int c = 0; c < 2; ++c)
                {
                    auto& d = tap->data[(size_t) c];
                    std::copy (d.begin() + r1, d.begin() + r1 + m1, scratch[(size_t) c].begin());
                    std::copy (d.begin() + r2, d.begin() + r2 + m2, scratch[(size_t) c].begin() + m1);
                }
                tap->fifo.finishedRead (m1 + m2);
                if (resetting)
                    continue;
                const std::lock_guard<std::mutex> g (lock);
                auto it = channels.find ((int) k);
                if (it == channels.end())
                {
                    it = channels.emplace ((int) k, Channel {}).first;
                    it->second.setup (sr);
                }
                it->second.process (scratch[0].data(), scratch[1].data(), m1 + m2, info.ppq, info.ppqPerSample, sr, (int) k == masterKey);
            }
        }
        if (resetting)
        {
            const std::lock_guard<std::mutex> g (lock);
            channels.clear();
        }
    }
}

// -----------------------------------------------------------------------------
// One channel's maths

void Analyzer::Channel::setup (double sr)
{
    // K-weighting (BS.1770): a high shelf of +4 dB from about 1.7 kHz, then a high-pass at 38 Hz.
    {
        const double f0 = 1681.974450955533, gain = 3.999843853973347, q = 0.7071752369554196;
        const double A = std::pow (10.0, gain / 40.0), w = 2 * kPi * f0 / sr, cs = std::cos (w), alpha = std::sin (w) / (2 * q), sq = 2 * std::sqrt (A) * alpha;
        for (auto* k : { &kL[0], &kR[0] })
            setBiquad (k->b0, k->b1, k->b2, k->a1, k->a2, A * ((A + 1) + (A - 1) * cs + sq), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - sq),
                       (A + 1) - (A - 1) * cs + sq, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - sq);
    }
    {
        const double f0 = 38.13547087602444, q = 0.5003270373238773, w = 2 * kPi * f0 / sr, cs = std::cos (w), alpha = std::sin (w) / (2 * q);
        for (auto* k : { &kL[1], &kR[1] })
            setBiquad (k->b0, k->b1, k->b2, k->a1, k->a2, (1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + alpha, -2 * cs, 1 - alpha);
    }
    // The bands: band-passes (0 dB at the centre), one per band.
    for (int b = 0; b < kBands; ++b)
    {
        const double lo = kBandEdges[b], hi = juce::jmin (kBandEdges[b + 1], sr * 0.45);
        const double f0 = std::sqrt (lo * hi), q = f0 / juce::jmax (1.0, hi - lo), w = 2 * kPi * f0 / sr, alpha = std::sin (w) / (2 * q);
        auto& f = bandFilters[(size_t) b];
        setBiquad (f.b0, f.b1, f.b2, f.a1, f.a2, alpha, 0, -alpha, 1 + alpha, -2 * std::cos (w), 1 - alpha);
    }
}

void Analyzer::Channel::process (const float* l, const float* r, int n, double ppq, double ppqPerSample, double sr, bool master)
{
    const int subLength = (int) std::lround (sr * 0.1);
    const int frameLength = (int) std::lround (sr);
    // The frame starts where the song was when its first sample played.
    if (! frameStarted)
    {
        framePpq = ppq;
        frameStarted = true;
    }
    const auto& tp = truePeakTaps();
    for (int i = 0; i < n; ++i)
    {
        const double x = l[i], y = r[i];
        const double kl = kL[1].run (kL[0].run (x)), kr = kR[1].run (kR[0].run (y));
        const double k2 = kl * kl + kr * kr;
        subSum += k2;
        frameSum += k2;
        const double mono = (x + y) * 0.5;
        for (int b = 0; b < kBands; ++b)
        {
            const double v = bandFilters[(size_t) b].run (mono);
            bandSum[(size_t) b] += v * v;
        }
        const double a = juce::jmax (std::abs (x), std::abs (y));
        framePeak = juce::jmax (framePeak, a);
        peak = juce::jmax (peak, a);
        if (master)
        {
            lr += x * y;
            ll += x * x;
            rr += y * y;
            mid += (x + y) * (x + y) * 0.25;
            side += (x - y) * (x - y) * 0.25;
            // True peak: the samples between samples, at 4x.
            history[0][(size_t) historyPos] = (float) x;
            history[1][(size_t) historyPos] = (float) y;
            historyPos = (historyPos + 1) % 12;
            for (int c = 0; c < 2; ++c)
                for (int phase = 0; phase < 4; ++phase)
                {
                    double acc = 0;
                    for (int k = 0; k < 12; ++k)
                        acc += history[(size_t) c][(size_t) ((historyPos + k) % 12)] * tp[(size_t) phase][(size_t) k];
                    truePeak = juce::jmax (truePeak, std::abs (acc));
                }
        }
        if (++subCount >= subLength)
        {
            subBlocks.push_back ((float) (subSum / subCount));
            subSum = 0;
            subCount = 0;
        }
        if (++frameCount >= frameLength)
        {
            closeFrame();
            // The next frame starts here: the block's position plus what has played of it.
            framePpq = ppq + (i + 1) * ppqPerSample;
            frameStarted = true;
        }
    }
    seconds += n / sr;
}

Analyzer::Frame Analyzer::Channel::current() const
{
    Frame f;
    f.ppq = framePpq;
    f.loudness = (float) lufs (frameSum / juce::jmax (1, frameCount));
    for (int b = 0; b < kBands; ++b)
    {
        const double ms = bandSum[(size_t) b] / juce::jmax (1, frameCount);
        f.bands[(size_t) b] = (float) (ms > 1e-12 ? 10.0 * std::log10 (ms) : -120.0);
    }
    f.peak = (float) framePeak;
    f.correlation = (float) (ll > 0 && rr > 0 ? lr / std::sqrt (ll * rr) : 1.0);
    f.side = (float) (mid + side > 0 ? side / (mid + side) : 0.0);
    return f;
}

void Analyzer::Channel::closeFrame()
{
    if (frameCount == 0)
        return;
    frames.push_back (current());
    bandSum.fill (0.0);
    frameSum = 0;
    framePeak = 0;
    frameCount = 0;
    lr = ll = rr = mid = side = 0;
    frameStarted = false;
}

int Analyzer::frameLengthOf (const Channel&) const
{
    return (int) std::lround (rate.load());
}

std::vector<Analyzer::Result> Analyzer::results()
{
    const std::lock_guard<std::mutex> g (lock);
    std::vector<Result> out;
    for (auto& [key, ch] : channels)
    {
        Result r;
        r.key = key;
        r.frames = ch.frames;
        // The second under way when the song stopped, if it is a good part of one.
        if (ch.frameCount > 0 && frameLengthOf (ch) > 0 && ch.frameCount * 4 >= frameLengthOf (ch))
            r.frames.push_back (ch.current());
        r.seconds = ch.seconds;
        r.peak = ch.peak;
        r.truePeak = key == masterKey ? ch.truePeak : ch.peak;
        // Integrated loudness: 400 ms blocks (75 % overlap), absolute gate at -70 LUFS, then -10 LU.
        std::vector<double> blocks;
        for (size_t i = 0; i + 4 <= ch.subBlocks.size(); ++i)
            blocks.push_back ((ch.subBlocks[i] + ch.subBlocks[i + 1] + ch.subBlocks[i + 2] + ch.subBlocks[i + 3]) / 4.0);
        auto gatedMean = [] (const std::vector<double>& ms, double gate) {
            double sum = 0;
            int count = 0;
            for (double m : ms)
                if (lufs (m) > gate)
                {
                    sum += m;
                    ++count;
                }
            return count > 0 ? sum / count : 0.0;
        };
        const double first = gatedMean (blocks, -70.0);
        r.integrated = first > 0 ? lufs (gatedMean (blocks, lufs (first) - 10.0)) : -100.0;
        // Short-term (3 s) loudness, every second: its loudest and its range (10th to 95th
        // percentile after a -20 LU relative gate, EBU R128 LRA).
        std::vector<double> shortTerm;
        for (size_t i = 0; i + 30 <= ch.subBlocks.size(); i += 10)
        {
            double sum = 0;
            for (size_t k = i; k < i + 30; ++k)
                sum += ch.subBlocks[k];
            shortTerm.push_back (lufs (sum / 30.0));
        }
        if (! shortTerm.empty())
            r.shortMax = *std::max_element (shortTerm.begin(), shortTerm.end());
        std::vector<double> gated;
        double powerSum = 0;
        int powerCount = 0;
        for (double v : shortTerm)
            if (v > -70.0)
            {
                powerSum += std::pow (10.0, (v + 0.691) / 10.0);
                ++powerCount;
            }
        if (powerCount > 0)
        {
            const double rel = lufs (powerSum / powerCount) - 20.0;
            for (double v : shortTerm)
                if (v > -70.0 && v > rel)
                    gated.push_back (v);
        }
        if (gated.size() >= 2)
        {
            std::sort (gated.begin(), gated.end());
            const auto at = [&] (double p) { return gated[(size_t) std::lround (p * (double) (gated.size() - 1))]; };
            r.range = at (0.95) - at (0.10);
        }
        out.push_back (std::move (r));
    }
    return out;
}

} // namespace fh
