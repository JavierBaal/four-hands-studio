// Four Hands Engine: entry point.
//
//   FourHandsEngine --port 0 --token <t> --cache <file>   normal use: Four Hands starts it
//   FourHandsEngine --selftest <folder with VST3>          loads the first instrument, plays a note
//                                                          offline and checks it sounds (exit code)
//   FourHandsEngine --render <bank> <song.mid> <out.wav>   plays a MIDI file with the built-in sounds
//                                                          offline, to compare them with the app's
//
// On start it prints "FH_ENGINE_READY <port>" so Four Hands knows where to connect. It quits when
// Four Hands goes (connection lost) or never comes (30 s): it must not outlive the app.
#include "Engine.h"
#include "Link.h"
#include "SoundFontSynth.h"

#include <cmath>
#include <iostream>

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

class EngineApp final : public juce::JUCEApplication, private juce::Timer
{
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
        if (args.contains ("--selftest"))
        {
            const auto code = selfTest (argAfter (args, "--selftest"));
            setApplicationReturnValue (code);
            quit();
            return;
        }
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
