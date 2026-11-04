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
    auto play = [&engine] (double gain, double reverb) {
        engine.setMix (0, gain, 0.0, reverb);
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
        engine.setMix (0, 1.0, 0.0, 0.0, true);
        engine.schedule (0, 0.0, juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100));
        engine.schedule (0, 1.0, juce::MidiMessage::noteOff (1, 60));
        juce::AudioBuffer<float> a (2, 14400), b (2, 14400);
        a.clear();
        b.clear();
        engine.renderOffline (a);
        engine.setMix (0, 1.0, 0.0, 0.0, false);
        engine.takeMeters (false); // count from here on
        engine.renderOffline (b);
        const auto offStrip = engine.takeMeters (false)[0].peak;
        engine.setMix (0, 1.0, 0.0, 0.0, true);
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
            engine.setMix (0, 1.0, 0.0, 0.0, strip == 0);
            engine.setMix (1, 1.0, 0.0, 0.0, strip == 1);
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
        engine.setMix (0, 1.0, 0.0, 0.0, true);
        engine.setMix (1, 1.0, 0.0, 0.0, true);
        engine.unload (1);
        if (engine.compensation() != 0)
        {
            std::cout << "FAIL the compensation stays after the effects went" << std::endl;
            return 16;
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
        for (int ch = 0; ch < 16; ++ch)
            engine.setMix (stripBase >= 0 ? stripBase + ch : ch, 1.0, 0.0, send);
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
