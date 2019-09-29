"use strict";

/*
 * Created with @iobroker/create-adapter v1.16.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

const rp = require('request-promise');

class Bsblan extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "bsblan",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("objectChange", this.onObjectChange.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here
        // setup timer
        this.interval = this.config.interval || 60;
        this.interval *= 1000;
        if (this.interval < 10000)
            this.interval = 10000;

        if(this.config.user && this.config.password) {
            this.auth = { 'Authorization': "Basic " + Buffer.from(this.config.user + ":" + this.config.password).toString('base64') }
        } else {
            this.auth = {}
        }

        // in this template all states changes inside the adapters namespace are subscribed
        this.subscribeStates("*");

        this.update();
    }

    update() {

        var values = this.config.values.replace(/\s/g,'');
        var options = {
            uri: "http://" + this.config.host + "/JQ=" + values,
            headers: this.auth,
            json: true
        };

        this.log.info(options.uri)

        rp(options)
            .then(result => this.setStates(result));

        this.timer = setTimeout(() => this.update(), this.interval);
    }

    setStates(data) {
        console.info(data);
        for (let key of Object.keys(data)) {

            let name = data[key].name.replace(".", "") + " (" + key + ")";
            let value = this.parseValue(data[key].value, data[key].desc, data[key].dataType);

            let obj = {
                type: "state",
                common: {
                    name: name,
                    type: this.mapType(data[key].dataType),
                    role: "value",
                    read: true,
                    write: false,
                    unit: this.parseUnit(data[key].unit),
                },
                native: {}
            };
            this.setObjectNotExists(name, obj, callback => {
                this.setStateAsync(name, {val: value, ack: true})
                    .catch((error) => this.errorHandler(error));
            });
        }
    }

    parseValue(value, desc, type) {
        switch (type) {
            case 1:
                return value + " (" + desc + ")";
            default:
                return value;
        }
    }

    mapType(type) {
        // https://1coderookie.github.io/BSB-LPB-LAN/kap08.html#824-abrufen-und-steuern-mittels-json
        switch (type) {
            case 0:
                return "number"; // number
            case 1:
                return "string"; // enum
            case 2:
                return "string"; // weekday
            case 3:
                return "number"; // hr/min
            case 4:
                return "string"; // date/time
            case 5:
                return "number"; // day/month
            case 6:
                return "string"; // string
            default:
                return "string";
        }
    }

    parseUnit(unit) {
        return unit
            .replace("&deg;", "°")
            .replace("&#037;", "%");
    }

    errorHandler(error) {
        this.log.error(error.message);
        if (error.stack)
            this.log.error(error.stack);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.log.info("cleaned everything up...");
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed object changes
     * @param {string} id
     * @param {ioBroker.Object | null | undefined} obj
     */
    onObjectChange(id, obj) {
        if (obj) {
            // The object was changed
            this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        } else {
            // The object was deleted
            this.log.info(`object ${id} deleted`);
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.message" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    // onMessage(obj) {
    // 	if (typeof obj === "object" && obj.message) {
    // 		if (obj.command === "send") {
    // 			// e.g. send email or pushover or whatever
    // 			this.log.info("send command");

    // 			// Send response in callback if required
    // 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
    // 		}
    // 	}
    // }

}

// @ts-ignore parent is a valid property on module
if (module

    .parent
) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module
        .exports = (options) => new Bsblan(options);
} else {
    // otherwise start the instance directly
    new Bsblan();
}