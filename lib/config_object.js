class ConfigObject {
    constructor(id, name, role, dataType, unit) {
        this.id = id;
        this.obj = {
            type: "state",
            common: {
                name: name,
                type: dataType,
                role: role,
                read: true,
                write: false,
                unit: unit,
            },
        };
    }
}

module.exports = {
    ConfigObject,
};
