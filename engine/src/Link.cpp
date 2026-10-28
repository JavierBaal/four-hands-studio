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

juce::var Link::handle (const juce::var& m, Connection& from)
{
    const auto type = m["type"].toString();

    if (type == "hello")
        return obj ({ { "type", "hello" },
                      { "version", 1 },
                      { "device", engine.deviceText() },
                      { "sampleRate", engine.getSampleRate() },
                      { "latency", engine.outputLatencySeconds() },
                      { "deviceError", engine.deviceError() } });

    if (type == "plugins")
        return pluginList();

    if (type == "scan")
    {
        juce::FileSearchPath where = engine.defaultSearchPath();
        if (m["paths"].isArray())
            for (const auto& p : *m["paths"].getArray())
                where.add (juce::File (p.toString()));
        const auto pedal = cacheFile.getSiblingFile ("plugins-scanning.txt");
        engine.scan (where, pedal, [&from] (const juce::String& file) { from.send (obj ({ { "type", "scanning" }, { "file", file } })); });
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

    if (type == "setState")
    {
        juce::MemoryBlock data;
        data.fromBase64Encoding (m["data"].toString());
        return obj ({ { "type", "stateSet" }, { "slot", m["slot"] }, { "ok", engine.setState ((int) m["slot"], data) } });
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
