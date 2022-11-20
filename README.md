Control your Denon AVR network enabled receiver with your Homey.

This apps connects via Telnet to your Denon receiver. Please make sure your receiver set up to have a static IP address as well as enabling Network Control. (Setup->Network->Network Control on your receiver)

## Features
Action Flow Cards:
* Turn your Denon AVR on and off, or toggle
* Increase or decrease volume by a relative amount
* Set volume to a fixed dB value
* Mute/Unmute or toggle mute
* Set input source from a dropdown list.
* Send customized commands. Add functionality that the app does not support by default: missing input sources for your specific device or setting surround mode for example.

Condition Flow Cards:
* Is the Denon AVR powered on?
* Is the Denon AVR set to a selected input source?


## About Custom Commands
Custom commands allow you to specify custom data to send to your Denon device. These are generally uppercase short words like: MVUP, MVDOWN, SIDVD or Z2ON. You can look up commands that your device supports by doing a websearch for '(your_device_series e.g. X1200W) denon telnet protocol'. Denon provides PDF files for a lot of devices. Inside you will find the commands supported by your device. Note that the Denon AVR app will automatically terminate your commands with the required `<CR>`.


## Supported Devices
Most Denon models that are network control enabled through Telnet should work.

## Confirmed
* AVR-X1000
* AVR-X1200W
* AVR-X1300W
* AVR-X1600 DAB (custom commands required)
* AVR-X1700H
* AVR-X2200W
* AVR-X2300W
* AVR-X2600H DAB
* AVR-X3000
* AVR-X3100W
* AVR-X3200W
* AVR-X3500H
* AVR-X4000
* AVR-X4100W
* AVR-X4200W
* AVR-X4300H
* AVR-X4500H
* AVC-X4700H
* AVR-X5200
* AVR-X6200
* AVR-3313
* AVR-3808A
* AVR-S960H
* CEOL RCD-N8
* DRA-800H

Please let me know if your Denon model is supported.


## Future Things
Most important features are implemented but there are some things that would be nice to have. If there is some demand for it these might be implemented until then the base functionality remains as is.
* Zone2 control; channel select and volume.
* More trigger cards. (on/off trigger card is available)
* More mobile controls; channel select.


For changelogs please visit: https://github.com/murderbeard/com.moz.denon

## Version 1.2.1
* Fixed an issue where adding a new device would fail.

## Version 1.2.0
* Upgrade to Homey SDK3.

## Version 1.1.6
* Deleted devices are handled correctly. All running tasks are killed and callbacks cleared. Before deleted devices would linger due to status and command timeouts.
* Added titleFormatted to flow cards: Selected As Source, Adjust Volume, Set Volume and Select Source. For increased readability.

## Version 1.1.5
* Volume clamping added (both in app.json and ensuring it in device.js).
* 'new Buffer' replaced with 'Buffer.alloc', due to deprecation. 
* Moved source asset files into .src to exclude it from builds.
* Added brandColor, dark gray fitting Denon's overall look.
 
## Version 1.1.4
* Fixed crash when receiving an error when trying to use the muting capability. 

## Version 1.1.3
* Fixed an issue where the volume action card could cause a crash if it received a 'dual line message' from the receiver.

## Version 1.1.2
* Fixed an issue where a volume response message from MV? could be discarded erroneously. Leaving the socket open and resulting in a confusing or possibly even broken series of events.
* Command messages are given a number which makes it easier to follow the flow of events in the log file.
* Changelogs removed from README.TXT per Athom request.

## Version 1.1.0
* Mobile control for volume setting and muting (volume_set, volume_up, volume_down, volume_mute capabilities added).
* Polling feature added; will automatically detect changes to power, muting and volume.

## Version 1.0.0
* Updated icon to be centered properly in app.
* Readability of advanced settings improved.
* Reduced time before a receiver is considered unreachable. Reducing the time before a proper error shows.
* Bumped version number to be semantically compatible with Athom's conventions.

## Version 0.2.1
* Power toggling could cause the socket not getting closed when the receiver returns an error message, blocking any new requests to the receiver.

## Version 0.2.0
* Custom command flow card added. Send your own data to your Denon device.
* Converted to Homey SDK 2. Promises used where applicable.
* Flow cards now show errors; failed to send, IP not found, etc.
* Device specific settings are stored and not requested during each command request.
* Command processing loop now stops when the command buffer is empty.

## Version 0.1.9
* Organized and cleaned up some code.
* Value label for volume cards is now 'dB' instead of 'db'.
* Updated compatibility list and some text in README.
* Fixed JPEGs for the Athom app store having a white background of 253 instead of 255.

## Version 0.1.8
* Added mobile card for onoff, other capabilities such as volume are for a future release.

## Version 0.1.7
* Added option to use ZM instead of PW to only control the Main Zone. Zone2 would also get turned on/off on devices with multiple zones, single zone devices should use PW.
* Added more AUX channels for 3100-W and N8: AUX2, AUXA, AUXB, AUXC and AUXD.

## Version 0.1.6
* Fixed crash in capabilities.onoff.set.
* Power flow cards now use module.exports.capabilities, removing duplicate code and making the onoff state data available for insights.

## Version 0.1.5
* A change in Homey meant device status could be requested before settings were saved when pairing. Failsafe added.

## Version 0.1.4
* Fix for volume adjust not parsing whole dB numbers correctly which could cause large jumps in dB.
* Fix for volume adjust sending negative dB values, which is ignored by the AVR but makes no sense to let happen. 
* Reponse packet telling that the AVR is on max volume is not considered a real volume request response. (Caused no problems but still a bug.)

## Version 0.1.3
* Fix 'substring' of null crash for channel condition flow card.