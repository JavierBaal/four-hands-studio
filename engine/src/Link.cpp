#include "Link.h"

namespace fh
{
namespace
{
juce::var obj (std::initializer_list<std::pair<const char*, juce::var>> fields)
{
    auto* o = new juce::DynamicObject();
    for (auto& [k, v] : fields)
        o->setProperty (k, v);
    return juce::var (o);
}

juce::var error (const juce::String& request, const juce::String& message)
{
    return obj ({ { "type", "error" }, { "request", request }, { "message", message } });
}
} // namespace

// -----------------------------------------------------------------------------
// Connection

Connection::Connection (Link& owner) : InterprocessConnection (true), link (owner) {}

Connection::~Connection()
{
    disconnect();
}

void Connection::send (const juce::var& message)
{
    const auto text = juce::JSON::toString (message, true);
    juce::MemoryBlock block (text.toRawUTF8(), text.getNumBytesAsUTF8());
    sendMessage (block);
}

void Connection::connectionMade() {}

void Connection::connectionLost()
{
    link.lost (this);
}

void Connection::messageReceived (const juce::MemoryBlock& data)
{
    const auto message = juce::JSON::parse (data.toString());
    const auto type = message["type"].toString();
    if (! greeted)
    {
        if (type != "hello" || ! link.checkToken (message["token"].toString()))
        {
            send (error ("hello", "Wrong or missing token"));
            disconnect();
            return;
        }
        greeted = true;
    }
    const auto reply = link.handle (message, *this);
    if (! reply.isVoid())
        send (reply);
}

// -----------------------------------------------------------------------------
// Link

Link::Link (Engine& e, juce::String token, juce::File cache) : engine (e), expectedToken (std::move (token)), cacheFile (std::move (cache))
{
    if (cacheFile.existsAsFile())
        if (auto xml = juce::parseXML (cacheFile))
            engine.known().recreateFromXml (*xml);
}

Link::~Link()
{
    loader.removeAllJobs (true, 30000);
    stop();
    connections.clear();
}

juce::InterprocessConnection* Link::createConnectionObject()
{
    connections.push_back (std::make_unique<Connection> (*this));
    current = connections.back().get();
    connected = true;
    return current;
}

void Link::lost (Connection* c)
{
    if (current == c)
        current = nullptr;
    // Deleted later: we are inside its own callback.
    juce::MessageManager::callAsync ([this, c] {
        connections.erase (std::remove_if (connections.begin(), connections.end(), [c] (auto& p) { return p.get() == c; }), connections.end());
    });
}

void Link::saveCache() const
{
    if (cacheFile == juce::File())
        return;
    if (auto xml = engine.known().createXml())
    {
        cacheFile.getParentDirectory().createDirectory();
        xml->writeTo (cacheFile);
    }
}

juce::var Link::pluginList() const
{
    juce::Array<juce::var> list;
    for (const auto& d : engine.known().getTypes())
        list.add (obj ({ { "id", d.createIdentifierString() },
                         { "name", d.name },
                         { "vendor", d.manufacturerName },
                         { "category", d.category },
                         { "format", d.pluginFormatName },
                         { "instrument", d.isInstrument } }));
    return obj ({ { "type", "plugins" }, { "list", list } });
}

void Link::notify (const juce::var& event)
{
    if (current != nullptr)
        current->send (event);
}

juce::var Link::handle (const juce::var& m, Connection& from)
{
    const auto type = m["type"].toString();

    if (type == "hello")
        return obj ({ { "type", "hello" },
                      { "version", 1 },
                      { "device", engine.deviceText() },
                      { "sampleRate", engine.getSampleRate() },
                      { "latency", engine.outputLatencySeconds() },
                      { "deviceError", engine.deviceError() },
                      // F2.1 (31/10/2026): it plays the built-in sounds (requests "sounds" and slot 16).
                      { "sounds", true },
                      { "soundsSlot", kSoundsSlot } });

    if (type == "plugins")
        return pluginList();

    if (type == "scan")
    {
        juce::FileSearchPath where = engine.defaultSearchPath();
        if (m["paths"].isArray())
            for (const auto& p : *m["paths"].getArray())
                where.add (juce::File (p.toString()));
        const auto pedal = cacheFile.getSiblingFile ("plugins-scanning.txt");
        engine.scan (where, pedal, [&from] (const juce::String& file, float progress) { from.send (obj ({ { "type", "scanning" }, { "file", file }, { "progress", progress } })); });
        saveCache();
        return pluginList();
    }

    if (type == "load")
    {
        const int slot = m["slot"];
        const auto id = m["id"].toString();
        for (const auto& d : engine.known().getTypes())
            if (d.createIdentifierString() == id)
            {
                const auto problem = engine.load (slot, d);
                if (problem.isNotEmpty())
                    return error ("load", problem);
                return obj ({ { "type", "loaded" }, { "slot", slot }, { "name", engine.nameOf (slot) } });
            }
        return error ("load", "Unknown plugin: " + id);
    }

    if (type == "unload")
    {
        engine.unload ((int) m["slot"]);
        return obj ({ { "type", "unloaded" }, { "slot", m["slot"] } });
    }

    if (type == "show")
        return obj ({ { "type", "shown" }, { "slot", m["slot"] }, { "ok", engine.showEditor ((int) m["slot"]) } });

    if (type == "midi")
    {
        // Several events at once: { slot, delay (seconds from now), data: [status, data1, data2] }.
        if (auto* events = m["events"].getArray())
            for (const auto& e : *events)
            {
                const auto* bytes = e["data"].getArray();
                if (bytes == nullptr || bytes->isEmpty())
                    continue;
                const int b0 = (*bytes)[0];
                const int b1 = bytes->size() > 1 ? (int) (*bytes)[1] : 0;
                const int b2 = bytes->size() > 2 ? (int) (*bytes)[2] : 0;
                engine.schedule ((int) e["slot"], (double) e["delay"], juce::MidiMessage (b0, b1, b2));
            }
        return {};
    }

    if (type == "panic")
    {
        engine.panic();
        return {};
    }

    if (type == "getState")
    {
        const int slot = m["slot"];
        return obj ({ { "type", "state" }, { "slot", slot }, { "data", engine.state (slot).toBase64Encoding() } });
    }

    if (type == "windows")
    {
        juce::Array<juce::var> slots;
        for (auto slot : engine.openWindows())
            slots.add (slot);
        return obj ({ { "type", "windows" }, { "slots", slots } });
    }

    if (type == "setState")
    {
        juce::MemoryBlock data;
        data.fromBase64Encoding (m["data"].toString());
        return obj ({ { "type", "stateSet" }, { "slot", m["slot"] }, { "ok", engine.setState ((int) m["slot"], data) } });
    }

    if (type == "sounds")
    {
        // A bank for the built-in sounds: the reply comes at once, the load later, as an event
        // ("soundsLoaded"), so MIDI and the other requests go on meanwhile.
        const int offset = m["offset"];
        const juce::File file (m["path"].toString());
        const auto id = m["id"].toString();
        engine.sounds();
        juce::WeakReference<Link> self (this);
        auto& e = engine;
        loader.addJob ([self, &e, offset, file, id] {
            const auto started = juce::Time::getMillisecondCounterHiRes();
            int presets = 0;
            const auto problem = e.loadSoundBank (offset, file, presets);
            const auto ms = (int) (juce::Time::getMillisecondCounterHiRes() - started);
            juce::MessageManager::callAsync ([self, offset, id, problem, presets, ms] {
                if (auto* link = self.get())
                    if (link->current != nullptr)
                        link->current->send (obj ({ { "type", "event" },
                                                    { "event", "soundsLoaded" },
                                                    { "id", id },
                                                    { "offset", offset },
                                                    { "ok", problem.isEmpty() },
                                                    { "error", problem },
                                                    { "presets", presets },
                                                    { "ms", ms } }));
            });
        });
        return obj ({ { "type", "soundsLoading" }, { "id", id }, { "offset", offset } });
    }

    if (type == "mix")
    {
        // F2.2: the strips of the tracks that changed, { ch, gain, pan, reverb }. No reply.
        if (auto* list = m["channels"].getArray())
            for (const auto& c : *list)
                engine.setMix ((int) c["ch"], (double) c["gain"], (double) c["pan"], (double) c["reverb"]);
        return {};
    }

    if (type == "meters" || type == "levels")
    {
        // "meters": since the last time (the mixer's meters); "levels": since resetLevels (the AI).
        const auto levels = engine.takeMeters (type == "levels");
        juce::Array<juce::var> list;
        for (int i = 0; i < kSlots; ++i)
            list.add (obj ({ { "peak", levels[(size_t) i].peak }, { "rms", levels[(size_t) i].rms }, { "clips", (juce::int64) levels[(size_t) i].clips } }));
        const auto& mst = levels[(size_t) kSlots];
        return obj ({ { "type", type }, { "channels", list }, { "master", obj ({ { "peak", mst.peak }, { "rms", mst.rms }, { "clips", (juce::int64) mst.clips } }) } });
    }

    if (type == "resetLevels")
    {
        engine.resetLevels();
        return obj ({ { "type", "levelsReset" } });
    }

    if (type == "stats")
    {
        const auto s = engine.takeStats();
        return obj ({ { "type", "stats" }, { "blocks", (juce::int64) s.blocks }, { "maxLoad", s.maxLoad }, { "late", s.late } });
    }

    if (type == "quit")
    {
        juce::JUCEApplicationBase::quit();
        return {};
    }

    return error (type, "Unknown request");
}

} // namespace fh
