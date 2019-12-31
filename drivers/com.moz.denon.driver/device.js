'use strict';

const net = require('net');
const Homey = require('homey');

const WRITE_CLOSE_MODE = 0;             // We write a command and immediately close the socket afterwards.
const READ_MODE = 1;                    // We write a command and return the result, we keep the connection open. Must be closed manually.
const TELNET_PORT = 23;
const TELNET_RECONNECT_TIME_OUT = 100;  // Time before we consider a socket truly closed. Denon AVR doesn't accept a new connection while the old is open for some time.
const LOOP_DELAY = 50;                  // The time in between command buffer handling.
const LOOP_DELAY_LIMP_MODE = 200		// When receiving warnings we switch to this delay time.
const SOCKET_TIMEOUT = 1000				// Time after which we consider the socket unconnectable.

const DEFAULT_IP = "192.168.0.1";
const SETTING_KEY_IP = "com.moz.denon.settings.ip";
const SETTING_KEY_POWER_COMMAND = "com.moz.denon.settings.powercommand";
const CAPABILITY_VOLUME_SET = "volume_set";
const CAPABILITY_VOLUME_UP = "volume_up";
const CAPABILITY_VOLUME_DOWN = "volume_down";
const CAPABILITY_VOLUME_MUTE = "volume_mute";
const CMD_VOLUME_MASTER_SET = "MV";
const CMD_VOLUME_MASTER_UP = "MVUP";
const CMD_VOLUME_MASTER_DOWN = "MVDOWN";
const CMD_VOLUME_MUTE = "MU"

