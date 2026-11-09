// Four Hands Engine: entry point.
//
//   FourHandsEngine --port 0 --token <t> --cache <file>   normal use: Four Hands starts it
//   FourHandsEngine --selftest <folder with VST3>          loads the first instrument, plays a note
//                                                          offline and checks it sounds (exit code)
//   FourHandsEngine --render <bank> <song.mid> <out.wav>   plays a MIDI file with the built-in sounds
//                                                          offline, to compare them with the app's
//   FourHandsEngine --bench <folder with VST3> [strips] [seconds]
//                                                          the load test (09/11/2026): many plugin tracks
//                                                          with effects, in real time, with a thread that
//                                                          talks to the engine like the app; prints where
//                                                          the time goes
//
// On start it prints "FH_ENGINE_READY <port>" so Four Hands knows where to connect. It quits when
// Four Hands goes (connection lost) or never comes (30 s): it must not outlive the app.
#include "CrashDump.h"
#include "Engine.h"
#include "Link.h"
#include "SoundFontSynth.h"

#include <cmath>
#include <iostream>
#include <thread>

namespace
{
juce::String argAfter (const juce::StringArray& args, const juce::String& name)
{
    const auto i = args.indexOf (name);
    return i >= 0 && i + 1 < args.size() ? args[i + 1].unquoted() : juce::String();
}

/** The S2 self test without a device: scan, load, play C4 for half a second, measure. */
int selfTest (const juce::String& folder)
{
    fh::Engine engine;
    const auto pedal = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("fh-engine-selftest-scan.txt");
    engine.scan (juce::FileSearchPath (folder), pedal, [] (const juce::String& f, float) { std::cout << "scanning " << f << std::endl; });
    juce::PluginDescription chosen;
    bool found = false;
    for (const auto& d : engine.known().getTypes())
    {
        std::cout << "found " << d.name << " (" << d.pluginFormatName << (d.isInstrument ? ", instrument" : "") << ")" << std::endl;
        if (d.isInstrument && ! found)
        {
            chosen = d;
            found = true;
        }
    }
    if (! found)
    {
        std::cout << "FAIL no instrument found" << std::endl;
        return 2;
    }
    engine.prepareOffline (48000.0, 512);
    const auto problem = engine.load (0, chosen);
    if (problem.isNotEmpty())
    {
        std::cout << "FAIL load: " << problem << std::endl;
        return 3;
    }
    engine.schedule (0, 0.0, juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100));
    engine.schedule (0, 0.5, juce::MidiMessage::noteOff (1, 60));
    juce::AudioBuffer<float> out (2, 48000);
    out.clear();
    engine.renderOffline (out);
    const auto during = out.getRMSLevel (0, 4800, 9600);
    const auto after = out.getRMSLevel (0, 40000, 4800);
    std::cout << "rms during " << during << " after " << after << std::endl;
    const auto state = engine.state (0);
    std::cout << "state " << (int) state.getSize() << " bytes" << std::endl;
    if (during < 0.001f)
    {
        std::cout << "FAIL silent" << std::endl;
        return 4;
    }
    if (after > during * 0.5f)
    {
        std::cout << "FAIL the note did not stop" << std::endl;
        return 5;
    }
    // F2.2: the plugin's strip. Half the fader halves the sound (dry); a reverb send leaves a tail.
    // Parte D: the send goes to bus 0, which has Four Hands' Reverb (the «Reverb» bus).
    auto sendToReverb = [&engine] (double level) {
        engine.setChain (fh::Engine::kBusChain, { fh::Engine::InsertSpec { "xr", "reverb", "", false, {} } });
        fh::Engine::Route strip;
        if (level > 0)
            strip.sends.push_back ({ 0, (float) level, false });
        engine.setRouting ({ { 0, strip } }, { { 0, fh::Engine::Route {} } }, { 0 }, 0);
    };
    auto play = [&engine, &sendToReverb] (double gain, double reverb) {
        engine.setMix (0, gain, 0.0);
        sendToReverb (reverb);
        engine.schedule (0, 0.0, juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100));
        engine.schedule (0, 0.5, juce::MidiMessage::noteOff (1, 60));
        juce::AudioBuffer<float> b (2, 48000);
        b.clear();
        engine.renderOffline (b);
        return b;
    };
    const auto dry = play (0.5, 0.0);
    const auto half = dry.getRMSLevel (0, 4800, 9600);
    const auto wet = play (1.0, 1.0);
    const auto tail = wet.getRMSLevel (0, 40000, 4800);
    std::cout << "strip: rms at half fader " << half << " (" << half / during << " of full), reverb tail " << tail << std::endl;
    if (std::abs (half / during - 0.5f) > 0.08f)
    {
        std::cout << "FAIL the fader" << std::endl;
        return 6;
    }
    if (tail < 1e-5f)
    {
        std::cout << "FAIL no reverb from the send" << std::endl;
        return 7;
    }
    // F2.2 parte B: a strip that goes off is silent at once, in the middle of a note (its plugin's
    // own tail stops; what it already sent to the Reverb bus rings out there, as in the DAWs).
    {
        engine.setMix (0, 1.0, 0.0, true);
        engine.schedule (0, 0.0, juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100));
        engine.schedule (0, 1.0, juce::MidiMessage::noteOff (1, 60));
        juce::AudioBuffer<float> a (2, 14400), b (2, 14400);
        a.clear();
        b.clear();
        engine.renderOffline (a);
        engine.setMix (0, 1.0, 0.0, false);
        engine.takeMeters (false); // count from here on
        engine.renderOffline (b);
        const auto offStrip = engine.takeMeters (false)[0].peak;
        engine.setMix (0, 1.0, 0.0, true);
        juce::AudioBuffer<float> rest (2, 48000);
        engine.renderOffline (rest);
        const auto on = a.getRMSLevel (0, 4800, 4800);
        // The strip itself: the master may still carry the Reverb bus's tail of the tests before.
        std::cout << "strip off: rms on " << on << ", strip peak while off " << offStrip << std::endl;
        if (on < 0.001f || offStrip > 1e-9)
        {
            std::cout << "FAIL a strip that goes off keeps sounding" << std::endl;
            return 10;
        }
    }
    // The master fader: half the gain, half the sound.
    {
        engine.setMasterGain (0.5);
        const auto m = play (1.0, 0.0);
        engine.setMasterGain (1.0);
        const auto ratio = m.getRMSLevel (0, 4800, 9600) / during;
        std::cout << "master at half: " << ratio << " of full" << std::endl;
        if (std::abs (ratio - 0.5f) > 0.08f)
        {
            std::cout << "FAIL the master fader" << std::endl;
            return 11;
        }
    }
    // F2.2 parte C: insert effects on strip 0.
    {
        using Spec = fh::Engine::InsertSpec;
        auto rmsWith = [&] (std::vector<Spec> chain) {
            engine.setChain (0, chain);
            const auto b = play (1.0, 0.0);
            return b.getRMSLevel (0, 4800, 9600);
        };
        const auto plain = rmsWith ({});
        // A high cut at 200 Hz takes most of a synth's energy away; bypassed, nothing changes.
        Spec eq { "x1", "eq", "", false, { { "highCut", 1 }, { "highCutFreq", 200 } } };
        const auto cut = rmsWith ({ eq });
        eq.bypass = true;
        const auto eqOff = rmsWith ({ eq });
        // A compressor at -40 dB, 10:1, lowers it; the limiter keeps every sample under -12 dB.
        Spec comp { "x2", "compressor", "", false, { { "threshold", -40 }, { "ratio", 10 }, { "attack", 1 }, { "knee", 0 } } };
        const auto squeezed = rmsWith ({ comp });
        engine.setChain (0, { Spec { "x3", "limiter", "", false, { { "gain", 12 }, { "ceiling", -12 } } } });
        const auto lim = play (1.0, 0.0);
        const auto peak = lim.getMagnitude (0, 0, lim.getNumSamples());
        std::cout << "effects: plain " << plain << ", high cut " << cut << ", eq off " << eqOff << ", compressed " << squeezed
                  << ", limiter peak " << peak << " (ceiling 0.251), latency " << engine.chainLatency (0) << ", compensation " << engine.compensation() << std::endl;
        if (cut > plain * 0.6f || std::abs (eqOff / plain - 1.0f) > 0.02f)
        {
            std::cout << "FAIL the EQ" << std::endl;
            return 12;
        }
        if (squeezed > plain * 0.6f)
        {
            std::cout << "FAIL the compressor" << std::endl;
            return 13;
        }
        if (peak > 0.2512f + 1e-4f || engine.chainLatency (0) != 240 || engine.compensation() != 240)
        {
            std::cout << "FAIL the limiter" << std::endl;
            return 14;
        }
        // Compensation: strip 1 has no effects, so it waits the limiter's 240 samples. A note on
        // each strip at the same time starts at the same sample on both.
        engine.load (1, chosen);
        auto onset = [&] (int strip) {
            engine.setMix (0, 1.0, 0.0, strip == 0);
            engine.setMix (1, 1.0, 0.0, strip == 1);
            engine.schedule (strip, 0.0, juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100));
            engine.schedule (strip, 0.2, juce::MidiMessage::noteOff (1, 60));
            juce::AudioBuffer<float> b (2, 24000);
            b.clear();
            engine.renderOffline (b);
            juce::AudioBuffer<float> rest (2, 48000);
            engine.renderOffline (rest);
            for (int i = 0; i < b.getNumSamples(); ++i)
                if (std::abs (b.getSample (0, i)) > 1e-4f)
                    return i;
            return -1;
        };
        engine.setChain (0, { Spec { "x3", "limiter", "", false, { { "gain", 0 }, { "ceiling", 0 } } } });
        const int a = onset (0), c = onset (1);
        std::cout << "compensation: onset with limiter " << a << ", without " << c << std::endl;
        if (a < 0 || c < 0 || std::abs (a - c) > 1)
        {
            std::cout << "FAIL the compensation" << std::endl;
            return 15;
        }
        // Back as before: no effects, no compensation, both strips on.
        engine.setChain (0, {});
        engine.setMix (0, 1.0, 0.0, true);
        engine.setMix (1, 1.0, 0.0, true);
        engine.unload (1);
        if (engine.compensation() != 0)
        {
            std::cout << "FAIL the compensation stays after the effects went" << std::endl;
            return 16;
        }
    }
    // F2.2 parte D: buses.
    {
        using Spec = fh::Engine::InsertSpec;
        using Route = fh::Engine::Route;
        // Four Hands' Reverb at its defaults is the GS reverb exactly (what a send at 100 % gave).
        {
            const auto fx = fh::makeOwnEffect ("reverb");
            fx->prepare (48000.0, 512);
            fh::gs::Reverb gs (48000.0);
            juce::Random random (7);
            std::vector<float> in (48000), l (48000, 0.0f), r (48000, 0.0f), gl (48000, 0.0f), gr (48000, 0.0f);
            for (int i = 0; i < 2400; ++i)
                in[(size_t) i] = random.nextFloat() * 0.5f - 0.25f;
            for (int i = 0; i < 48000; ++i)
                l[(size_t) i] = r[(size_t) i] = in[(size_t) i] / 1.8f;
            for (int i = 0; i < 48000; i += 512)
            {
                const int n = juce::jmin (512, 48000 - i);
                fx->process (l.data() + i, r.data() + i, n, false);
                gs.process (in.data() + i, gl.data() + i, gr.data() + i, 0, n);
            }
            float worst = 0, energy = 0;
            for (int i = 0; i < 48000; ++i)
            {
                worst = juce::jmax (worst, std::abs (l[(size_t) i] - gl[(size_t) i]), std::abs (r[(size_t) i] - gr[(size_t) i]));
                energy = juce::jmax (energy, std::abs (gl[(size_t) i]));
            }
            std::cout << "reverb effect: largest difference with the GS reverb " << worst << " (peak " << energy << ")" << std::endl;
            if (energy < 1e-3f || worst > 1e-5f)
            {
                std::cout << "FAIL the Reverb effect is not the GS reverb" << std::endl;
                return 30;
            }
        }
        // The delay (Fran, 04/11/2026): a quarter note at 120 BPM is 24000 samples; at 100 BPM, 28800;
        // 100 ms without sync, 4800. In ping-pong the first repeat is on the left, the next on the right.
        {
            auto echoes = [] (std::vector<std::pair<juce::String, double>> params, double bpm) {
                const auto fx = fh::makeOwnEffect ("delay");
                fx->prepare (48000.0, 512);
                for (const auto& [k, v] : params)
                    fx->setParam (k, v);
                std::vector<float> l (72000, 0.0f), r (72000, 0.0f);
                l[0] = r[0] = 1.0f;
                for (int i = 0; i < 72000; i += 512)
                {
                    fx->setTempo (bpm);
                    fx->process (l.data() + i, r.data() + i, juce::jmin (512, 72000 - i), false);
                }
                return std::make_pair (l, r);
            };
            auto peakAt = [] (const std::vector<float>& x, int from, int to) {
                int at = from;
                for (int i = from; i < to; ++i)
                    if (std::abs (x[(size_t) i]) > std::abs (x[(size_t) at]))
                        at = i;
                return std::make_pair (at, std::abs (x[(size_t) at]));
            };
            const auto [l120, r120] = echoes ({}, 120.0);
            const auto first = peakAt (l120, 1000, 36000), second = peakAt (l120, 36000, 60000);
            const auto [l100, r100] = echoes ({}, 100.0);
            const auto slower = peakAt (l100, 1000, 36000);
            const auto [lms, rms100] = echoes ({ { "sync", 0 }, { "time", 100 } }, 120.0);
            const auto fast = peakAt (lms, 100, 9000);
            const auto [lpp, rpp] = echoes ({ { "pingPong", 1 } }, 120.0);
            const auto ppFirstL = peakAt (lpp, 1000, 36000), ppFirstR = peakAt (rpp, 1000, 36000), ppSecondR = peakAt (rpp, 36000, 60000);
            std::cout << "delay: 1/4 at 120 BPM " << first.first << " (" << first.second << "), next " << second.first << " (" << second.second << "), at 100 BPM " << slower.first
                      << ", 100 ms " << fast.first << ", ping-pong left " << ppFirstL.second << " right " << ppFirstR.second << " then right " << ppSecondR.first << std::endl;
            if (std::abs (first.first - 24000) > 3 || std::abs (second.first - 48000) > 6 || second.second >= first.second || std::abs (slower.first - 28800) > 3 || std::abs (fast.first - 4800) > 3)
            {
                std::cout << "FAIL the delay's time" << std::endl;
                return 34;
            }
            if (ppFirstR.second > ppFirstL.second * 0.01f || std::abs (ppSecondR.first - 48000) > 6)
            {
                std::cout << "FAIL the delay's ping-pong" << std::endl;
                return 35;
            }
        }
        auto rms = [&] (double stripGain) {
            engine.setMix (0, stripGain, 0.0);
            const auto b = [&] {
                engine.schedule (0, 0.0, juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100));
                engine.schedule (0, 0.5, juce::MidiMessage::noteOff (1, 60));
                juce::AudioBuffer<float> x (2, 48000);
                x.clear();
                engine.renderOffline (x);
                return x;
            }();
            return b.getRMSLevel (0, 4800, 9600);
        };
        engine.setChain (fh::Engine::kBusChain, {});
        // Strip 0 → bus 1 → bus 0 → master; bus 0 at half.
        Route strip, bus1, bus0;
        strip.out = 1;
        bus1.out = 0;
        engine.setRouting ({ { 0, strip } }, { { 0, bus0 }, { 1, bus1 } }, { 1, 0 }, -1);
        const auto through = rms (1.0);
        engine.setBusMix (0, 0.5, 0.0);
        const auto halfBus = rms (1.0);
        engine.setBusMix (0, 1.0, 0.0, false);
        const auto busOff = rms (1.0);
        engine.setBusMix (0, 1.0, 0.0);
        const auto busLevels = engine.takeBusMeters (false);
        // A send before the fader still sounds with the fader down; one after it does not.
        Route pre, post;
        pre.sends.push_back ({ 1, 1.0f, true });
        post.sends.push_back ({ 1, 1.0f, false });
        engine.setRouting ({ { 0, pre } }, { { 0, bus0 }, { 1, bus1 } }, { 1, 0 }, -1);
        const auto preSend = rms (0.0);
        engine.setRouting ({ { 0, post } }, { { 0, bus0 }, { 1, bus1 } }, { 1, 0 }, -1);
        const auto postSend = rms (0.0);
        std::cout << "buses: through two buses " << through << " (direct " << during << "), bus at half " << halfBus << ", bus off " << busOff
                  << ", pre send with the fader down " << preSend << ", post send " << postSend << ", buses metered " << busLevels.size() << std::endl;
        if (std::abs (through / during - 1.0f) > 0.02f || std::abs (halfBus / through - 0.5f) > 0.05f || busOff > 1e-6f)
        {
            std::cout << "FAIL the buses" << std::endl;
            return 31;
        }
        if (std::abs (preSend / through - 1.0f) > 0.02f || postSend > 1e-6f || busLevels.size() != 2)
        {
            std::cout << "FAIL the sends" << std::endl;
            return 32;
        }
        // Compensation through a bus: bus 0 has the limiter (240 samples); strip 0 goes through it,
        // strip 1 straight to the master. Both start at the same sample.
        engine.load (1, chosen);
        engine.setChain (fh::Engine::kBusChain, { Spec { "x9", "limiter", "", false, { { "gain", 0 }, { "ceiling", 0 } } } });
        Route via;
        via.out = 0;
        engine.setRouting ({ { 0, via } }, { { 0, Route {} } }, { 0 }, -1);
        auto onset = [&] (int s) {
            engine.setMix (0, 1.0, 0.0, s == 0);
            engine.setMix (1, 1.0, 0.0, s == 1);
            engine.schedule (s, 0.0, juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100));
            engine.schedule (s, 0.2, juce::MidiMessage::noteOff (1, 60));
            juce::AudioBuffer<float> b (2, 24000);
            b.clear();
            engine.renderOffline (b);
            juce::AudioBuffer<float> rest (2, 48000);
            engine.renderOffline (rest);
            for (int i = 0; i < b.getNumSamples(); ++i)
                if (std::abs (b.getSample (0, i)) > 1e-4f)
                    return i;
            return -1;
        };
        const int viaBus = onset (0), direct = onset (1);
        std::cout << "bus compensation: through the limiter's bus " << viaBus << ", straight " << direct << std::endl;
        if (viaBus < 0 || direct < 0 || std::abs (viaBus - direct) > 1)
        {
            std::cout << "FAIL the compensation through a bus" << std::endl;
            return 33;
        }
        engine.setChain (fh::Engine::kBusChain, {});
        engine.setRouting ({}, {}, {}, -1);
        engine.setMix (0, 1.0, 0.0, true);
        engine.setMix (1, 1.0, 0.0, true);
        engine.unload (1);
    }
    // F2.3 (04/11/2026), the AI's ear: a 1 kHz sine at -20 dBFS on both sides is -20 LUFS (BS.1770),
    // its energy is in the mids; a sine at a quarter of the rate, 45° off, peaks 3 dB over its samples.
    {
        fh::Analyzer a (4, 3);
        a.prepare (48000.0);
        a.ensureTaps ({ 0, 3 });
        juce::Thread::sleep (100);
        std::vector<float> sine (480), quarter (480);
        for (int block = 0; block < 1000; ++block) // 10 s, at 120 BPM (a quarter note every half second)
        {
            for (int i = 0; i < 480; ++i)
            {
                const double t = (block * 480 + i) / 48000.0;
                sine[(size_t) i] = (float) (0.1 * std::sin (2 * juce::MathConstants<double>::pi * 1000.0 * t));
                quarter[(size_t) i] = (float) (0.5 * std::sin (juce::MathConstants<double>::halfPi * (block * 480 + i) + juce::MathConstants<double>::pi / 4));
            }
            while (! a.beginBlock (480, block * 480 * 2.0 / 48000.0, 2.0 / 48000.0))
                juce::Thread::sleep (5);
            a.write (0, sine.data(), sine.data(), 480);
            a.write (3, quarter.data(), quarter.data(), 480);
            a.endBlock();
        }
        juce::Thread::sleep (600);
        const auto res = a.results();
        const fh::Analyzer::Result* s0 = nullptr;
        const fh::Analyzer::Result* m = nullptr;
        for (const auto& r : res)
            (r.key == 0 ? s0 : m) = &r;
        if (s0 == nullptr || m == nullptr || s0->frames.size() < 9)
        {
            std::cout << "FAIL the analysis measured nothing" << std::endl;
            return 40;
        }
        const auto& f = s0->frames[5];
        int loudest = 0;
        for (int b = 1; b < fh::kBands; ++b)
            if (f.bands[(size_t) b] > f.bands[(size_t) loudest])
                loudest = b;
        const double tp = 20 * std::log10 (m->truePeak), sp = 20 * std::log10 (m->peak);
        std::cout << "analysis: sine " << s0->integrated << " LUFS (range " << s0->range << "), " << s0->frames.size() << " frames, frame 5 at ppq " << f.ppq
                  << " loudest band " << loudest << "; quarter-rate sine peak " << sp << " dBFS, true peak " << tp << " dBTP, gaps " << a.gaps() << std::endl;
        if (std::abs (s0->integrated + 20.0) > 0.3 || loudest != 3 || std::abs (f.ppq - 10.0) > 0.01)
        {
            std::cout << "FAIL the loudness, the bands or the position" << std::endl;
            return 41;
        }
        if (std::abs (tp - 20 * std::log10 (0.5)) > 0.3 || std::abs (sp - tp + 3.0) > 0.3)
        {
            std::cout << "FAIL the true peak" << std::endl;
            return 42;
        }
    }
    // F2.2 (04/11/2026): the plugins read where the song is. Playing from beat 4 at 120 BPM, half
    // a second later it is at beat 5; stopped, it says so.
    {
        if (! engine.pluginHasTransport (0))
        {
            std::cout << "FAIL the plugin does not read the engine's transport" << std::endl;
            return 17;
        }
        engine.scheduleTransport (0.0, { true, 4.0, 120.0, 4, 4, 4.0 });
        juce::AudioBuffer<float> b (2, 24000);
        engine.renderOffline (b);
        const auto now = engine.transportNow();
        const double ppq = now.getPpqPosition().orFallback (-1);
        std::cout << "transport: playing " << now.getIsPlaying() << ", ppq " << ppq << ", bpm " << now.getBpm().orFallback (0) << std::endl;
        if (! now.getIsPlaying() || std::abs (ppq - 5.0) > 0.02 || std::abs (now.getBpm().orFallback (0) - 120.0) > 1e-9)
        {
            std::cout << "FAIL the transport" << std::endl;
            return 18;
        }
        engine.scheduleTransport (0.0, { false, 5.0, 120.0, 4, 4, 4.0 });
        engine.renderOffline (b);
        if (engine.transportNow().getIsPlaying())
        {
            std::cout << "FAIL the transport does not stop" << std::endl;
            return 19;
        }
    }
    // F2.3: the engine measures what plays while the transport plays, and stops when it stops.
    {
        engine.resetLevels();
        juce::Thread::sleep (100);
        engine.scheduleTransport (0.0, { true, 0.0, 120.0, 4, 4, 0.0 });
        for (int k = 0; k < 6; ++k)
        {
            engine.schedule (0, k * 0.5, juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100));
            engine.schedule (0, k * 0.5 + 0.4, juce::MidiMessage::noteOff (1, 60));
        }
        juce::AudioBuffer<float> b (2, 480);
        for (int i = 0; i < 300; ++i) // 3 s, in blocks like a device's, not much faster than one
        {
            engine.renderOffline (b);
            juce::Thread::sleep (2);
        }
        engine.scheduleTransport (0.0, { false, 6.0, 120.0, 4, 4, 4.0 });
        engine.renderOffline (b);
        juce::Thread::sleep (500);
        int frames = 0;
        double loud = -100, masterLoud = -100, lastPpq = -1;
        for (const auto& r : engine.analysis())
        {
            if (r.key == 0)
            {
                frames = (int) r.frames.size();
                loud = r.integrated;
                if (! r.frames.empty())
                    lastPpq = r.frames.back().ppq;
            }
            if (r.key == fh::Engine::kMasterChain)
                masterLoud = r.integrated;
        }
        std::cout << "engine analysis: strip 0 " << frames << " frames, " << loud << " LUFS, last frame at ppq " << lastPpq << "; master " << masterLoud << " LUFS, gaps " << engine.analysisGaps() << std::endl;
        if (frames < 2 || loud < -60 || masterLoud < -60 || std::abs (lastPpq - 4.0) > 0.05 || engine.analysisGaps() > 0)
        {
            std::cout << "FAIL the engine's analysis" << std::endl;
            return 43;
        }
    }
    // A2: a strip far past the 16 MIDI channels plays the same as the first one.
    engine.unload (0);
    if (const auto again = engine.load (300, chosen); again.isNotEmpty())
    {
        std::cout << "FAIL load on strip 300: " << again << std::endl;
        return 8;
    }
    engine.schedule (300, 0.0, juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100));
    engine.schedule (300, 0.5, juce::MidiMessage::noteOff (1, 60));
    juce::AudioBuffer<float> high (2, 48000);
    high.clear();
    engine.renderOffline (high);
    const auto far = high.getRMSLevel (0, 4800, 9600);
    std::cout << "strip 300: rms " << far << " (" << far / during << " of strip 0), strips in use " << engine.stripsInUse() << std::endl;
    if (std::abs (far / during - 1.0f) > 0.08f)
    {
        std::cout << "FAIL strip 300" << std::endl;
        return 9;
    }

    // 09/11/2026: the stop silences a plugin on the channel it was played on (panic only goes to the
    // channels each plugin was sent something on).
    engine.panic();
    high.clear();
    engine.renderOffline (high);
    engine.schedule (300, 0.0, juce::MidiMessage::noteOn (3, 64, (juce::uint8) 100));
    high.clear();
    engine.renderOffline (high);
    const auto held = high.getRMSLevel (0, 24000, 4800);
    engine.panic();
    high.clear();
    engine.renderOffline (high);
    const auto stopped = high.getRMSLevel (0, 24000, 4800);
    std::cout << "panic on channel 3: held " << held << " after " << stopped << std::endl;
    if (held < 0.001f || stopped > held * 0.05f)
    {
        std::cout << "FAIL panic did not silence channel 3" << std::endl;
        return 36;
    }
    std::cout << "OK" << std::endl;
    return 0;
}
/**
 * The built-in sounds without a device: a MIDI file through their slot, written as a 24-bit WAV.
 * Optional `extra` banks go at offsets 60, 66… (as the app adds them).
 */
