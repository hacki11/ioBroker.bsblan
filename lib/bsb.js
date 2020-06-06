const rp = require('promise-request-retry');
const config = require('./config');

module.exports = class BSB {
    constructor(host, user, password) {
        this.host = host;
        if (user && password) {
            this.auth = {'Authorization': "Basic " + Buffer.from(user + ":" + password).toString('base64')}
        } else {
            this.auth = {}
        }
    }

    async query(values) {
        return rp(this.options("http://" + this.host + "/JQ=" + [...values].join(",")));
    }

    async categories() {
        return rp(this.options("http://" + this.host + "/JK=ALL"));
    }

    async category(id) {
        return rp(this.options("http://" + this.host + "/JK=" + id));
    }

    async writeSet(id, value, type) {
        return rp({
                method: 'POST',
                uri: "http://" + this.host + "/JS",
                headers: this.auth,
                json: true,
                body: {
                    Parameter: id,
                    Value: this.convert(value, type),
                    Type: '1',
                },
                timeout: 15000,
                retry: 2,
                delay: 1000
            }
        )
            .then(response => this.handleJSResponse(id, response))
    }
    async writeInf(id, value, type) {
        return rp({
            method: 'GET',
            uri: `http://${this.host}/I${id}=${value}`,
            headers: this.auth,
            timeout: 15000,
            retry: 2,
            delay: 1000
        })
            .then(response => this.handleIResponse(id, response))
    }

    async write(id, value, type) {

        switch(config.objects[id].writeType) {
            case "set": return this.writeSet(id, value, type);
            case "inf": return this.writeInf(id, value, type);
        }
    }

    isReadWrite(id, dataType) {
        return id in config.objects && config.objects[id].rw && config.rwDataTypes.includes(dataType);
    }

    handleJSResponse(id, response) {
        var object = response[id];
        switch (object.status) {
            case 0:
                // error
                throw {
                    name: "BSBWriteError",
                    message: `Could not set value: "${JSON.stringify(response)}"`
                };
            case 1:
                // OK
                return response;
            case 2:
                // readonly
                throw {
                    name: "BSBWriteError",
                    message: `Parameter "${id}" is read-only. Can not be set or BSB_Lan firwmare was not compiled with write-flag for this parameter. ${JSON.stringify(response)}`
                };
        }
    }

    handleIResponse(id, response) {
        if(response.includes("FEHLER: Setzen fehlgeschlagen!")){
            throw {
                name: "BSBWriteError",
                message: `Could not set inf "${id}", received an error`
            };
        }

        return response;
    }


    convert(value, type) {
        switch (type) {
            case 0:
                return value;
            case 1:
                return value;
            case 2:
                return value;
            case 4: // hr:mm => hr.mm
                return value.replace(':', '.');

        }
    }

    options(uri) {
        return {
            uri: uri,
            headers: this.auth,
            json: true,
            timeout: 15000,
            retry: 2,
            delay: 1000
        };
    };
};
