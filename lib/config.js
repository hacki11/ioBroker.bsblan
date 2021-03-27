const {ConfigObject} = require("./config_object");

const staticV1Config = {
    // default: rw=true, writeType=1 (SET)
    5: { "rw": true, "writeType": 0 },
    6: { "rw": true, "writeType": 0 },
    8700: { "rw": false, "writeType": 1 },
};

function initInfoObjects() {
    const objects = [];

    objects.push(new ConfigObject("name", "Name of Device", "info.name", "string", ""));
    objects.push(new ConfigObject("version", "Firmware Version", "info.version", "string", ""));
    objects.push(new ConfigObject("freeram", "Free RAM", "value", "number", "byte"));
    objects.push(new ConfigObject("uptime", "Uptime", "value", "number", "ms"));
    objects.push(new ConfigObject("MAC", "MAC Address", "info.mac", "number", "ms"));
    objects.push(new ConfigObject("bus", "Bus Type", "value", "string", ""));
    objects.push(new ConfigObject("buswritable", "Can data be written on the bus", "value", "number", ""));
    objects.push(new ConfigObject("busaddr", "Bus Address", "value", "number", ""));
    objects.push(new ConfigObject("busdest", "Bus Destination", "value", "number", ""));
    objects.push(new ConfigObject("monitor", "Monitor", "value", "number", ""));
    objects.push(new ConfigObject("verbose", "Verbose Active", "value", "number", ""));
    objects.push(new ConfigObject("logvalues", "Log Values", "value", "number", ""));
    objects.push(new ConfigObject("loginterval", "Log Interval", "value", "number", ""));

    return objects;
}
const InfoObjects = initInfoObjects();

module.exports = {
    staticV1Config,
    InfoObjects
};
