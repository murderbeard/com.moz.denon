"use strict";

/// TODO:
// - Zone2
// - Persistant GUID's? We don't want people to lose their flows because an ID is not matching.
// --> Keeping the ID's the same doesn't seem to help :(.
// - Channel UP / DOWN.

var net = require('net');

var devices = {};       // Denon AVR Device List. 
var commands = {};      // A buffer of requests to make to a specific Denon AVR by IP.

const WRITE_CLOSE_MODE = 0;             // We write a command and immediately close the socket afterwards.
const READ_MODE = 1;                    // We write a command and return the result, we keep the connection open. Must be closed manually.
const TELNET_RECONNECT_TIME_OUT = 100;  // Time before we consider a socket truly closed. Denon AVR doesn't accept a new connection while the old is open for some time.
const LOOP_DELAY = 10;                  // The time in between command buffer handling.

const DEFAULT_IP = "192.168.0.1";
const SETTING_KEY_IP = "com.moz.denon.settings.ip";
const SETTING_KEY_POWER_COMMAND = "com.moz.denon.settings.powercommand";


//////////////////          Network Control            //////////////////
function StringToBytes(str) {
    var array = new Buffer(str.length + 1);

    for(var i = 0; i < str.length; i++) {
        array[i] = str.charCodeAt(i);
    }

    array[str.length] = 13; // CR

    return array;
}

function Loop() {
    for(var ip in commands) {
        if(!commands.hasOwnProperty(ip)) continue; // Don't do prototype properties...

        if(commands[ip].socket == null && commands[ip].list.length > 0) {
            var nc = commands[ip].list.shift();

            // Some code duplication here.
            if(nc.mode == WRITE_CLOSE_MODE) {
                // Create this function object thing to not mess up things because we're inside a loop.
                var nf = function(ipaddress, command, callback) {
                    Homey.log("Sending write-close command " + command);
                    
                    commands[ipaddress].socket = new net.Socket();
                    var cd = {
                        port: 23,
                        host: ipaddress
                    };

                    var client = commands[ipaddress].socket.connect(cd, () => {
                        client.write(StringToBytes(command), () => {
                            client.end();

                            if(callback != null && callback != undefined)
                                callback(true);
                        });
                    });

                    client.on('close', ()=> {
                        Homey.log("Socket closed");

                        setTimeout(function() {
                            commands[ipaddress].socket = null; 
                        }, TELNET_RECONNECT_TIME_OUT);
                    });

                    client.on('error', (err) => {
                        Homey.log(err);
                        client.end();

                        if(callback != null && callback != undefined)
                            callback(false);
                    });
                };

                nf(ip, nc.command, nc.callback);
            } else if(nc.mode == READ_MODE) {
                var nf = function(ipaddress, command, callback) {
                    Homey.log("Sending read command " + command);
                    
                    commands[ipaddress].socket = new net.Socket();
                    var cd = {
                        port: 23,
                        host: ipaddress
                    };

                    var client = commands[ipaddress].socket.connect(cd, () => {
                        client.write(StringToBytes(command));
                    });

                    client.on('data', (data)=> {
                        var status = data.toString();
                        status = status.substring(0, status.length-1); // We already remove CR here for convience.

                        callback(status, client);
                    });

                    client.on('close', ()=> {
                        Homey.log("Socket closed");

                        setTimeout(function() {
                            commands[ipaddress].socket = null;
                        }, TELNET_RECONNECT_TIME_OUT);
                    });

                    client.on('error', (err) => {
                        Homey.log(err);
                        callback(null, client);        
                    });
                };

                nf(ip, nc.command, nc.callback);
            }
        } else {
            // We're busy. Waiting on completion or no commands to process.
        }
    }
    
    setTimeout(Loop, LOOP_DELAY);
}

function ASyncRequest(mode, ip, command, callback) {
    var request = {};
    request.command = command;
    request.callback = callback;
    request.mode = mode;

    // If no such command buffer exists.
    if(commands[ip] == undefined || commands[ip] == null) {
        commands[ip] = {};
        commands[ip].socket = null;
        commands[ip].list = new Array();
    }

    commands[ip].list.push(request);
}

function WriteCloseRequest(ip, command, callback) {
    ASyncRequest(WRITE_CLOSE_MODE, ip, command, callback);
}

function ReadRequest(ip, command, callback) {
    ASyncRequest(READ_MODE, ip, command, callback);
}


//////////////////          Flow cards            //////////////////
Homey.manager('flow').on('action.com.moz.denon.actions.poweron', function(callback, args) {
    module.exports.capabilities.onoff.set(args.device, true, (error, result) => {});
	callback(null, true);
});

