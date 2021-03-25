const {default: PQueue} = require("p-queue");

const rp = require("promise-request-retry");
const config = require("./config");
const queue = new PQueue({concurrency: 1});

module.exports = class BSB {
    constructor(host, user, password) {
        this.host = host;
        if (user && password) {
            this.auth = {"Authorization": "Basic " + Buffer.from(user + ":" + password).toString("base64")};
        } else {
            this.auth = {};
        }
    }

    async query(values, endpoint) {
        const BATCH_SIZE = 30;
        let promiseChain = Promise.resolve();
        const results = {};
        const valuesArray = [...values];
        const slices = valuesArray.length / BATCH_SIZE;
        let index = 0;
        do {
            const slice = valuesArray.slice(index * BATCH_SIZE, index * BATCH_SIZE + BATCH_SIZE);
            promiseChain = promiseChain.then(() => rp(this.options("http://" + this.host + endpoint + "=" + [...slice].join(","))))
                .then(result => Object.assign(results, result));
            index++;
        } while (index < slices);

        return queue.add(() => promiseChain);
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
            method: "POST",
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

    async queryInfo() {
        // since bsb_lan 2.x
        return queue.add(() => rp(this.options("http://" + this.host + "/JI")));
    }

    async getParameterDefinitionAsync(values) {
        return await this.query(values, "/JC");
    }

    async getParameter(values) {
        return await this.query(values, "/JQ");
    }

    isReadWrite(id, dataType) {
        return id in config.objects && config.objects[id].rw && config.rwDataTypes.includes(dataType);
    }

    handleJSResponse(id, response) {
        const object = response[id];
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
            case 0: // VALS
                return value;
            case 1: // ENUM
                return value;
            case 2: // BITS
                return value;
            case 3: // WDAY, (not used)
                return value;
            case 4: // HHMM, hr:mm => hr.mm
                return value.replace(":", ".");
            case 5: // DTTM, Date and time ("09.01.2021 12:42:02"), must be set as "09.01.2021_12:42:02"
                return value.replace(" ", "_");
            case 6: // DDMM, Day and month ("25.10."), no special handling
                return value;
            case 7: // STRN
                return value;
            case 8: // DWHM, PPS time (day of week, hour:minute)
                return value;
            case 9: // TMPR, Time program "1. 04:00 - 21:00 2. --:-- - --:-- 3. --:-- - --:--" => "04:00-21:00_xx:xx-xx:xx_xx:xx-xx:x"
                return value
                    .replace("1. ", "")
                    .replace(" 2. ", "_")
                    .replace(" 3. ", "_")
                    .replace(/--/g, "xx")
                    .replace(/ - /g, "-");
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
    }
};
