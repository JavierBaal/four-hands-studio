// Four Hands Engine: the reverb and chorus of the built-in sounds (F2.1, Fran 01/11/2026).
//
// The same effects the app's SoundFont player uses (SpessaSynth, Apache-2.0): a Dattorro plate
// reverb set as the GS "Hall 2" macro (number 4, its default) and the GS "Chorus 3" macro (2).
// Ported line by line so a track's reverb sounds as it does in the app.
#pragma once

#include <cmath>
#include <cstdint>
#include <vector>

namespace fh::gs
{
class DattorroReverb
{
public:
    float preDelay = 0, preLPF = 0.5f, inputDiffusion1 = 0.75f, inputDiffusion2 = 0.625f, decay = 0.5f;
    float decayDiffusion1 = 0.7f, decayDiffusion2 = 0.5f, damping = 0.005f, excursionRate = 0.1f, excursionDepth = 0.2f, gain = 1;

    explicit DattorroReverb (double rate) : sampleRate (rate), pDLength ((int) rate), pDelay ((size_t) rate, 0.0f)
    {
        for (double d : { .004771345, .003595309, .012734787, .009307483, .022579886, .149625349, .060481839, .1249958, .030509727, .141695508, .089244313, .106280031 })
            makeDelayLine (d);
        for (double t : { .008937872, .099929438, .064278754, .067067639, .066866033, .006283391, .035818689, .011861161, .121870905, .041262054, .08981553, .070931756, .011256342, .004065724 })
            taps.push_back ((std::int16_t) std::lround (t * sampleRate));
    }

    void process (const float* input, float* outputLeft, float* outputRight, int startIndex, int sampleCount)
    {
        const int pd = (int) preDelay;
        const double fi = inputDiffusion1, si = inputDiffusion2, dc = decay, ft = decayDiffusion1, st = decayDiffusion2;
        const double dp = 1 - damping;
        const double ex = excursionRate / sampleRate;
        const double ed = excursionDepth * sampleRate / 1e3;
        const int blockStart = pDWrite;
        for (int j = 0; j < sampleCount; ++j)
            pDelay[(size_t) ((blockStart + j) % pDLength)] = input[j];
        for (int i = 0; i < sampleCount; ++i)
        {
            lp1 += preLPF * (pDelay[(size_t) ((pDLength + pDWrite - pd + i) % pDLength)] - lp1);
            double pre = writeDelay (0, lp1 - fi * readDelay (0));
            pre = writeDelay (1, fi * (pre - readDelay (1)) + readDelay (0));
            pre = writeDelay (2, fi * pre + readDelay (1) - si * readDelay (2));
            pre = writeDelay (3, si * (pre - readDelay (3)) + readDelay (2));
            const double split = si * pre + readDelay (3);
            const double exc = ed * (1 + std::cos (excPhase * 6.28));
            const double exc2 = ed * (1 + std::sin (excPhase * 6.2847));
            double temp = writeDelay (4, split + dc * readDelay (11) + ft * readDelayCAt (4, exc));
            writeDelay (5, readDelayCAt (4, exc) - ft * temp);
            lp2 += dp * (readDelay (5) - lp2);
            temp = writeDelay (6, dc * lp2 - st * readDelay (6));
            writeDelay (7, readDelay (6) + st * temp);
            temp = writeDelay (8, split + dc * readDelay (7) + ft * readDelayCAt (8, exc2));
            writeDelay (9, readDelayCAt (8, exc2) - ft * temp);
            lp3 += dp * (readDelay (9) - lp3);
            temp = writeDelay (10, dc * lp3 - st * readDelay (10));
            writeDelay (11, readDelay (10) + st * temp);
            const double left = readDelayAt (9, taps[0]) + readDelayAt (9, taps[1]) - readDelayAt (10, taps[2]) + readDelayAt (11, taps[3])
                              - readDelayAt (5, taps[4]) - readDelayAt (6, taps[5]) - readDelayAt (7, taps[6]);
            const int idx = i + startIndex;
            outputLeft[idx] += (float) (left * gain);
            const double right = readDelayAt (5, taps[7]) + readDelayAt (5, taps[8]) - readDelayAt (6, taps[9]) + readDelayAt (7, taps[10])
                               - readDelayAt (9, taps[11]) - readDelayAt (10, taps[12]) - readDelayAt (11, taps[13]);
            outputRight[idx] += (float) (right * gain);
            excPhase += ex;
            for (auto& d : delays)
            {
                d.write = (d.write + 1) & d.mask;
                d.read = (d.read + 1) & d.mask;
            }
        }
        pDWrite = (blockStart + sampleCount) % pDLength;
    }

private:
    struct Delay
    {
        std::vector<float> buffer;
        int write, read, mask;
    };

