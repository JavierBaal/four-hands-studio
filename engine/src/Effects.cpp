#include "Effects.h"

#include <cmath>

namespace fh
{
namespace
{
constexpr double kPi = juce::MathConstants<double>::pi;

/** RBJ cookbook biquad, direct form I, per channel. */
struct Biquad
{
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    double x1[2] {}, x2[2] {}, y1[2] {}, y2[2] {};
    bool active = false;

    void set (double nb0, double nb1, double nb2, double na0, double na1, double na2)
    {
        b0 = nb0 / na0;
        b1 = nb1 / na0;
        b2 = nb2 / na0;
        a1 = na1 / na0;
        a2 = na2 / na0;
    }
    void off() { active = false; }
    void lowCut (double rate, double f)
    {
        const double w = 2 * kPi * f / rate, c = std::cos (w), a = std::sin (w) / (2 * 0.7071);
        set ((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a);
        active = true;
    }
    void highCut (double rate, double f)
    {
        const double w = 2 * kPi * f / rate, c = std::cos (w), a = std::sin (w) / (2 * 0.7071);
        set ((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + a, -2 * c, 1 - a);
        active = true;
    }
    void bell (double rate, double f, double gainDb, double q)
    {
        if (std::abs (gainDb) < 0.01)
            return off();
        const double A = std::pow (10.0, gainDb / 40), w = 2 * kPi * f / rate, c = std::cos (w), a = std::sin (w) / (2 * q);
        set (1 + a * A, -2 * c, 1 - a * A, 1 + a / A, -2 * c, 1 - a / A);
        active = true;
    }
    void shelf (double rate, double f, double gainDb, bool high)
    {
        if (std::abs (gainDb) < 0.01)
            return off();
        const double A = std::pow (10.0, gainDb / 40), w = 2 * kPi * f / rate, c = std::cos (w), s = std::sin (w);
        const double a = s / 2 * std::sqrt (2.0), k = 2 * std::sqrt (A) * a;
        if (high)
            set (A * ((A + 1) + (A - 1) * c + k), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - k),
                 (A + 1) - (A - 1) * c + k, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - k);
        else
            set (A * ((A + 1) - (A - 1) * c + k), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - k),
                 (A + 1) + (A - 1) * c + k, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - k);
        active = true;
    }
    void process (float* data, int ch, int n)
    {
        if (! active)
            return;
        for (int i = 0; i < n; ++i)
        {
            const double x = data[i];
            const double y = b0 * x + b1 * x1[ch] + b2 * x2[ch] - a1 * y1[ch] - a2 * y2[ch];
            x2[ch] = x1[ch];
            x1[ch] = x;
            y2[ch] = y1[ch];
            y1[ch] = y;
            data[i] = (float) y;
        }
    }
};

/** Parameters by name, set from any thread; `dirty` says the audio thread must read them again. */
template <size_t N>
struct Params
{
    std::array<const char*, N> names;
    std::array<std::atomic<double>, N> values;
    std::atomic<bool> dirty { true };

