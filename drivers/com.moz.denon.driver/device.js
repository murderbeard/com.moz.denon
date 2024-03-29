'use strict';

const net = require('net');
const Homey = require('homey');

const WRITE_CLOSE_MODE = 0;             // We write a command and immediately close the socket afterwards.
const READ_MODE = 1;                    // We write a command and return the result, we keep the connection open. Must be closed manually.
const TELNET_PORT = 23;
const TELNET_RECONNECT_TIME_OUT = 200;  // Time before we consider a socket truly closed. Denon AVR doesn't accept a new connection while the old is open for some time.
const LOOP_DELAY = 50;                  // The time in between command buffer handling.
const LOOP_DELAY_LIMP_MODE = 200;		// When receiving warnings we switch to this delay time.
const SOCKET_CONNECT_TIMEOUT = 1000;			// Time after which we consider the socket unconnectable.
const SOCKET_INACTIVITY_TIMEOUT = 5000;			// Time after which we apparently didn't get an answer, or closed the socket properly, but we did manage to connect.
const READ_REQUEST_PROCESS_DELAY = 100;	// Delay before we send the data we received to the callback. This allows secondary messages to come through reliably.

const STATUS_COMMAND_COUNT = 4;			// Number of commands before a complete update has been received.
const STATUS_MAX_RETRY_COUNT = 9;		// Times before we consider a denon device unreachable and we stop trying to update. (Two whole 4 msg status updates + 1).
const STATUS_DELAY = 2000;				// Update time between polls	
const STATUS_DELAY_UNREACHABLE = 60000;	// Update time after too many failed attempts.			

const DEFAULT_IP = "192.168.0.1";
const SETTING_KEY_IP = "com.moz.denon.settings.ip";
const SETTING_KEY_POWER_COMMAND = "com.moz.denon.settings.powercommand";

const CAPABILITY_ONOFF = "onoff";
const CAPABILITY_VOLUME_SET = "volume_set";
const CAPABILITY_VOLUME_UP = "volume_up";
const CAPABILITY_VOLUME_DOWN = "volume_down";
const CAPABILITY_VOLUME_MUTE = "volume_mute";

const CMD_VOLUME_MASTER = "MV";
const CMD_VOLUME_MASTER_UP = "MVUP";
const CMD_VOLUME_MASTER_DOWN =  "MVDOWN";
const CMD_VOLUME_MUTE = "MU"

const LOG_LEVEL_EVERYTHING = 1000;		// Mostly useful for development. Any deployed build can just use EVERYTHING.
const LOG_LEVEL_DEBUG = 100;			
const LOG_LEVEL_WARNING = 25;
const LOG_LEVEL_ERROR = 0;
const LOG_LEVEL_ESSENTIAL = 0;

const LOG_LEVEL = LOG_LEVEL_EVERYTHING;

class DenonDevice extends Homey.Device {
	writeLog(what, level) {
		if(level == undefined)
			level = LOG_LEVEL_ESSENTIAL;

		if(level <= LOG_LEVEL)
			this.log(what);
	}

	/////////////////          Helpers	            //////////////////
	StringToBytes(str) {
		var array = Buffer.alloc(str.length + 1);

		for(var i = 0; i < str.length; i++) {
			array[i] = str.charCodeAt(i);
		}

		array[str.length] = 13; // CR

		return array;
	}

	findMessage(messages, filter) {
		var messageArray = messages.split('\r');

		for (let i = 0; i < messageArray.length; i++) {
			if(messageArray[i].startsWith(filter))
				return messageArray[i];
		}

		return "";
	}

