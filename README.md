#Denon AVR Network Control for Athom Homey

Control your Denon AVR network enabled receiver with your Homey.

This apps connects via Telnet to your Denon receiver. Please make sure it is set up to have a static IP address as well as enabling Network Control. (Setup->Network->Network Control on your receiver)

##Features
Action Flow Cards:
* Turn your Denon AVR on and off, or toggle
* Increase or decrease volume
* Set volume to a fixed db value
* Mute/Unmute or toggle mute
* Set input source from a dropdown list.

Condition Flow Cards:
* Is the Denon AVR powered on?
* Is the Denon AVR set to selected input source?


##Supported Devices
Probably most Denon models that are network control enabled through Telnet should work.
##Confirmed
* Denon AVR-X2200W

Please let me know if your Denon model is supported.


##Future Things
Currently most important features are implemented but there are several things that would be nice to have.
* Zone2 control 
* Trigger cards

##Version 0.1.3
* Fix 'substring' of null crash for channel condition flow card.