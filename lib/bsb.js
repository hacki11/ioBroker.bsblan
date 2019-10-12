
const rp = require('request-promise');

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

    options(uri) {
        return {
            uri: uri,
            headers: this.auth,
            json: true,
            timeout: 15000
        };
    }
};