int renderSong (const juce::String& bankPath, const juce::String& midiPath, const juce::String& wavPath, const juce::StringArray& extra)
{
    fh::Engine engine;
    const double rate = 48000.0;
    engine.prepareOffline (rate, 512);
    engine.sounds();
    int presets = 0;
    auto problem = engine.loadSoundBank (0, juce::File (bankPath), presets);
    if (problem.isNotEmpty())
    {
        std::cout << "FAIL bank: " << problem << std::endl;
        return 2;
    }
    std::cout << "bank " << presets << " presets" << std::endl;
    for (int i = 0; i < extra.size(); ++i)
    {
        problem = engine.loadSoundBank (fh::SoundFontSynth::kFirstOffset + i * fh::SoundFontSynth::kOffsetStep, juce::File (extra[i]), presets);
        if (problem.isNotEmpty())
        {
            std::cout << "FAIL bank: " << problem << std::endl;
            return 2;
        }
    }

    juce::MidiFile file;
    juce::FileInputStream in ((juce::File (midiPath)));
    if (! in.openedOk() || ! file.readFrom (in))
    {
        std::cout << "FAIL midi" << std::endl;
        return 3;
    }
    file.convertTimestampTicksToSeconds();
    juce::MidiMessageSequence all;
    for (int t = 0; t < file.getNumTracks(); ++t)
        all.addSequence (*file.getTrack (t), 0.0);
    all.updateMatchedPairs();
    double end = 0.0;
    const int quantize = juce::SystemStats::getEnvironmentVariable ("FH_RENDER_BLOCK", "0").getIntValue();
    // FH_RENDER_SEND=1: every strip sends this much to the Reverb bus, as a plugin track does (tests).
    const auto send = juce::SystemStats::getEnvironmentVariable ("FH_RENDER_SEND", "0").getDoubleValue();
    // FH_RENDER_STRIP=n (A2): MIDI channel c plays on strip n + c instead of on its own channel (tests:
    // the strip must not change the sound).
    const int stripBase = juce::SystemStats::getEnvironmentVariable ("FH_RENDER_STRIP", "-1").getIntValue();
    // FH_RENDER_ROUTED=1: with Four Hands' routing and no buses (a new song since parte D): it must
    // sound as without routing (tests: the bank's own reverb stays).
    if (juce::SystemStats::getEnvironmentVariable ("FH_RENDER_ROUTED", "0") == "1")
        engine.setRouting ({}, {}, {}, -1);
    if (send > 0)
    {
        // Parte D: every strip sends to bus 0, which has the Reverb, as Four Hands' «Reverb» bus.
        engine.setChain (fh::Engine::kBusChain, { fh::Engine::InsertSpec { "xr", "reverb", "", false, {} } });
        std::vector<std::pair<int, fh::Engine::Route>> strips;
        for (int ch = 0; ch < 16; ++ch)
        {
            fh::Engine::Route r;
            r.sends.push_back ({ 0, (float) send, false });
            strips.push_back ({ stripBase >= 0 ? stripBase + ch : ch, r });
        }
        engine.setRouting (strips, { { 0, fh::Engine::Route {} } }, { 0 }, 0);
    }
    for (const auto* e : all)
    {
        if (e->message.isMetaEvent())
            continue;
        // FH_RENDER_BLOCK=128: events at the start of their 128-sample block, as SpessaSynth's own
        // sequencer plays a file (to compare the two sample by sample).
        auto t = e->message.getTimeStamp();
        if (quantize > 0)
            t = std::ceil (t * rate / quantize - 1e-9) * quantize / rate;
        engine.schedule (fh::kSoundsSlot, t, e->message, stripBase >= 0 ? stripBase + e->message.getChannel() - 1 : -1);
        end = juce::jmax (end, e->message.getTimeStamp());
    }
    juce::AudioBuffer<float> out (2, (int) ((end + 3.0) * rate));
    out.clear();
    // FH_RENDER_ANALYSIS=bpm (F2.3): the transport plays at that tempo and the AI's ear measures it;
    // rendered in pieces not much faster than real time, so the analysis keeps up.
    const auto analysisBpm = juce::SystemStats::getEnvironmentVariable ("FH_RENDER_ANALYSIS", "0").getDoubleValue();
    if (analysisBpm > 0)
    {
        engine.resetLevels();
        juce::Thread::sleep (100);
        engine.scheduleTransport (0.0, { true, 0.0, analysisBpm, 4, 4, 0.0 });
        for (int done = 0; done < out.getNumSamples(); done += 4800)
        {
            const int n = juce::jmin (4800, out.getNumSamples() - done);
            juce::AudioBuffer<float> piece (out.getArrayOfWritePointers(), 2, done, n);
            engine.renderOffline (piece);
            juce::Thread::sleep (8);
        }
        juce::Thread::sleep (800);
        for (const auto& r : engine.analysis())
        {
            std::array<double, fh::kBands> bands {};
            int active = 0;
            for (const auto& f : r.frames)
                if (f.loudness > -50)
                {
                    ++active;
                    for (int b = 0; b < fh::kBands; ++b)
                        bands[(size_t) b] += std::pow (10.0, f.bands[(size_t) b] / 10.0);
                }
            std::cout << "analysis key " << r.key << ": " << r.integrated << " LUFS, range " << r.range << ", true peak " << 20 * std::log10 (juce::jmax (1e-9, r.truePeak)) << ", frames " << r.frames.size() << ", bands";
            for (double b : bands)
                std::cout << " " << (active ? std::round (10 * std::log10 (b / active + 1e-12) * 10) / 10 : -120.0);
            std::cout << std::endl;
        }
        std::cout << "analysis gaps " << engine.analysisGaps() << std::endl;
    }
    else
        engine.renderOffline (out);
    std::cout << "rms " << out.getRMSLevel (0, 0, out.getNumSamples()) << " peak " << out.getMagnitude (0, out.getNumSamples()) << std::endl;

    juce::File wav (wavPath);
    wav.deleteFile();
    juce::WavAudioFormat format;
    std::unique_ptr<juce::AudioFormatWriter> writer (format.createWriterFor (new juce::FileOutputStream (wav), rate, 2, 24, {}, 0));
    if (writer == nullptr)
    {
        std::cout << "FAIL wav" << std::endl;
        return 4;
    }
    writer->writeFromAudioSampleBuffer (out, 0, out.getNumSamples());
    std::cout << "OK" << std::endl;
    return 0;
}
} // namespace

