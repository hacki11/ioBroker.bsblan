"use strict";

/*
 * Created with @iobroker/create-adapter v1.16.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const BSB = require("./lib/bsb");

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
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // setup timer
        this.interval = this.config.interval || 60;
        this.interval *= 1000;
        if (this.interval < 10000)
            this.interval = 10000;

        this.bsb = new BSB(this.config.host, this.config.user, this.config.password);

        this.values = this.resolveConfigValues();

        await this.migrateExistingObjects();

        this.subscribeStates("*");

        this.update();
    }

    resolveConfigValues() {
        let values = new Set();
        for (let line of this.config.values.split(/\r?\n/)) {
            for (let entry of line.split(",")) {
                let value = entry.trim();
                if (value.length === 0) {
                    //ignore
                } else if (isNaN(parseInt(value))) {
                    this.log.error(value + " is not a valid id to retrieve.")
                } else {
                    values.add(entry.trim());
                }
            }
        }
        let valuesArray = [...values].sort();
        this.log.info("Values found: " + valuesArray);
        return valuesArray;
    }

    update() {
        this.log.debug("Fetch values ...")
        this.detectNewObjects(this.values)
            .then(newValues => this.initializeParameters(newValues))
            .then(() => this.connectionHandler(true))
            .then(() => this.bsb.query(this.values))
            .then(result => this.setStates(result))
            .then(() => this.bsb.query24hAverages())
            .then(result24h => this.set24hAverages(result24h))
            .then(() => this.refreshTimer())
            .catch((error) => {
                this.errorHandler(error);
                this.refreshTimer();
            });
    }

    refreshTimer() {
        this.log.debug("Reset Timer")
        this.timer = setTimeout(() => this.update(), this.interval);
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (state) {
            // The state was changed
            if (this.bsb && state && !state.ack) {
                this.log.info(`Sending write request for ${id} (value: ${state.val})`);

                this.getObjectAsync(id)
                    .then(obj => this.bsb.write(obj.native.id, state.val, obj.native.bsb.dataType))
                    .then(response => {
                        this.log.debug(`Received write response: ${JSON.stringify(response)}`);
                        return this.bsb.query(Object.keys(response));
                    })
                    .then(result => this.setStates(result))
                    .catch((error) => {
                        if (error.name === "BSBWriteError") {
                            this.log.error(`Error writing value: ${error.message}`);
                            // ignore
                        } else {
                            this.errorHandler(error);
                        }
                    })
            }
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    async initializeParameters(values) {

        if (!values || values.size === 0) return;

        this.log.info("Setup new objects (" + [...values] + ") ...")
        this.categories = await this.bsb.categories();

        let categoryMap = {};

        for (let value of values) {
            for (let category of Object.keys(this.categories)) {
                if (value >= this.categories[category]['min'] && value <= this.categories[category]['max']) {
                    var obj = {
                        id: category,
                        native: this.categories[category],
                        values: []
                    };
                    if (!categoryMap[category]) {
                        categoryMap[category] = obj;
                    }
                    categoryMap[category].values.push(value);
                    break;
                }
            }
        }

        var queriedValues = await this.bsb.query(values);

        var createdValues = new Set()
        for (let category of Object.keys(categoryMap)) {
            this.log.info("Fetching category " + category + " " + categoryMap[category].native.name + " ...")
            await this.bsb.category(category)
                .then(result => this.setupCategory(categoryMap[category], result, queriedValues))
                .then(result => createdValues = new Set([...createdValues, ...result]))
        }

        this.showInvalidValues(createdValues, values)

        this.log.info("Setup objects done.")
        return createdValues;
    }

    showInvalidValues(createdValues, newValues) {

        for (let value of newValues) {
            if (!createdValues.has(value)) {
                this.log.warn("Value not found, skipping: " + value)
            }
        }
    }

    detectNewObjects(values) {

        let newValues = new Set(values);
        return this.getAdapterObjectsAsync()
            .then(records => {
                for (let key of Object.keys(records)) {
                    if (records[key].native) {
                        let id = records[key].native.id;
                        if (newValues.has(id)) {
                            newValues.delete(id);
                        }
                    }
                }
                return newValues;
            });
    }

    setupCategory(category, params, values) {
        var name = category.native['name'] + " (" + category.native['min'] + " - " + category.native['max'] + ")";
        this.log.info("Setup category " + category.id + ": " + name);
        var createdValues = new Set();
        for (let value of category.values) {
            if (params.hasOwnProperty(value)) {
                this.setupObject(value, params[value], values[value])
                    .catch((error) => this.errorHandler(error))
                createdValues.add(value)
            }
        }
        return createdValues;
    }

    async setupObject(key, param, value) {
        let name = param.name + " (" + key + ")";

        this.log.info("Add Parameter: " + name);

        let obj = {
            type: "state",
            common: {
                name: name,
                type: this.mapType(param.dataType),
                role: "value",
                read: true,
                write: !(!!+param.readonly),
                unit: this.parseUnit(value.unit)
            },
            native: {
                id: key,
                bsb: param,
            }
        };
        if (param.possibleValues.length > 0) {
            obj.common.states = this.createObjectStates(param.possibleValues);
        }


        this.setObjectNotExistsAsync(this.createId(key, param.name), obj)
            .then(this.setStateAsync(this.createId(key, param.name), {val: value.value, ack: true}))
            .catch((error) => this.errorHandler(error));
    }

    async set24hAvgObject(key, param) {
        let name = param.name + " (" + key + ")"

        this.log.info("Set 24h Average: " + name)

        let obj = {
            type: "state",
            common: {
                name: name,
                type: "number",
                role: "value",
                read: true,
                write: false,
                unit: this.parseUnit(param.unit)
            },
            native: {
                id: key,
                bsb: param,
                avg: "24h"
            }
        }

        await this.setObjectNotExistsAsync("24h", {
            type: "channel",
            common: {
                name: "24h averages"
            }
        })

        await this.setObjectNotExistsAsync("24h." + this.createId(key, param.name), obj)
            .then(this.setStateAsync("24h." + this.createId(key, param.name), {val: param.value, ack: true}))
            .catch((error) => this.errorHandler(error))
    }

    async set24hAverages(data) {
        this.log.debug("/JA Response: " + JSON.stringify(data))

        for (let key of Object.keys(data)) {
            await this.set24hAvgObject(key, data[key])
        }
    }

    setStates(data) {
        this.log.debug("/JQ Response: " + JSON.stringify(data));
        for (let key of Object.keys(data)) {
            this.setStateAsync(this.createId(key, data[key].name), {val: data[key].value, ack: true})
                .catch((error) => this.errorHandler(error));
        }
    }

    createId(key, name) {
        return name.replace(/\s/g, "_").replace(/\./g, "").replace(/`/g, "_") + "_(" + key + ")";
    }

    createObjectStates(possibleValues) {
        let states = {};
        for (let entry of possibleValues) {
            states[entry['enumValue']] = entry['desc']
        }
        return states;
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
                return "string"; // hr/min
            case 4:
                return "string"; // date/time
            case 5:
                return "string"; // day/month
            case 6:
                return "string"; // string
            default:
                return "string";
        }
    }

    parseUnit(unit) {
        return unit
            .replace("&deg;", "°")
            .replace("&#037;", "%")
            .replace("&#181;", "u");  // micro
    }

    async migrateExistingObjects() {
        this.getAdapterObjectsAsync().then(objects => {
            for (let id in objects) {
                var obj = objects[id];
                if (obj.native && obj.native.bsb) {
                    this.fixReadWrite(obj);
                    this.fixEmptyStates(obj);

                    this.extendObject(id, obj);
                }
            }
        });
    }

    fixReadWrite(obj) {
        var rw = this.bsb.isReadWrite(obj.native.id, obj.native.bsb.dataType);
        if (rw !== obj.common.write) {
            this.log.info(`Migrate ${obj._id}: set write = ${rw}`)
            obj.common.write = rw;
        }
    }

    fixEmptyStates(obj) {
        if (obj.common.states && Object.keys(obj.common.states).length === 0) {
            this.log.info(`Migrate ${obj._id}: remove empty states`)
            obj.common.states = null;
        }
    }

    errorHandler(error) {
        this.log.error(error.message);
        if (error.stack)
            this.log.error(error.stack);
        this.connectionHandler(false);
    }

    connectionHandler(connected) {
        if (this.connection !== connected) {
            this.connection = connected;
            if (connected)
                this.log.info("Connection established successfully");
            else
                this.log.error("Connection failed");

            this.setState("info.connection", this.connection, true);
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            clearTimeout(this.timer);
            this.log.info("cleaned everything up...");
            callback();
        } catch (e) {
            callback();
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module && module.parent) {
    // Export the constructor in compact mode
    module.exports = (options) => new Bsblan(options);
} else {
    // otherwise start the instance directly
    new Bsblan();
}