    onInit() {
		if(!this.hasCapability(CAPABILITY_ONOFF)) {
			this.addCapability(CAPABILITY_ONOFF);
		}

		if(!this.hasCapability(CAPABILITY_VOLUME_SET)) {
			this.addCapability(CAPABILITY_VOLUME_SET);
		}

		if(!this.hasCapability(CAPABILITY_VOLUME_UP)) {
			this.addCapability(CAPABILITY_VOLUME_UP);
		}

		if(!this.hasCapability(CAPABILITY_VOLUME_DOWN)) {
			this.addCapability(CAPABILITY_VOLUME_DOWN);
		}

		if(!this.hasCapability(CAPABILITY_VOLUME_MUTE)) {
			this.addCapability(CAPABILITY_VOLUME_MUTE);
		}

		this.registerCapabilityListener(CAPABILITY_ONOFF, this.onCapabilityOnoff.bind(this))
		this.registerCapabilityListener(CAPABILITY_VOLUME_SET, this.onCapabilityVolumeSet.bind(this))
		this.registerCapabilityListener(CAPABILITY_VOLUME_UP, this.onCapabilityVolumeUp.bind(this))
		this.registerCapabilityListener(CAPABILITY_VOLUME_DOWN, this.onCapabilityVolumeDown.bind(this))
		this.registerCapabilityListener(CAPABILITY_VOLUME_MUTE, this.onCapabilityVolumeMute.bind(this))
		
		this.ip = this.getStoredSetting(SETTING_KEY_IP, DEFAULT_IP);
		this.powerCommand = this.getStoredSetting(SETTING_KEY_POWER_COMMAND, "PW");
		this.offCommand = this.powerCommand == "PW" ? "STANDBY" : "OFF";

		this.statusRetryCount = STATUS_MAX_RETRY_COUNT;
		this.statusCommandsRemain = 0;	// Each status update requires four separate requests for: power, muted, volume and now also source.
		this.statusCommandsFailed = 0;
		this.channel = "";

		this.looping = true;			// Is the device actively working through commands?
		this.commandList = new Array();	// Backlog of commands to process.
		this.commandID = 0;				// ID for the current command, useful for logging.	
		this.socket = null;

		this.statusTimeout = null;		// Timeout awaiting the next status update.
		this.commandTimeout = null;		// Timeout awaiting the next command loop. (might make looping:boolean redundant).
		this.readRequestProcessTimeout = null;	// Timeout until we present the received messages to the callback.
		this.connectTimeout = null;

		this.writeLog("Denon device initialized with IP: " + this.ip);

		this.updateDeviceStatus();

		this.commandLoop();
	}
	
	updateDeviceStatus() {
		if(this.statusCommandsFailed > 0) {
			if(this.statusRetryCount > 0) {
				this.statusRetryCount--;

				if(this.statusRetryCount == 0) {
					this.writeLog("Denon Device failed to respond: " + STATUS_MAX_RETRY_COUNT + " times. Going into slow poll mode.");
				}
			}
		} else {
			if(this.statusRetryCount == 0) {
				this.statusRetryCount = STATUS_MAX_RETRY_COUNT;
				this.writeLog("Denon Device responded after sustained failures. Going back into fast poll mode.");
			}
		}

		this.statusTimeout = null;
		this.statusCommandsRemain = STATUS_COMMAND_COUNT;
		this.statusCommandsFailed = 0;

		this.getPowerState((err, result)=> {
			if(err != null)
				this.statusCommandsFailed++;

			this.statusCommandsRemain--;

			if(this.statusCommandsRemain == 0)
				this.statusTimeout = setTimeout(this.updateDeviceStatus.bind(this), this.statusRetryCount > 0 ? STATUS_DELAY : STATUS_DELAY_UNREACHABLE);
		});	
		this.getIsMuted((err, result)=> {
			if(err != null)
				this.statusCommandsFailed++;

			this.statusCommandsRemain--;

			if(this.statusCommandsRemain == 0)
				this.statusTimeout = setTimeout(this.updateDeviceStatus.bind(this), this.statusRetryCount > 0 ? STATUS_DELAY : STATUS_DELAY_UNREACHABLE);
		});
		this.getVolume((err, result)=> {
			if(err != null)
				this.statusCommandsFailed++;

			this.statusCommandsRemain--;

			if(this.statusCommandsRemain == 0)
				this.statusTimeout = setTimeout(this.updateDeviceStatus.bind(this), this.statusRetryCount > 0 ? STATUS_DELAY : STATUS_DELAY_UNREACHABLE);
		});
		this.readRequest("SI?", (err, result, socket)=> {
			if(socket != null)	// If you can, close it. Also in case of an error.
				socket.end();
			
			if(err != null)
				this.statusCommandsFailed++;
			else {
				var source = this.findMessage(result, "SI");

				if(source != "") {	// We actually got a valid message back.
					if(this.channel != "" && this.channel != source) {
						this.channel = source;
						this.writeLog("Changed channel to: " + source);

						let channelNameForFlow = source.substring(2);	// We don't show the user the SI prefix.

						this.homey.flow.getDeviceTriggerCard('com.moz.denon.triggers.channelchanged')
							.trigger(this, {"channel": channelNameForFlow});

						this.homey.flow.getDeviceTriggerCard('com.moz.denon.triggers.channelchangedto')
							.trigger(this, null, {"channel": channelNameForFlow});
					}
					
					this.channel = source;
				}
			}

			this.statusCommandsRemain--;

			if(this.statusCommandsRemain == 0)
				this.statusTimeout = setTimeout(this.updateDeviceStatus.bind(this), this.statusRetryCount > 0 ? STATUS_DELAY : STATUS_DELAY_UNREACHABLE);
		});
	}

