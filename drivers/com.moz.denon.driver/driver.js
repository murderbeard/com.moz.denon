"use strict";

const Homey = require('homey');

class DenonDriver extends Homey.Driver {
    async onInit() {
        this.homey.flow.getActionCard('com.moz.denon.actions.poweron').registerRunListener((args, state) => {
            return args.device.onCapabilityOnoff(true, null, null);
        });
        
        this.homey.flow.getActionCard('com.moz.denon.actions.poweroff').registerRunListener((args, state) => {
            return args.device.onCapabilityOnoff(false, null, null);
        });
        
        this.homey.flow.getActionCard('com.moz.denon.actions.powertoggle').registerRunListener((args, state) => {
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

        this.homey.flow.getActionCard('com.moz.denon.actions.mute').registerRunListener((args, state) => {
            return args.device.writeCloseRequestPromise('MUON');
        });

        this.homey.flow.getActionCard('com.moz.denon.actions.unmute').registerRunListener((args, state) => {
            return args.device.writeCloseRequestPromise('MUOFF');
        });

        this.homey.flow.getActionCard('com.moz.denon.actions.mutetoggle').registerRunListener((args, state) => {
            let promise = new Promise(
                function (resolve, reject) {
                    args.device.readRequest('MU?', (err, result, socket) => {
                        if(err == null) {
                            var mute = ((result == 'MUON') ? 'MUOFF' : 'MUON');
                            
                            socket.write(args.device.StringToBytes(mute), () => {
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

        this.homey.flow.getActionCard('com.moz.denon.actions.source').registerRunListener((args, state) => {
            return args.device.writeCloseRequestPromise('SI' + args.channel);
        });

        this.homey.flow.getActionCard('com.moz.denon.actions.volume').registerRunListener((args, state) => {
            let promise = new Promise(
                function (resolve, reject) {
                    args.device.readRequest('MV?', (err, result, socket) => {
                        // Attempt to recover from a dual line
                        // NOTE: Requires more testing. There are two points where this happens; see flow card also.
                        if(err == null && (result.substring(0, 2) == 'MV' && result.includes('MAX') && result.includes("\r"))) {
                            result = result.split("\r")[0];
                            args.device.log("volumeAction received a dual line response. Splitting up the message...");
                        }

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
                
                            socket.write(args.device.StringToBytes('MV'+paddedResult), () => {
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

        this.homey.flow.getActionCard('com.moz.denon.actions.volumeset').registerRunListener((args, state) => {
            var volume = parseFloat(args.db) * 10;
            return args.device.writeCloseRequestPromise('MV' + volume);
        });
        
        this.homey.flow.getActionCard('com.moz.denon.actions.customcommand').registerRunListener((args, state) => {
            args.device.log("Sending custom command: " + args.command);
            return args.device.writeCloseRequestPromise(args.command);
        });

        this.homey.flow.getConditionCard('com.moz.denon.conditions.power').registerRunListener(( args, state ) => {
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

        this.homey.flow.getConditionCard('com.moz.denon.conditions.channel').registerRunListener(( args, state ) => {
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
    }

    async onPairListDevices( data ){
		this.log("Device Pairing method called.");
        this.log(data);

        return [
            {
				name: "New Denon Amplifier",
                data: {
					id: data.id
                }
            }
        ];
    }
}

module.exports = DenonDriver;