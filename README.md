#Denon AVR Network Control for Athom Homey

Control your Denon AVR network enabled receiver with your Homey.

This apps connects via Telnet to your Denon receiver. Please make sure your receiver set up to have a static IP address as well as enabling Network Control. (Setup->Network->Network Control on your receiver)

##Features
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


##About Custom Commands
Custom commands allow you to specify custom data to send to your Denon device. These are generally uppercase short words like: MVUP, MVDOWN, SIDVD or Z2ON. You can look up commands that your device supports by doing a websearch for '(your_device_series e.g. X1200W) denon telnet protocol'. Denon provides PDF files for a lot of devices. Inside you will find the commands supported by your device. Note that the Denon AVR app will automatically terminate your commands with the required `<CR`>.


##Supported Devices
Most Denon models that are network control enabled through Telnet should work.
##Confirmed
* AVR-X1000
* AVR-X1200W
* AVR-X2200W
* AVR-X2300W
* AVR-X3100W
* AVR-X3200W
* AVR-3808A
* AVR-X4200W
* AVR-X4000
* AVR-X5200
* AVR-X6200
* CEOL RCD-N8

Please let me know if your Denon model is supported.


##Future Things
Most important features are implemented but there are some things that would be nice to have. If there is some demand for it these might be implemented until then the base functionality remains as is.
* Zone2 control; channel select and volume.
* Trigger cards.
* More mobile control; volume and channel controls.


#Version 0.2.0
* Custom command flow card added. Send your own data to your Denon device.
* Converted to Homey SDK 2. Promises used where applicable.
* Flow cards now show errors; failed to send, IP not found, etc.
* Device specific settings are stored and not requested during each command request.
* Command processing loop now stops when the command buffer is empty.

##Version 0.1.9
* Organized and cleaned up some code.
* Value label for volume cards is now 'dB' instead of 'db'.
* Updated compatibility list and some text in README.
* Fixed JPEGs for the Athom app store having a white background of 253 instead of 255.

##Version 0.1.8
* Added mobile card for onoff, other capabilities such as volume are for a future release.

##Version 0.1.7
* Added option to use ZM instead of PW to only control the Main Zone. Zone2 would also get turned on/off on devices with multiple zones, single zone devices should use PW.
* Added more AUX channels for 3100-W and N8: AUX2, AUXA, AUXB, AUXC and AUXD.

##Version 0.1.6
* Fixed crash in capabilities.onoff.set.
* Power flow cards now use module.exports.capabilities, removing duplicate code and making the onoff state data available for insights.

##Version 0.1.5
* A change in Homey meant device status could be requested before settings were saved when pairing. Failsafe added.

##Version 0.1.4
* Fix for volume adjust not parsing whole dB numbers correctly which could cause large jumps in dB.
* Fix for volume adjust sending negative dB values, which is ignored by the AVR but makes no sense to let happen. 
* Reponse packet telling that the AVR is on max volume is not considered a real volume request response. (Caused no problems but still a bug.)

##Version 0.1.3
* Fix 'substring' of null crash for channel condition flow card.