Homey.manager('flow').on('action.com.moz.denon.actions.poweroff', function(callback, args) {
    module.exports.capabilities.onoff.set(args.device, false, (error, result) => {});
	callback(null, true);
});

Homey.manager('flow').on('action.com.moz.denon.actions.powertoggle', function(callback, args) {
    module.exports.capabilities.onoff.get(args.device, (error, result) => {
        module.exports.capabilities.onoff.set(args.device, !result, (error, result) => {});
    });
	callback(null, true);
});

Homey.manager('flow').on('action.com.moz.denon.actions.mute', function(callback, args) {
    Homey.log("Muting");
    
    WriteCloseRequest(GetSettingByDeviceData(args.device, SETTING_KEY_IP, DEFAULT_IP), 'MUON');

	callback(null, true);
});

Homey.manager('flow').on('action.com.moz.denon.actions.unmute', function(callback, args) {
    Homey.log("Unmuting");
    WriteCloseRequest(GetSettingByDeviceData(args.device, SETTING_KEY_IP, DEFAULT_IP), 'MUOFF');

	callback(null, true);
});

Homey.manager('flow').on('action.com.moz.denon.actions.mutetoggle', function(callback, args) {
    Homey.log("Toggling Mute");

    ReadRequest(GetSettingByDeviceData(args.device, SETTING_KEY_IP, DEFAULT_IP), 'MU?', (result, socket) => {
        if(result != null) {
            var mute = ((result == 'MUON') ? 'MUOFF' : 'MUON');

            socket.write(StringToBytes(mute), () => {
                socket.end();
            });     
        } else {
            socket.end();
        }
    });

	callback(null, true);
});

Homey.manager('flow').on('action.com.moz.denon.actions.source', function(callback, args) {
    Homey.log("Setting Source");

    WriteCloseRequest(GetSettingByDeviceData(args.device, SETTING_KEY_IP, DEFAULT_IP), 'SI' + args.channel);

	callback(null, true);
});

Homey.manager('flow').on('action.com.moz.denon.actions.volume', function(callback, args) {
    Homey.log("Change Volume");

    ReadRequest(GetSettingByDeviceData(args.device, SETTING_KEY_IP, DEFAULT_IP), 'MV?', (result, socket) => {
        if(result != null && (result.substring(0, 2) != 'MV' || result.includes('MAX')))  // We don't handle Zone 2 and ignore MAX reached response.
            return;

        if(result != null) {
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

            Homey.log("Adjusting volume from " + volumeAsString + " with length of " + volumeAsString.length + " parsed as (" + volume + ") to (" + newVolume + ") sent as (" + paddedResult + ")");

            socket.write(StringToBytes('MV'+paddedResult), () => {
                socket.end();
            });            
        } else {
            socket.end();
        }
    });

	callback(null, true);
});

Homey.manager('flow').on('action.com.moz.denon.actions.volumeset', function(callback, args) {
    Homey.log("Setting Volume");

    var volume = parseFloat(args.db) * 10;
    WriteCloseRequest(GetSettingByDeviceData(args.device, SETTING_KEY_IP, DEFAULT_IP), 'MV' + volume);

	callback(null, true);
});

Homey.manager('flow').on('condition.com.moz.denon.conditions.power', function( callback, args ){
    Homey.log("Getting power state for condition.");

    module.exports.capabilities.onoff.get(args.device, (object, state) => {
        callback(null, state);
    });
});

Homey.manager('flow').on('condition.com.moz.denon.conditions.channel', function( callback, args ){
    Homey.log("Getting channel for condition.");

    ReadRequest(GetSettingByDeviceData(args.device, SETTING_KEY_IP, DEFAULT_IP), 'SI?', (result, socket) => {
        if(result != null && result.substring(0, 2) != 'SI')  // We ignore any SV, video mode data that comes second.
            return;

        if(result != null) {
            socket.end();

            Homey.log("Current Source is: " + result);
            callback(null, result == 'SI' + args.channel);
        } else {
            socket.end();
            callback(null, false);
        }
    });
});


//////////////////          Initialization            //////////////////
function InitDevice( device_data ) {
    devices[ device_data.id ] = {};
    devices[ device_data.id ].state = { onoff: true };
    devices[ device_data.id ].data = device_data;

    Homey.log("Initializing Device, getting settings...");
    module.exports.getSettings(device_data, function(err, settings) {                                   // NOTE: this is an async operation so the fact the device exists doesn't mean its settings do.
        Homey.log("Requested settings for " + device_data.id + ", result: " + err + ' ' + settings);
        Homey.log(settings);
        devices[device_data.id].settings = settings;

        // TODO: Should we manually try to get the power state here?
    });
}

