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
    // F2.2: the plugin's strip. Half the fader halves the sound; a reverb send leaves a tail.
    engine.setMix (0, 0.5, 0.0, 0.5);
    engine.schedule (0, 0.0, juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100));
    engine.schedule (0, 0.5, juce::MidiMessage::noteOff (1, 60));
    juce::AudioBuffer<float> mixed (2, 48000);
    mixed.clear();
    engine.renderOffline (mixed);
    const auto half = mixed.getRMSLevel (0, 4800, 9600);
    const auto tail = mixed.getRMSLevel (0, 40000, 4800);
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
    std::cout << "OK" << std::endl;
    return 0;
}
/**
 * The built-in sounds without a device: a MIDI file through slot 16, written as a 24-bit WAV.
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
    for (const auto* e : all)
    {
        if (e->message.isMetaEvent())
            continue;
        // FH_RENDER_BLOCK=128: events at the start of their 128-sample block, as SpessaSynth's own
        // sequencer plays a file (to compare the two sample by sample).
        auto t = e->message.getTimeStamp();
        if (quantize > 0)
            t = std::ceil (t * rate / quantize - 1e-9) * quantize / rate;
        engine.schedule (fh::kSoundsSlot, t, e->message);
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
