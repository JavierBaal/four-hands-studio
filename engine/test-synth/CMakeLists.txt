# A sine instrument as a VST3, only to test hosting (test S2): no third-party plugin needed.
juce_add_plugin(FourHandsTestSynth
  PRODUCT_NAME "Four Hands Test Synth"
  COMPANY_NAME "Four Hands Studio"
  BUNDLE_ID com.fourhandsstudio.testsynth
  PLUGIN_MANUFACTURER_CODE FhSt
  PLUGIN_CODE FhTs
  FORMATS VST3
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  EDITOR_WANTS_KEYBOARD_FOCUS FALSE
  COPY_PLUGIN_AFTER_BUILD FALSE)
target_sources(FourHandsTestSynth PRIVATE TestSynth.cpp)
target_compile_definitions(FourHandsTestSynth PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0 JUCE_DISPLAY_SPLASH_SCREEN=0)
target_link_libraries(FourHandsTestSynth PRIVATE juce::juce_audio_utils juce::juce_recommended_config_flags)