    onAdded() {
        this.writeLog("Denon device added.");
    }

    onDeleted() {
        this.writeLog("Denon device deleted.");

		for(var i = 0; i < this.commandList.length; i++) {	
			this.commandList[i].callback = null;	// Destroy any callbacks for commands in progress.
		}

		this.commandList.length = 0;				// Clear any backlogged commands.

		// Clear all timeouts if they exist.
		if(this.statusTimeout != null) clearTimeout(this.statusTimeout);			// Stop the status update loop.
		if(this.commandTimeout != null) clearTimeout(this.commandTimeout);			// Stop command loop.
		if(this.readRequestProcessTimeout != null) clearTimeout(this.readRequestProcessTimeout);
		if(this.connectTimeout != null) clearTimeout(this.connectTimeout);
    }
	
	async onSettings({ oldSettings, newSettings, changedKeys }) {
		this.writeLog("Settings updated.");

		this.ip = this.getSetting(newSettings, SETTING_KEY_IP, DEFAULT_IP);
		this.powerCommand = this.getSetting(newSettings, SETTING_KEY_POWER_COMMAND, "PW");
		this.offCommand = this.powerCommand == "PW" ? "STANDBY" : "OFF";
	}

    onCapabilityOnoff( value, opts, callback ) {
		this.writeLog("Setting Denon device power to " + value);
		let powerCommand =  this.powerCommand;
		let offCommand =    this.offCommand;
		let device = this;

		let promise = new Promise(
			function (resolve, reject) {
				device.writeCloseRequest(value ? powerCommand+'ON' : powerCommand+offCommand, (err, result, socket) => {
					if(err == null) {
						device.setCapabilityValue(CAPABILITY_ONOFF, value);
						resolve(value);
					} else {
						reject(err);
					}
				});		
			}
		);

		return promise;
	}

	onCapabilityVolumeSet( value, opts, callback) {
		this.writeLog("Setting Denon device volume to " + value);
		value = value > 1 ? 1 : value < 0 ? 0 : value;
																									// Again; assuming all Denon's stop at 98.0db.
		let volumeWholeNumber = parseInt(value * 98);												// The following values can be sent safely.
		let volumeRemainder = (parseInt(value * 980) - (volumeWholeNumber*10)) > 0 ? 5 : 0;			// 050 == 5db
																									// 05  == 5db
		let volume = (volumeWholeNumber*10) + volumeRemainder;										// 005 == 0.5db
		let volumeStr = volume.toString();															// 000 == 0.0db
																									// 105 == 10.5db

		// If value is smaller than 10, we need to add a zero infront otherwise it's rejected by the protocol // 980 == 98.0db
		if(volumeWholeNumber < 10) {
			volumeStr = '0' + volumeStr;
		}

		this.writeLog("Volume set: " + value + " to " + volumeStr);

		return this.writeCloseRequestPromise(CMD_VOLUME_MASTER + volumeStr);
		// Note: we don't set the capability value here but at updateDeviceStatus() next time we check. 
	}

