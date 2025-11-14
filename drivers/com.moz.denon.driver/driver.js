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
                            var mute = args.device.findMessage(result, 'MU') == 'MUON' ? 'MUOFF' : 'MUON';
                            
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

        // Cache for supported source for autocomplete cards for fast response. Invalidates after a while in case someone renames a sources in the receiver.
        let deviceSourceListCache = {}; // [id]: {list[], time}
        function filterSourceList(list, query) {
            var newList = new Array();
            var q = query.toLowerCase();

            var addBeforeNext = null;   // Insert the static list indicator thing.
            for(var i = 0; i < list.length; i++) {
                if(list[i].id == "GRBG") {
                    addBeforeNext = list[i];
                    continue;
                }

                if( list[i].id.toLowerCase().includes(q) || list[i].name.toLowerCase().includes(q)) {
                    if(addBeforeNext != null) {
                        newList.push(addBeforeNext);
                        addBeforeNext = null;
                    }
                    newList.push(list[i]);
                }
            }

            // Make the list empty if this is the only one.
            if(newList.length == 1 && newList[0].id == "GRBG")
                newList.pop();

            return newList;
        }
        function sourceAutocompleteProvider(query, args) {
            if(deviceSourceListCache[args.device.id] != undefined) {
                var now = Date.now();
                if(now - deviceSourceListCache[args.device.id].time < 30000) {
                    deviceSourceListCache[args.device.id].time = now;   // Reset the timer
                    return filterSourceList(deviceSourceListCache[args.device.id].list, query);
                } else {
                    deviceSourceListCache[args.device.id] = undefined;
                }
            }

            return new Promise(async (resolve) => {
                let originalList = [
                    { id: "TUNER",    name: "Tuner" },
                    { id: "DVD",      name: "DVD" },
                    { id: "BD",       name: "Blu-ray" },
                    { id: "TV",       name: "TV Audio" },
                    { id: "SAT/CBL",   name: "CBL/SAT" },
                    { id: "MPLAY",   name: "Media Player" },
                    { id: "GAME",   name: "Game" },
                    { id: "AUX1",   name: "Aux 1" },
                    { id: "AUX2",   name: "Aux 2" },
                    { id: "NET",   name: "Network" },
                    { id: "PANDORA",   name: "Pandora (US Only)" },
                    { id: "SIRIUSXM",   name: "Siriusxm (US Only)" },
                    { id: "SPOTIFY",   name: "Spotify" },
                    { id: "FLICKR",   name: "Flickr" },
                    { id: "FAVORITES",   name: "Favorites" },
                    { id: "IRADIO",   name: "Internet Radio" },                            
                    { id: "SERVER",   name: "Server" },                            
                    { id: "USB/IPOD",   name: "USB/iPod" },                            
                    { id: "USB",   name: "USB (Start Playback)" },                            
                    { id: "IPD",   name: "iPod Direct (Start Playback)" },                            
                    { id: "IRP",   name: "Internet Radio (Start Playback)" },
                    { id: "AUXA",   name: "Portable In (N8 Only)" },
                    { id: "AUXB",   name: "N5:Analog In / N8:Analog In1" },
                    { id: "AUXC",   name: "Analog In2 (N8 Only)" },
                    { id: "AUXD",   name: "Digital In" },
                    { id: "CD",   name: "CD" },
                    { id: "PHONO",   name: "Phono" },
                    { id: "GAME1",   name: "Game 1" }
                ]

                // Add the ID at the back for ppl who want to know.
                for(var i = 0; i < originalList.length; i++) {
                    originalList[i].name = originalList[i].name + " ["+originalList[i].id+"]";
                }

                let list = new Array();
                args.device.log("Requesting sources list with SSFUN ?");
                // In case of SSFUN not returning anything the receiver will stop sending and the socket will error out with inactivity.
                // In case it receives some part of another message it will not get added and will trigger the inactivity a few lines later.
                function finalizeList() {
                    // TODO: it doesn't like translated stuff in the description. We might be able to manually set the text by seeing what this homey's language is.
                    list.push({id: "GRBG", name:"↓↓↓ Other sources ↓↓↓", description: "Items below might be unsupported."});

                    for(var i = 0; i < originalList.length; i++) {
                        var alreadyPresent = false;
                        for(var j = 0; j < list.length; j++) {      // Don't add duplicates to the list.
                            if(list[j].id == originalList[i].id) {
                                alreadyPresent = true;
                                break;
                            }
                        }

                        if(!alreadyPresent)
                            list.push(originalList[i]);
                    }

                    args.device.log("Unfiltered sources list: " + JSON.stringify(list));

                    deviceSourceListCache[args.device.id] = {};
                    deviceSourceListCache[args.device.id].list = list;
                    deviceSourceListCache[args.device.id].time = Date.now();
                    
                    resolve(filterSourceList(list, query));
                }

                // NOTE: some devices don't end the list with SSFUN END so we get a inactivity timeout - in that case we still need to check if we got any sources.
                args.device.readRequest('SSFUN ?', (err, result, socket) => {
                    if(err == null) {
                        var lines = result.split('\r');

                        lines.forEach(line => {
                            if(line.indexOf("SSFUN END") != -1) {
                                if(socket != null)
                                    socket.end();

                                finalizeList();
                            } else if(line.startsWith("SSFUN")) {
                                //args.device.log("Adding: " + line);
                                let newID = line.substring(5, line.indexOf(" "));
                                let newName = line.substring(line.indexOf(" ")).trim() + " ["+newID+"]";

                                list.push({ id: newID,
                                            name: newName});
                            }
                        });
                    } else {
                        if(socket != null)
                            socket.end();

                        if(list.length != 0) {
                            finalizeList();
                        } else {
                            args.device.log("Error during sources list - defaulting to: " + JSON.stringify(originalList));
                            deviceSourceListCache[args.device.id] = {};
                            deviceSourceListCache[args.device.id].list = originalList;
                            deviceSourceListCache[args.device.id].time = Date.now();

                            resolve(filterSourceList(originalList, query));
                        }
                    }
                });
            });
        }

        this.homey.flow.getActionCard('com.moz.denon.actions.source.v2').registerRunListener((args, state) => {
            return args.device.writeCloseRequestPromise('SI' + args.channel.id);
        }).getArgument("channel").registerAutocompleteListener(sourceAutocompleteProvider);

        // NOTE-2023-06-10: This still works properly with the new multiline collection system.
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
                        if(err == null) {
                            socket.end();

                            let foundMessage = args.device.findMessage(result, 'SI');

                            if(foundMessage == "")
                                reject("No source info received from Denon receiver.");
                                                        
                            args.device.log("Current Source is: " + foundMessage);
                            resolve(foundMessage == 'SI' + args.channel);
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

        // This is just a straight up copy but we check args.channel.id instead of args.channel.
        this.homey.flow.getConditionCard('com.moz.denon.conditions.channel.v2').registerRunListener(( args, state ) => {
            let promise = new Promise(
                function (resolve, reject) {
                    args.device.readRequest('SI?', (err, result, socket) => {
                        if(err == null) {
                            socket.end();

                            let foundMessage = args.device.findMessage(result, 'SI');

                            if(foundMessage == "")
                                reject("No source info received from Denon receiver.");
                                                        
                            args.device.log("Current Source is: " + foundMessage);
                            resolve(foundMessage == 'SI' + args.channel.id);
                        } else {
                            if(socket != null)
                                socket.end();
                            reject(err);
                        }
                    });
                }
            );
        
            return promise;
        }).getArgument("channel").registerAutocompleteListener(sourceAutocompleteProvider);

        this.homey.flow.getDeviceTriggerCard('com.moz.denon.triggers.channelchangedto').registerRunListener(( args, state ) => {
            let promise = new Promise(
                function (resolve, reject) {
                    resolve(args.channel == state.channel);
                }
            );
        
            return promise;
        });
        this.homey.flow.getDeviceTriggerCard('com.moz.denon.triggers.channelchangedto.v2').registerRunListener(( args, state ) => {
            let promise = new Promise(
                function (resolve, reject) {
                    resolve(args.channel.id == state.channel);
                }
            );
        
            return promise;
        }).getArgument("channel").registerAutocompleteListener(sourceAutocompleteProvider);
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