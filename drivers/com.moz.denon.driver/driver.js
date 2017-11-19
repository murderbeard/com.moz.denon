"use strict";

const Homey = require('homey');

class DenonDriver extends Homey.Driver {
    onPairListDevices( data, callback ){
		this.log("Device Pairing method called.");
        this.log(data);

        callback( null, [
            {
				name: "New Denon Amplifier",
                data: {
					id: data.id
                }
            }
        ]);
    }
}

module.exports = DenonDriver;