	onCapabilityVolumeUp( value, opts, callback) {						// NOTE: Volume value gets updated during updateDeviceStatus();
		this.writeLog("Increasing Denon Device Volume.");
		return this.writeCloseRequestPromise(CMD_VOLUME_MASTER_UP);
	}

	onCapabilityVolumeDown( value, opts, callback) {					// NOTE: Volume value gets updated during updateDeviceStatus();
		this.writeLog("Decreasing Denon Device Volume.");
		return this.writeCloseRequestPromise(CMD_VOLUME_MASTER_DOWN);
	}

	onCapabilityVolumeMute( value, opts, callback) {
		this.writeLog("Setting Denon Device Mute: " + value);

		return this.writeCloseRequestPromise(value ? CMD_VOLUME_MUTE + "ON" : CMD_VOLUME_MUTE + "OFF");
		// NOTE: We do not have to request an update from the amplifier here as any corrections will be sent during updateDeviceStatus().
	}

	// callback(err, result)
	getPowerState(callback) {
		this.writeLog("Getting Denon Device Power Status.", LOG_LEVEL_DEBUG);
		let powerCommand =  this.powerCommand;
		let offCommand =    this.offCommand;
	
		this.readRequest(powerCommand + '?', (err, result, socket) => {
			//if(err == null && result.substring(0, 2) != powerCommand) {  // We don't handle Zone 2.
			//	this.writeLog("Ignoring other zone power states. result = (" + result + ")");
			//	return;
			//}

			if(err == null) {
				socket.end();
				
				var powerState = this.findMessage(result, powerCommand);

				if(powerState == "") {
					// No power message was found.
				} else if(powerState == powerCommand + offCommand) {
					this.setCapabilityValue(CAPABILITY_ONOFF, false);					
				} else if(powerState == powerCommand + 'ON') {
					this.setCapabilityValue(CAPABILITY_ONOFF, true);
				}
			} else {
				if(socket != null)
					socket.end();
			}

			if(callback != null)
				return callback(err, this.getCapabilityValue(CAPABILITY_ONOFF));
		});
	}	
	
	getIsMuted(callback) {
		this.writeLog("Getting Denon Device Mute Status.", LOG_LEVEL_DEBUG);

		this.readRequest(CMD_VOLUME_MUTE + '?', (err, result, socket) => {
			if(err == null) {
				socket.end();

				result = this.findMessage(result, CMD_VOLUME_MUTE);

				var isMuted = result.includes('ON');
				var isNotMuted = result.includes('OFF');

				//this.writeLog("Mute state: " + result + ": " + isNotMuted + ", " + isMuted);
				// A fail safe if we receive something unexpected; one must be true.
				if(isNotMuted || isMuted)
					this.setCapabilityValue(CAPABILITY_VOLUME_MUTE, isMuted);
			} else {
				if(socket != null)
					socket.end();
			}

			if(callback != null)
				return callback(err, this.getCapabilityValue(CAPABILITY_VOLUME_MUTE));
		});
	}

