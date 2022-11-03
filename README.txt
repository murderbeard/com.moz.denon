Control your Denon AVR network enabled receiver with your Homey.

This apps connects via Telnet to your Denon receiver. Please make sure your receiver set up to have a static IP address as well as enabling Network Control. (Setup->Network->Network Control on your receiver)

Features
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


About Custom Commands
Custom commands allow you to specify custom data to send to your Denon device. These are generally uppercase short words like: MVUP, MVDOWN, SIDVD or Z2ON. You can look up commands that your device supports by doing a websearch for '(your_device_series e.g. X1200W) denon telnet protocol'. Denon provides PDF files for a lot of devices. Inside you will find the commands supported by your device. Note that the Denon AVR app will automatically terminate your commands with the required `<CR>`.


Supported Devices
Most Denon models that are network control enabled through Telnet should work.

Confirmed
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
* AVC-X4700H
* AVR-X5200
* AVR-X6200
* AVR-3313
* AVR-3808A
* AVR-S960H
* CEOL RCD-N8
* DRA-800H

Please let me know if your Denon model is supported.


Future Things
Most important features are implemented but there are some things that would be nice to have. If there is some demand for it these might be implemented until then the base functionality remains as is.
* Zone2 control; channel select and volume.
* More trigger cards. (on/off trigger card is available)
* More mobile controls; channel select.


For changelogs please visit: https://github.com/murderbeard/com.moz.denon