module.exports.init = function( devices_data, callback ) {      // the 'init' method is called when the driver is loaded for the first time
    Homey.log("Initializing Denon Device Driver");

    devices_data.forEach(function(device_data) {
        InitDevice( device_data );
    })

    Loop(); // Start the command buffer handling loop.
    callback();
}


//////////////////          Device Handling            //////////////////
module.exports.added = function( device_data, callback ) {      // the 'added' method is called is when pairing is done and a device has been added
    Homey.log("New Denon AVR added");
    Homey.log(device_data);

    InitDevice( device_data );

    callback( null, true ); // Deferring this callback doesn't stop the capabilities.on_off check.
}

module.exports.deleted = function( device_data, callback ) {    // the 'delete' method is called when a device has been deleted by a user
    delete devices[ device_data.id ];
    callback( null, true );
}

module.exports.renamed = function(device_data, new_name) {      // update the devices array we keep
	devices[device_data.id].data.name = new_name;
};

module.exports.pair = function( socket ) {                      // the 'pair' method is called when a user starts pairing
    socket.on('list_devices', function( data, callback ){
        Homey.log("Device Pairing method called.");
        Homey.log(data);
        var device_data = {
            name: "New Denon Amplifier",
            data: {
                id: data.id
            }
        }

        callback( null, [ device_data ] );
    });
}


//////////////////          Settings            //////////////////
module.exports.settings = function(device_data, newSettingsObj, oldSettingsObj, changedKeysArr, callback) {
    Homey.log("Getting new settings for " + device_data.id + ": " + newSettingsObj);
    devices[device_data.id].settings = newSettingsObj;  // We just slave-ishly assume anything is okay for an IP address. And assuming that this device exists in our list.

    callback(null, true);
}

function GetSettingByDeviceID(deviceID, settingID, defaultValue) {
    var device = devices[deviceID];

    if(device == undefined || device == null)
        return defaultValue;

    return GetSettingByDevice(device, settingID, defaultValue);
}

function GetSettingByDeviceData(deviceData, settingID, defaultValue) {
    var device = devices[deviceData.id];

    if(device == undefined || device == null)
        return defaultValue;
    
    return GetSettingByDevice(device, settingID, defaultValue);
}

function GetSettingByDevice(device, settingID, defaultValue) {
    if( device == undefined || device == null || device.settings == undefined || device.settings[settingID] == undefined)
        return defaultValue;
    else
        return device.settings[settingID];
}


//////////////////          Capabilities            //////////////////
function GetDeviceByData( device_data ) {
    var device = devices[ device_data.id ];
    if( typeof device === 'undefined' ) {
        return new Error("invalid_device");
    } else {
        return device;
    }
}

// NOTE: A device's settings are supplied async; as such we need to check if its settings exist.
module.exports.capabilities = {};
module.exports.capabilities.onoff = {};
module.exports.capabilities.onoff.get = function( device_data, callback ) {
    var device = GetDeviceByData( device_data );
    if(device instanceof Error) return callback( device );
    if(device.settings == undefined) return callback(null, false);      // The device is not yet initialized.

    Homey.log("Getting Denon device status.");

    var powerCommand =  GetSettingByDevice(device, SETTING_KEY_POWER_COMMAND, "PW");
    var offCommand =    powerCommand == "PW" ? "STANDBY" : "OFF";

    ReadRequest(GetSettingByDevice(device, SETTING_KEY_IP, DEFAULT_IP), powerCommand + '?', (result, socket) => {
        if(result != null && result.substring(0, 2) != powerCommand)  // We don't handle Zone 2.
            return;

        socket.end();

        var oldDeviceState = device.state.onoff;

        if(result == null || result == powerCommand + offCommand)
            device.state.onoff = false;
        else
            device.state.onoff = true;

        if(oldDeviceState != device.state.onoff)    // Update our realtime data if the device changed state since we last looked.
            module.exports.realtime( device_data, 'onoff', device.state.onoff);

        return callback( null, device.state.onoff );
    });
}
module.exports.capabilities.onoff.set = function( device_data, onoff, callback ) {
    var device = GetDeviceByData( device_data );
    if(device instanceof Error) return callback( device );
    if(device.settings == undefined) return callback(null, false);      // The device is not yet initialized.

    Homey.log("Setting Denon device power.");
    device.state.onoff = onoff;

    var powerCommand =  GetSettingByDevice(device, SETTING_KEY_POWER_COMMAND, "PW");
    var offCommand =    powerCommand == "PW" ? "STANDBY" : "OFF";

    WriteCloseRequest(GetSettingByDevice(device, SETTING_KEY_IP, DEFAULT_IP), onoff ? powerCommand+'ON' : powerCommand+offCommand); 

    module.exports.realtime( device_data, 'onoff', device.state.onoff); // also emit the new value to realtime this produced Insights logs and triggers Flows

    return callback( null, device.state.onoff );
}