	getVolume(callback) {
		this.writeLog("Getting Denon Device Volume Status.", LOG_LEVEL_DEBUG);

		this.readRequest(CMD_VOLUME_MASTER + '?', (err, result, socket) => {
			// NOTE: it is possible to get MV205\r\nMVMAX 695
			// This would break the promise flow(?) and will never close the socket or return it's promise.
			// So we need to account for either; two split messages; a single message; or a single message with two lines.
			// Is the second message dependant on if we close the socket fast enough after the first message?
			// Why does another device use \r\n and another separates it by time(?).

			// Attempt to recover from a dual line
			// NOTE: Requires more testing. There are two points where this happens; see flow card also.
			//if(err == null && (result.substring(0, 2) == 'MV' && result.includes('MAX') && result.includes("\r"))) {
			//	result = result.split("\r")[0];
			//	this.writeLog("getVolume received a dual line response. Splitting up the message...")
			//}

			//if(err == null && (result.substring(0, 2) != 'MV' || result.includes('MAX')))  // We don't handle Zone 2 and ignore MAX reached response.
			//	return;

			if(err == null) {
				socket.end();

				result = this.findMessage(result, CMD_VOLUME_MASTER); //result.split('\r')[0];

				if(!result.startsWith("MVMAX") && result != "") {
					var volumeAsString = result.substring(2);
					var volume = parseFloat(volumeAsString);

					if(volumeAsString.length == 2)	// Two digits is a whole number, three digits means .5.
						volume *= 10;

					//this.writeLog("Volume string is: " + volumeAsString + ", " + volume);
					var normalizedVolume = volume / 980;
					normalizedVolume = normalizedVolume < 0 ? 0 : normalizedVolume > 1 ? 1 : normalizedVolume;	// Be sure to cap it 0-1.

					this.setCapabilityValue(CAPABILITY_VOLUME_SET, normalizedVolume);		// Assumes all denon devices stop at 98db.
				}
			} else {
				if(socket != null)
					socket.end();
			}

			if (callback != null)
				return callback(err, this.getCapabilityValue(CAPABILITY_VOLUME_SET));
		});
	}

