// The link between Four Hands and the engine (ESTUDIO_FASE2_MOTOR.md, 3): one local TCP connection
// (127.0.0.1), JSON messages framed the JUCE way (4-byte magic number, 4-byte size, then the
// message). The first message must be "hello" with the token Four Hands passed on the command line.
#pragma once

#include "Engine.h"

namespace fh
{
class Link;

class Connection final : public juce::InterprocessConnection
{
public:
    explicit Connection (Link& owner);
    ~Connection() override;
    void send (const juce::var& message);

private:
    void connectionMade() override;
    void connectionLost() override;
    void messageReceived (const juce::MemoryBlock& data) override;
    Link& link;
    std::atomic<bool> greeted { false };
    JUCE_DECLARE_WEAK_REFERENCEABLE (Connection)
};

class Link final : public juce::InterprocessConnectionServer
{
public:
    Link (Engine& engine, juce::String token, juce::File cache);
    ~Link() override;

    /** Handles one message from Four Hands; returns the reply (or void for none). */
    juce::var handle (const juce::var& message, Connection& from);
    bool checkToken (const juce::String& token) const { return token == expectedToken; }
    void lost (Connection* c);
    /** True once Four Hands has connected at least once. */
    bool everConnected() const { return connected; }
    bool hasConnection() const { return current != nullptr; }
    /** Says something to Four Hands on the engine's own initiative (`{ type: "event", event, … }`). */
    void notify (const juce::var& event);
    /**
     * Messages that only feed the audio (notes, transport, faders, panic), handled on the link's own
     * thread as they arrive (09/11/2026): a plugin window keeping the message thread busy (Kontakt
     * opening, The God Particle redrawing) must not make the notes late.
     */
    static bool isAudioOnly (const juce::String& type);
    /** The longest the message thread was busy since the last call, in ms. */
    double takeMessageStall();

private:
    juce::InterprocessConnection* createConnectionObject() override;
    juce::var pluginList() const;
    void saveCache() const;

    Engine& engine;
    juce::String expectedToken;
    juce::File cacheFile;
    std::vector<std::unique_ptr<Connection>> connections;
    Connection* current = nullptr;
    bool connected = false;
    /** Loads sound banks one at a time, off the message thread (an SF3 takes seconds). */
    juce::ThreadPool loader { 1 };
    /** Ticks every 10 ms on the message thread; a late tick is how long it was busy. */
    struct StallWatch final : juce::Timer
    {
        double last = 0;
        std::atomic<double> most { 0 };
        void timerCallback() override;
    } stallWatch;

    JUCE_DECLARE_WEAK_REFERENCEABLE (Link)
};

} // namespace fh
