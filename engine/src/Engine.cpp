#include "Engine.h"

namespace fh
{
namespace
{
/** The plugin's own window. Closing it hides it; the plugin keeps sounding. */
class PluginWindow final : public juce::DocumentWindow
{
public:
    PluginWindow (const juce::String& title, juce::AudioProcessorEditor* editor)
        : DocumentWindow (title, juce::Colour (0xff1b1916), DocumentWindow::closeButton | DocumentWindow::minimiseButton)
    {
        setUsingNativeTitleBar (true);
        setContentOwned (editor, true);
        setResizable (editor->isResizable(), false);
        centreWithSize (getWidth(), getHeight());
        setAlwaysOnTop (false);
    }

    void closeButtonPressed() override { setVisible (false); }
};
} // namespace

Engine::Engine()
{
#if JUCE_PLUGINHOST_VST3
    formatManager.addFormat (new juce::VST3PluginFormat());
#endif
}

Engine::~Engine()
{
    device.removeAudioCallback (this);
    device.closeAudioDevice();
    for (auto& w : windows)
        w.reset();
    {
        const juce::SpinLock::ScopedLockType sl (lock);
        live.fill (nullptr);
    }
    for (auto& s : slots)
        s.reset();
}

// -----------------------------------------------------------------------------
// Audio device

juce::String Engine::openDevice()
{
    auto error = device.initialiseWithDefaultDevices (0, 2);
    if (error.isNotEmpty())
        return error;
    if (device.getCurrentAudioDevice() == nullptr)
        return "There is no audio output device";
    device.addAudioCallback (this);
    return {};
}

juce::String Engine::deviceText() const
{
    auto* d = device.getCurrentAudioDevice();
    if (d == nullptr)
        return "none";
    return d->getTypeName() + " · " + d->getName() + " · " + juce::String ((int) d->getCurrentSampleRate()) + " Hz · "
         + juce::String (d->getCurrentBufferSizeSamples()) + " samples";
}

double Engine::outputLatencySeconds() const
{
    auto* d = device.getCurrentAudioDevice();
    if (d == nullptr || d->getCurrentSampleRate() <= 0)
        return 0.0;
    return (d->getOutputLatencyInSamples() + d->getCurrentBufferSizeSamples()) / d->getCurrentSampleRate();
}

void Engine::audioDeviceAboutToStart (juce::AudioIODevice* d)
{
    prepare (d->getCurrentSampleRate(), d->getCurrentBufferSizeSamples());
}

void Engine::audioDeviceStopped() {}

void Engine::prepare (double rate, int block)
{
    const juce::SpinLock::ScopedLockType sl (lock);
    sampleRate = rate;
    blockSize = block;
    scratch.setSize (2, block, false, true, true);
    for (auto& m : midi)
        m.ensureSize (2048);
    for (auto* p : live)
        if (p != nullptr)
            p->prepareToPlay (rate, block);
}

// -----------------------------------------------------------------------------
// Plugins

juce::FileSearchPath Engine::defaultSearchPath()
{
    juce::FileSearchPath path;
    for (auto* f : formatManager.getFormats())
        path.addPath (f->getDefaultLocationsToSearch());
    return path;
}

void Engine::scan (const juce::FileSearchPath& where, const juce::File& deadMansPedal, const std::function<void (const juce::String&)>& progress)
{
    for (auto* format : formatManager.getFormats())
    {
        juce::PluginDirectoryScanner scanner (knownPlugins, *format, where, true, deadMansPedal, false);
        juce::String name;
        for (;;)
        {
            name = scanner.getNextPluginFileThatWillBeScanned();
            if (progress && name.isNotEmpty())
                progress (name);
            if (! scanner.scanNextFile (true, name))
                break;
        }
    }
}

juce::String Engine::load (int slot, const juce::PluginDescription& description)
{
    if (slot < 0 || slot >= kSlots)
        return "Invalid slot";
    juce::String error;
    auto instance = formatManager.createPluginInstance (description, sampleRate, blockSize, error);
    if (instance == nullptr)
        return error.isNotEmpty() ? error : "The plugin could not be created";
    instance->enableAllBuses();
    instance->prepareToPlay (sampleRate, blockSize);
    windows[(size_t) slot].reset();
    {
        const juce::SpinLock::ScopedLockType sl (lock);
        live[(size_t) slot] = instance.get();
        const auto channels = juce::jmax (2, instance->getTotalNumInputChannels(), instance->getTotalNumOutputChannels());
        if (scratch.getNumChannels() < channels)
            scratch.setSize (channels, blockSize, false, true, true);
    }
    // The old instance (if any) is released here, after the audio thread stopped seeing it.
    slots[(size_t) slot] = std::move (instance);
    return {};
}

void Engine::unload (int slot)
{
    if (slot < 0 || slot >= kSlots)
        return;
    windows[(size_t) slot].reset();
    {
        const juce::SpinLock::ScopedLockType sl (lock);
        live[(size_t) slot] = nullptr;
    }
    slots[(size_t) slot].reset();
}

juce::String Engine::nameOf (int slot) const
{
    if (slot < 0 || slot >= kSlots || slots[(size_t) slot] == nullptr)
        return {};
    return slots[(size_t) slot]->getName();
}

bool Engine::showEditor (int slot)
{
    if (slot < 0 || slot >= kSlots || slots[(size_t) slot] == nullptr)
        return false;
    auto& window = windows[(size_t) slot];
    if (window == nullptr)
    {
        auto* plugin = slots[(size_t) slot].get();
        if (! plugin->hasEditor())
            return false;
        auto* editor = plugin->createEditorIfNeeded();
        if (editor == nullptr)
            return false;
        window = std::make_unique<PluginWindow> (plugin->getName(), editor);
    }
    window->setVisible (true);
    window->toFront (true);
    return true;
}

juce::MemoryBlock Engine::state (int slot)
{
    juce::MemoryBlock data;
    if (slot >= 0 && slot < kSlots && slots[(size_t) slot] != nullptr)
        slots[(size_t) slot]->getStateInformation (data);
    return data;
}

bool Engine::setState (int slot, const juce::MemoryBlock& data)
{
    if (slot < 0 || slot >= kSlots || slots[(size_t) slot] == nullptr)
        return false;
    // Not under the audio lock: a sampler may load its library here, which takes long. Plugins
    // must accept state changes while they play (the VST3 rules say so).
    slots[(size_t) slot]->setStateInformation (data.getData(), (int) data.getSize());
    return true;
}

// -----------------------------------------------------------------------------
// MIDI

void Engine::schedule (int slot, double delaySeconds, const juce::MidiMessage& message)
{
    if (slot < 0 || slot >= kSlots)
        return;
    const auto at = position.load() + (juce::int64) std::llround (juce::jmax (0.0, delaySeconds) * sampleRate);
    const juce::SpinLock::ScopedLockType sl (lock);
    pending.push_back ({ at, slot, message });
}

void Engine::panic()
{
    const juce::SpinLock::ScopedLockType sl (lock);
    pending.clear();
    const auto now = position.load();
    for (int s = 0; s < kSlots; ++s)
        for (int ch = 1; ch <= 16; ++ch)
        {
            pending.push_back ({ now, s, juce::MidiMessage::controllerEvent (ch, 64, 0) });
            pending.push_back ({ now, s, juce::MidiMessage::allNotesOff (ch) });
        }
}

// -----------------------------------------------------------------------------
// Processing

void Engine::audioDeviceIOCallbackWithContext (const float* const*, int, float* const* outputs, int numOutputs, int numSamples, const juce::AudioIODeviceCallbackContext&)
{
    const auto started = juce::Time::getMillisecondCounterHiRes();
    process (outputs, numOutputs, numSamples);
    const auto budget = 1000.0 * numSamples / sampleRate;
    const auto load = (juce::Time::getMillisecondCounterHiRes() - started) / budget;
    const juce::SpinLock::ScopedLockType sl (statsLock);
    stats.blocks++;
    stats.maxLoad = juce::jmax (stats.maxLoad, load);
}

Engine::Stats Engine::takeStats()
{
    const juce::SpinLock::ScopedLockType sl (statsLock);
    auto out = stats;
    stats = {};
    return out;
}

void Engine::process (float* const* outputs, int numOutputs, int numSamples)
{
    for (int c = 0; c < numOutputs; ++c)
        if (outputs[c] != nullptr)
            juce::FloatVectorOperations::clear (outputs[c], numSamples);

    const juce::SpinLock::ScopedLockType sl (lock);
    const auto start = position.load();
    const auto end = start + numSamples;

    // Due events go to their slot's buffer at their exact sample; late ones at sample 0.
    for (auto& m : midi)
        m.clear();
    int late = 0;
    auto it = pending.begin();
    while (it != pending.end())
    {
        if (it->at < end)
        {
            if (it->at < start)
                ++late;
            const auto offset = (int) juce::jlimit<juce::int64> (0, numSamples - 1, it->at - start);
            midi[(size_t) it->slot].addEvent (it->message, offset);
            it = pending.erase (it);
        }
        else
            ++it;
    }
    if (late > 0)
    {
        const juce::SpinLock::ScopedLockType st (statsLock);
        stats.late += late;
    }

    if (scratch.getNumSamples() < numSamples)
        scratch.setSize (scratch.getNumChannels(), numSamples, false, true, true);

    for (int s = 0; s < kSlots; ++s)
    {
        auto* plugin = live[(size_t) s];
        if (plugin == nullptr)
            continue;
        const auto channels = juce::jmax (plugin->getTotalNumInputChannels(), plugin->getTotalNumOutputChannels());
        juce::AudioBuffer<float> buffer (scratch.getArrayOfWritePointers(), juce::jmin (channels, scratch.getNumChannels()), numSamples);
        buffer.clear();
        plugin->processBlock (buffer, midi[(size_t) s]);
        const auto outChannels = juce::jmin (plugin->getTotalNumOutputChannels(), buffer.getNumChannels());
        for (int c = 0; c < numOutputs; ++c)
        {
            if (outputs[c] == nullptr || outChannels == 0)
                continue;
            // Mono plugins feed both sides.
            juce::FloatVectorOperations::add (outputs[c], buffer.getReadPointer (juce::jmin (c, outChannels - 1)), numSamples);
        }
    }
    position.store (end);
}

void Engine::prepareOffline (double rate, int block)
{
    prepare (rate, block);
}

void Engine::renderOffline (juce::AudioBuffer<float>& out)
{
    for (int done = 0; done < out.getNumSamples(); done += blockSize)
    {
        const int n = juce::jmin (blockSize, out.getNumSamples() - done);
        std::array<float*, 2> ptrs { out.getWritePointer (0, done), out.getWritePointer (juce::jmin (1, out.getNumChannels() - 1), done) };
        process (ptrs.data(), out.getNumChannels(), n);
    }
}

} // namespace fh
