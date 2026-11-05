# Four Hands Engine (fase 2, prueba S2; ESTUDIO_FASE2_MOTOR.md): the native audio engine.
# It hosts VST3 instruments, opens their windows and plays what Four Hands sends it.
# JUCE 8 under its Starter licence (free up to 20,000 USD a year; decided by Fran on 28/10/2026).
cmake_minimum_required(VERSION 3.22)
project(FourHandsEngine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
# A local copy (FH_JUCE_DIR) avoids downloading JUCE again on every clean build.
if(DEFINED FH_JUCE_DIR)
  add_subdirectory(${FH_JUCE_DIR} juce)
else()
  FetchContent_Declare(juce GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.12 GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(juce)
endif()

juce_add_gui_app(FourHandsEngine
  PRODUCT_NAME "Four Hands Engine"
  COMPANY_NAME "Four Hands Studio"
  BUNDLE_ID com.fourhandsstudio.engine
  VERSION 0.1.0)

target_sources(FourHandsEngine PRIVATE src/Main.cpp src/Engine.cpp src/Effects.cpp src/Analyzer.cpp src/Link.cpp src/SoundFontSynth.cpp src/SoundBank.cpp)
# The built-in sounds (F2.1, 31/10 and 01/11/2026): voices that follow SpessaSynth (Apache-2.0), on
# banks read by TinySoundFont (MIT) with stb_vorbis (MIT or public domain), single files kept in
# third_party with their licences.

target_compile_definitions(FourHandsEngine PRIVATE
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_AU=0
  JUCE_PLUGINHOST_LADSPA=0
  JUCE_PLUGINHOST_LV2=0
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_WASAPI=1
  JUCE_ASIO=0
  JUCE_DISPLAY_SPLASH_SCREEN=0
  JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:FourHandsEngine,JUCE_PRODUCT_NAME>"
  JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:FourHandsEngine,JUCE_VERSION>")

target_link_libraries(FourHandsEngine PRIVATE
  juce::juce_audio_utils
  juce::juce_audio_processors
  juce::juce_audio_devices
  juce::juce_gui_extra
  juce::juce_recommended_config_flags
  juce::juce_recommended_warning_flags)

# A tiny sine instrument, as a VST3, to test hosting without third-party plugins (CI and the container).
option(FH_TEST_PLUGIN "Build the test instrument plugin" OFF)
if(FH_TEST_PLUGIN)
  add_subdirectory(test-synth)
endif()
