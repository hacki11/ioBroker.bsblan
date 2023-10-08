"use strict";

/*
 * Created with @iobroker/create-adapter v1.16.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const BSB = require("./lib/bsb");
const {InfoObjects} = require("./lib/config");

class Bsblan extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        // @ts-ignore
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
        this.interval = Number(this.config.interval) || 60;
        this.interval *= 1000;
        if (this.interval < 10000)
            this.interval = 10000;


        this.values = this.resolveConfigValues();

        await this.migrateExistingObjects();

        // only supported bsb_lan > 2.x
        await this.updateNativeData();

        this.subscribeStates("*");

        await this.setupDefaultObjects();
        await this.update();
    }

    getBSB() {
        if(!this.bsb) {
            this.bsb = new BSB(this.config.host, this.config.user, this.config.password);
        }
        return this.bsb;
    }

    resolveConfigValues() {
        const values = new Set();
        for (const line of this.config.values.split(/\r?\n/)) {
            for (const entry of line.split(",")) {
                const value = entry.trim();
                if (value.length === 0) {
                    //ignore
                } else if (isNaN(parseInt(value))) {
                    this.log.error(value + " is not a valid id to retrieve.");
                } else {
                    values.add(entry.trim());
                }
            }
        }
        const valuesArray = [...values].sort();
        this.log.info("Values found: " + valuesArray);
        return valuesArray;
    }

    async update() {
        this.log.debug("Update default states ...");
        await this.updateDefaultStates()
            .catch((error) => {
                this.errorHandler(error);
                this.refreshTimer();
            });

        this.log.debug("Update parameters ...");
        await this.detectNewObjects(this.values)
            .then(newValues => this.initializeParameters(newValues))
            .then(() => this.connectionHandler(true))
            .then(() => this.getBSB().getParameter(this.values))
            .then(result => this.setStates(result))
            .then(() => this.getBSB().query24hAverages())
            .then(result24h => this.set24hAverages(result24h))
            .then(() => this.refreshTimer())
            .catch((error) => {
                this.errorHandler(error);
                this.refreshTimer();
            });
    }

    refreshTimer() {
        this.log.debug("Reset Timer");
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
                    .then(obj => {
                        if(obj && obj.native && obj.native.bsb) {
                            return this.getBSB().write(obj.native.id, state.val, obj.native.bsb.dataType);
                        } else {
                            this.log.error(`Error getting BSB native information from: ${id}`);
                        }
                    })
                    .then(response => {
                        this.log.debug(`Received write response: ${JSON.stringify(response)}`);
                        return this.getBSB().getParameter(Object.keys(response));
                    })
                    .then(result => this.setStates(result))
                    .catch((error) => {
                        if (error.name === "BSBWriteError") {
                            this.log.error(`Error writing value: ${error.message}`);
                            // ignore
                        } else {
                            this.errorHandler(error);
                        }
                    });
            }
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    async initializeParameters(values) {
        if (!values || values.size === 0) return;

        this.log.info("Setup new objects (" + [...values] + ") ...");
        this.categories = await this.getBSB().categories();

        const categoryMap = {};

        for (const value of values) {
            for (const category of Object.keys(this.categories)) {
                if (value >= this.categories[category]["min"] && value <= this.categories[category]["max"]) {
                    const obj = {
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

        const queriedValues = await this.getBSB().getParameter(values);

        let createdValues = new Set();
        for (const category of Object.keys(categoryMap)) {
            this.log.info("Fetching category " + category + " " + categoryMap[category].native.name + " ...");
            await this.getBSB().category(category)
                .then(result => this.setupCategory(categoryMap[category], result, queriedValues))
                .then(result => createdValues = new Set([...createdValues, ...result]));
        }

        this.showInvalidValues(createdValues, values);

        this.log.info("Setup objects done.");
        return createdValues;
    }

    showInvalidValues(createdValues, newValues) {
        for (const value of newValues) {
            if (!createdValues.has(value)) {
                this.log.warn("Value not found, skipping: " + value);
            }
        }
    }

    detectNewObjects(values) {
        const newValues = new Set(values);
        return this.getAdapterObjectsAsync()
            .then(records => {
                for (const key of Object.keys(records)) {
                    if (records[key].native) {
                        const id = records[key].native.id;
                        if (newValues.has(id)) {
                            newValues.delete(id);
                        }
                    }
                }
                return newValues;
            });
    }

    setupCategory(category, params, values) {
        const name = category.native["name"] + " (" + category.native["min"] + " - " + category.native["max"] + ")";
        this.log.info("Setup category " + category.id + ": " + name);
        const createdValues = new Set();
        for (const value of category.values) {
            if (value in params) {
                this.setupObject(value, params[value], values[value])
                    .catch((error) => this.errorHandler(error));
                createdValues.add(value);
            }
        }
        return createdValues;
    }

    async setupDefaultObjects() {
        this.log.info("Fetch device information ...");
        await this.getBSB().queryInfo()
            .then(info => InfoObjects.map(object => this.setupDefaultObject(object, info)))
            .catch(error => this.errorHandler(error));
    }

    async setupDefaultObject(object, info) {
        const name = "info." + object.id;
        if (Object.prototype.hasOwnProperty.call(info, object.id)) {
            await this.setObjectNotExistsAsync(name, object.obj)
                .then(response => {
                    // if the object exists, we get an undefined
                    if (response !== undefined) {
                        this.log.info("Add Info Object: " + name + " " + JSON.stringify(response));
                    }
                })
                .catch(error => this.errorHandler(error));
        }
    }

    async updateDefaultStates() {
        await this.getBSB().queryInfo()
            .then(info => this.setDefaultStates(info))
            .catch(error => this.errorHandler(error));
    }

    async setDefaultStates(info) {
        for (const object of InfoObjects) {
            const name = "info." + object.id;
            if (Object.hasOwnProperty.call(info, object.id)) {
                // no conversion needed because BSBLAN already delivers string or number
                await this.setStateAsync(name, {val: info[object.id], ack: true})
                    .catch(error => this.errorHandler(error));
            }
        }
    }

    async setupObject(key, param, value) {
        const name = this.createName(param.name, key);

        this.log.info("Add Parameter: " + name);

        // bsb_lan 2.x feature
        let write;
        if ("readonly" in value) {
            write = value.readonly === 0;
        } else {
            // bsb_lan 1.x we have to guess or hard-code
            write = this.getBSB().isReadWrite(key);
        }

        const obj = {
            type: "state",
            common: {
                name: name,
                type: this.mapType(param.dataType),
                role: "value",
                read: true,
                write: write,
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

        // @ts-ignore
        await this.setObjectNotExistsAsync(key, obj)
            .then(() => this.setStateAsync(key, {
                val: this.parseValue(value.value, value.dataType),
                ack: true
            }))
            .catch((error) => this.errorHandler(error));
    }

    async set24hAvgObject(key, param) {
        const name = this.createName(param.name, key);

        this.log.debug("Set 24h Average: " + name);

        const obj = {
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
        };

        await this.setObjectNotExistsAsync("24h", {
            type: "channel",
            common: {
                name: "24h averages"
            },
            native: {}
        });

        // @ts-ignore
        await this.setObjectNotExistsAsync("24h." + key, obj)
            .then(() => this.setStateAsync("24h." + key, {
                val: this.parseValue(param.value, param.dataType),
                ack: true
            }))
            .catch((error) => this.errorHandler(error));
    }

    async set24hAverages(data) {
        this.log.debug("/JA Response: " + JSON.stringify(data));

        for (const key of Object.keys(data)) {
            await this.set24hAvgObject(key, data[key]);
        }
    }

    setStates(data) {
        this.log.debug("/JQ Response: " + JSON.stringify(data));
        for (const key of Object.keys(data)) {
            this.setStateAsync(key, {
                val: this.parseValue(data[key].value, data[key].dataType),
                ack: true
            }).catch((error) => this.errorHandler(error));
        }
    }

    createName(name, key) {
        return name + " (" + key + ")";
    }

    createObjectStates(possibleValues) {
        const states = {};
        for (const entry of possibleValues) {
            states[entry["enumValue"]] = entry["desc"];
        }
        return states;
    }

    mapType(type) {
        // https://1coderookie.github.io/BSB-LPB-LAN/kap08.html#824-abrufen-und-steuern-mittels-json
        switch (type) {
            case 0:
                return "number"; // number
            case 1:
                return "number"; // enum
            case 2:
                return "string"; // Bit value
            case 3:
                return "string"; // weekday
            case 4:
                return "string"; // hr/min
            case 5:
                return "string"; // date/time
            case 6:
                return "string"; // day/month
            case 7:
                return "string"; // string
            default:
                return "string";
        }
    }

    parseValue(value, type) {
        switch(type) {
            case 0: // number
            case 1: // enum
                // BSB_LAN returns --- for numbers
                // https://github.com/fredlcore/BSB-LAN/issues/469
                if (value == "---") {
                    return 0;
                }
                return parseFloat(value);
            default: // no conversion
                return value;
        }
    }

    parseUnit(unit) {
        return unit
            .replace("&deg;", "°")
            .replace("&#037;", "%")
            .replace("&#181;", "u");  // micro
    }

    async migrateExistingObjects() {
        await this.getAdapterObjectsAsync().then(objects => {
            for (const id in objects) {
                const obj = objects[id];
                if (obj.native && obj.native.bsb) {
                    this.fixReadWrite(obj);
                    this.fixEmptyStates(obj);
                    this.extendObject(id, obj);
                    //this.warnInvalidCharacters(obj);
                    this.fixDataType(obj);
                    this.migrateIdStrategy(obj);
                }
            }
        });
    }

    fixReadWrite(obj) {
        // not needed for objects created from V1 firmware
        if ("bsb" in obj.native && "readonly" in obj.native.bsb) {
            return;
        }

        const rw = this.getBSB().isReadWrite(obj.native.id);
        if (rw !== obj.common.write) {
            this.log.info(`Migrate ${obj._id}: set write = ${rw}`);
            obj.common.write = rw;
        }
    }

    fixEmptyStates(obj) {
        if (obj.common.states && Object.keys(obj.common.states).length === 0) {
            this.log.info(`Migrate ${obj._id}: remove empty states`);
            obj.common.states = null;
        }
    }

    warnInvalidCharacters(obj) {
        const newId = obj.native.id;
        const oldId = obj._id.split(".");
        if (oldId[oldId.length - 1] !== newId) {
            this.log.warn(`Object ${obj._id} contains illegal characters, please delete. ${newId} will then be created automatically.`);
        }
    }

    fixDataType(obj) {
        if ("bsb" in obj.native && "dataType" in obj.native.bsb) {
            const newType = this.mapType(obj.native.bsb.dataType);
            if (obj.common.type != newType) {
                this.log.info(`Migrate ${obj._id}: Change data type from ${obj.common.type} to ${newType}`);
                obj.common.type = newType;
            }
        }
    }

    async migrateIdStrategy(obj) {
        if("bsb" in obj.native) {
            const oldId = obj._id.split(".");
            // verify if state has already the new ID instead of Name+ID
            if (oldId[oldId.length - 1] !== obj.native.id) {
                let newId = obj.native.id;
                if("avg" in obj.native.bsb) {
                    newId = "24h." + newId;
                }

                // only migrate once
                if(!this.objectExists(newId)) {
                    this.log.info(`Migrate ${obj._id}: Change ID to ${newId}`);
                    await this.setObjectNotExistsAsync(newId, obj);
                } else {
                    this.log.warn(`Please delete deprecated state manually: ${obj._id}`);
                }
            }
        }
    }


    async updateNativeData() {
        this.log.info("Updating meta information of parameters ...");
        // get all existing objects
        const objects = await this.getAdapterObjectsAsync();

        // convert into array of dict [iob id, bsb id]
        const ids = {};
        Object.values(objects)
            .filter(obj => obj.native)
            .filter(obj => obj.native.id)
            .filter(obj => !isNaN(obj.native.id))
            .map(obj => ids[parseInt(obj.native.id)] = obj);

        // fetch parameter definitions (bsb_lan > 2.x)
        const results = {};
        await this.getBSB().getParameterDefinitionAsync(this.values)
            .then(result => Object.assign(results, result))
            .then(() => this.getBSB().query24AverageDefinitions())
            .then(result => Object.assign(results, result))
            .then(() => {
                // merge native data
                for (const [bsb_id, obj] of Object.entries(ids)) {
                    // check if the object has a definition available
                    if (bsb_id in results) {
                        // update native data
                        obj.native.bsb = results[bsb_id];
                        obj.common.name = this.createName(results[bsb_id].name, bsb_id);
                        this.setObjectAsync(obj._id, obj);
                    }
                }
            })
            .catch(error => this.errorHandler(error));
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
