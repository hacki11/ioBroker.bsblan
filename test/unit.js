const {expect} = require("chai");
const { describe, it } = require("node:test");
const BSB = require(__dirname + "/../lib/bsb");

// Run unit tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
// tests.unit(path.join(__dirname, ".."));
describe("BSB => trimParameterId", () => {
    const bsb = new BSB("http://host", "dummy", "password");

    it(`100 should be 100`, async () => {
        expect(bsb.trimParameterId("100")).to.be.equal("100");
    });

    it(`100.0 should be 100`, async () => {
        expect(bsb.trimParameterId("100.0")).to.be.equal("100");
    });

    it(`100.1 should be 100.1`, async () => {
        expect(bsb.trimParameterId("100.1")).to.be.equal("100.1");
    });
});

describe("BSB => validateParameterId", () => {
    const bsb = new BSB("http://host", "dummy", "password");

    it(`100 is valid id`, async () => {
        expect(bsb.validateParameterId("100")).to.be.equal(true);
    });

    it(`1 is valid id`, async () => {
        expect(bsb.validateParameterId("1")).to.be.equal(true);
    });

    it(`20000 is valid id`, async () => {
        expect(bsb.validateParameterId("20000")).to.be.equal(true);
    });

    it(`20000.0 is valid id`, async () => {
        expect(bsb.validateParameterId("20000.0")).to.be.equal(true);
    });

    it(`20000.9 is valid id`, async () => {
        expect(bsb.validateParameterId("20000.9")).to.be.equal(true);
    });

    it(`20000.9. is not valid id`, async () => {
        expect(bsb.validateParameterId("20000.9.")).to.be.equal(false);
    });

    it(`20000.a. is not valid id`, async () => {
        expect(bsb.validateParameterId("20000.a.")).to.be.equal(false);
    });

    it(`2000a is not valid id`, async () => {
        expect(bsb.validateParameterId("2000a")).to.be.equal(false);
    });

    it(`a is not valid id`, async () => {
        expect(bsb.validateParameterId("a")).to.be.equal(false);
    });

    it(`1a1 is not valid id`, async () => {
        expect(bsb.validateParameterId("1a1")).to.be.equal(false);
    });
});

describe("BSB => convert", () => {
    const bsb = new BSB("http://host", "dummy", "password");

    it(`VALS should return input value`, async () => {
        const input = "20.5";
        const expected = "20.5";
        expect(bsb.convertToBsb(input, 0)).to.be.equal(expected);
    });


    it(`ENUM should return input value`, async () => {
        const input = "3";
        const expected = "3";
        expect(bsb.convertToBsb(input, 1)).to.be.equal(expected);
    });

    it(`BITS should return input value`, async () => {
        const input = "00110011";
        const expected = "00110011";
        expect(bsb.convertToBsb(input, 2)).to.be.equal(expected);
    });

    it(`HHMM should return converted value`, async () => {
        const input = "07:00";
        const expected = "07.00";
        expect(bsb.convertToBsb(input, 4)).to.be.equal(expected);
    });

    it(`DTTM should return converted value`, async () => {
        const input = "25.03.2021 20:47:53";
        const expected = "25.03.2021_20:47:53";
        expect(bsb.convertToBsb(input, 5)).to.be.equal(expected);
    });

    it(`DTTM should return input value`, async () => {
        const input = "25.03.";
        const expected = "25.03.";
        expect(bsb.convertToBsb(input, 6)).to.be.equal(expected);
    });

    it(`DTTM should return input value`, async () => {
        const input = "string";
        const expected = "string";
        expect(bsb.convertToBsb(input, 6)).to.be.equal(expected);
    });

    it(`TIMEPROG should return converted value`, async () => {
        const expected = "04:12-21:00_xx:xx-xx:xx_xx:xx-xx:xx";
        const input = "1. 04:12-21:00 2. --:-- - --:-- 3. --:-- - --:--";
        expect(bsb.convertToBsb(input, 9)).to.be.equal(expected);
    });
});