    void makeDelayLine (double length)
    {
        const int len = (int) std::lround (length * sampleRate);
        const int nextPow2 = 1 << (int) std::ceil (std::log2 ((double) len));
        delays.push_back ({ std::vector<float> ((size_t) nextPow2, 0.0f), len - 1, 0, nextPow2 - 1 });
    }
    // Float32Array in SpessaSynth: the line keeps a float, but the assignment gives back the double.
    double writeDelay (int index, double sample)
    {
        auto& d = delays[(size_t) index];
        d.buffer[(size_t) d.write] = (float) sample;
        return sample;
    }
    double readDelay (int index) const
    {
        const auto& d = delays[(size_t) index];
        return d.buffer[(size_t) d.read];
    }
    double readDelayAt (int index, int i) const
    {
        const auto& d = delays[(size_t) index];
        return d.buffer[(size_t) ((d.read + i) & d.mask)];
    }
    double readDelayCAt (int index, double i) const
    {
        const auto& d = delays[(size_t) index];
        const double frac = i - std::trunc (i);
        int at = (int) std::trunc (i) + d.read - 1;
        const double x0 = d.buffer[(size_t) (at++ & d.mask)], x1 = d.buffer[(size_t) (at++ & d.mask)], x2 = d.buffer[(size_t) (at++ & d.mask)], x3 = d.buffer[(size_t) (at & d.mask)];
        const double a = (3 * (x1 - x2) - x0 + x3) / 2, b = 2 * x2 + x0 - (5 * x1 + x3) / 2, c = (x2 - x0) / 2;
        return ((a * frac + b) * frac + c) * frac + x1;
    }

    double sampleRate;
    double lp1 = 0, lp2 = 0, lp3 = 0, excPhase = 0;
    int pDWrite = 0;
    int pDLength;
    std::vector<float> pDelay;
    std::vector<Delay> delays;
    std::vector<std::int16_t> taps;
};

/** SpessaSynthReverb with the GS macro 4 (Hall 2), what SpessaSynth sets on reset. */
class Reverb
{
public:
    explicit Reverb (double rate) : dattorro (rate), sampleRate (rate)
    {
        // setReverbMacro(4): level 64, character 4, pre-lowpass 0, time 64, no pre-delay.
        configure (64, 0, 64, 0);
    }

    /**
     * SpessaSynth's GS reverb parameters (F2.2 parte D: Four Hands' Reverb effect turns them):
     * level and time 0–127, pre-lowpass 0–7 (0: brightest), pre-delay in samples (under a second).
     */
    void configure (int level, int preLowpass, int time, double preDelaySamples)
    {
        dattorro.damping = 0.1f;
        dattorro.inputDiffusion1 = 0.75f;
        dattorro.inputDiffusion2 = 0.625f;
        dattorro.decayDiffusion1 = 0.67f;
        dattorro.decayDiffusion2 = 0.69f;
        dattorro.excursionRate = 0.5f;
        dattorro.excursionDepth = 0.7f;
        const double timeCoefficient = 1.2, gainCoefficient = 1.0, lpfCoefficient = 0.1;
        dattorro.preLPF = (float) std::fmin (1.0, 0.1 + (7 - preLowpass) / 14.0 + lpfCoefficient);
        dattorro.gain = (float) (level / 345.0 * gainCoefficient);
        dattorro.decay = (float) (timeCoefficient * (0.05 + 0.65 * (time / 127.0)));
        dattorro.preDelay = (float) std::fmax (0.0, std::fmin (0.9 * sampleRate, preDelaySamples));
    }

    void process (const float* input, float* left, float* right, int start, int count) { dattorro.process (input, left, right, start, count); }

private:
    DattorroReverb dattorro;
    double sampleRate;
};

/** SpessaSynthChorus with the GS macro 2 (Chorus 3), what SpessaSynth sets on reset. */
class Chorus
{
public:
    explicit Chorus (double rate) : sampleRate (rate), left ((size_t) rate, 0.0f), right ((size_t) rate, 0.0f)
    {
        gain = (float) (64 / 127.0 * 1.3);
        delaySamples = std::fmax (1.0, 80 / 127.0 * 0.025 * sampleRate);
        feedbackGain = 8 * 0.00763;
        rateInc = 3 * 0.122 / sampleRate;
        depthSamples = 19 / 127.0 * 0.025 * sampleRate;
    }

    /** `toReverb` gets what goes on to the reverb (nothing with this macro). */
    void process (const float* input, float* outputLeft, float* outputRight, float* toReverb, int startIndex, int sampleCount)
    {
        const int len = (int) left.size();
        for (int i = 0; i < sampleCount; ++i)
        {
            const double in = input[i];
            const double lfo = 2 * std::fabs (phase - 0.5);
            const double dL = std::fmax (1.0, std::fmin (delaySamples + lfo * depthSamples, (double) len));
            double readL = write - dL;
            if (readL < 0)
                readL += len;
            int x0 = (int) readL, x1 = x0 + 1;
            if (x1 >= len)
                x1 -= len;
            double frac = readL - x0;
            const double outL = left[(size_t) x0] * (1 - frac) + left[(size_t) x1] * frac;
            left[(size_t) write] = (float) (in + outL * feedbackGain);
            const double dR = std::fmax (1.0, std::fmin (delaySamples + (1 - lfo) * depthSamples, (double) len));
            double readR = write - dR;
            if (readR < 0)
                readR += len;
            x0 = (int) readR;
            x1 = x0 + 1;
            if (x1 >= len)
                x1 -= len;
            frac = readR - x0;
            const double outR = right[(size_t) x0] * (1 - frac) + right[(size_t) x1] * frac;
            outputLeft[i + startIndex] += (float) (outL * gain);
            outputRight[i + startIndex] += (float) (outR * gain);
            toReverb[i] += (float) ((outL + outR) / 2 * reverbGain);
            right[(size_t) write] = (float) (in + outR * feedbackGain);
            if (++write >= len)
                write = 0;
            if ((phase += rateInc) >= 1)
                phase -= 1;
        }
    }

private:
    double sampleRate;
    std::vector<float> left, right;
    double phase = 0;
    int write = 0;
    float gain = 0.5f;
    double reverbGain = 0, delaySamples = 1, depthSamples = 0, rateInc = 0, feedbackGain = 0;
};

} // namespace fh::gs
