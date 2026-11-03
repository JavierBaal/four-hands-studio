#include "Engine.h"
#include "SoundFontSynth.h"

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
    formatManager.addFormat (std::make_unique<juce::VST3PluginFormat>());
#endif
}

Engine::~Engine()
{
    stopTimer();
    device.removeChangeListener (this);
    device.removeAudioCallback (this);
    device.closeAudioDevice();
    for (auto& w : windows)
        w.reset();
    {
        const juce::SpinLock::ScopedLockType sl (lock);
        live.fill (nullptr);
    }
    // Effects go before the format manager (their plugins) and with their windows first.
    for (auto& c : chains)
        c.reset();
    for (auto& s : slots)
        s.reset();
}

// -----------------------------------------------------------------------------
// Audio device

juce::String Engine::openDevice()
{
    lastDeviceError = device.initialiseWithDefaultDevices (0, 2);
    if (lastDeviceError.isEmpty() && device.getCurrentAudioDevice() == nullptr)
        lastDeviceError = "There is no audio output device";
    if (lastDeviceError.isEmpty())
        device.addAudioCallback (this);
    return lastDeviceError;
}

void Engine::followDefaultOutput (std::function<void (const juce::String&, double)> onDeviceChanged)
{
    deviceChanged = std::move (onDeviceChanged);
    // The device manager says when the system's list changes (the default too, with WASAPI); the
    // timer is a second look in case a change does not come through.
    device.addChangeListener (this);
    startTimer (2000);
}

