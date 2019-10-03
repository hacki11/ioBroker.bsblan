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

        if (this.config.user && this.config.password) {
            this.auth = {'Authorization': "Basic " + Buffer.from(this.config.user + ":" + this.config.password).toString('base64')}
        } else {
            this.auth = {}
        }

        // in this template all states changes inside the adapters namespace are subscribed
        this.subscribeStates("*");

        this.valuesAsCSV = this.config.values.replace(/\s/g, '');
        this.values = [...new Set(this.valuesAsCSV.split(","))].sort();


        await //this.detectNewObjects(this.values)
            //.then(newValues =>
            this.initializeParameters(this.values);
            // .catch((error) => this.errorHandler(error));


        this.update();
    }

    async detectNewObjects(values) {
        let newValues = [];
        var promises = [];
        for (let val of values) {
            promises.push(this.getState(val, cb => {
                if (!cb) return val;
            }));
        }
        Promises.all(promises).then(() => {
            return newValues;
        });
    }

    initializeCategories() {
        return rp(this.options("http://" + this.config.host + "/JK=ALL"))
    }

    async initializeParameters(values) {

        if (!values || values.length == 0) return;

        this.categories = await this.initializeCategories();

        let fetch = new Set();

        for (let value of values) {
            for (let key of Object.keys(this.categories)) {
                if (value >= this.categories[key]['min'] && value <= this.categories[key]['max']) {
                    fetch.add(key);
                    break;
                }
            }
        }
        this.log.info("Fetching categories");

        let params = {};
        for (let category of fetch) {
            await rp(this.options("http://" + this.config.host + "/JK=" + category))
                .then(result => Object.keys(result).forEach(k => params[k] = result[k]));
        }

        this.log.info(params);

        for (let obj of values) {
            await this.setupObject(obj, params[obj]);
        }
    }

    async setupObject(key, param) {
        let name = param.name.replace(".", "") + " (" + key + ")";

        this.log.info("Add Parameter: " + name);

        await rp(this.options("http://" + this.config.host + "/JQ=" + key))
            .then(valueObject => {
                let obj = {
                    type: "state",
                    common: {
                        name: param.name,
                        type: this.mapType(param.dataType),
                        role: "value",
                        read: true,
                        write: false,
                        unit: this.parseUnit(valueObject[key].unit),
                        states: this.createObjectStates(param.possibleValues)
                    },
                    native: {}
                };
                this.setObjectNotExists(key, obj);
                return valueObject.value;
            })
            .catch((error) => this.errorHandler(error));
    }

    createObjectStates(possibleValues) {
        let states = {};
        for (let entry of possibleValues) {
            states[entry['enumValue']] = entry['desc']
        }
        return states;
    }

    update() {
        rp(this.options("http://" + this.config.host + "/JQ=" + this.valuesAsCSV))
            .then(result => this.setStates(result));

        this.timer = setTimeout(() => this.update(), this.interval);
    }

    options(uri) {
        return {
            uri: uri,
            headers: this.auth,
            json: true
        };
    }

    setStates(data) {
        console.info(data);
        for (let key of Object.keys(data)) {

            let name = data[key].name.replace(".", "") + " (" + key + ")";

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
                this.setStateAsync(name, {val: data[key].value, ack: true})
                    .catch((error) => this.errorHandler(error));
            });
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