const {default: PQueue} = require('p-queue');

const rp = require('promise-request-retry');
const config = require('./config');
const queue = new PQueue({concurrency: 1});

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
        const BATCH_SIZE = 30;
        var promiseChain = Promise.resolve();
        var results = {}
        let valuesArray = [...values];
        let slices = valuesArray.length / BATCH_SIZE;
        let index = 0;
        do {
            let slice = valuesArray.slice(index * BATCH_SIZE, index * BATCH_SIZE + BATCH_SIZE)
            promiseChain = promiseChain.then(() => rp(this.options("http://" + this.host + "/JQ=" + [...slice].join(","))))
                .then(result => Object.assign(results, result));
            index++;
        } while (index < slices)

        return queue.add(() => promiseChain)
    }

    async query24hAverages() {
        return queue.add(() => rp(this.options("http://" + this.host + "/JA")));
    }

    async categories() {
        return queue.add(() => rp(this.options("http://" + this.host + "/JK=ALL")));
    }

    async category(id) {
        return queue.add(() => rp(this.options("http://" + this.host + "/JK=" + id)));
    }

    async write(id, value, type) {
        return queue.add(() => rp({
                method: 'POST',
                uri: "http://" + this.host + "/JS",
                headers: this.auth,
                json: true,
                body: {
                    Parameter: id,
                    Value: this.convert(value, type),
                    Type: `${config.objects[id].writeType}`,
                },
                timeout: 15000,
                retry: 2,
                delay: 1000
            }
        )
            .then(response => this.handleJSResponse(id, response)));
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
            delay: 1000,
            verbose_logging: false
        };
    };
};