void Engine::checkDefaultOutput (bool rescan)
{
    if (checkingDevice)
        return;
    auto* type = device.getCurrentDeviceTypeObject();
    if (type == nullptr)
        return;
    const juce::ScopedValueSetter<bool> busy (checkingDevice, true);
    if (rescan)
        type->scanForDevices();
    const auto names = type->getDeviceNames (false);
    const auto index = type->getDefaultDeviceIndex (false);
    if (! juce::isPositiveAndBelow (index, names.size()))
        return;
    const auto wanted = names[index];
    auto setup = device.getAudioDeviceSetup();
    if (setup.outputDeviceName == wanted && device.getCurrentAudioDevice() != nullptr)
        return;
    // Same rate and buffer as before when the new output allows it. Our callback goes first (it
    // waits for the audio thread) and the plugins are released, so they are prepared again cleanly.
    device.removeAudioCallback (this);
    for (auto& p : slots)
        if (p != nullptr)
            p->releaseResources();
    for (auto& c : chains)
        if (c != nullptr)
            for (auto& x : c->inserts)
                if (x->plugin != nullptr)
                    x->plugin->releaseResources();
    setup.outputDeviceName = wanted;
    const auto error = device.setAudioDeviceSetup (setup, true);
    lastDeviceError = error.isNotEmpty() ? error : (device.getCurrentAudioDevice() == nullptr ? juce::String ("There is no audio output device") : juce::String());
    if (lastDeviceError.isEmpty() && device.getCurrentAudioDevice() != nullptr)
        device.addAudioCallback (this); // no-op if it is already there
    if (deviceChanged)
        deviceChanged (deviceText(), outputLatencySeconds());
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
    // Called with the audio stopped: on opening the output and again when it changes (Windows
    // switched to the headphones, 03/11/2026). The buffer keeps room for the plugin with the most
    // channels: Kontakt has many outputs, and a buffer cut back to 2 channels when the output
    // changed made it write past the end and bring the engine down.
    std::vector<juce::AudioPluginInstance*> plugins;
    {
        const juce::SpinLock::ScopedLockType sl (lock);
        sampleRate = rate;
        blockSize = block;
        int channels = 2;
        for (auto* p : live)
            if (p != nullptr)
            {
                channels = juce::jmax (channels, p->getTotalNumInputChannels(), p->getTotalNumOutputChannels());
                plugins.push_back (p);
            }
        scratch.setSize (channels, block, false, true, true);
        for (auto& m : midi)
            m.ensureSize (2048);
        strips.setSize (2 * kStrips, block, false, true, true);
        sends.setSize (kStrips, block, false, true, true);
        soundsEvents.reserve (8192);
        master.setSize (2, block, false, true, true);
        busIn.setSize (1, block, false, true, true);
        // The Reverb bus (F2.2): the GS reverb the built-in sounds had inside, now for every track.
        if (busReverb == nullptr || rate != busRate)
        {
            busReverb = std::make_unique<gs::Reverb> (rate);
            busRate = rate;
        }
    }
    // Plugins are prepared out of the lock: Kontakt takes its time, and the audio is stopped anyway.
    for (auto* p : plugins)
        p->prepareToPlay (rate, block);
    // The effects too (F2.2 parte C): their filters and look-ahead depend on the rate.
    for (auto& c : chains)
        if (c != nullptr)
            for (auto& x : c->inserts)
            {
                if (x->own != nullptr)
                    x->own->prepare (rate, block);
                if (x->plugin != nullptr)
                    x->plugin->prepareToPlay (rate, block);
            }
    noMidi.ensureSize (16);
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

void Engine::scan (const juce::FileSearchPath& where, const juce::File& deadMansPedal, const std::function<void (const juce::String&, float)>& progress)
{
    for (auto* format : formatManager.getFormats())
    {
        juce::PluginDirectoryScanner scanner (knownPlugins, *format, where, true, deadMansPedal, false);
        juce::String name;
        for (;;)
        {
            name = scanner.getNextPluginFileThatWillBeScanned();
            if (progress && name.isNotEmpty())
                progress (name, scanner.getProgress());
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
        touch (slot);
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

juce::Array<int> Engine::openWindows() const
{
    juce::Array<int> out;
    for (int slot = 0; slot < kSlots; ++slot)
        if (windows[(size_t) slot] != nullptr && windows[(size_t) slot]->isVisible())
            out.add (slot);
    return out;
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

namespace
{
/**
 * A plugin track's reverb at 100% sounds as much as a built-in sound's at its top (CC91 = 127).
 * Measured on 03/11/2026 with MuseScore strings: (L + R) / 2 into the bus gave 5 dB less reverb
 * than the built-in send (Fran: «muy sutil, casi apenas perceptible al 100%»); 10^(5.1/20).
 */
constexpr double kPluginSendMatch = 1.8;
} // namespace

// -----------------------------------------------------------------------------
// Built-in sounds

SoundFontSynth& Engine::sounds()
{
    if (slots[(size_t) kSoundsSlot] == nullptr)
    {
        auto synth = std::make_unique<SoundFontSynth>();
        synth->prepareToPlay (sampleRate, blockSize);
        {
            const juce::SpinLock::ScopedLockType sl (lock);
            live[(size_t) kSoundsSlot] = synth.get();
        }
        slots[(size_t) kSoundsSlot] = std::move (synth);
    }
    return *static_cast<SoundFontSynth*> (slots[(size_t) kSoundsSlot].get());
}

juce::String Engine::loadSoundBank (int offset, const juce::File& file, int& presets)
{
    auto* synth = static_cast<SoundFontSynth*> (slots[(size_t) kSoundsSlot].get());
    if (synth == nullptr)
        return "The built-in sounds are not ready";
    return synth->loadBank (offset, file, presets);
}

// -----------------------------------------------------------------------------
// MIDI

void Engine::schedule (int slot, double delaySeconds, const juce::MidiMessage& message, int strip)
{
    if (slot < 0 || slot >= kAllSlots || strip >= kStrips)
        return;
    const auto at = position.load() + (juce::int64) std::llround (juce::jmax (0.0, delaySeconds) * sampleRate);
    const juce::SpinLock::ScopedLockType sl (lock);
    pending.push_back ({ at, slot, message, strip });
}

void Engine::touch (int strip)
{
    int now = used.load();
    while (strip >= now && ! used.compare_exchange_weak (now, juce::jmin (strip + 1, kStrips)))
    {
    }
}

void Engine::panic()
{
    const juce::SpinLock::ScopedLockType sl (lock);
    pending.clear();
    const auto now = position.load();
    for (int s = 0; s < kSlots; ++s)
        if (live[(size_t) s] != nullptr)
            for (int ch = 1; ch <= 16; ++ch)
            {
                pending.push_back ({ now, s, juce::MidiMessage::controllerEvent (ch, 64, 0) });
                pending.push_back ({ now, s, juce::MidiMessage::allNotesOff (ch) });
            }
    // The built-in sounds have a channel per strip: all of them at once.
    if (auto* synth = static_cast<SoundFontSynth*> (live[(size_t) kSoundsSlot]))
        synth->releaseAll();
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
    stats.sumLoad += load;
    if (load > 1.0)
        stats.overruns++;
}

Engine::Stats Engine::takeStats()
{
    Stats out;
    {
        const juce::SpinLock::ScopedLockType sl (statsLock);
        out = stats;
        stats = {};
    }
    // The driver's own count of dropouts (WASAPI counts them), as the change since the last call.
    if (auto* d = device.getCurrentAudioDevice())
    {
        const int now = d->getXRunCount();
        if (now >= 0)
        {
            out.xruns = lastXRuns >= 0 ? juce::jmax (0, now - lastXRuns) : 0;
            lastXRuns = now;
        }
    }
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
    soundsEvents.clear();
    int late = 0;
    auto it = pending.begin();
    while (it != pending.end())
    {
        if (it->at < end)
        {
            if (it->at < start)
                ++late;
            const auto offset = (int) juce::jlimit<juce::int64> (0, numSamples - 1, it->at - start);
            if (it->slot == kSoundsSlot)
            {
                // A2: the strip is the synth channel; without one (before A2), the MIDI channel.
                const int channel = it->strip >= 0 ? it->strip : it->message.getChannel() - 1;
                touch (channel);
                soundsEvents.push_back ({ offset, channel, it->message });
            }
            else
                midi[(size_t) it->slot].addEvent (it->message, offset);
            it = pending.erase (it);
        }
        else
            ++it;
    }
    // In time order, keeping the order they came in at the same sample (as a MidiBuffer does).
    for (size_t i = 1; i < soundsEvents.size(); ++i)
        for (size_t j = i; j > 0 && soundsEvents[j - 1].offset > soundsEvents[j].offset; --j)
            std::swap (soundsEvents[j - 1], soundsEvents[j]);
    if (late > 0)
    {
        const juce::SpinLock::ScopedLockType st (statsLock);
        stats.late += late;
    }

    if (scratch.getNumSamples() < numSamples)
        scratch.setSize (scratch.getNumChannels(), numSamples, false, true, true);
    // F2.2: one strip per track (A2: numbered by Four Hands), its reverb send and the master.
    if (strips.getNumSamples() < numSamples)
    {
        strips.setSize (2 * kStrips, numSamples, false, false, true);
        sends.setSize (kStrips, numSamples, false, false, true);
        master.setSize (2, numSamples, false, false, true);
        busIn.setSize (1, numSamples, false, false, true);
    }
    // Only the strips in use: a song with 20 tracks does not pay for 512.
    const int inUse = used.load();
    for (int s = 0; s < inUse; ++s)
    {
        strips.clear (2 * s, 0, numSamples);
        strips.clear (2 * s + 1, 0, numSamples);
        sends.clear (s, 0, numSamples);
    }
    master.clear (0, numSamples);
    busIn.clear (0, numSamples);

    for (int s = 0; s < inUse; ++s)
    {
        auto* plugin = live[(size_t) s];
        if (plugin == nullptr)
            continue;
        const auto channels = juce::jmax (plugin->getTotalNumInputChannels(), plugin->getTotalNumOutputChannels());
        juce::AudioBuffer<float> buffer (scratch.getArrayOfWritePointers(), juce::jmin (channels, scratch.getNumChannels()), numSamples);
        buffer.clear();
        plugin->processBlock (buffer, midi[(size_t) s]);
        const auto outChannels = juce::jmin (plugin->getTotalNumOutputChannels(), buffer.getNumChannels());
        if (outChannels == 0)
            continue;
        // The plugin's first pair goes to its track's strip; a mono plugin feeds both sides.
        for (int c = 0; c < 2; ++c)
            strips.addFrom (2 * s + c, 0, buffer, juce::jmin (c, outChannels - 1), 0, numSamples);
    }
    if (auto* sounds = static_cast<SoundFontSynth*> (live[(size_t) kSoundsSlot]))
        sounds->processSplit (soundsEvents, numSamples, strips.getArrayOfWritePointers(), sends.getArrayOfWritePointers(), master.getWritePointer (0), master.getWritePointer (1));

    // Insert effects (F2.2 parte C), then the delay that lines every strip up with the slowest one.
    const int comp = maxLatency.load();
    for (int ch = 0; ch < inUse; ++ch)
    {
        float* L = strips.getWritePointer (2 * ch);
        float* R = strips.getWritePointer (2 * ch + 1);
        auto* chain = chains[(size_t) ch].get();
        int own = 0;
        if (chain != nullptr && ! chain->inserts.empty())
        {
            runChain (*chain, L, R, numSamples);
            own = chain->latency;
        }
        if (comp > own)
        {
            float* lines[3] = { L, R, sends.getWritePointer (ch) };
            // The built-in sounds' own reverb send is delayed as much as the whole strip.
            delays[(size_t) ch].process (lines, 3, numSamples, comp - own);
        }
    }

    // The strips: fader and balance, meters, into the master and the Reverb bus (post-fader).
    float* busData = busIn.getWritePointer (0);
    for (int ch = 0; ch < inUse; ++ch)
    {
        const auto& p = mix[(size_t) ch];
        float* L = strips.getWritePointer (2 * ch);
        float* R = strips.getWritePointer (2 * ch + 1);
        if (! p.on)
        {
            // Off: silent from here, its sends too (the built-in sounds' own send included).
            juce::FloatVectorOperations::clear (L, numSamples);
            juce::FloatVectorOperations::clear (R, numSamples);
            meters[(size_t) ch].add (L, R, numSamples);
            continue;
        }
        const float gL = (float) (p.gain * (p.pan <= 0 ? 1.0 : std::cos (p.pan * juce::MathConstants<double>::halfPi)));
        const float gR = (float) (p.gain * (p.pan >= 0 ? 1.0 : std::cos (-p.pan * juce::MathConstants<double>::halfPi)));
        if (gL != 1.0f)
            juce::FloatVectorOperations::multiply (L, gL, numSamples);
        if (gR != 1.0f)
            juce::FloatVectorOperations::multiply (R, gR, numSamples);
        meters[(size_t) ch].add (L, R, numSamples);
        master.addFrom (0, 0, L, numSamples);
        master.addFrom (1, 0, R, numSamples);
        // The built-in sounds' own send (it already follows their volume) and the plugins' send.
        juce::FloatVectorOperations::add (busData, sends.getReadPointer (ch), numSamples);
        if (p.reverb > 0)
            for (int i = 0; i < numSamples; ++i)
                busData[i] += (float) ((L[i] + R[i]) * 0.5 * p.reverb * kPluginSendMatch);
    }
    if (busReverb != nullptr)
        busReverb->process (busData, master.getWritePointer (0), master.getWritePointer (1), 0, numSamples);
    if (auto* mc = chains[(size_t) kMasterChain].get(); mc != nullptr && ! mc->inserts.empty())
        runChain (*mc, master.getWritePointer (0), master.getWritePointer (1), numSamples);
    if (const auto mg = (float) masterGain.load(); mg != 1.0f)
    {
        juce::FloatVectorOperations::multiply (master.getWritePointer (0), mg, numSamples);
        juce::FloatVectorOperations::multiply (master.getWritePointer (1), mg, numSamples);
    }
    meters[(size_t) kStrips].add (master.getReadPointer (0), master.getReadPointer (1), numSamples);

    for (int c = 0; c < numOutputs; ++c)
        if (outputs[c] != nullptr)
        {
            if (numOutputs == 1)
            {
                juce::FloatVectorOperations::copyWithMultiply (outputs[c], master.getReadPointer (0), 0.5f, numSamples);
                juce::FloatVectorOperations::addWithMultiply (outputs[c], master.getReadPointer (1), 0.5f, numSamples);
            }
            else if (c < 2)
                juce::FloatVectorOperations::copy (outputs[c], master.getReadPointer (c), numSamples);
        }
    position.store (end);
}

void Engine::Meter::add (const float* L, const float* R, int n)
{
    for (int i = 0; i < n; ++i)
    {
        const float a = juce::jmax (std::abs (L[i]), std::abs (R[i]));
        peak = juce::jmax (peak, a);
        totalPeak = juce::jmax (totalPeak, a);
        if (a > 1.0f)
            ++clips;
        const double sq = 0.5 * ((double) L[i] * L[i] + (double) R[i] * R[i]);
        sum += sq;
        totalSum += sq;
    }
    count += n;
    totalCount += n;
}

void Engine::setMix (int strip, double gain, double pan, double reverb, bool on)
{
    if (! juce::isPositiveAndBelow (strip, kStrips))
        return;
    const juce::SpinLock::ScopedLockType sl (lock);
    mix[(size_t) strip] = { juce::jlimit (0.0, 4.0, gain), juce::jlimit (-1.0, 1.0, pan), juce::jlimit (0.0, 1.0, reverb), on };
    // A neutral strip does not need to be counted; one with a mix does (its plugin may come later).
    if (gain != 1.0 || pan != 0.0 || reverb != 0.0 || ! on)
        touch (strip);
}

std::vector<Engine::Level> Engine::takeMeters (bool sinceReset)
{
    // The strips in use, then the master.
    const int n = used.load();
    std::vector<Level> out ((size_t) n + 1);
    const juce::SpinLock::ScopedLockType sl (lock);
    for (size_t i = 0; i < out.size(); ++i)
    {
        auto& m = meters[i < (size_t) n ? i : (size_t) kStrips];
        if (sinceReset)
            out[i] = { m.totalPeak, m.totalCount > 0 ? std::sqrt (m.totalSum / (double) m.totalCount) : 0.0, m.clips };
        else
        {
            out[i] = { m.peak, m.count > 0 ? std::sqrt (m.sum / (double) m.count) : 0.0, m.clips };
            m.peak = 0;
            m.sum = 0;
            m.count = 0;
        }
    }
    return out;
}

void Engine::resetLevels()
{
    const juce::SpinLock::ScopedLockType sl (lock);
    for (auto& m : meters)
        m = {};
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


// -----------------------------------------------------------------------------
// Insert effects (F2.2 parte C)

void Engine::runChain (Chain& chain, float* L, float* R, int n)
{
    for (auto& x : chain.inserts)
    {
        const bool off = x->bypass.load();
        if (x->own != nullptr)
        {
            x->own->process (L, R, n, off);
            continue;
        }
        auto* plugin = x->plugin.get();
        if (plugin == nullptr)
            continue;
        const int channels = juce::jmin (scratch.getNumChannels(), juce::jmax (2, plugin->getTotalNumInputChannels(), plugin->getTotalNumOutputChannels()));
        juce::AudioBuffer<float> buffer (scratch.getArrayOfWritePointers(), channels, n);
        buffer.clear();
        const int ins = plugin->getTotalNumInputChannels();
        if (ins == 1)
        {
            buffer.copyFrom (0, 0, L, n, 0.5f);
            buffer.addFrom (0, 0, R, n, 0.5f);
        }
        else
        {
            buffer.copyFrom (0, 0, L, n);
            buffer.copyFrom (1, 0, R, n);
        }
        noMidi.clear();
        if (off)
            plugin->processBlockBypassed (buffer, noMidi);
        else
            plugin->processBlock (buffer, noMidi);
        const int outs = juce::jmin (plugin->getTotalNumOutputChannels(), channels);
        if (outs <= 0)
            continue;
        juce::FloatVectorOperations::copy (L, buffer.getReadPointer (0), n);
        juce::FloatVectorOperations::copy (R, buffer.getReadPointer (outs > 1 ? 1 : 0), n);
    }
}

std::vector<std::pair<juce::String, juce::String>> Engine::setChain (int strip, const std::vector<InsertSpec>& specs)
{
    std::vector<std::pair<juce::String, juce::String>> problems;
    const int index = strip < 0 ? kMasterChain : strip;
    if (index > kMasterChain)
    {
        problems.push_back ({ "", "Invalid strip" });
        return problems;
    }
    auto before = chains[(size_t) index];
    auto next = std::make_shared<Chain>();
    int channels = 2;
    for (const auto& spec : specs)
    {
        std::shared_ptr<Insert> x;
        if (before != nullptr)
            for (auto& old : before->inserts)
                if (old->id == spec.id && old->kind == spec.kind && old->pluginId == spec.pluginId)
                    x = old;
        if (x == nullptr)
        {
            x = std::make_shared<Insert>();
            x->id = spec.id;
            x->kind = spec.kind;
            x->pluginId = spec.pluginId;
            if (spec.kind == "plugin")
            {
                juce::PluginDescription description;
                bool found = false;
                for (const auto& d : knownPlugins.getTypes())
                    if (! found && d.createIdentifierString() == spec.pluginId)
                    {
                        description = d;
                        found = true;
                    }
                if (! found)
                {
                    problems.push_back ({ spec.id, "Unknown plugin: " + spec.pluginId });
                    continue;
                }
                juce::String error;
                x->plugin = formatManager.createPluginInstance (description, sampleRate, blockSize, error);
                if (x->plugin == nullptr)
                {
                    problems.push_back ({ spec.id, error.isNotEmpty() ? error : "The plugin could not be created" });
                    continue;
                }
                x->plugin->enableAllBuses();
                x->plugin->prepareToPlay (sampleRate, blockSize);
            }
            else
            {
                x->own = makeOwnEffect (spec.kind);
                if (x->own == nullptr)
                {
                    problems.push_back ({ spec.id, "Unknown effect: " + spec.kind });
                    continue;
                }
                x->own->prepare (sampleRate, blockSize);
            }
        }
        x->bypass.store (spec.bypass);
        if (x->own != nullptr)
            for (const auto& [name, value] : spec.params)
                x->own->setParam (name, value);
        if (x->plugin != nullptr)
            channels = juce::jmax (channels, x->plugin->getTotalNumInputChannels(), x->plugin->getTotalNumOutputChannels());
        next->latency += x->latency();
        next->inserts.push_back (x);
    }
    // The slowest strip sets how much the others wait (the master's chain delays everything alike).
    int most = 0;
    for (int s = 0; s < kStrips; ++s)
    {
        const auto& c = s == index ? next : chains[(size_t) s];
        if (c != nullptr)
            most = juce::jmax (most, c->latency);
    }
    if (index < kStrips)
        touch (index);
    // Longer delay lines are made here and swapped in under the lock (the audio thread uses them).
    std::vector<std::pair<int, DelayLine>> longer;
    if (most > 0)
        for (int s = 0; s < used.load(); ++s)
            if (delays[(size_t) s].size() < most + 1)
            {
                longer.emplace_back (s, DelayLine());
                longer.back().second.setSize (most);
            }
    {
        const juce::SpinLock::ScopedLockType sl (lock);
        if (scratch.getNumChannels() < channels)
            scratch.setSize (channels, blockSize, false, true, true);
        for (auto& [s, line] : longer)
            std::swap (delays[(size_t) s], line);
        chains[(size_t) index] = next->inserts.empty() ? nullptr : next;
        maxLatency.store (most);
    }
    // What left the chain is released here, out of the audio lock (its window first).
    return problems;
}

void Engine::ensureDelays()
{
    const int most = maxLatency.load();
    if (most <= 0)
        return;
    for (int s = 0; s < used.load(); ++s)
        if (delays[(size_t) s].size() < most + 1)
        {
            DelayLine fresh;
            fresh.setSize (most);
            const juce::SpinLock::ScopedLockType sl (lock);
            std::swap (delays[(size_t) s], fresh);
        }
}

void Engine::timerTick()
{
    checkDefaultOutput (true);
    // A track that started to sound after the last chain change gets its delay line here.
    ensureDelays();
}

int Engine::chainLatency (int strip) const
{
    const int index = strip < 0 ? kMasterChain : strip;
    if (index > kMasterChain || chains[(size_t) index] == nullptr)
        return 0;
    return chains[(size_t) index]->latency;
}

std::shared_ptr<Insert> Engine::findInsert (const juce::String& id) const
{
    for (const auto& c : chains)
        if (c != nullptr)
            for (const auto& x : c->inserts)
                if (x->id == id)
                    return x;
    return nullptr;
}

float Engine::insertReduction (const juce::String& id) const
{
    auto x = findInsert (id);
    return x != nullptr && x->own != nullptr ? x->own->reduction() : 0.0f;
}

bool Engine::showInsert (const juce::String& id)
{
    auto x = findInsert (id);
    if (x == nullptr || x->plugin == nullptr)
        return false;
    if (x->window == nullptr)
    {
        if (! x->plugin->hasEditor())
            return false;
        auto* editor = x->plugin->createEditorIfNeeded();
        if (editor == nullptr)
            return false;
        x->window = std::make_unique<PluginWindow> (x->plugin->getName(), editor);
    }
    x->window->setVisible (true);
    x->window->toFront (true);
    return true;
}

juce::StringArray Engine::openInsertWindows() const
{
    juce::StringArray out;
    for (const auto& c : chains)
        if (c != nullptr)
            for (const auto& x : c->inserts)
                if (x->window != nullptr && x->window->isVisible())
                    out.add (x->id);
    return out;
}

juce::MemoryBlock Engine::insertState (const juce::String& id)
{
    juce::MemoryBlock data;
    if (auto x = findInsert (id); x != nullptr && x->plugin != nullptr)
        x->plugin->getStateInformation (data);
    return data;
}

bool Engine::setInsertState (const juce::String& id, const juce::MemoryBlock& data)
{
    auto x = findInsert (id);
    if (x == nullptr || x->plugin == nullptr)
        return false;
    x->plugin->setStateInformation (data.getData(), (int) data.getSize());
    return true;
}

std::vector<Engine::ParamInfo> Engine::parameters (const juce::String& id, int slot)
{
    std::vector<ParamInfo> out;
    juce::AudioProcessor* p = nullptr;
    if (id.isNotEmpty())
    {
        if (auto x = findInsert (id); x != nullptr)
            p = x->plugin.get();
    }
    else if (slot >= 0 && slot < kSlots)
        p = slots[(size_t) slot].get();
    if (p == nullptr)
        return out;
    const auto& params = p->getParameters();
    for (int i = 0; i < params.size(); ++i)
    {
        auto* q = params[i];
        out.push_back ({ i, q->getName (64), q->getCurrentValueAsText(), q->getLabel(), q->getValue() });
    }
    return out;
}

juce::String Engine::setParameter (const juce::String& id, int slot, int index, float value, const juce::String& text, bool& ok)
{
    ok = false;
    juce::AudioProcessor* p = nullptr;
    if (id.isNotEmpty())
    {
        if (auto x = findInsert (id); x != nullptr)
            p = x->plugin.get();
    }
    else if (slot >= 0 && slot < kSlots)
        p = slots[(size_t) slot].get();
    if (p == nullptr)
        return {};
    const auto& params = p->getParameters();
    if (! juce::isPositiveAndBelow (index, params.size()))
        return {};
    auto* q = params[index];
    const float v = text.isNotEmpty() ? q->getValueForText (text) : juce::jlimit (0.0f, 1.0f, value);
    q->beginChangeGesture();
    q->setValueNotifyingHost (v);
    q->endChangeGesture();
    ok = true;
    return q->getCurrentValueAsText();
}

} // namespace fh
