Control your Denon AVR receiver with Homey locally via LAN.

This apps connects your Denon receiver with Homey via TelNet. The underlying technology is also shared with Marantz receivers so those may also work. Please make sure the receiver has a static IP address and has Network Control set to Always-On in its settings.

Features
Action Flow Cards:
 - Turn your Denon AVR on and off, or toggle
 - Absolute and relative volume controls (using percentages or dB values)
 - Muting controls
 - Set the input source. Sources are dynamically requested from the receiver including user defined source names - PS5 instead of GAME for example.
 - Send customized commands. Add functionality that the app does not support by default: setting surround mode or tweaking parameters for example.

When Flow Cards:
 - Turned on/off
 - Volume changed
 - Source changed (in general or to a specific source)

Condition Flow Cards:
 - Is the receiver powered on?
 - Is the receiver set to a specific input source?


About Custom Commands
Custom commands allow you to specify custom data to send to your Denon device. These are generally uppercase short words like: MVUP, MVDOWN, SIDVD or Z2ON. You can look up commands that your device supports by doing a websearch for 'denon telnet protocol' including your model number. There are several excel sheets and PDFs with available commands and a lot of them are shared between models. Note that the Denon AVR app will automatically terminate your commands with the required '<CR>'.


Supported Devices
Most Denon models that are network control enabled through Telnet should work. Some Marantz receivers have also been reported to work with this app. 

Confirmed
* AVR-X1000
* AVR-X1200W
* AVR-X1300W
* AVR-X1600 DAB (custom commands required)
* AVR-X1700H
* AVR-X1800H (developer's receiver)
* AVR-X2200W (developer's previous receiver)
* AVR-X2300W
* AVR-X2600H DAB
* AVR-X2700H
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
* AVC-A1H
* AVR-X5200
* AVR-X6200
* AVR-3313
* AVR-3808A (power saving must be turned off)
* AVR-S960H
* CEOL RCD-N8
* DRA-800H

* Marantz NR-1711
* Marantz SR6013

Please let me know if your Denon model is supported.


Currently unsupported
* Zone2 and Zone3 control are currently only possible by using custom commands.
* This app uses telnet to communicate with the receiver on port 80, not the web interface via port 8080. 

For changelogs, issues or suggestions please visit: 
https://github.com/murderbeard/com.moz.denon