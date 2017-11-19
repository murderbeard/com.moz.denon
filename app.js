'use strict';

const Homey = require('homey');

class DenonApp extends Homey.App {
	onInit() {
		this.log("Denon App Booted.");
	}
}

module.exports = DenonApp;