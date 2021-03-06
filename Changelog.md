# Changelog


## 4.0.8 - 2020-11-10
- Added new DisplayOrder function to manually rearrange the order of inputs
- Added CurrentVisibilityState & TargetVisibilityState to hide/show inputs from Apple Home
- Fixed target channel uri
- Better error handling
- Better debug

## v4.0.7 - 2020-11-10
- fixed getCurrentExternalInputsStatus

## v4.0.6 - 2020-11-10
- Removed unnecessary deps
- Updated bravia dep (need for debug)

## v4.0.5 - 2020-11-09
- Added new option to turn on TV over WOL

## v4.0.4 - 2020-11-09
- Fixed fetching inputs

## v4.0.3 - 2020-11-09
- Partial support for non android TVs

## v4.0.2 - 2020-11-08
- Fix volume up

## v4.0.1 - 2020-11-08
- Fix apple remote volume

## v4.0.0 - 2020-11-06
- Refactored code
- BETTER: Authetication flow
- BETTER: Reduced cpu/ram usage
- BETTER: Detection for tv inputs
- NEW: IRCC commands as inputs
- NEW: Config UI X support
- NEW: Speaker types (switch, lightbulb, speaker)
- NEW: Customizable Apple Remote Commands
- Bugfixes

**BRAKING CHANGES:** If you use v3 of this plugin, please remove the added TV from Homekit/Homebridge before updating! Otherwise you have to reset Homebridge!

## v3.0.5 - 2019-05-01
- Bugfixes
- Use input label when defined [(#47)](https://github.com/SeydX/homebridge-bravia-tvos/pull/47)

## v3.0.3 - 2019-04-30
- Bugfixes
- Debugging improvements

## v3.0.2
- Debugging improvements

## v3.0.1
- Bugfixes

## v3.0
- Completely rewritten code
- Faster
- Bugfixes and Improvements
- Better communication
- More memory efficient
- Designed for iOS 12.2
- Debug mode

## v2.0
- Dynamic Platform Plugin
- Bugfixes
- Performance improvements
- Ability to add multiple TVs
- Designed for iOS 12.1 and lower

## v1.0
- Init release
