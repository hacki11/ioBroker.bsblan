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
        const version = await this.queryVersion();
        switch (version) {
            case "1.0":
                return await this.query24hAveragesV1();
            default:
                return await this.query24AveragesV2();
        }
    }

    // bsb_lan v1 only
    async query24hAveragesV1() {
        return queue.add(() => rp(this.options("http://" + this.host + "/JA")));
    }

    // since bsb_lan v2
    async query24AveragesV2() {
        return await this.query24AverageIds()
            .then(ids => this.getParameter(ids));
    }

    // since bsb_lan v2
    async query24AverageDefinitions() {
        return await this.query24AverageIds()
            .then(ids => this.getParameterDefinitionAsync(ids));
    }

    async query24AverageIds() {
        // 24h values are stored in 20050-20099 since bsb_lan v2
        const count = await this.query24AverageCount();

        // create the parameter array starting from 20050
        return this.range(count, 20050);
    }

    async query24AverageCount() {
        // check how many 24h average values are available
        const parameters = await this.queryConfiguration()
            .then(response => Object.values(response)
                .filter(p => Object.hasOwnProperty.call(p, "parameter"))
                .filter(p => p.parameter === 13)
                .map(p => p.value.split(",")));

        return parameters.length + 1;
    }

    async queryVersion() {
        const response = await queue.add(() => rp(this.options("http://" + this.host + "/JV")));
        if(Object.hasOwnProperty.call(response, "api_version")){
            return response["api_version"];
        } else {
            return "1.0";
        }
    }

    async queryConfiguration() {
        return queue.add(() => rp(this.options("http://" + this.host + "/JL")));
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
                Value: this.convertToBsb(value, type),
                Type: `${this.getWriteType(id)}`,
            },
            timeout: 15000,
            retry: 2,
            delay: 1000
        })
            .then(response => this.handleJSResponse(id, response)));
    }

    // since bsb_lan 2.x
    async queryInfo() {
        return queue.add(() => rp(this.options("http://" + this.host + "/JI")));
    }

    // since bsb_lan 2.x
    async getParameterDefinitionAsync(values) {
        return await this.query(values, "/JC");
    }

    async getParameter(values) {
        return await this.query(values, "/JQ");
    }

    getWriteType(id) {
        if(id in config.staticV1Config) {
            return config.staticV1Config[id].writeType;
        } else {
            // 1 is default
            return 1;
        }
    }

    isReadWrite(id) {
        return id in config.staticV1Config && config.staticV1Config[id].rw || true;
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

    convertToBsb(value, type) {
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

    range(size, startAt = 0) {
        return [...Array(size).keys()].map(i => i + startAt);
    }
};
