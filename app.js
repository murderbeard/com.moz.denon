'use strict';

const Homey = require('homey');
//const inspector = require('inspector');

class DenonApp extends Homey.App {
	onInit() {
		this.log("Denon App Booted.");
		//inspector.open(9229, '0.0.0.0', true);
	}
}

module.exports = DenonApp;