/**
 * The load test (09/11/2026): `strips` instances of the instrument, each with an EQ, a compressor
 * and a reverb, chords and a CC11 curve on all of them, blocks of 512 at 48 kHz paced in real time,
 * and a second thread doing what the app does while it plays (notes 200 ms ahead, meters, faders).
 */
static int bench (const juce::String& folder, int strips, double seconds)
{
    fh::Engine engine;
    const auto pedal = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("fh-engine-bench-scan.txt");
    engine.scan (juce::FileSearchPath (folder), pedal, [] (const juce::String&, float) {});
    juce::PluginDescription chosen;
    bool found = false;
    for (const auto& d : engine.known().getTypes())
        if (d.isInstrument && ! found)
            chosen = d, found = true;
    if (! found)
    {
        std::cout << "FAIL no instrument found" << std::endl;
        return 2;
    }
    constexpr double rate = 48000.0;
    constexpr int block = 512;
    engine.prepareOffline (rate, block);
    for (int s = 0; s < strips; ++s)
    {
        if (const auto problem = engine.load (s, chosen); problem.isNotEmpty())
        {
            std::cout << "FAIL load " << problem << std::endl;
            return 3;
        }
        std::vector<fh::Engine::InsertSpec> chain (3);
        chain[0].id = "eq" + juce::String (s), chain[0].kind = "eq";
        chain[1].id = "comp" + juce::String (s), chain[1].kind = "compressor";
        chain[2].id = "rev" + juce::String (s), chain[2].kind = "reverb";
        engine.setChain (s, chain);
        engine.setMix (s, 0.3, 0.0);
    }
    std::atomic<bool> running { true };
    const auto t0 = juce::Time::getMillisecondCounterHiRes();
    // The app: every 20 ms, what falls in the next 200 ms that it has not sent; meters at 30 Hz; a fader.
    std::thread app ([&] {
        double sentUntil = 0; // seconds of song
        int tick = 0;
        while (running.load())
        {
            const double now = (juce::Time::getMillisecondCounterHiRes() - t0) / 1000.0;
            const double until = now + 0.2;
            for (double t = std::ceil (sentUntil * 100.0) / 100.0; t < until; t += 0.01)
            {
                const int step = (int) std::llround (t * 100.0);
                for (int s = 0; s < strips; ++s)
                {
                    const int ch = 1 + s % 16;
                    if (step % 25 == 0)
                        for (int n = 0; n < 4; ++n)
                        {
                            engine.schedule (s, t - now, juce::MidiMessage::noteOn (ch, 48 + 7 * n + s % 5, (juce::uint8) 90), s);
                            engine.schedule (s, t + 0.24 - now, juce::MidiMessage::noteOff (ch, 48 + 7 * n + s % 5), s);
                        }
                    engine.schedule (s, t - now, juce::MidiMessage::controllerEvent (ch, 11, 64 + (step + s) % 64), s);
                }
            }
            sentUntil = until;
            if (tick % 2 == 0)
            {
                engine.takeMeters (false);
                engine.takeBusMeters (false);
            }
            if (tick % 5 == 0)
                engine.setMix (tick % strips, 0.3, 0.0);
            ++tick;
            std::this_thread::sleep_for (std::chrono::milliseconds (20));
        }
    });
    juce::AudioBuffer<float> out (2, block);
    const double budgetMs = 1000.0 * block / rate;
    const int blocks = (int) (seconds * rate / block);
    double next = juce::Time::getMillisecondCounterHiRes();
    std::vector<double> loads;
    fh::Engine::Stats total;
    for (int b = 0; b < blocks; ++b)
    {
        std::array<float*, 2> ptrs { out.getWritePointer (0), out.getWritePointer (1) };
        engine.audioDeviceIOCallbackWithContext (nullptr, 0, ptrs.data(), 2, block, {});
        next += budgetMs;
        const double wait = next - juce::Time::getMillisecondCounterHiRes();
        if (wait > 0)
            juce::Thread::sleep ((int) wait);
        if ((b + 1) % 94 == 0) // about a second, as the app asks
        {
            const auto s = engine.takeStats();
            total.blocks += s.blocks;
            total.sumLoad += s.sumLoad;
            total.maxLoad = juce::jmax (total.maxLoad, s.maxLoad);
            total.overruns += s.overruns;
            total.waitSum += s.waitSum, total.waitMax = juce::jmax (total.waitMax, s.waitMax);
            total.soundsSum += s.soundsSum;
            total.mixSum += s.mixSum, total.mixMax = juce::jmax (total.mixMax, s.mixMax);
            total.analysisSum += s.analysisSum;
            for (int i = 0; i < strips; ++i)
                total.stripSum[(size_t) i] += s.stripSum[(size_t) i], total.stripMax[(size_t) i] = juce::jmax (total.stripMax[(size_t) i], s.stripMax[(size_t) i]);
        }
    }
    running = false;
    app.join();
    if (total.blocks == 0)
        return 4;
    double stripsMs = 0, worstStrip = 0;
    for (int i = 0; i < strips; ++i)
        stripsMs += total.stripSum[(size_t) i], worstStrip = juce::jmax (worstStrip, total.stripMax[(size_t) i]);
    const auto per = [&] (double sum) { return sum / (double) total.blocks / budgetMs; };
    std::cout << "BENCH strips " << strips << " blocks " << total.blocks << " budget " << budgetMs << " ms" << std::endl;
    std::cout << "BENCH load avg " << total.sumLoad / (double) total.blocks << " max " << total.maxLoad << " overruns " << total.overruns << std::endl;
    std::cout << "BENCH tracks avg " << per (stripsMs) << " (one track " << per (stripsMs) / strips << ", worst block of one " << worstStrip / budgetMs << ")" << std::endl;
    std::cout << "BENCH wait avg " << per (total.waitSum) << " max " << total.waitMax / budgetMs << " | mix avg " << per (total.mixSum) << " max " << total.mixMax / budgetMs
              << " | analysis avg " << per (total.analysisSum) << std::endl;
    return 0;
}

