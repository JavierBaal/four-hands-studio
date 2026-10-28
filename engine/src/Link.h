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
    bool greeted = false;
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
};

} // namespace fh