	commandLoop() {
		if(this.socket == null && this.commandList.length > 0) {
			let newCommand = this.commandList.shift();
			let mode = newCommand.mode;
			let command = newCommand.command;
			let callback = newCommand.callback;
			let commandLogInfo = "[" + this.commandID + ", " + command + "]";
			this.commandID = (this.commandID + 1) % 255;

			// Asserts.
			if(mode == READ_MODE && (callback == null || callback == undefined)) {
				this.writeLog("Cannot use READ_MODE and not provide a callback!");	// Ignore and continue on.
			} else {
				this.socket = new net.Socket();

				var cd = {
					port: TELNET_PORT,
					host: this.ip
				};

				// INACTIVITY TIMEOUT, so not just for connecting.
				this.socket.setTimeout(SOCKET_INACTIVITY_TIMEOUT, ()=>{
					if(this.socket != null)
						this.socket.destroy();

					this.writeLog(commandLogInfo +  " < Socket inactivity timeout triggered.");					

					if(callback != null && callback != undefined)
						callback(new Error("Socket inactivity timeout triggered."), false, null);						
				});
				
				// Connect failed timeout. TEST MORE !!!!!!!!!!!!!!!!!!!
				this.connectTimeout = setTimeout(()=> {
					this.writeLog(commandLogInfo +  " < Failed to connect. Socket timed out.");
					if(this.socket != null)
						this.socket.destroy();

					if(callback != null && callback != undefined)
						callback(new Error("Failed to connect to receiver. Socket timed out.\n\nIs your IP correct and is Network Control enabled on the receiver?"), false, null);						
				}, SOCKET_CONNECT_TIMEOUT);

				if(mode == WRITE_CLOSE_MODE) {
					this.writeLog(commandLogInfo +  " < Sending write-close command.", LOG_LEVEL_DEBUG);
					let client = this.socket.connect(cd, () => {
						clearTimeout(this.connectTimeout);
						client.write(this.StringToBytes(command), () => {
							client.end();

							if(callback != null && callback != undefined)
								callback(null, true, null);
						});
					});

					client.on('close', ()=> {
						setTimeout(function() {
							this.socket = null; 
							this.writeLog(commandLogInfo +  " < Socket closed", LOG_LEVEL_DEBUG);
						}.bind(this), TELNET_RECONNECT_TIME_OUT);
					});

					client.on('error', (err) => {
						this.writeLog(err);
						client.end();

						if(callback != null && callback != undefined)
							callback(err, false, null);
					});
				} else if(newCommand.mode == READ_MODE) {
					this.writeLog(commandLogInfo +  " < Sending read command.", LOG_LEVEL_DEBUG);

					let client = this.socket.connect(cd, () => {
						clearTimeout(this.connectTimeout);
						client.write(this.StringToBytes(command));
					});

					let msgData = "";

					client.on('data', (data)=> {
						var status = data.toString();
						status = status.substring(0, status.length-1); // We already remove CR here for convience.

						var err = null;

						if(status.startsWith("SSINFAI")) {
							this.writeLog(commandLogInfo +  " < Denon returned error message: " + status);
							err = new Error(commandLogInfo +  " < Denon returned error message: " + status);

							// TODO: The socket is not automatically closed on this error.
						}


						msgData = msgData + data.toString();
						if(this.readRequestProcessTimeout != null) {
							clearTimeout(this.readRequestProcessTimeout);
						}

						this.readRequestProcessTimeout = setTimeout(() => {
							this.writeLog(commandLogInfo +  " < Returned result: " + msgData.replace('\r', '\\r'), LOG_LEVEL_DEBUG);
							callback(err, msgData, client);
						}, READ_REQUEST_PROCESS_DELAY);
					});

					client.on('close', ()=> {
						setTimeout(function() {
							this.socket = null;
							this.writeLog(commandLogInfo +  " < Socket closed.", LOG_LEVEL_DEBUG);
						}.bind(this), TELNET_RECONNECT_TIME_OUT);
					});

					client.on('error', (err) => {
						this.writeLog(commandLogInfo +  " < Error: " + err);
						callback(err, null, client); 
					});
				}
			}
		} 
		
		if(this.socket != null || this.commandList.length > 0) {
			this.commandTimeout = setTimeout(this.commandLoop.bind(this), LOOP_DELAY);
			this.looping = true;
		} else {
			// Nothing to do
			this.writeLog("Commandbuffer empty. Stopping loop.", LOG_LEVEL_DEBUG);
			this.commandTimeout = null;
			this.looping = false;
		}
	}

	// callback(err, result, socket)
	aSyncRequest(mode, command, callback) {
		var request = {};
		request.command = command;
		request.callback = callback;
		request.mode = mode;
	
		this.commandList.push(request);

		if(!this.looping) {
			this.commandLoop();
		}
	}
	
	// callback(err, result, socket) where: result is boolean (success) and socket will automatically close.
	writeCloseRequest(command, callback) {
		this.aSyncRequest(WRITE_CLOSE_MODE, command, callback);
	}

	// Simple promise wrapper for handling write and forget commands.
	// NOTE: It only resolves to TRUE, which is the result when it's a write-close, and rejects to err.
	writeCloseRequestPromise(command) {
		let device = this;

		let promise = new Promise(
			function (resolve, reject) {
				device.writeCloseRequest(command, (err, result, socket) => {
					if(err == null)
						resolve(result);
					else
						reject(err);
				});
			}
		);
	
		return promise;
	}
	
	// callback(err, result, socket) where: result is string (data) and socket remains open.
	readRequest(command, callback) {
		this.aSyncRequest(READ_MODE, command, callback);
	}

	getStoredSetting(settingID, defaultValue) {
		let settings = this.getSettings();
		return this.getSetting(settings, settingID, defaultValue);	
	}

	getSetting(settings, settingID, defaultValue) {
		if( settings == undefined || settings[settingID] == undefined)
			return defaultValue;
		else
			return settings[settingID];
	}
}

module.exports = DenonDevice;