class EngineApp final : public juce::JUCEApplication, private juce::Timer
{
    juce::String crashDumpPath; // must outlive the handler: the app lives as long as the process

public:
    const juce::String getApplicationName() override { return JUCE_APPLICATION_NAME_STRING; }
    const juce::String getApplicationVersion() override { return JUCE_APPLICATION_VERSION_STRING; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise (const juce::String& commandLine) override
    {
        const auto args = juce::StringArray::fromTokens (commandLine, true);
        if (args.contains ("--render"))
        {
            const auto i = args.indexOf ("--render");
            juce::StringArray extra;
            for (int k = i + 4; k < args.size(); ++k)
                extra.add (args[k].unquoted());
            setApplicationReturnValue (renderSong (args[i + 1].unquoted(), args[i + 2].unquoted(), args[i + 3].unquoted(), extra));
            quit();
            return;
        }
        if (args.contains ("--bench"))
        {
            const auto i = args.indexOf ("--bench");
            const int strips = juce::jlimit (1, 256, args[i + 2].getIntValue() > 0 ? args[i + 2].getIntValue() : 20);
            const double seconds = args[i + 3].getDoubleValue() > 0 ? args[i + 3].getDoubleValue() : 10.0;
            setApplicationReturnValue (bench (args[i + 1].unquoted(), strips, seconds));
            quit();
            return;
        }
        if (args.contains ("--selftest"))
        {
            const auto code = selfTest (argAfter (args, "--selftest"));
            setApplicationReturnValue (code);
            quit();
            return;
        }
        // A crash leaves engine-crash.dmp next to the cache (the app reads it at the next start).
        if (const auto cacheFile = argAfter (args, "--cache"); cacheFile.isNotEmpty())
            crashDumpPath = juce::File (cacheFile).getSiblingFile ("engine-crash.dmp").getFullPathName();
        fh::installCrashDump (crashDumpPath.toWideCharPointer());
        engine = std::make_unique<fh::Engine>();
        const auto deviceError = engine->openDevice();
        if (deviceError.isNotEmpty())
            std::cout << "FH_ENGINE_DEVICE_ERROR " << deviceError << std::endl;
        auto cache = juce::File (argAfter (args, "--cache"));
        link = std::make_unique<fh::Link> (*engine, argAfter (args, "--token"), cache);
        const auto port = argAfter (args, "--port").getIntValue();
        if (! link->beginWaitingForSocket (port, "127.0.0.1"))
        {
            std::cout << "FH_ENGINE_ERROR cannot listen" << std::endl;
            setApplicationReturnValue (1);
            quit();
            return;
        }
        std::cout << "FH_ENGINE_READY " << link->getBoundPort() << std::endl;
        // Windows changes its output (the TV, the headphones): the engine goes with it and says so.
        engine->followDefaultOutput ([this] (const juce::String& device, double latency) {
            auto* o = new juce::DynamicObject();
            o->setProperty ("type", "event");
            o->setProperty ("event", "deviceChanged");
            o->setProperty ("device", device);
            o->setProperty ("latency", latency);
            o->setProperty ("deviceError", engine->deviceError());
            link->notify (juce::var (o));
        });
        startedAt = juce::Time::getMillisecondCounter();
        startTimer (1000);
    }

    void shutdown() override
    {
        stopTimer();
        link.reset();
        engine.reset();
    }

    void systemRequestedQuit() override { quit(); }
    void anotherInstanceStarted (const juce::String&) override {}

private:
    void timerCallback() override
    {
        // Four Hands went away, or never came: the engine goes too.
        if (link->everConnected() ? ! link->hasConnection() : juce::Time::getMillisecondCounter() - startedAt > 30000)
            quit();
    }

    std::unique_ptr<fh::Engine> engine;
    std::unique_ptr<fh::Link> link;
    juce::uint32 startedAt = 0;
};

START_JUCE_APPLICATION (EngineApp)