class DenonDevice extends Homey.Device {
    onInit() {
		if (!this.hasCapability(CAPABILITY_VOLUME_SET)) {
			this.addCapability(CAPABILITY_VOLUME_SET);
		}

		if (!this.hasCapability(CAPABILITY_VOLUME_UP)) {
			this.addCapability(CAPABILITY_VOLUME_UP);
		}

		if (!this.hasCapability(CAPABILITY_VOLUME_DOWN)) {
			this.addCapability(CAPABILITY_VOLUME_DOWN);
		}

		if (!this.hasCapability(CAPABILITY_VOLUME_MUTE)) {
			this.addCapability(CAPABILITY_VOLUME_MUTE);
		}

		this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this))
		this.registerCapabilityListener(CAPABILITY_VOLUME_SET, this.onCapabilityVolumeSet.bind(this))
		this.registerCapabilityListener(CAPABILITY_VOLUME_UP, this.onCapabilityVolumeUp.bind(this))
		this.registerCapabilityListener(CAPABILITY_VOLUME_DOWN, this.onCapabilityVolumeDown.bind(this))
		this.registerCapabilityListener(CAPABILITY_VOLUME_MUTE, this.onCapabilityVolumeMute.bind(this))
		
		this.ip = this.getSetting(SETTING_KEY_IP, DEFAULT_IP);
		this.powerCommand = this.getSetting(SETTING_KEY_POWER_COMMAND, "PW");
		this.offCommand = this.powerCommand == "PW" ? "STANDBY" : "OFF";

		this.looping = true;
		this.commandList = new Array();
		this.socket = null;
		this.log("Denon device initialized with IP:", this.ip);
		this.getPowerState();
		
		if(this.hasCapability(CAPABILITY_VOLUME_MUTE)) {
			this.getIsMuted();
		}
		
		if(this.hasCapability(CAPABILITY_VOLUME_SET)) {
			this.getVolume();
		}

		this.commandLoop();
	}

    onAdded() {
        this.log("Denon device added.");
    }

    onDeleted() {
        this.log("Denon device deleted.");
    }
	
	onSettings( oldSettingsObj, newSettingsObj, changedKeysArr, callback ) {
		this.log("Settings updated.");
		callback( null, true );

		this.ip = this.getSetting(SETTING_KEY_IP, DEFAULT_IP);
		this.powerCommand = this.getSetting(SETTING_KEY_POWER_COMMAND, "PW");
		this.offCommand = this.powerCommand == "PW" ? "STANDBY" : "OFF";
	}

    onCapabilityOnoff( value, opts, callback ) {
		this.log("Setting Denon device power to " + value);
		let powerCommand =  this.powerCommand;
		let offCommand =    this.offCommand;
		let device = this;

		let promise = new Promise(
			function (resolve, reject) {
				device.writeCloseRequest(value ? powerCommand+'ON' : powerCommand+offCommand, (err, result, socket) => {
					if(err == null) {
						device.setCapabilityValue("onoff", value);
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
		
		this.log("Setting Denon device volume to " + value);
		let device = this;
		let volume = parseInt(parseFloat(value) * 100);
		let volumeStr = volume.toString();

		// If value is smaller than 10, we need to add a zero infront otherwise it's rejected by the protocol
		if(volume < 10) {
			volumeStr = '0' + volumeStr;
		}

		let promise = new Promise(
			function (resolve, reject) {
				device.writeCloseRequest(CMD_VOLUME_MASTER_SET + volumeStr, (err, result, socket) => {
					if(err == null) {
						device.setCapabilityValue(CAPABILITY_VOLUME_SET, value);
						resolve(value);
					} else {
						reject(err);
					}
				});		
			}
		);

		return promise;
	}

	onCapabilityVolumeUp( value, opts, callback) {
		this.log("Volume up");
		let device = this;
		
		let promise = new Promise(
			function (resolve, reject) {
				device.writeCloseRequest(CMD_VOLUME_MASTER_UP, (err, result, socket) => {
					if(err == null) {
						device.getVolume();
						resolve(value);
					} else {
						reject(err);
					}
				});		
			}
		);

		return promise;
	}

	onCapabilityVolumeDown( value, opts, callback) {
		this.log("Volume down");
		let device = this;

		let promise = new Promise(
			function (resolve, reject) {
				device.writeCloseRequest(CMD_VOLUME_MASTER_DOWN, (err, result, socket) => {
					if(err == null) {
						device.getVolume();
						resolve(value);
					} else {
						reject(err);
					}
				});		
			}
		);

		return promise;
	}

	onCapabilityVolumeMute( value, opts, callback) {
		this.log("Mute");
		let device = this;

		let promise = new Promise(
			function (resolve, reject) {
				try {
					device.getIsMuted();
				} catch (err) {
					reject(err);
				}
				
				let isMuted = device.getCapabilityValue(CAPABILITY_VOLUME_MUTE);
				let muteCmd = isMuted ? CMD_VOLUME_MUTE + "OFF" : CMD_VOLUME_MUTE + "ON";

				device.writeCloseRequest(muteCmd, (errWrite, resultWrite, socket) => {
					if(errWrite == null) {
						device.getIsMuted();
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
		this.log("Getting Denon Device Power Status.");
		let powerCommand =  this.powerCommand;
		let offCommand =    this.offCommand;
	
		this.readRequest(powerCommand + '?', (err, result, socket) => {
			if(err == null && result.substring(0, 2) != powerCommand) {  // We don't handle Zone 2.
				this.log("Ignoring other zone power states. result = (" + result + ")");
				return;
			}

			if(err == null) {
				socket.end();
				//var oldDeviceState = this.getCapabilityValue("onoff");
				this.setCapabilityValue("onoff", !(result == powerCommand + offCommand));
			}

			if(callback != null)
				return callback(err, this.getCapabilityValue("onoff"));
		});
	}

	getIsMuted(callback) {
		this.log("Getting Denone Device mute status.");
		let device = this;

		device.readRequest(CMD_VOLUME_MUTE + '?', (errRead, resultRead, socket) => {
			let isMuted = false;
			if (errRead == null) {
				socket.end();
				try{
					isMuted = resultRead.toString().includes('OFF')? false : true;
				} catch (err) {
					this.log(err);
				}
				

				this.setCapabilityValue(CAPABILITY_VOLUME_MUTE, isMuted);
			} 
			
			if (callback != null) {
				return callback(errRead, this.getCapabilityValue(CAPABILITY_VOLUME_MUTE));
			}
		});
	}

	getVolume(callback) {
		let device = this;

		device.readRequest(CMD_VOLUME_MASTER_SET + '?', (errRead, resultRead, socket) => {
			if (errRead == null) {
				socket.end();
				try {
					// result is of format: MV575,MVMAX 98
					// result can be of format: MV57,MVMAX 98
					let masterVolume = resultRead.toString().split(',')[0].substring(2, 4);
					this.setCapabilityValue(CAPABILITY_VOLUME_SET, parseFloat(masterVolume)/100.0);
				} catch (err) {
					this.log(err);
				}
			} 
			
			if (callback != null) {
				return callback(errRead, this.getCapabilityValue(CAPABILITY_VOLUME_SET));
			}
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
				this.log("Cannot use READ_MODE and not provide a callback!");	// Ignore and continue on.
			} else {
				this.socket = new net.Socket();

				var cd = {
					port: TELNET_PORT,
					host: this.ip
				};

				this.socket.setTimeout(SOCKET_TIMEOUT, ()=>{
					this.log("Failed to connect. Socket timed out.");
					this.socket.destroy();

					if(callback != null && callback != undefined)
						callback(new Error("Failed to connect to receiver. Socket timed out.\n\nIs your IP correct and is Network Control enabled on the receiver?"), false, null);						
				});

				if(mode == WRITE_CLOSE_MODE) {
					this.log("Sending write-close command " + command);
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
							this.log("Socket closed");
						}.bind(this), TELNET_RECONNECT_TIME_OUT);
					});

					client.on('error', (err) => {
						this.log(err);
						client.end();

						if(callback != null && callback != undefined)
							callback(err, false, null);
					});
				} else if(newCommand.mode == READ_MODE) {
					this.log("Sending read command " + command);

					let client = this.socket.connect(cd, () => {
						client.write(StringToBytes(command));
					});

					client.on('data', (data)=> {
						var status = data.toString();
						status = status.substring(0, status.length-1); // We already remove CR here for convience.

						var err = null;

						if(status.startsWith("SSINFAI")) {
							this.log("Denon returned error message: " + status);
							err = new Error("Denon returned error message: " + status);
						}

						callback(err, status, client);
					});

					client.on('close', ()=> {
						setTimeout(function() {
							this.socket = null;
							this.log("Socket closed");
						}.bind(this), TELNET_RECONNECT_TIME_OUT);
					});

					client.on('error', (err) => {
						this.log(err);
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
			this.log("Commandbuffer empty. Stopping loop.");
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