// A sine instrument for the engine's tests: one voice per note, a short release, a generic editor.
#include <juce_audio_utils/juce_audio_utils.h>

namespace
{
struct SineSound final : juce::SynthesiserSound
{
    bool appliesToNote (int) override { return true; }
    bool appliesToChannel (int) override { return true; }
};

struct SineVoice final : juce::SynthesiserVoice
{
    bool canPlaySound (juce::SynthesiserSound* s) override { return dynamic_cast<SineSound*> (s) != nullptr; }
    void startNote (int note, float velocity, juce::SynthesiserSound*, int) override
    {
        level = velocity * 0.2;
        tail = 0;
        angle = 0;
        delta = juce::MathConstants<double>::twoPi * juce::MidiMessage::getMidiNoteInHertz (note) / getSampleRate();
    }
    void stopNote (float, bool allowTail) override
    {
        if (allowTail && tail == 0)
            tail = 1;
        else
            clearCurrentNote(), level = 0;
    }
    void pitchWheelMoved (int) override {}
    void controllerMoved (int, int) override {}
    void renderNextBlock (juce::AudioBuffer<float>& out, int start, int count) override
    {
        if (level <= 0)
            return;
        while (--count >= 0)
        {
            const auto v = (float) (std::sin (angle) * level * (tail > 0 ? tail : 1.0));
            for (int c = out.getNumChannels(); --c >= 0;)
                out.addSample (c, start, v);
            angle += delta;
            ++start;
            if (tail > 0)
            {
                tail *= 0.999;
                if (tail < 0.005)
                {
                    clearCurrentNote();
                    level = 0;
                    break;
                }
            }
        }
    }
    double angle = 0, delta = 0, level = 0, tail = 0;
};

class TestSynth final : public juce::AudioProcessor
{
public:
    TestSynth() : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true))
    {
        for (int i = 0; i < 8; ++i)
            synth.addVoice (new SineVoice());
        synth.addSound (new SineSound());
        addParameter (gain = new juce::AudioParameterFloat ({ "gain", 1 }, "Gain", 0.0f, 1.0f, 1.0f));
    }
    const juce::String getName() const override { return "Four Hands Test Synth"; }
    void prepareToPlay (double rate, int) override { synth.setCurrentPlaybackSampleRate (rate); }
    void releaseResources() override {}
    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override
    {
        buffer.clear();
        synth.renderNextBlock (buffer, midi, 0, buffer.getNumSamples());
        buffer.applyGain (gain->get());
    }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.1; }
    juce::AudioProcessorEditor* createEditor() override { return new juce::GenericAudioProcessorEditor (*this); }
    bool hasEditor() const override { return true; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return "Default"; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock& data) override { juce::MemoryOutputStream (data, true).writeFloat (gain->get()); }
    void setStateInformation (const void* data, int size) override
    {
        if (size >= 4)
            *gain = juce::MemoryInputStream (data, (size_t) size, false).readFloat();
    }

private:
    juce::Synthesiser synth;
    juce::AudioParameterFloat* gain;
};
} // namespace

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new TestSynth();
}
