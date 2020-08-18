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
        var promiseChain = Promise.resolve();
        var results = {}
        let slices = values.size / 30;
        let index = 0;
        do {
            let slice = [...values].slice(index * 30, index * 30 + 30)
            promiseChain = promiseChain.then(() => rp(this.options("http://" + this.host + "/JQ=" + [...slice].join(","))))
                .then(result => Object.assign(results, result));
            index++;
        } while (index < slices)

        return promiseChain;
    }

    async categories() {
        return rp(this.options("http://" + this.host + "/JK=ALL"));
    }

    async category(id) {
        return rp(this.options("http://" + this.host + "/JK=" + id));
    }

    async write(id, value, type) {
        return rp({
                method: 'POST',
                uri: "http://" + this.host + "/JS",
                headers: this.auth,
                json: true,
                body: {
                    Parameter: id,
                    Value: this.convert(value, type),
                    Type: `"${config.objects[id].writeType}"`,
                },
                timeout: 15000,
                retry: 2,
                delay: 1000
            }
        )
            .then(response => this.handleJSResponse(id, response))
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
