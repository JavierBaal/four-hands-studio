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
                      // F2.1 (31/10/2026): it plays the built-in sounds (requests "sounds" and their slot).
                      { "sounds", true },
                      { "soundsSlot", kSoundsSlot },
                      // A2 (03/11/2026): strips numbered by Four Hands, not by MIDI channel.
                      { "strips", kStrips },
                      // F2.2 parte D: buses, and an engine that can route (older ones ignore "routing").
                      { "buses", kBuses } });

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
        // Several events at once: { slot, delay (seconds from now), data: [status, data1, data2] },
        // and for the built-in sounds `ch`, the strip (A2).
        if (auto* events = m["events"].getArray())
            for (const auto& e : *events)
            {
                const auto* bytes = e["data"].getArray();
                if (bytes == nullptr || bytes->isEmpty())
                    continue;
                const int b0 = (*bytes)[0];
                const int b1 = bytes->size() > 1 ? (int) (*bytes)[1] : 0;
                const int b2 = bytes->size() > 2 ? (int) (*bytes)[2] : 0;
                const auto strip = e.hasProperty ("ch") ? (int) e["ch"] : -1;
                engine.schedule ((int) e["slot"], (double) e["delay"], juce::MidiMessage (b0, b1, b2), strip);
            }
        return {};
    }

    if (type == "transport")
    {
        // F2.2 (04/11/2026): [{ delay, playing, ppq, bpm, num, den, bar }], with the notes. No reply.
        if (auto* points = m["points"].getArray())
            for (const auto& p : *points)
            {
                Engine::TransportPoint t;
                t.playing = (bool) p["playing"];
                t.ppq = (double) p["ppq"];
                t.bpm = juce::jlimit (10.0, 1000.0, (double) p["bpm"]);
                t.num = juce::jmax (1, (int) p["num"]);
                t.den = juce::jmax (1, (int) p["den"]);
                t.bar = (double) p["bar"];
                engine.scheduleTransport ((double) p["delay"], t);
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
        // F2.2: the strips that changed, { ch (the strip), gain, pan, on }; parte D: the buses that
        // changed, { bus, gain, pan, on }; the master fader (`master`, linear), when it comes. No reply.
        if (auto* list = m["channels"].getArray())
            for (const auto& c : *list)
                engine.setMix ((int) c["ch"], (double) c["gain"], (double) c["pan"], c.hasProperty ("on") ? (bool) c["on"] : true);
        if (auto* list = m["buses"].getArray())
            for (const auto& c : *list)
                engine.setBusMix ((int) c["bus"], (double) c["gain"], (double) c["pan"], c.hasProperty ("on") ? (bool) c["on"] : true);
        if (m.hasProperty ("master"))
            engine.setMasterGain ((double) m["master"]);
        return {};
    }

    if (type == "routing")
    {
        // F2.2 parte D, the whole routing: { strips: [{ ch, out, sends: [{ bus, level, pre }] }],
        // buses: [{ bus, out, sends }], order: [bus…], instrumentReverb }. `out` -1: the master.
        auto route = [] (const juce::var& c) {
            Engine::Route r;
            r.out = c.hasProperty ("out") ? (int) c["out"] : -1;
            if (auto* sends = c["sends"].getArray())
                for (const auto& x : *sends)
                    r.sends.push_back ({ (int) x["bus"], (float) (double) x["level"], (bool) x["pre"] });
            return r;
        };
        std::vector<std::pair<int, Engine::Route>> strips, buses;
        std::vector<int> order;
        if (auto* list = m["strips"].getArray())
            for (const auto& c : *list)
                strips.push_back ({ (int) c["ch"], route (c) });
        if (auto* list = m["buses"].getArray())
            for (const auto& c : *list)
                buses.push_back ({ (int) c["bus"], route (c) });
        if (auto* list = m["order"].getArray())
            for (const auto& b : *list)
                order.push_back ((int) b);
        // No reply, like "mix" (Four Hands sends it without waiting; a reply only filled its log).
        engine.setRouting (std::move (strips), std::move (buses), std::move (order), m.hasProperty ("instrumentReverb") ? (int) m["instrumentReverb"] : -1);
        return {};
    }

    if (type == "meters" || type == "levels")
    {
        // "meters": since the last time (the mixer's meters); "levels": since resetLevels (the AI).
        const auto levels = engine.takeMeters (type == "levels");
        const auto busLevels = engine.takeBusMeters (type == "levels");
        auto level = [] (const Engine::Level& l) { return obj ({ { "peak", l.peak }, { "rms", l.rms }, { "clips", (juce::int64) l.clips } }); };
        juce::Array<juce::var> list, buses;
        // A2: one per strip in use (the app maps them to its tracks), then the master; parte D: the buses.
        for (size_t i = 0; i + 1 < levels.size(); ++i)
            list.add (level (levels[i]));
        for (const auto& l : busLevels)
            buses.add (level (l));
        return obj ({ { "type", type }, { "channels", list }, { "master", level (levels.back()) }, { "buses", buses } });
    }

    if (type == "resetLevels")
    {
        engine.resetLevels();
        return obj ({ { "type", "levelsReset" } });
    }

    if (type == "stats")
    {
        const auto s = engine.takeStats();
        return obj ({ { "type", "stats" }, { "blocks", (juce::int64) s.blocks }, { "maxLoad", s.maxLoad },
                      { "avgLoad", s.blocks > 0 ? s.sumLoad / (double) s.blocks : 0.0 }, { "late", s.late },
                      { "overruns", s.overruns }, { "xruns", s.xruns } });
    }

    // --- Insert effects (F2.2 parte C) ---------------------------------------------------------
    if (type == "inserts")
    {
        // { strip (-1: the master), chain: [{ id, kind, plugin, bypass, params: { name: value } }] }
        std::vector<Engine::InsertSpec> specs;
        if (auto* list = m["chain"].getArray())
            for (const auto& c : *list)
            {
                Engine::InsertSpec spec;
                spec.id = c["id"].toString();
                spec.kind = c["kind"].toString();
                spec.pluginId = c["plugin"].toString();
                spec.bypass = (bool) c["bypass"];
                if (auto* params = c["params"].getDynamicObject())
                    for (const auto& p : params->getProperties())
                        spec.params.push_back ({ p.name.toString(), (double) p.value });
                specs.push_back (std::move (spec));
            }
        // Parte D: { bus: n } instead of a strip, for a bus's chain.
        const int strip = m.hasProperty ("bus") ? Engine::kBusChain + (int) m["bus"] : (int) m["strip"];
        const auto problems = engine.setChain (strip, specs);
        juce::Array<juce::var> errors;
        for (const auto& [id, message] : problems)
            errors.add (obj ({ { "id", id }, { "error", message } }));
        return obj ({ { "type", "insertsSet" }, { "strip", m.hasProperty ("bus") ? m["strip"] : juce::var (strip) }, { "bus", m["bus"] }, { "latency", engine.chainLatency (strip) }, { "compensation", engine.compensation() }, { "errors", errors } });
    }

    if (type == "showInsert")
        return obj ({ { "type", "shown" }, { "id", m["id"] }, { "ok", engine.showInsert (m["id"].toString()) } });

    if (type == "insertWindows")
    {
        juce::Array<juce::var> ids;
        for (const auto& id : engine.openInsertWindows())
            ids.add (id);
        return obj ({ { "type", "insertWindows" }, { "ids", ids } });
    }

    if (type == "getInsertState")
        return obj ({ { "type", "insertState" }, { "id", m["id"] }, { "data", engine.insertState (m["id"].toString()).toBase64Encoding() } });

    if (type == "setInsertState")
    {
        juce::MemoryBlock data;
        data.fromBase64Encoding (m["data"].toString());
        return obj ({ { "type", "insertStateSet" }, { "id", m["id"] }, { "ok", engine.setInsertState (m["id"].toString(), data) } });
    }

    if (type == "reductions")
    {
        // How much each compressor and limiter is reducing now (the console's meters, later).
        juce::DynamicObject::Ptr out = new juce::DynamicObject();
        if (auto* ids = m["ids"].getArray())
            for (const auto& id : *ids)
                out->setProperty (id.toString(), engine.insertReduction (id.toString()));
        return obj ({ { "type", "reductions" }, { "values", juce::var (out.get()) } });
    }

    if (type == "params")
    {
        // A plugin's parameters: an effect's (`id`) or an instrument's (`slot`).
        const auto list = engine.parameters (m["id"].toString(), m.hasProperty ("slot") ? (int) m["slot"] : -1);
        juce::Array<juce::var> out;
        for (const auto& p : list)
            out.add (obj ({ { "index", p.index }, { "name", p.name }, { "text", p.text }, { "label", p.label }, { "value", p.value } }));
        return obj ({ { "type", "params" }, { "params", out } });
    }

    if (type == "setParam")
    {
        bool ok = false;
        float after = 0;
        const auto text = engine.setParameter (m["id"].toString(), m.hasProperty ("slot") ? (int) m["slot"] : -1, (int) m["index"], (float) (double) m["value"], m["text"].toString(), ok, &after);
        return obj ({ { "type", "paramSet" }, { "ok", ok }, { "text", text }, { "value", after } });
    }

    if (type == "quit")
    {
        juce::JUCEApplicationBase::quit();
        return {};
    }

    return error (type, "Unknown request");
}

} // namespace fh
