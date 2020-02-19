'use strict';

const net = require('net');
const Homey = require('homey');

const WRITE_CLOSE_MODE = 0;             // We write a command and immediately close the socket afterwards.
const READ_MODE = 1;                    // We write a command and return the result, we keep the connection open. Must be closed manually.
const TELNET_PORT = 23;
const TELNET_RECONNECT_TIME_OUT = 100;  // Time before we consider a socket truly closed. Denon AVR doesn't accept a new connection while the old is open for some time.
const LOOP_DELAY = 50;                  // The time in between command buffer handling.
const LOOP_DELAY_LIMP_MODE = 200;		// When receiving warnings we switch to this delay time.
const SOCKET_TIMEOUT = 1000;			// Time after which we consider the socket unconnectable.

const STATUS_COMMAND_COUNT = 3;			// Number of commands before a complete update has been received.
const STATUS_MAX_RETRY_COUNT = 5;		// Times before we consider a denon device unreachable and we stop trying to update.
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
		
		this.ip = this.getSetting(SETTING_KEY_IP, DEFAULT_IP);
		this.powerCommand = this.getSetting(SETTING_KEY_POWER_COMMAND, "PW");
		this.offCommand = this.powerCommand == "PW" ? "STANDBY" : "OFF";

		this.statusRetryCount = STATUS_MAX_RETRY_COUNT;
		this.statusCommandsRemain = 0;
		this.statusCommandsFailed = 0;

		this.looping = true;
		this.commandList = new Array();
		this.socket = null;
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

		this.statusCommandsRemain = STATUS_COMMAND_COUNT;
		this.statusCommandsFailed = 0;

		this.getPowerState((err, result)=> {
			if(err != null)
				this.statusCommandsFailed++;

			this.statusCommandsRemain--;

			if(this.statusCommandsRemain == 0)
				setTimeout(this.updateDeviceStatus.bind(this), this.statusRetryCount > 0 ? STATUS_DELAY : STATUS_DELAY_UNREACHABLE);
		});	
		this.getIsMuted((err, result)=> {
			if(err != null)
				this.statusCommandsFailed++;

			this.statusCommandsRemain--;

			if(this.statusCommandsRemain == 0)
				setTimeout(this.updateDeviceStatus.bind(this), this.statusRetryCount > 0 ? STATUS_DELAY : STATUS_DELAY_UNREACHABLE);
		});
		this.getVolume((err, result)=> {
			if(err != null)
				this.statusCommandsFailed++;

			this.statusCommandsRemain--;

			if(this.statusCommandsRemain == 0)
				setTimeout(this.updateDeviceStatus.bind(this), this.statusRetryCount > 0 ? STATUS_DELAY : STATUS_DELAY_UNREACHABLE);
		});
	}

    onAdded() {
        this.writeLog("Denon device added.");
    }

    onDeleted() {
        this.writeLog("Denon device deleted.");
    }
	
	onSettings( oldSettingsObj, newSettingsObj, changedKeysArr, callback ) {
		this.writeLog("Settings updated.");
		callback( null, true );

		this.ip = this.getSetting(SETTING_KEY_IP, DEFAULT_IP);
		this.powerCommand = this.getSetting(SETTING_KEY_POWER_COMMAND, "PW");
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
		let device = this;

		let promise = new Promise(
			function (resolve, reject) {
				var isMuted = device.getCapabilityValue(CAPABILITY_VOLUME_MUTE);
				var muteCmd = isMuted ? CMD_VOLUME_MUTE + "OFF" : CMD_VOLUME_MUTE + "ON";

				device.writeCloseRequest(muteCmd, (err, result, socket) => {
					if(err == null) {
						//device.getIsMuted();	// NOTE: We do not have to request an update from the amplifier here as any corrections will be sent during updateDeviceStatus().
						resolve(value);
					} else {
						reject(errWrite);
					}
				});
			}
		);

		return promise;
	}

	// callback(err, result)
	getPowerState(callback) {
		this.writeLog("Getting Denon Device Power Status.", LOG_LEVEL_DEBUG);
		let powerCommand =  this.powerCommand;
		let offCommand =    this.offCommand;
	
		this.readRequest(powerCommand + '?', (err, result, socket) => {
			if(err == null && result.substring(0, 2) != powerCommand) {  // We don't handle Zone 2.
				this.writeLog("Ignoring other zone power states. result = (" + result + ")");
				return;
			}

			if(err == null) {
				socket.end();
				//var oldDeviceState = this.getCapabilityValue(CAPABILITY_ONOFF);
				this.setCapabilityValue(CAPABILITY_ONOFF, !(result == powerCommand + offCommand));
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
			if(err == null && (result.substring(0, 2) != 'MV' || result.includes('MAX')))  // We don't handle Zone 2 and ignore MAX reached response.
				return;

			if(err == null) {
				socket.end();

				var volumeAsString = result.substring(2);
				var volume = parseFloat(volumeAsString);

				if(volumeAsString.length == 2)	// Two digits is a whole number, three digits means .5.
					volume *= 10;

				//this.writeLog("Volume string is: " + volumeAsString + ", " + volume);
				this.setCapabilityValue(CAPABILITY_VOLUME_SET, volume / 980);		// Assumes all denon devices stop at 98db.
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

			// Asserts.
			if(mode == READ_MODE && (callback == null || callback == undefined)) {
				this.writeLog("Cannot use READ_MODE and not provide a callback!");	// Ignore and continue on.
			} else {
				this.socket = new net.Socket();

				var cd = {
					port: TELNET_PORT,
					host: this.ip
				};

				this.socket.setTimeout(SOCKET_TIMEOUT, ()=>{
					this.writeLog(command + " < Failed to connect. Socket timed out.");
					this.socket.destroy();

					if(callback != null && callback != undefined)
						callback(new Error("Failed to connect to receiver. Socket timed out.\n\nIs your IP correct and is Network Control enabled on the receiver?"), false, null);						
				});

				if(mode == WRITE_CLOSE_MODE) {
					this.writeLog(command + " < Sending write-close command.", LOG_LEVEL_DEBUG);
					let client = this.socket.connect(cd, () => {
						client.write(StringToBytes(command), () => {
							client.end();

							if(callback != null && callback != undefined)
								callback(null, true, null);
						});
					});

					client.on('close', ()=> {
						setTimeout(function() {
							this.socket = null; 
							this.writeLog(command + " < Socket closed", LOG_LEVEL_DEBUG);
						}.bind(this), TELNET_RECONNECT_TIME_OUT);
					});

					client.on('error', (err) => {
						this.writeLog(err);
						client.end();

						if(callback != null && callback != undefined)
							callback(err, false, null);
					});
				} else if(newCommand.mode == READ_MODE) {
					this.writeLog(command + " < Sending read command.", LOG_LEVEL_DEBUG);

					let client = this.socket.connect(cd, () => {
						client.write(StringToBytes(command));
					});

					client.on('data', (data)=> {
						var status = data.toString();
						status = status.substring(0, status.length-1); // We already remove CR here for convience.

						var err = null;

						if(status.startsWith("SSINFAI")) {
							this.writeLog(command + " < Denon returned error message: " + status);
							err = new Error(command + " < Denon returned error message: " + status);

							// TODO: The socket is not automatically closed on this error.
						}

						this.writeLog(command + " < Returned result: " + status, LOG_LEVEL_DEBUG);

						callback(err, status, client);
					});

					client.on('close', ()=> {
						setTimeout(function() {
							this.socket = null;
							this.writeLog(command + " < Socket closed.", LOG_LEVEL_DEBUG);
						}.bind(this), TELNET_RECONNECT_TIME_OUT);
					});

					client.on('error', (err) => {
						this.writeLog(command + " < Error: " + err);
						callback(err, null, client); 
					});
				}
			}
		} 
		
		if(this.socket != null || this.commandList.length > 0) {
			setTimeout(this.commandLoop.bind(this), LOOP_DELAY);
			this.looping = true;
		} else {
			// Nothing to do
			this.writeLog("Commandbuffer empty. Stopping loop.", LOG_LEVEL_DEBUG);
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

	getSetting(settingID, defaultValue) {
		let settings = this.getSettings();

		if( settings == undefined || settings[settingID] == undefined)
			return defaultValue;
		else
			return settings[settingID];
	}
}

/////////////////          Helpers	            //////////////////
function StringToBytes(str) {
    var array = new Buffer(str.length + 1);

    for(var i = 0; i < str.length; i++) {
        array[i] = str.charCodeAt(i);
    }

    array[str.length] = 13; // CR

    return array;
}

/////////////////          Flow cards            //////////////////
let powerOnAction = new Homey.FlowCardAction('com.moz.denon.actions.poweron');
powerOnAction.register().registerRunListener((args, state) => {
	return args.device.onCapabilityOnoff(true, null, null);
});

let powerOffAction = new Homey.FlowCardAction('com.moz.denon.actions.poweroff');
powerOffAction.register().registerRunListener((args, state) => {
	return args.device.onCapabilityOnoff(false, null, null);
});

let powerToggleAction = new Homey.FlowCardAction('com.moz.denon.actions.powertoggle');
powerToggleAction.register().registerRunListener((args, state) => {
	let promise = new Promise(
		function (resolve, reject) {
			args.device.getPowerState((err, result) => {
				if(err == null)
					resolve(result);
				else
					reject(err);
			});
		}
	).then(function(result) {
		return args.device.onCapabilityOnoff(!result);
	});

	return promise;
});

let muteAction = new Homey.FlowCardAction('com.moz.denon.actions.mute');
muteAction.register().registerRunListener((args, state) => {
	return args.device.writeCloseRequestPromise('MUON');
});

let unmuteAction = new Homey.FlowCardAction('com.moz.denon.actions.unmute');
unmuteAction.register().registerRunListener((args, state) => {
	return args.device.writeCloseRequestPromise('MUOFF');
});

let toggleMuteAction = new Homey.FlowCardAction('com.moz.denon.actions.mutetoggle');
toggleMuteAction.register().registerRunListener((args, state) => {
	let promise = new Promise(
		function (resolve, reject) {
			args.device.readRequest('MU?', (err, result, socket) => {
				if(err == null) {
					var mute = ((result == 'MUON') ? 'MUOFF' : 'MUON');
					
					socket.write(StringToBytes(mute), () => {
						socket.end();
						resolve(true);
					});
				} else {
					if(socket != null)
						socket.end();
					reject(err);
				}
			});
		}
	);
	return promise;
});

let sourceAction = new Homey.FlowCardAction('com.moz.denon.actions.source');
sourceAction.register().registerRunListener((args, state) => {
	return args.device.writeCloseRequestPromise('SI' + args.channel);
});

let volumeAction = new Homey.FlowCardAction('com.moz.denon.actions.volume');
volumeAction.register().registerRunListener((args, state) => {
	let promise = new Promise(
		function (resolve, reject) {
			args.device.readRequest('MV?', (err, result, socket) => {
				if(err == null && (result.substring(0, 2) != 'MV' || result.includes('MAX')))  // We don't handle Zone 2 and ignore MAX reached response.
					return;

				if(err == null) {
					var volumeAsString = result.substring(2);
					var volume = parseInt(volumeAsString);
		
					if(volumeAsString.length == 2)          // We always want to  work in .5db mode.
						volume *= 10;
		
					var add = parseFloat(args.db) * 10;
					
					var newVolume = (volume+add);
					if(newVolume < 0) newVolume = 0;
		
					var paddedResult = newVolume.toString();
					while(paddedResult.length < 3)         // Again always in .5db mode. AVR doesn't care if the last ch is 0.
						paddedResult = '0' + paddedResult;
		
					args.device.log("Adjusting volume from " + volumeAsString + " with length of " + volumeAsString.length + " parsed as (" + volume + ") to (" + newVolume + ") sent as (" + paddedResult + ")");
		
					socket.write(StringToBytes('MV'+paddedResult), () => {
						socket.end();
						resolve(true);
					});            
				} else {
					if(socket != null)
						socket.end();
					
					reject(err);
				}
			});
		}
	);
	return promise;
});

let volumeSetAction = new Homey.FlowCardAction('com.moz.denon.actions.volumeset');
volumeSetAction.register().registerRunListener((args, state) => {
	var volume = parseFloat(args.db) * 10;
	return args.device.writeCloseRequestPromise('MV' + volume);
});

let customCommandAction = new Homey.FlowCardAction('com.moz.denon.actions.customcommand');
customCommandAction.register().registerRunListener((args, state) => {
	args.device.log("Sending custom command: " + args.command);
	return args.device.writeCloseRequestPromise(args.command);
});

let powerCondition = new Homey.FlowCardCondition('com.moz.denon.conditions.power');
powerCondition.register().registerRunListener(( args, state ) => {
	let promise = new Promise(
		function (resolve, reject) {
			args.device.getPowerState((err, result) => {
				args.device.log("Power state: " + err + ", " + result);

				if(err == null)
					resolve(result);
				else
					reject(err);
			});
		}
	);

	return promise;
});

let channelCondition = new Homey.FlowCardCondition('com.moz.denon.conditions.channel');
channelCondition.register().registerRunListener(( args, state ) => {
	let promise = new Promise(
		function (resolve, reject) {
			args.device.readRequest('SI?', (err, result, socket) => {
				if(err == null && result.substring(0, 2) != 'SI')  // We ignore any SV, video mode data that comes after the original reply.
					return;

				if(err == null) {
					socket.end();
		
					args.device.log("Current Source is: " + result);
					resolve(result == 'SI' + args.channel);
				} else {
					if(socket != null)
						socket.end();
					reject(err);
				}
			});
		}
	);

	return promise;
});

module.exports = DenonDevice;