    Params (std::array<const char*, N> n, std::array<double, N> defaults) : names (n)
    {
        for (size_t i = 0; i < N; ++i)
            values[i].store (defaults[i]);
    }
    bool set (const juce::String& id, double v)
    {
        for (size_t i = 0; i < N; ++i)
            if (id == names[i])
            {
                values[i].store (v);
                dirty.store (true);
                return true;
            }
        return false;
    }
    double operator[] (size_t i) const { return values[i].load(); }
};

// --- EQ: low cut, low shelf, two bells, high shelf, high cut --------------------------------------

class Eq final : public OwnEffect
{
public:
    void prepare (double r, int) override
    {
        rate = r;
        p.dirty.store (true);
    }
    bool setParam (const juce::String& id, double v) override { return p.set (id, v); }
    void process (float* l, float* r, int n, bool bypass) override
    {
        if (bypass)
            return;
        if (p.dirty.exchange (false))
            update();
        for (auto& b : bands)
        {
            b.process (l, 0, n);
            b.process (r, 1, n);
        }
    }

private:
    void update()
    {
        const double nyq = rate * 0.49;
        if (p[0] >= 0.5) bands[0].lowCut (rate, juce::jmin (p[1], nyq)); else bands[0].off();
        bands[1].shelf (rate, juce::jmin (p[2], nyq), p[3], false);
        bands[2].bell (rate, juce::jmin (p[4], nyq), p[5], p[6]);
        bands[3].bell (rate, juce::jmin (p[7], nyq), p[8], p[9]);
        bands[4].shelf (rate, juce::jmin (p[10], nyq), p[11], true);
        if (p[12] >= 0.5) bands[5].highCut (rate, juce::jmin (p[13], nyq)); else bands[5].off();
    }
    double rate = 48000;
    std::array<Biquad, 6> bands;
    Params<14> p { { "lowCut", "lowCutFreq", "lowFreq", "lowGain", "lowMidFreq", "lowMidGain", "lowMidQ", "highMidFreq", "highMidGain", "highMidQ", "highFreq", "highGain", "highCut", "highCutFreq" },
                   { 0, 80, 120, 0, 400, 0, 1, 2500, 0, 1, 8000, 0, 0, 16000 } };
};

// --- Compressor: feed-forward, stereo-linked peak detector, soft knee -----------------------------

class Compressor final : public OwnEffect
{
public:
    void prepare (double r, int) override
    {
        rate = r;
        p.dirty.store (true);
    }
    bool setParam (const juce::String& id, double v) override { return p.set (id, v); }
    float reduction() const override { return lastReduction.load(); }
    void process (float* l, float* r, int n, bool bypass) override
    {
        if (bypass)
        {
            env = 0;
            lastReduction.store (0);
            return;
        }
        if (p.dirty.exchange (false))
        {
            threshold = p[0];
            ratio = juce::jmax (1.0, p[1]);
            attack = std::exp (-1.0 / (juce::jmax (0.05, p[2]) * 0.001 * rate));
            release = std::exp (-1.0 / (juce::jmax (1.0, p[3]) * 0.001 * rate));
            knee = juce::jmax (0.0, p[4]);
            makeup = p[5];
        }
        double most = 0;
        for (int i = 0; i < n; ++i)
        {
            const double x = juce::jmax (std::abs ((double) l[i]), std::abs ((double) r[i]));
            const double in = 20 * std::log10 (juce::jmax (x, 1e-9));
            double out = in;
            const double over = in - threshold;
            if (knee > 0 && 2 * std::abs (over) <= knee)
                out = in + (1 / ratio - 1) * std::pow (over + knee / 2, 2) / (2 * knee);
            else if (over > 0)
                out = threshold + over / ratio;
            const double gr = out - in; // 0 or below
            const double c = gr < env ? attack : release;
            env = c * env + (1 - c) * gr;
            most = juce::jmin (most, env);
            const auto g = (float) std::pow (10.0, (env + makeup) / 20);
            l[i] *= g;
            r[i] *= g;
        }
        lastReduction.store ((float) -most);
    }

private:
    double rate = 48000, threshold = -18, ratio = 3, attack = 0, release = 0, knee = 6, makeup = 0, env = 0;
    std::atomic<float> lastReduction { 0 };
    Params<6> p { { "threshold", "ratio", "attack", "release", "knee", "makeup" }, { -18, 3, 10, 120, 6, 0 } };
};

// --- Limiter: 5 ms look-ahead, then a safety clip at the ceiling ----------------------------------

class Limiter final : public OwnEffect
{
public:
    void prepare (double r, int) override
    {
        rate = r;
        look = juce::jmax (1, (int) std::lround (0.005 * rate));
        for (auto& d : delay)
            d.assign ((size_t) look, 0.0f);
        pos = 0;
        hold = 1;
        holdLeft = 0;
        env = 1;
        p.dirty.store (true);
    }
    int latency() const override { return look; }
    float reduction() const override { return lastReduction.load(); }
    bool setParam (const juce::String& id, double v) override { return p.set (id, v); }
    void process (float* l, float* r, int n, bool bypass) override
    {
        if (p.dirty.exchange (false))
        {
            gain = std::pow (10.0, p[0] / 20);
            ceiling = std::pow (10.0, p[1] / 20);
            releaseCoeff = std::exp (-1.0 / (juce::jmax (1.0, p[2]) * 0.001 * rate));
            attackCoeff = std::exp (-1.0 / (0.001 * rate)); // 1 ms down, within the look-ahead
        }
        double least = 1;
        const auto c = (float) ceiling;
        for (int i = 0; i < n; ++i)
        {
            const double g = bypass ? 1.0 : gain;
            const double xl = l[i] * g, xr = r[i] * g;
            const double peak = juce::jmax (std::abs (xl), std::abs (xr));
            const double target = peak > ceiling ? ceiling / peak : 1.0;
            // The lowest gain seen in the look-ahead window is held while that peak travels through it.
            if (target <= hold || holdLeft <= 0)
            {
                hold = target;
                holdLeft = look;
            }
            else
                --holdLeft;
            env = hold < env ? hold + (env - hold) * attackCoeff : hold + (env - hold) * releaseCoeff;
            least = juce::jmin (least, env);
            const float dl = delay[0][(size_t) pos], dr = delay[1][(size_t) pos];
            delay[0][(size_t) pos] = (float) xl;
            delay[1][(size_t) pos] = (float) xr;
            pos = (pos + 1) % look;
            if (bypass)
            {
                // Off: only the look-ahead delay, so the track stays in time.
                l[i] = dl;
                r[i] = dr;
                continue;
            }
            l[i] = juce::jlimit (-c, c, (float) (dl * env));
            r[i] = juce::jlimit (-c, c, (float) (dr * env));
        }
        lastReduction.store ((float) (-20 * std::log10 (juce::jmax (least, 1e-6))));
    }

private:
    double rate = 48000, gain = 1, ceiling = 0.891, releaseCoeff = 0, attackCoeff = 0, hold = 1, env = 1;
    int look = 240, pos = 0, holdLeft = 0;
    std::array<std::vector<float>, 2> delay;
    std::atomic<float> lastReduction { 0 };
    Params<3> p { { "gain", "ceiling", "release" }, { 0, -1, 50 } };
};
} // namespace

std::unique_ptr<OwnEffect> makeOwnEffect (const juce::String& kind)
{
    if (kind == "eq")
        return std::make_unique<Eq>();
    if (kind == "compressor")
        return std::make_unique<Compressor>();
    if (kind == "limiter")
        return std::make_unique<Limiter>();
    return nullptr;
}

int Insert::latency() const
{
    if (own != nullptr)
        return own->latency();
    if (plugin != nullptr)
        return plugin->getLatencySamples();
    return 0;
}

void DelayLine::setSize (int samples)
{
    if (samples + 1 <= length)
        return;
    length = samples + 1;
    for (auto& b : buffers)
        b.assign ((size_t) length, 0.0f);
    write = 0;
}

void DelayLine::process (float* const* channels, int numChannels, int n, int delay)
{
    if (delay <= 0 || length == 0)
        return;
    delay = juce::jmin (delay, length - 1);
    int w = write;
    for (int i = 0; i < n; ++i)
    {
        int rd = w - delay;
        if (rd < 0)
            rd += length;
        for (int c = 0; c < numChannels && c < 3; ++c)
        {
            auto& b = buffers[(size_t) c];
            const float in = channels[c][i];
            channels[c][i] = b[(size_t) rd];
            b[(size_t) w] = in;
        }
        if (++w >= length)
            w = 0;
    }
    write = w;
}

} // namespace fh
