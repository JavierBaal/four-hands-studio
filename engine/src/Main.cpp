// Four Hands Engine: entry point.
//
//   FourHandsEngine --port 0 --token <t> --cache <file>   normal use: Four Hands starts it
//   FourHandsEngine --selftest <folder with VST3>          loads the first instrument, plays a note
//                                                          offline and checks it sounds (exit code)
//
// On start it prints "FH_ENGINE_READY <port>" so Four Hands knows where to connect. It quits when
// Four Hands goes (connection lost) or never comes (30 s): it must not outlive the app.
#include "Engine.h"
#include "Link.h"

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
    engine.scan (juce::FileSearchPath (folder), pedal, [] (const juce::String& f) { std::cout << "scanning " << f << std::endl; });
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
